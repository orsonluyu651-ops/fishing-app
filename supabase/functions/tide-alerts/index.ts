import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ──────────────────────────────────────────────────────────────
// tide-alerts — weather/tide/social push sweep (cron-oriented).
//
// Reads barometric + lunar readings (live payload POSTed by the scraper, or
// a deterministic mock series when none is supplied), computes the trailing
// pressure variance per location, and — when a location's variance shifts
// into the optimal feed window (±4 hPa over the trailing 6h by default) —
// fans a launch-frame alert out to every bound ExpoPushToken via the Expo
// Push API gateway.
//
// Auth: designed for a scheduler, not a user session. When
// TIDE_ALERTS_CRON_SECRET is set, requests must carry it as x-cron-secret.
// Database reads use SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase).
// ──────────────────────────────────────────────────────────────

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const PUSH_BATCH_SIZE = 100;
const HOUR_MS = 3_600_000;
const DEFAULT_WINDOW_HOURS = 6;
const DEFAULT_MIN_VARIANCE_HPA = 4;
const LAUNCH_FRAME_LEAD_MINUTES = 90;

const corsHeaders = (request: Request): HeadersInit => {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
  };
};

const json = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });

interface PressureReading {
  location: string;
  timestamp: string;
  pressureHpa: number;
  moonPhase?: string;
}

interface TideAlertPayload {
  readings?: PressureReading[];
  minVarianceHpa?: number;
  windowHours?: number;
}

interface LocationAnalysis {
  location: string;
  windowHours: number;
  startPressureHpa: number;
  endPressureHpa: number;
  varianceHpa: number;
  trend: 'rising' | 'falling' | 'steady';
  launchAt: string;
  moonPhase: string | null;
  tideNote: string | null;
  withinOptimalWindow: boolean;
  headline: string;
}

/** Drops malformed scraper rows instead of letting one bad point kill the sweep. */
function sanitizeReadings(raw: unknown): PressureReading[] {
  if (!Array.isArray(raw)) return [];
  const readings: PressureReading[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as Partial<PressureReading>;
    const location = typeof candidate.location === 'string' ? candidate.location.trim() : '';
    const timestamp = typeof candidate.timestamp === 'string' ? candidate.timestamp : '';
    const pressureHpa = candidate.pressureHpa;
    if (
      !location || location.length > 120 ||
      !timestamp || Number.isNaN(Date.parse(timestamp)) ||
      typeof pressureHpa !== 'number' || !Number.isFinite(pressureHpa) ||
      pressureHpa < 850 || pressureHpa > 1100
    ) {
      continue;
    }
    readings.push({
      location,
      timestamp: new Date(timestamp).toISOString(),
      pressureHpa,
      ...(typeof candidate.moonPhase === 'string' && candidate.moonPhase.trim()
        ? { moonPhase: candidate.moonPhase.trim().slice(0, 40) }
        : {}),
    });
  }
  return readings;
}

/**
 * Mock scraper stand-in: a deterministic 6h barometric series per monitored
 * location (two crossing the ±4 hPa feed threshold, one quiet) plus lunar
 * phase context. Swap the body for a real scraper (e.g. BOM hourly pressure)
 * — the grounding logic below is scraper-agnostic.
 */
function mockReadings(): PressureReading[] {
  const now = Date.now();
  const build = (
    location: string,
    startHpa: number,
    stepPerHour: number,
    moonPhase: string,
  ): PressureReading[] =>
    Array.from({ length: 7 }, (_, index) => ({
      location,
      timestamp: new Date(now - (6 - index) * HOUR_MS).toISOString(),
      pressureHpa: Number((startHpa + stepPerHour * index).toFixed(1)),
      moonPhase,
    }));
  return [
    ...build('Southport Seaway', 1012.4, -0.9, 'waxing gibbous'), // −5.4 hPa / 6h — falling front
    ...build('Broadwater Banks', 1009.8, 0.7, 'waxing gibbous'), // +4.2 hPa / 6h — rising ridge
    ...build('Jumpinpin Channel', 1015.0, 0.2, 'waning crescent'), // +1.2 hPa — quiet, no alert
  ];
}

function tideNoteFor(phase: string | null): string | null {
  if (!phase) return null;
  if (/new|full/i.test(phase)) return 'spring tides building';
  if (/quarter/i.test(phase)) return 'neap tides — subtle movement';
  return null;
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} UTC`;
}

/**
 * Grounding logic: slice the trailing window, compute the signed barometric
 * variance, and — when |variance| reaches the feed threshold — project the
 * optimal launch frame (pressure movement triggers feeding ~90 min out:
 * rising ridges push bait onto flats, falling fronts switch predators on).
 */
function analyzeLocation(
  readings: PressureReading[],
  windowHours: number,
  minVarianceHpa: number,
): LocationAnalysis {
  const sorted = [...readings].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const latest = sorted[sorted.length - 1];
  const windowStartMs = Date.parse(latest.timestamp) - windowHours * HOUR_MS;
  const inWindow = sorted.filter((reading) => Date.parse(reading.timestamp) >= windowStartMs);
  const first = inWindow[0] ?? latest;

  const varianceHpa = Number((latest.pressureHpa - first.pressureHpa).toFixed(1));
  const trend = varianceHpa > 0 ? 'rising' : varianceHpa < 0 ? 'falling' : 'steady';
  const withinOptimalWindow = Math.abs(varianceHpa) >= minVarianceHpa;
  const launchAt = new Date(
    Date.parse(latest.timestamp) + LAUNCH_FRAME_LEAD_MINUTES * 60_000,
  ).toISOString();

  const moonPhase = latest.moonPhase ?? first.moonPhase ?? null;
  const tideNote = tideNoteFor(moonPhase);

  const headline = withinOptimalWindow
    ? `Barometer ${trend} ${Math.abs(varianceHpa)} hPa in ${windowHours}h — prime launch frame around ${timeLabel(launchAt)}${tideNote ? ` (${tideNote})` : ''}.`
    : `Barometer steady (${varianceHpa >= 0 ? '+' : ''}${varianceHpa} hPa in ${windowHours}h) — no alert.`;

  return {
    location: latest.location,
    windowHours,
    startPressureHpa: first.pressureHpa,
    endPressureHpa: latest.pressureHpa,
    varianceHpa,
    trend,
    launchAt,
    moonPhase,
    tideNote,
    withinOptimalWindow,
    headline,
  };
}

interface PushTarget {
  userId: string;
  token: string;
  displayName: string | null;
}

/** Service-role read of every bound ExpoPushToken (migration 0016). */
async function loadPushTargets(
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<PushTarget[]> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, expo_push_token')
    .not('expo_push_token', 'is', null)
    .limit(1000);
  if (error) throw error;
  return (data ?? [])
    .filter((row) => typeof row.expo_push_token === 'string' && row.expo_push_token.length > 0)
    .map((row) => ({
      userId: row.id as string,
      token: row.expo_push_token as string,
      displayName: (row.display_name as string | null) ?? null,
    }));
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound?: 'default';
  data?: Record<string, unknown>;
}

/**
 * Delivers messages to the Expo Push gateway in ≤100-message batches.
 * Gateway and per-ticket failures are counted into the summary — a partial
 * gateway outage degrades the sweep instead of rejecting it.
 */
async function sendPushBatches(
  messages: ExpoPushMessage[],
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const delivery = { sent: 0, failed: 0, errors: [] as string[] };
  for (let index = 0; index < messages.length; index += PUSH_BATCH_SIZE) {
    const batch = messages.slice(index, index + PUSH_BATCH_SIZE);
    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        delivery.failed += batch.length;
        delivery.errors.push(`gateway ${response.status}`.slice(0, 140));
        continue;
      }
      const tickets = (await response.json()) as {
        data?: Array<{ status?: string; message?: string }>;
      };
      const results = Array.isArray(tickets?.data) ? tickets.data : [];
      for (const ticket of results) {
        if (ticket?.status === 'ok') delivery.sent += 1;
        else {
          delivery.failed += 1;
          if (ticket?.message) delivery.errors.push(ticket.message.slice(0, 140));
        }
      }
      if (results.length === 0) delivery.failed += batch.length;
    } catch (error) {
      delivery.failed += batch.length;
      delivery.errors.push(
        String((error as { message?: string } | null)?.message ?? error).slice(0, 140),
      );
    }
  }
  return delivery;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== 'POST' && request.method !== 'GET') {
    return json(request, { error: 'method_not_allowed', message: 'Use POST or GET for tide-alerts.' }, 405);
  }

  try {
    // Cron guard: when a secret is configured, the sweep is not open.
    const cronSecret = Deno.env.get('TIDE_ALERTS_CRON_SECRET');
    if (cronSecret && request.headers.get('x-cron-secret') !== cronSecret) {
      return json(request, { error: 'unauthorized', message: 'Missing or invalid x-cron-secret header.' }, 401);
    }

    let payload: TideAlertPayload = {};
    if (request.method === 'POST') {
      try {
        payload = (await request.json()) as TideAlertPayload;
      } catch {
        payload = {}; // Body-less invocation → fall through to the mock scraper.
      }
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      throw new Error('Supabase function environment is incomplete.');
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const windowHours = clamp(
      typeof payload.windowHours === 'number' && Number.isFinite(payload.windowHours)
        ? payload.windowHours
        : DEFAULT_WINDOW_HOURS,
      1,
      12,
    );
    const minVarianceHpa = clamp(
      typeof payload.minVarianceHpa === 'number' && Number.isFinite(payload.minVarianceHpa)
        ? payload.minVarianceHpa
        : DEFAULT_MIN_VARIANCE_HPA,
      0.5,
      10,
    );

    const readings = payload.readings?.length ? sanitizeReadings(payload.readings) : mockReadings();
    if (readings.length === 0) {
      return json(request, {
        error: 'invalid_readings',
        message: 'No usable barometric readings found.',
      }, 400);
    }

    // Group per location, then ground each series independently.
    const byLocation = new Map<string, PressureReading[]>();
    for (const reading of readings) {
      const series = byLocation.get(reading.location) ?? [];
      series.push(reading);
      byLocation.set(reading.location, series);
    }
    const analyses: LocationAnalysis[] = [];
    for (const series of byLocation.values()) {
      analyses.push(analyzeLocation(series, windowHours, minVarianceHpa));
    }

    // Downstream delivery: only locations inside the optimal feed window fire.
    const firing = analyses.filter((analysis) => analysis.withinOptimalWindow);
    let delivery = { sent: 0, failed: 0, errors: [] as string[] };
    let recipients = 0;
    if (firing.length > 0) {
      const targets = await loadPushTargets(supabaseAdmin);
      recipients = targets.length;
      if (targets.length > 0) {
        const messages: ExpoPushMessage[] = targets.flatMap((target) =>
          firing.map((analysis) => ({
            to: target.token,
            title: 'TideWire · Tide & weather window',
            body: `${analysis.headline} (${analysis.location})`,
            sound: 'default' as const,
            data: {
              deepLink: '/(tabs)/guide',
              location: analysis.location,
              varianceHpa: analysis.varianceHpa,
              launchAt: analysis.launchAt,
            },
          })),
        );
        delivery = await sendPushBatches(messages);
      }
    }

    return json(request, {
      mode: payload.readings?.length ? 'payload' : 'mock-scraper',
      windowHours,
      minVarianceHpa,
      analyses,
      alertsFired: firing.length,
      recipients,
      delivery,
    });
  } catch (error) {
    console.error('tide-alerts failed', error);
    return json(request, {
      error: 'tide_alerts_failed',
      message: 'The tide alerts sweep could not be completed.',
    }, 500);
  }
});

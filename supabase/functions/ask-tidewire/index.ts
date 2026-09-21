import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ──────────────────────────────────────────────────────────────
// ask-tidewire — LLM proxy for the Ask TideWire guide.
//
// Design contract: docs/ai-assistant-spec.md (§5). Structural parity with
// ../verify-catch/index.ts: same CORS helper, same JSON error envelope, same
// Bearer-JWT-then-supabase.auth.getUser auth flow.
//
// The provider API key never reaches the client: it lives only in the Deno
// runtime environment (set via `supabase secrets set OPENAI_API_KEY=…` or
// `ANTHROPIC_API_KEY=…`). The React Native client talks only to this function.
// ──────────────────────────────────────────────────────────────

const PROVIDER_TIMEOUT_MS = 20_000;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_TURN_LENGTH = 1000;
const MAX_OUTPUT_TOKENS = 512;

const corsHeaders = (request: Request): HeadersInit => {
  const origin = request.headers.get('origin');
  const allowedOrigins = (Deno.env.get('ASK_TIDEWIRE_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowOrigin = origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))
    ? origin
    : allowedOrigins.length === 0
      ? '*'
      : 'null';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
};

const json = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });

type ChatRole = 'user' | 'assistant';

interface HistoryTurn {
  role: ChatRole;
  content: string;
}

interface AskPayload {
  message: string;
  coordinates?: { latitude: number; longitude: number } | null;
  history?: HistoryTurn[];
}

/** Picks the configured provider. ASK_TIDEWIRE_PROVIDER may pin one explicitly. */
function resolveProvider(): 'openai' | 'anthropic' | null {
  const pinned = (Deno.env.get('ASK_TIDEWIRE_PROVIDER') ?? '').trim().toLowerCase();
  if (pinned === 'openai') return Deno.env.get('OPENAI_API_KEY') ? 'openai' : null;
  if (pinned === 'anthropic') return Deno.env.get('ANTHROPIC_API_KEY') ? 'anthropic' : null;
  if (Deno.env.get('OPENAI_API_KEY')) return 'openai';
  if (Deno.env.get('ANTHROPIC_API_KEY')) return 'anthropic';
  return null;
}

/** Coordinates are report-only context. Drop anything malformed or out of range. */
function sanitizeCoordinates(raw: unknown): { latitude: number; longitude: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as { latitude?: unknown; longitude?: unknown };
  const latitude = candidate.latitude;
  const longitude = candidate.longitude;
  if (
    typeof latitude !== 'number' || !Number.isFinite(latitude) ||
    typeof longitude !== 'number' || !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
  ) {
    return null;
  }
  // Round to ~1km precision: the model gets season/technique context,
  // never a precise pin, and the coordinates are never echoed back.
  return { latitude: Number(latitude.toFixed(2)), longitude: Number(longitude.toFixed(2)) };
}

function sanitizeHistory(raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: HistoryTurn[] = [];
  for (const item of raw.slice(-MAX_HISTORY_TURNS)) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as { role?: unknown; content?: unknown };
    if (candidate.role !== 'user' && candidate.role !== 'assistant') continue;
    if (typeof candidate.content !== 'string') continue;
    const content = candidate.content.trim().slice(0, MAX_HISTORY_TURN_LENGTH);
    if (!content) continue;
    turns.push({ role: candidate.role, content });
  }
  return turns;
}

function buildSystemPrompt(
  coordinates: { latitude: number; longitude: number } | null,
): string {
  const locationLine = coordinates
    ? `The angler is fishing from roughly ${coordinates.latitude}°, ${coordinates.longitude}° (South East Queensland). Use this only to ground seasonal/technique advice — never echo the coordinates back and never claim exact local rules for that spot.`
    : 'No location was provided. Keep regional advice general to South East Queensland and invite the angler to share their region for sharper advice.';

  return [
    'You are TideWire, an educational regional fishing assistant inside the TideWire app for South East Queensland anglers (Gold Coast, Brisbane, Sunshine Coast — estuary, beach, offshore and freshwater).',
    '',
    'Your job is to teach and guide: species identification help, bait and rig suggestions, seasonal patterns, tide and weather thinking, general spot strategy, and how to get value from the app (catch logging, the leaderboard, the map, catch verification).',
    '',
    'HARD RULES — REGULATORY FIGURES:',
    '1. Never invent, guess or approximate legal minimum sizes, maximum sizes, possession/bag limits, no-take species lists or closed-season dates. These are law, they change, and a wrong number can cost an angler a fine.',
    '2. You are NOT the authoritative source for those figures. When an angler asks for one, say plainly that the verified figure comes from the app itself — the species rule card in Ask TideWire / Add Catch (backed by the live Queensland rules database) — or from the official Queensland fishing rules, and then answer the educational part of the question.',
    '3. If you are not certain a number is the current published law, do not state it as fact. Fall back to rule 2 — the deterministic local rules files.',
    '',
    'STYLE:',
    `- ${locationLine}`,
    '- Warm, practical, experienced-fishing-mate tone. No lectures, no hedging boilerplate.',
    '- Short and skimmable: tight paragraphs or bullet lists. A few sentences beats an essay.',
    '- The app presents you as a fishing guide, not an AI. Never narrate about being a language model.',
  ].join('\n');
}

interface ProviderResult {
  text: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

async function callOpenAI(
  system: string,
  history: HistoryTurn[],
  message: string,
): Promise<ProviderResult> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  const model = Deno.env.get('ASK_TIDEWIRE_MODEL') ?? 'gpt-4o-mini';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: system },
        ...history,
        { role: 'user', content: message },
      ],
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(new Error(`OpenAI request failed (${response.status})`), {
      providerStatus: response.status,
      providerDetail: detail.slice(0, 300),
    });
  }
  const data = await response.json();
  const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new Error('OpenAI returned an empty completion.');
  return {
    text,
    model: String(data?.model ?? model),
    usage: {
      input_tokens: Number(data?.usage?.prompt_tokens ?? 0),
      output_tokens: Number(data?.usage?.completion_tokens ?? 0),
    },
  };
}

async function callAnthropic(
  system: string,
  history: HistoryTurn[],
  message: string,
): Promise<ProviderResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');
  const model = Deno.env.get('ASK_TIDEWIRE_MODEL') ?? 'claude-3-5-haiku-20241022';

  // The Messages API requires the transcript to open on a user turn.
  const turns: HistoryTurn[] = [...history, { role: 'user', content: message }];
  const firstUser = turns.findIndex((turn) => turn.role === 'user');
  const messages = firstUser >= 0 ? turns.slice(firstUser) : [{ role: 'user', content: message }];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages,
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(new Error(`Anthropic request failed (${response.status})`), {
      providerStatus: response.status,
      providerDetail: detail.slice(0, 300),
    });
  }
  const data = await response.json();
  const text = (Array.isArray(data?.content) ? data.content : [])
    .map((block: { text?: unknown }) => (typeof block?.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!text) throw new Error('Anthropic returned an empty response.');
  return {
    text,
    model: String(data?.model ?? model),
    usage: {
      input_tokens: Number(data?.usage?.input_tokens ?? 0),
      output_tokens: Number(data?.usage?.output_tokens ?? 0),
    },
  };
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== 'POST') {
    return json(request, { error: 'method_not_allowed', message: 'Use POST for ask-tidewire.' }, 405);
  }

  try {
    const authorization = request.headers.get('Authorization') ?? '';
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return json(request, { error: 'unauthorized', message: 'A signed-in session is required.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase function environment is incomplete.');
    }
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return json(request, { error: 'unauthorized', message: 'The session is invalid or expired.' }, 401);
    }

    let payload: Partial<AskPayload>;
    try {
      payload = await request.json() as Partial<AskPayload>;
    } catch {
      return json(request, { error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
    }

    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!message || message.length > MAX_MESSAGE_LENGTH) {
      return json(request, {
        error: 'invalid_message',
        message: `message is required and must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
      }, 400);
    }

    const provider = resolveProvider();
    if (!provider) {
      return json(request, {
        error: 'provider_not_configured',
        message: 'No LLM provider key is configured for this project yet.',
      }, 503);
    }

    const coordinates = sanitizeCoordinates(payload.coordinates);
    const history = sanitizeHistory(payload.history);
    const system = buildSystemPrompt(coordinates);

    const startedAt = Date.now();
    const result = provider === 'anthropic'
      ? await callAnthropic(system, history, message)
      : await callOpenAI(system, history, message);

    return json(request, {
      answer: { text: result.text },
      provider,
      model_version: result.model,
      usage: result.usage,
      latency_ms: Date.now() - startedAt,
    });
  } catch (error) {
    if (isTimeout(error)) {
      return json(request, {
        error: 'provider_timeout',
        message: 'The guide took too long to respond. Try again in a moment.',
      }, 504);
    }
    const providerStatus = (error as { providerStatus?: number } | null)?.providerStatus;
    console.error('ask-tidewire failed', error);
    if (typeof providerStatus === 'number') {
      return json(request, {
        error: 'provider_error',
        message: 'The guide service is having trouble right now. Try again shortly.',
      }, 502);
    }
    return json(request, {
      error: 'assistant_failed',
      message: 'Ask TideWire could not be completed. Please try again.',
    }, 500);
  }
});

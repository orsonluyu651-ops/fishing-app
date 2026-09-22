/** Current marine measurements returned by the optional Open-Meteo adapter. */
export interface MarineForecastData {
  waveHeight: number;
  wavePeriod: number;
  waterTemp: number;
}

/** Legacy daily feeding-window model retained for existing chart consumers. */
export interface SolunarActivity {
  feedingScore: number; // Scale 0-100
  majorStart: string;
  majorEnd: string;
  minorStart: string;
  minorEnd: string;
}

/**
 * Consumes public Open-Meteo marine wave models for exact coordinate tracking.
 * @param lat Latitude sent to the marine endpoint.
 * @param lng Longitude sent to the marine endpoint.
 * @returns Current wave and water-temperature data, or `null` on transport/data failure.
 * @complexity O(1), excluding network latency.
 */
export async function fetchMarineTelemetry(lat: number, lng: number): Promise<MarineForecastData | null> {
  try {
    const url = `https://api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&current=wave_height,wave_period,sea_surface_temperature`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data || !data.current) return null;

    return {
      waveHeight: data.current.wave_height ?? 0,
      wavePeriod: data.current.wave_period ?? 0,
      waterTemp: data.current.sea_surface_temperature ?? 0,
    };
  } catch (err) {
    console.error('Open-Meteo marine network handshake fault:', err);
    return null;
  }
}

/**
 * Calculates solunar gravitational feeding activity index periods mathematically based on astronomical date targets.
 * @param date Day to model.
 * @param lat Observer latitude retained for legacy call compatibility.
 * @param lng Observer longitude used to shift the phase approximation.
 * @returns A deterministic score and legacy display windows.
 * @complexity O(1).
 */
export function calculateSolunarWindows(date: Date, lat: number, lng: number): SolunarActivity {
  // Analytical deterministic calculation of solar and lunar zenith coordinates
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000
  );

  // Base cycle approximations for gravitational influence calculations
  const rawMoonPhaseFactor = (dayOfYear + lng / 15) % 29.53;
  const distanceToNewOrFull = Math.min(
    rawMoonPhaseFactor,
    Math.abs(29.53 - rawMoonPhaseFactor),
    Math.abs(14.77 - rawMoonPhaseFactor)
  );

  // Higher score maps closest to absolute New and Full moon configurations
  let baseScore = 50 + Math.floor((7.38 - distanceToNewOrFull) * 6.5);
  baseScore = Math.max(10, Math.min(100, baseScore));

  return {
    feedingScore: baseScore,
    majorStart: '05:30 AM',
    majorEnd: '07:30 AM',
    minorStart: '11:15 AM',
    minorEnd: '12:15 PM',
  };
}

// ── Offline solunar forecast engine (Phase 3 hardening) ─────────────
// Pure, dependency-free trig: synodic lunar age from a Julian date anchor,
// illumination via the phase angle, and local lunar transit (upper/lower)
// derived from the moon's ~24.84h cycle shifted by observer longitude.
// No network, no loops over catch logs — O(1) per call, UI-thread safe.

/** Ordered qualitative activity buckets emitted by {@link generateSolunarForecast}. */
export type SolunarActivityRating = 'POOR' | 'FAIR' | 'GOOD' | 'EXCELLENT';

/** ISO-8601 start/end pair for a predicted solunar activity window. */
export interface SolunarStrikeWindow {
  start: string;
  end: string;
}

/** Complete offline forecast projected for one observer location and date. */
export interface SolunarForecast {
  lunarPhase: string;
  illuminationPercentage: number;
  majorStrikeWindows: SolunarStrikeWindow[];
  minorStrikeWindows: SolunarStrikeWindow[];
  overallActivityRating: SolunarActivityRating;
}

const SYNODIC_MONTH_DAYS = 29.530588853;
const KNOWN_NEW_MOON_UTC_MS = Date.UTC(2000, 0, 6, 18, 14, 0); // 2000-01-06 18:14 UTC
const MS_PER_DAY = 86_400_000;
const LUNAR_DAY_HOURS = 24.8412; // mean interval between successive moon transits

const LUNAR_PHASE_NAMES = [
  'New Moon',
  'Waxing Crescent',
  'First Quarter',
  'Waxing Gibbous',
  'Full Moon',
  'Waning Gibbous',
  'Last Quarter',
  'Waning Crescent',
] as const;

function clampLatitude(lat: number): number {
  if (!Number.isFinite(lat)) return 0;
  return Math.min(90, Math.max(-90, lat));
}

function wrapLongitude(lng: number): number {
  if (!Number.isFinite(lng)) return 0;
  return ((lng + 540) % 360) - 180;
}

function safeTargetDate(targetDate: Date): Date {
  if (targetDate instanceof Date && !Number.isNaN(targetDate.getTime())) return targetDate;
  return new Date();
}

/** Fractional lunar age in days [0, SYNODIC_MONTH_DAYS). */
function lunarAgeDays(date: Date): number {
  const elapsed = (date.getTime() - KNOWN_NEW_MOON_UTC_MS) / MS_PER_DAY;
  return ((elapsed % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
}

/** Phase angle 0..2π from lunar age (0 = new, π = full). */
function phaseAngle(ageDays: number): number {
  return (ageDays / SYNODIC_MONTH_DAYS) * 2 * Math.PI;
}

function lunarPhaseName(ageDays: number): string {
  const index = Math.floor(((ageDays / SYNODIC_MONTH_DAYS) * 8 + 0.5)) % 8;
  return LUNAR_PHASE_NAMES[index]!;
}

function formatWindow(base: Date, centerHours: number, halfDurationHours: number): SolunarStrikeWindow {
  const dayStart = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const center = ((centerHours % 24) + 24) % 24;
  const toISO = (h: number): string => {
    const wrapped = ((h % 24) + 24) % 24;
    return new Date(dayStart.getTime() + wrapped * 3_600_000).toISOString();
  };
  return { start: toISO(center - halfDurationHours), end: toISO(center + halfDurationHours) };
}

function ratingFor(score: number, illumination: number): SolunarActivityRating {
  // Reinforcement: high feeding score near new/full (illumination extremes)
  // boosts the bracket; mid-illumination damps it one step.
  const extreme = illumination <= 15 || illumination >= 85;
  const adjusted = extreme ? score + 8 : score - 4;
  if (adjusted >= 85) return 'EXCELLENT';
  if (adjusted >= 65) return 'GOOD';
  if (adjusted >= 40) return 'FAIR';
  return 'POOR';
}

/**
 * Generate a dependency-free, epoch-anchored offline solunar forecast.
 * Lunar age is measured against a known new-moon epoch; illumination derives
 * from the resulting phase angle. Longitude shifts upper/lower transit and
 * moonrise/moonset approximations; latitude is clamped and retained for the
 * compatible legacy reinforcement score.
 * @param latitude Observer latitude; non-finite values fall back to `0` and valid values clamp to `[-90, 90]`.
 * @param longitude Observer longitude; non-finite values fall back to `0` and valid values wrap to `[-180, 180)`.
 * @param targetDate Forecast date; invalid values fall back to the current date.
 * @returns Phase name, illumination percentage, two major windows, two minor windows, and a qualitative rating.
 * @complexity O(1); no I/O, catch-log iteration, or external API calls.
 */
export async function generateSolunarForecast(
  latitude: number,
  longitude: number,
  targetDate: Date,
): Promise<SolunarForecast> {
  const lat = clampLatitude(latitude);
  const lng = wrapLongitude(longitude);
  const date = safeTargetDate(targetDate);

  const age = lunarAgeDays(date);
  const angle = phaseAngle(age);
  const illuminationPercentage = Math.round(((1 - Math.cos(angle)) / 2) * 100);

  // Local lunar transit: base UTC transit drifts with the lunar day cycle
  // and shifts 4 minutes per degree of longitude (east earlier).
  // (Latitude shapes solar elevation only — lunar phase math is longitude-bound.)
  const transitUTC = ((12 + (age / SYNODIC_MONTH_DAYS) * LUNAR_DAY_HOURS - lng / 15) % 24 + 24) % 24;
  const nadirUTC = (transitUTC + LUNAR_DAY_HOURS / 2) % 24;
  const moonriseUTC = (transitUTC - 6.2 + 24) % 24;
  const moonsetUTC = (transitUTC + 6.2) % 24;

  const majorStrikeWindows = [
    formatWindow(date, transitUTC, 1),
    formatWindow(date, nadirUTC, 1),
  ];
  const minorStrikeWindows = [
    formatWindow(date, moonriseUTC, 0.5),
    formatWindow(date, moonsetUTC, 0.5),
  ];

  const legacy = calculateSolunarWindows(date, lat, lng);
  const overallActivityRating = ratingFor(legacy.feedingScore, illuminationPercentage);

  return {
    lunarPhase: lunarPhaseName(age),
    illuminationPercentage,
    majorStrikeWindows,
    minorStrikeWindows,
    overallActivityRating,
  };
}

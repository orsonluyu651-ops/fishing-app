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

/** Mean synodic month in days — the J2000-anchored lunar phase constant. */
export const SYNODIC_MONTH = 29.530588853;

/** UTC milliseconds of the J2000 reference new moon: 2000-01-06 18:14 UT. */
export const J2000_NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14, 0);

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

/** Fractional lunar age in days [0, SYNODIC_MONTH). */
function lunarAgeDays(date: Date): number {
  const elapsed = (date.getTime() - J2000_NEW_MOON_EPOCH_MS) / MS_PER_DAY;
  return ((elapsed % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
}

/** Phase angle 0..2π from lunar age (0 = new, π = full). */
function phaseAngle(ageDays: number): number {
  return (ageDays / SYNODIC_MONTH) * 2 * Math.PI;
}

function lunarPhaseName(ageDays: number): string {
  const index = Math.floor(((ageDays / SYNODIC_MONTH) * 8 + 0.5)) % 8;
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

  // Transit engine (shared with buildSolunarDayForecast — single source of
  // transit truth): longitude shifts 4 min/degree, lunar day 24.8412 h.
  // (Latitude shapes solar elevation only — lunar phase math is longitude-bound.)
  const { upperTransitUTC, lowerTransitUTC, moonriseUTC, moonsetUTC } =
    computeLunarTransitOffsets(date, lng);

  const majorStrikeWindows = [
    formatWindow(date, upperTransitUTC, 1),
    formatWindow(date, lowerTransitUTC, 1),
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

// ── Synodic moon tracker, transit engine & window calculator (Phase 3)
// Offline prediction matrix: pure O(1) trig, zero dependencies, UI-thread
// safe. buildSolunarDayForecast composes the tracker + transit engine into
// the structured daily profile consumed by charts and offline packs.

/** Latitude beyond which rise/set approximations degrade (polar circles). */
export const SOLUNAR_POLAR_LATITUDE_DEGREES = 66.5633;

/** Synodic moon tracker snapshot for one epoch timestamp. */
export interface SynodicMoonState {
  /** Fractional lunar age in days, [0, SYNODIC_MONTH). */
  ageDays: number;
  /** Normalized phase progress, [0, 1): 0 new → 0.5 full → 1 new. */
  phaseFraction: number;
  /** Phase angle in radians, [0, 2π): 0 = new, π = full. */
  phaseAngleRadians: number;
  /** Illuminated fraction of the lunar disk, 0–100 (rounded). */
  illumination: number;
  /** Qualitative 8-bucket phase name. */
  phaseName: string;
  /** True while the disk grows (new → full). */
  waxing: boolean;
}

/**
 * Synodic moon tracker: exact lunar illumination and current phase for a
 * given epoch timestamp, anchored to the J2000 reference new moon
 * ({@link J2000_NEW_MOON_EPOCH_MS}) and the mean synodic month
 * ({@link SYNODIC_MONTH}).
 * @param timestamp Epoch instant (`Date` or milliseconds since the Unix epoch). Invalid inputs fall back to the Unix epoch.
 * @returns Deterministic lunar state snapshot.
 * @complexity O(1); no I/O.
 */
export function getSynodicMoonState(timestamp: Date | number): SynodicMoonState {
  const ms = timestamp instanceof Date ? timestamp.getTime() : timestamp;
  const instant = Number.isFinite(ms) ? new Date(ms) : new Date(0);
  const age = lunarAgeDays(instant);
  const angle = phaseAngle(age);
  const fraction = age / SYNODIC_MONTH;
  return {
    ageDays: age,
    phaseFraction: fraction,
    phaseAngleRadians: angle,
    illumination: Math.round(((1 - Math.cos(angle)) / 2) * 100),
    phaseName: lunarPhaseName(age),
    waxing: fraction < 0.5,
  };
}

/** Local lunar transit offsets in UTC hours ([0, 24)) for one observer/date. */
export interface LunarTransitOffsets {
  /** Upper transit (moon at/nearest the local zenith). */
  upperTransitUTC: number;
  /** Lower transit (anti-zenith), half a lunar day after the upper. */
  lowerTransitUTC: number;
  /** Approximated moonrise, ~6.2 h before upper transit. */
  moonriseUTC: number;
  /** Approximated moonset, ~6.2 h after upper transit. */
  moonsetUTC: number;
}

/**
 * Transit engine: upper/lower lunar transit and rise/set offsets for an
 * observer longitude. The base UTC transit drifts with the 24.8412 h lunar
 * day and shifts 4 minutes per degree of longitude (east earlier).
 * @param targetDate Forecast instant; invalid values fall back to now.
 * @param longitude Observer longitude; non-finite values fall back to `0`, valid values wrap to `[-180, 180)`.
 * @returns Deterministic UTC-hour offsets, each in `[0, 24)`.
 * @complexity O(1); no I/O.
 */
export function computeLunarTransitOffsets(targetDate: Date, longitude: number): LunarTransitOffsets {
  const date = safeTargetDate(targetDate);
  const lng = wrapLongitude(longitude);
  const age = lunarAgeDays(date);

  const upperTransitUTC = ((12 + (age / SYNODIC_MONTH) * LUNAR_DAY_HOURS - lng / 15) % 24 + 24) % 24;
  const lowerTransitUTC = (upperTransitUTC + LUNAR_DAY_HOURS / 2) % 24;
  const moonriseUTC = (upperTransitUTC - 6.2 + 24) % 24;
  const moonsetUTC = (upperTransitUTC + 6.2) % 24;

  return { upperTransitUTC, lowerTransitUTC, moonriseUTC, moonsetUTC };
}

/** Structured daily solunar profile for the offline prediction matrix. */
export interface SolunarDayForecast {
  /** UTC midnight ISO instant of the forecast day. */
  date: string;
  /** Qualitative 8-bucket lunar phase name. */
  lunarPhase: string;
  /** Illuminated disk fraction, 0–100. */
  illumination: number;
  /** Legacy gravitational feeding score, 10–100. */
  feedingIndex: number;
  /** Two 2 h windows centered on the upper/lower lunar transits. */
  majorWindows: SolunarStrikeWindow[];
  /** Two 1 h windows centered on rise/set (or fallback offsets). */
  minorWindows: SolunarStrikeWindow[];
  /** Qualitative overall rating. */
  rating: SolunarActivityRating;
  /** True when |latitude| exceeded the polar-circle fallback bound. */
  latitudeFallbackApplied: boolean;
}

/**
 * Window calculator: composes the synodic tracker and transit engine into a
 * structured {@link SolunarDayForecast} — major 2 h feeding windows centered
 * on the transits, minor 1 h windows centered on rise/set events. Extreme
 * high/low latitudes (|lat| > {@link SOLUNAR_POLAR_LATITUDE_DEGREES}) switch
 * the minor windows to quarter-lunar-day fallback offsets, because
 * horizon-grazing moons make rise/set approximations degenerate.
 * @param latitude Observer latitude; non-finite values fall back to `0`, valid values clamp to `[-90, 90]`.
 * @param longitude Observer longitude; non-finite values fall back to `0`, valid values wrap to `[-180, 180)`.
 * @param targetDate Forecast day; invalid values fall back to now.
 * @returns Deterministic daily profile.
 * @complexity O(1); no I/O, catch-log iteration, or external API calls.
 */
export function buildSolunarDayForecast(
  latitude: number,
  longitude: number,
  targetDate: Date,
): SolunarDayForecast {
  const lat = clampLatitude(latitude);
  const lng = wrapLongitude(longitude);
  const date = safeTargetDate(targetDate);

  const moon = getSynodicMoonState(date);
  const transits = computeLunarTransitOffsets(date, lng);
  const latitudeFallbackApplied = Math.abs(lat) > SOLUNAR_POLAR_LATITUDE_DEGREES;

  // Fallback: quarter-lunar-day offsets from upper transit keep the minor
  // windows well-defined when rise/set events degenerate near the poles.
  const minorCenters = latitudeFallbackApplied
    ? [
        (transits.upperTransitUTC + LUNAR_DAY_HOURS / 4) % 24,
        (transits.upperTransitUTC + (3 * LUNAR_DAY_HOURS) / 4) % 24,
      ]
    : [transits.moonriseUTC, transits.moonsetUTC];

  const legacy = calculateSolunarWindows(date, lat, lng);

  return {
    date: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString(),
    lunarPhase: moon.phaseName,
    illumination: moon.illumination,
    feedingIndex: legacy.feedingScore,
    majorWindows: [
      formatWindow(date, transits.upperTransitUTC, 1),
      formatWindow(date, transits.lowerTransitUTC, 1),
    ],
    minorWindows: [
      formatWindow(date, minorCenters[0]!, 0.5),
      formatWindow(date, minorCenters[1]!, 0.5),
    ],
    rating: ratingFor(legacy.feedingScore, moon.illumination),
    latitudeFallbackApplied,
  };
}

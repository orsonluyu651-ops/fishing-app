/**
 * Angler Copilot — Predictive AI Fishing Advisor engine.
 *
 * A deterministic, offline-first service layer that:
 *   1. Aggregates spot telemetry from the offline Solunar cache + a deterministic
 *      tidal model (compileSpotTelemetry).
 *   2. Scores bite probability on a 1-100 matrix (calculateBiteProbabilityScore).
 *   3. Builds a structured LLM prompt and resolves a FishingTacticsBreakdown via a
 *      local SQLite `ai_tactics_cache` table with a deterministic network-stub
 *      fallback (fetchAITactics / buildAIPrompt).
 *
 * Storage is routed behind injectable adapter interfaces (FishingAdvisorProviders)
 * so production uses expo-sqlite while unit tests inject in-memory stores. SQLite
 * opens lazily + is web-guarded, so importing this module on web / during pure-logic
 * unit tests never touches native bindings.
 */

import { Platform } from 'react-native';
import {
  buildSolunarDayForecast,
  type SolunarActivityRating,
  type SolunarDayForecast,
  type SolunarStrikeWindow,
} from './solunarEngine';

// ── Constants ──

const ADVISOR_DB_NAME = 'fishlore_offline.db';
const ADVISOR_CACHE_TABLE = 'fishing_advisor_cache';
const TACTICS_CACHE_TABLE = 'ai_tactics_cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PROXIMITY_GRACE_MS = 30 * 60_000; // 30 min window treated as "approaching a peak"

// Deterministic semi-diurnal tidal model (mirrors the Gold Coast seaway model
// in components/SolunarForecaster.tsx, but UTC-normalised & TZ-independent).
const TIDAL_PERIOD_HOURS = 12.42;
const TIDE_BASE_HEIGHT_M = 1.8;
const TIDE_AMPLITUDE_M = 0.8;
const TIDE_AMPLITUDE_REFERENCE_M = 2.0;

// Bite-probability scoring weights.
const SCORE_MIN = 1;
const SCORE_MAX = 100;
const SOLUNAR_WEIGHT_MAX = 40;
const TIDE_WEIGHT_MAX = 30;
const TIMING_WEIGHT_MAX = 20;
const PHASE_WEIGHT_MAX = 10;
const MAJOR_CONTAIN_BONUS = 20;
const MINOR_CONTAIN_BONUS = 5;
const PROXIMITY_BONUS = 8;
const RISING_TIDE_BONUS = 15;
const FALLING_TIDE_BONUS = 10;
const TURNING_POINT_BONUS = 15;
const TWILIGHT_PEAK = 20;
const TWILIGHT_NEAR = 12;
const TWILIGHT_FAR = 6;
const TWILIGHT_FALLBACK = 2;
const TWILIGHT_ANCHORS = [6, 18]; // local 06:00 / 18:00 = dawn & dusk

// ── Types ──

export interface SpotLocation {
  latitude: number;
  longitude: number;
}

export type TideDirection = 'incoming' | 'outgoing' | 'slack';

export interface TideEvent {
  time: number; // epoch ms
  height: number; // metres
  type: 'high' | 'low';
}

export interface TideSnapshot {
  heightAtInstant: number;
  direction: TideDirection;
  nextTurn: { time: number; type: 'high' | 'low' } | null;
  turningPoints: TideEvent[];
  tidalRangeM: number;
}

export interface SolunarSnapshot {
  moonPhase: string;
  illumination: number; // 0-100
  feedingIndex: number; // 10-100
  rating: SolunarActivityRating;
  majorWindows: SolunarStrikeWindow[];
  minorWindows: SolunarStrikeWindow[];
}

export interface ScoreFactors {
  solunarPoints: number;
  tidePoints: number;
  timingPoints: number;
  phasePoints: number;
  rawTotal: number;
  clampedTotal: number;
  majorWindowsOverlapped: number;
  minorWindowsOverlapped: number;
  nearMajorBoundary: boolean;
  localHour: number;
  moonIllumination: number;
  tideDirection: TideDirection;
}

export interface BiteScoreResult {
  score: number; // 1-100
  grade: SolunarActivityRating;
  breakdown: ScoreFactors;
}

export interface BiteScoreInput {
  queryMs: number;
  majorWindows: SolunarStrikeWindow[];
  minorWindows: SolunarStrikeWindow[];
  moonIllumination: number;
  localHour: number;
  tideDirection: TideDirection;
  minutesToNextTurn: number;
  tideAmplitudeM: number;
}

export interface SpotTelemetry {
  telemetryId: string;
  spot: SpotLocation;
  timestamp: number;
  localHour: number;
  tzOffsetMinutes: number;
  solunar: SolunarSnapshot;
  tide: TideSnapshot;
  biteProbabilityScore: { score: number; grade: SolunarActivityRating };
  scoreBreakdown: ScoreFactors;
  cached: boolean;
}

export interface FishingTacticsBreakdown {
  bestSuitedSpots: string[];
  recommendedLures: string[];
  idealBaits: string[];
  techniqueSummary: string;
}

export interface AITacticsResult extends FishingTacticsBreakdown {
  prompt: string;
  source: 'cache' | 'network-simulation';
  latencyMs: number;
  cacheKey: string;
}

export interface TelemetryCacheAdapter {
  getSolunarSnapshot(lat: number, lng: number, timestamp: number): Promise<SolunarSnapshot | null>;
  upsertSolunarSnapshot(
    lat: number,
    lng: number,
    timestamp: number,
    snapshot: SolunarSnapshot,
  ): Promise<void>;
}

export interface TacticsCachePort {
  getTactics(key: string): Promise<AITacticsResult | null>;
  setTactics(key: string, payload: AITacticsResult): Promise<void>;
}

export interface FishingAdvisorProviders {
  telemetry: TelemetryCacheAdapter;
  tactics: TacticsCachePort;
}

export interface CompileSpotTelemetryOptions {
  tzOffsetMinutes?: number;
}
// ── Logger (everything prefixed) ──

type LogLevel = 'info' | 'warn' | 'error';
function log(level: LogLevel, message: string, error?: unknown): void {
  const line = `[Angler Copilot] ${message}`;
  if (error === undefined) {
    if (level === 'info') console.info(line);
    else if (level === 'warn') console.warn(line);
    else console.error(line);
  } else if (level === 'error') {
    console.error(line, error);
  } else if (level === 'warn') {
    console.warn(line, error);
  } else {
    console.info(line, error);
  }
}

// ── Pure helpers ──

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampLatitude(lat: number): number {
  if (!Number.isFinite(lat)) return 0;
  return clamp(lat, -90, 90);
}

function wrapLongitude(lng: number): number {
  if (!Number.isFinite(lng)) return 0;
  return ((lng + 540) % 360) - 180;
}

function utcDayStartMs(timestamp: number): number {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function toLocalHour(timestamp: number, tzOffsetMinutes: number): number {
  const d = new Date(timestamp);
  const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  return ((utcHours + tzOffsetMinutes / 60) % 24 + 24) % 24;
}

function solunarCacheKey(lat: number, lng: number, timestamp: number): string {
  const latR = Math.round(clampLatitude(lat) * 10_000) / 10_000;
  const lngR = Math.round(wrapLongitude(lng) * 10_000) / 10_000;
  return `sol:${latR.toFixed(4)}:${lngR.toFixed(4)}:${utcDayStartMs(timestamp)}`;
}

function minTwilightDistanceHours(hour: number): number {
  const normalized = ((hour % 24) + 24) % 24;
  let best = 24;
  for (const anchor of TWILIGHT_ANCHORS) {
    const delta = Math.abs(normalized - anchor);
    const circular = Math.min(delta, 24 - delta);
    if (circular < best) best = circular;
  }
  return best;
}

function hourLabel(localHour: number): string {
  const h24 = ((Math.floor(localHour) % 24) + 24) % 24;
  const minutes = Math.floor((localHour % 1) * 60);
  const displayHour = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${displayHour.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

// ── Deterministic tide model (UTC, no I/O) ──

function generateTideSnapshot(lat: number, lng: number, timestamp: number): TideSnapshot {
  void lng; // longitude reserved for future per-spot tidal datum; model is lat/phase driven
  const dayMs = utcDayStartMs(timestamp);
  const phaseShift = ((lat * 0.01) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

  // Turning points (high/low) occur where sin(.) = +/-1: arg = PI/2 + n*PI.
  const turningPoints: TideEvent[] = [];
  for (let n = -4; n <= 8; n++) {
    const arg = Math.PI / 2 + n * Math.PI;
    const hours = ((arg - phaseShift) / (2 * Math.PI)) * TIDAL_PERIOD_HOURS;
    const t = dayMs + hours * 3_600_000;
    if (t < dayMs - 12 * 3_600_000 || t > dayMs + 36 * 3_600_000) continue;
    const isHigh = n % 2 === 0;
    turningPoints.push({
      time: Math.round(t),
      height: TIDE_BASE_HEIGHT_M + TIDE_AMPLITUDE_M * (isHigh ? 1 : -1),
      type: isHigh ? 'high' : 'low',
    });
  }
  turningPoints.sort((a, b) => a.time - b.time);

  const hoursSince = (timestamp - dayMs) / 3_600_000;
  const arg = (hoursSince / TIDAL_PERIOD_HOURS) * 2 * Math.PI + phaseShift;
  const heightAtInstant = TIDE_BASE_HEIGHT_M + TIDE_AMPLITUDE_M * Math.sin(arg);
  const gradient = Math.cos(arg);
  const direction: TideDirection =
    gradient > 0.05 ? 'incoming' : gradient < -0.05 ? 'outgoing' : 'slack';

  let nearest: TideEvent | null = null;
  let minDist = Infinity;
  for (const tp of turningPoints) {
    const dist = Math.abs(tp.time - timestamp);
    if (dist < minDist) {
      minDist = dist;
      nearest = tp;
    }
  }

  return {
    heightAtInstant,
    direction,
    nextTurn: nearest ? { time: nearest.time, type: nearest.type } : null,
    turningPoints,
    tidalRangeM: TIDE_AMPLITUDE_M * 2,
  };
}
// ── SQLite adapter (lazy, web-guarded) ──

interface SQLiteDatabaseLike {
  execAsync(sql: string, params?: unknown[]): Promise<unknown>;
  runAsync(sql: string, params?: unknown[]): Promise<unknown>;
  getAllAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
}

let sharedDb: SQLiteDatabaseLike | null | undefined = undefined;

async function openAdvisorDb(): Promise<SQLiteDatabaseLike | null> {
  if (Platform.OS === 'web') return null;
  if (sharedDb !== undefined) return sharedDb;
  try {
    const SQLiteModule = await import('expo-sqlite');
    const raw = await SQLiteModule.openDatabaseAsync(ADVISOR_DB_NAME);
    const db = raw as unknown as SQLiteDatabaseLike;
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS ${ADVISOR_CACHE_TABLE} (
        cache_key TEXT PRIMARY KEY,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        date_unix INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        generated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_advisor_lookup
        ON ${ADVISOR_CACHE_TABLE}(lat, lng, date_unix);
      CREATE TABLE IF NOT EXISTS ${TACTICS_CACHE_TABLE} (
        cache_key TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        generated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    sharedDb = db;
    log('info', `Offline SQLite cache ready (${ADVISOR_CACHE_TABLE}, ${TACTICS_CACHE_TABLE}).`);
    return db;
  } catch (error) {
    sharedDb = null;
    log('error', `SQLite adapter unavailable for "${ADVISOR_DB_NAME}" - operating cacheless.`, error);
    return null;
  }
}

// ── Scoring matrix (deterministic, no I/O) ──

function normalizeInput(input: BiteScoreInput): BiteScoreInput {
  const direction: TideDirection =
    input.tideDirection === 'incoming' ||
    input.tideDirection === 'outgoing' ||
    input.tideDirection === 'slack'
      ? input.tideDirection
      : 'slack';
  return {
    queryMs: Number.isFinite(input.queryMs) ? input.queryMs : 0,
    majorWindows: Array.isArray(input.majorWindows) ? input.majorWindows : [],
    minorWindows: Array.isArray(input.minorWindows) ? input.minorWindows : [],
    moonIllumination: clamp(input.moonIllumination, 0, 100),
    localHour: ((input.localHour % 24) + 24) % 24,
    tideDirection: direction,
    minutesToNextTurn: Number.isFinite(input.minutesToNextTurn) ? input.minutesToNextTurn : 0,
    tideAmplitudeM: Math.max(0, input.tideAmplitudeM),
  };
}

function solunarPoints(input: BiteScoreInput): {
  points: number;
  major: number;
  minor: number;
  near: boolean;
} {
  const instant = input.queryMs;
  let major = 0;
  let minor = 0;
  let near = false;
  for (const w of input.majorWindows) {
    const start = Date.parse(w.start);
    const end = Date.parse(w.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (instant >= start && instant <= end) {
      major++;
    } else {
      const dist = Math.min(Math.abs(instant - start), Math.abs(instant - end));
      if (dist <= PROXIMITY_GRACE_MS) near = true;
    }
  }
  for (const w of input.minorWindows) {
    const start = Date.parse(w.start);
    const end = Date.parse(w.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (instant >= start && instant <= end) minor++;
  }
  const points = clamp(
    major * MAJOR_CONTAIN_BONUS + minor * MINOR_CONTAIN_BONUS + (near ? PROXIMITY_BONUS : 0),
    0,
    SOLUNAR_WEIGHT_MAX,
  );
  return { points, major, minor, near };
}

function tidePoints(input: BiteScoreInput): number {
  const directionBonus =
    input.tideDirection === 'incoming'
      ? RISING_TIDE_BONUS
      : input.tideDirection === 'outgoing'
      ? FALLING_TIDE_BONUS
      : 0;
  const turnBonus = Math.abs(input.minutesToNextTurn) <= 30 ? TURNING_POINT_BONUS : 0;
  const ampBonus = clamp(
    (input.tideAmplitudeM / TIDE_AMPLITUDE_REFERENCE_M) * PHASE_WEIGHT_MAX,
    0,
    5,
  );
  return clamp(directionBonus + turnBonus + ampBonus, 0, TIDE_WEIGHT_MAX);
}

function timingPoints(localHour: number): number {
  const distance = minTwilightDistanceHours(localHour);
  if (distance <= 1) return TWILIGHT_PEAK;
  if (distance <= 2) return TWILIGHT_NEAR;
  if (distance <= 3) return TWILIGHT_FAR;
  return TWILIGHT_FALLBACK;
}

function phasePoints(illumination: number): number {
  return Math.round((Math.abs(clamp(illumination, 0, 100) - 50) / 50) * PHASE_WEIGHT_MAX);
}

function gradeFor(score: number): SolunarActivityRating {
  if (score >= 80) return 'EXCELLENT';
  if (score >= 60) return 'GOOD';
  if (score >= 40) return 'FAIR';
  return 'POOR';
}

/**
 * Deterministic bite-probability scorer: solunar overlap + tide + timing +
 * lunar phase -> 1-100. Pure & side-effect-free; safe for unit-test asserts.
 * @complexity O(W), W = number of strike windows (<= 4).
 */
export function calculateBiteProbabilityScore(input: BiteScoreInput): BiteScoreResult {
  const safe = normalizeInput(input);
  const solunar = solunarPoints(safe);
  const tide = tidePoints(safe);
  const timing = timingPoints(safe.localHour);
  const phase = phasePoints(safe.moonIllumination);
  const raw = solunar.points + tide + timing + phase;
  const clamped = clamp(raw, SCORE_MIN, SCORE_MAX);
  return {
    score: clamped,
    grade: gradeFor(clamped),
    breakdown: {
      solunarPoints: solunar.points,
      tidePoints: tide,
      timingPoints: timing,
      phasePoints: phase,
      rawTotal: raw,
      clampedTotal: clamped,
      majorWindowsOverlapped: solunar.major,
      minorWindowsOverlapped: solunar.minor,
      nearMajorBoundary: solunar.near,
      localHour: safe.localHour,
      moonIllumination: safe.moonIllumination,
      tideDirection: safe.tideDirection,
    },
  };
}
// ── Telemetry assembly ──

function computeSolunarSnapshot(lat: number, lng: number, ts: number): SolunarSnapshot {
  const date = new Date(ts);
  const forecast: SolunarDayForecast = buildSolunarDayForecast(lat, lng, date);
  return {
    moonPhase: forecast.lunarPhase,
    illumination: forecast.illumination,
    feedingIndex: forecast.feedingIndex,
    rating: forecast.rating,
    majorWindows: forecast.majorWindows,
    minorWindows: forecast.minorWindows,
  };
}

/**
 * Compile full spot telemetry for a lat/lng/timestamp, warming the offline
 * cache on a miss. Uses the injected TelemetryCacheAdapter (defaults to the
 * expo-sqlite-backed adapter) - offline-first and deterministic.
 */
export async function compileSpotTelemetry(
  lat: number,
  lng: number,
  timestamp: number,
  options?: CompileSpotTelemetryOptions,
): Promise<SpotTelemetry> {
  const safeLat = clampLatitude(lat);
  const safeLng = wrapLongitude(lng);
  const ts = Number.isFinite(timestamp) ? timestamp : Date.now();
  const tz = options?.tzOffsetMinutes ?? 0;
  const localHour = toLocalHour(ts, tz);
  const telemetryId = solunarCacheKey(safeLat, safeLng, ts);

  let snapshot: SolunarSnapshot | null = null;
  let cached = false;
  try {
    snapshot = await providers.telemetry.getSolunarSnapshot(safeLat, safeLng, ts);
    if (snapshot) cached = true;
  } catch (error) {
    log('warn', `Telem cache read failed for ${telemetryId} - falling back to compute.`, error);
  }

  if (!snapshot) {
    snapshot = computeSolunarSnapshot(safeLat, safeLng, ts);
    try {
      await providers.telemetry.upsertSolunarSnapshot(safeLat, safeLng, ts, snapshot);
    } catch (error) {
      log('warn', `Telem cache write failed for ${telemetryId}.`, error);
    }
  }

  const tide = generateTideSnapshot(safeLat, safeLng, ts);
  const scored = calculateBiteProbabilityScore({
    queryMs: ts,
    majorWindows: snapshot.majorWindows,
    minorWindows: snapshot.minorWindows,
    moonIllumination: snapshot.illumination,
    localHour,
    tideDirection: tide.direction,
    minutesToNextTurn: tide.nextTurn ? (tide.nextTurn.time - ts) / 60_000 : 0,
    tideAmplitudeM: tide.tidalRangeM / 2,
  });

  log(
    'info',
    `${cached ? 'Cache hit' : 'Cache miss'} for ${telemetryId} - score ${scored.score}/100 (${scored.grade}).`,
  );

  return {
    telemetryId,
    spot: { latitude: safeLat, longitude: safeLng },
    timestamp: ts,
    localHour,
    tzOffsetMinutes: tz,
    solunar: snapshot,
    tide,
    biteProbabilityScore: { score: scored.score, grade: scored.grade },
    scoreBreakdown: scored.breakdown,
    cached,
  };
}

/**
 * Re-derive the bite score straight from a compiled telemetry object.
 * Useful for re-scoring after a cache hit without a recompute.
 */
export function calculateBiteScoreFromTelemetry(telemetry: SpotTelemetry): BiteScoreResult {
  return calculateBiteProbabilityScore({
    queryMs: telemetry.timestamp,
    majorWindows: telemetry.solunar.majorWindows,
    minorWindows: telemetry.solunar.minorWindows,
    moonIllumination: telemetry.solunar.illumination,
    localHour: telemetry.localHour,
    tideDirection: telemetry.tide.direction,
    minutesToNextTurn: telemetry.tide.nextTurn
      ? (telemetry.tide.nextTurn.time - telemetry.timestamp) / 60_000
      : 0,
    tideAmplitudeM: telemetry.tide.tidalRangeM / 2,
  });
}
// ── AI prompt ──

/**
 * Structured, LLM-ready markdown prompt for a spot, embedding the full telemetry
 * snapshot so the model can ground its tactics in the solunar/tidal moment.
 */
export function buildAIPrompt(telemetry: SpotTelemetry): string {
  const { spot, localHour, tzOffsetMinutes, solunar, tide, biteProbabilityScore, scoreBreakdown } =
    telemetry;
  const tzSign = tzOffsetMinutes >= 0 ? '+' : '';
  const tzHours = tzOffsetMinutes / 60;
  const majorList = solunar.majorWindows.map((w) => `${w.start} -> ${w.end}`).join(' | ') || 'none';
  const minorList = solunar.minorWindows.map((w) => `${w.start} -> ${w.end}`).join(' | ') || 'none';
  const nextTurnStr = tide.nextTurn
    ? `${tide.nextTurn.type} tide @ ${new Date(tide.nextTurn.time).toISOString()}`
    : 'n/a';
  return `# Angler Copilot - Fishing Tactics Advisory Prompt

## System
You are "Angler Copilot", a predictive AI fishing advisor. Given the structured
telemetry below, return a concise, actionable bite-tactics plan tuned to the
solunar and tidal moment.

## Local Context
- Coordinates: ${spot.latitude.toFixed(4)} deg, ${spot.longitude.toFixed(4)} deg
- Query instant (UTC): ${new Date(telemetry.timestamp).toISOString()}
- Local time: ${hourLabel(localHour)} (UTC${tzSign}${tzHours})

## Solunar Conditions
- Moon phase: ${solunar.moonPhase} (${solunar.illumination}% illuminated)
- Feeding index: ${solunar.feedingIndex}/100 - Rating: ${solunar.rating}
- Major strike windows: ${majorList}
- Minor strike windows: ${minorList}

## Tide Conditions
- Current tide height: ${tide.heightAtInstant.toFixed(2)} m
- Tide direction: ${tide.direction}
- Tidal range: ${tide.tidalRangeM.toFixed(2)} m
- Next turning point: ${nextTurnStr}

## Bite Probability Score
- Score: ${biteProbabilityScore.score}/100 (${biteProbabilityScore.grade})
- Solunar factor: ${scoreBreakdown.solunarPoints}/${SOLUNAR_WEIGHT_MAX}
- Tide factor: ${scoreBreakdown.tidePoints}/${TIDE_WEIGHT_MAX}
- Timing factor: ${scoreBreakdown.timingPoints}/${TIMING_WEIGHT_MAX}
- Phase factor: ${scoreBreakdown.phasePoints}/${PHASE_WEIGHT_MAX}

## Requested Output (strict JSON only)
{
  "bestSuitedSpots": string[],
  "recommendedLures": string[],
  "idealBaits": string[],
  "techniqueSummary": string
}

## Instructions
1. Prioritise the spots, windows and tide referenced above.
2. Match lure and bait selection to the moon phase and tide direction.
3. Keep techniqueSummary under 280 characters.
4. Emit ONLY the JSON object; no prose.
`;
}
// ── Deterministic network-stub resolver ──

type Season = 'spring' | 'summer' | 'autumn' | 'winter';

function seasonFromTimestamp(ts: number): Season {
  const m = new Date(ts).getUTCMonth();
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

const SEASON_BAITS: Record<Season, string[]> = {
  spring: ['Shrimp', 'Pilchard'],
  summer: ['Pilchard', 'Mullet'],
  autumn: ['Mullet', 'Squid'],
  winter: ['Squid', 'Pilchard'],
};

function luresFor(telemetry: SpotTelemetry): string[] {
  const { illumination, moonPhase } = telemetry.solunar;
  let base: string[];
  if (illumination <= 20 || illumination >= 80) {
    base =
      moonPhase === 'Full Moon'
        ? ['Topwater popper', 'Walking bait', 'Swimbait']
        : ['Topwater popper', 'Chatterbait', 'Swimbait'];
  } else if (illumination < 40 || illumination > 60) {
    base = ['Swimbait', 'Suspending jerkbait', 'Spinnerbait'];
  } else {
    base = ['Jig', 'Soft-plastic worm', 'Crankbait'];
  }
  const modifier =
    telemetry.tide.direction === 'incoming'
      ? 'Spinnerbait'
      : telemetry.tide.direction === 'outgoing'
      ? 'Suspending jerkbait'
      : 'Jig';
  return Array.from(new Set([...base, modifier]));
}

function baitsFor(telemetry: SpotTelemetry): string[] {
  return SEASON_BAITS[seasonFromTimestamp(telemetry.timestamp)];
}

function spotsFor(telemetry: SpotTelemetry): string[] {
  const { latitude, longitude } = telemetry.spot;
  const geo = `${latitude.toFixed(3)} deg, ${longitude.toFixed(3)} deg`;
  const directional =
    telemetry.tide.direction === 'incoming'
      ? ['Structure / drop-offs', 'Creek mouths']
      : telemetry.tide.direction === 'outgoing'
      ? ['Channel mouths', 'Gutters']
      : ['Backwaters', 'Protected bays'];
  return [...directional, `Spot @ ${geo}`];
}

function techniqueSummaryFor(telemetry: SpotTelemetry): string {
  const { score, grade } = telemetry.biteProbabilityScore;
  const { direction } = telemetry.tide;
  const { moonPhase, illumination } = telemetry.solunar;
  const zone =
    minTwilightDistanceHours(telemetry.localHour) <= 1
      ? 'dawn/dusk twilight'
      : 'non-peak hours';
  return `Bite probability ${score}/100 (${grade}). Target the ${direction} tide transition under a ${moonPhase} (${illumination}% illuminated) during ${zone}.`;
}

/**
 * Deterministic network-stub resolver: returns a reproducible tactics
 * breakdown derived purely from the telemetry (no remote call required).
 * Used by fetchAITactics on a cache miss so the app stays fully offline.
 */
export function simulateAITacticsResponse(
  telemetry: SpotTelemetry,
  _prompt: string,
): FishingTacticsBreakdown {
  return {
    bestSuitedSpots: spotsFor(telemetry),
    recommendedLures: luresFor(telemetry),
    idealBaits: baitsFor(telemetry),
    techniqueSummary: techniqueSummaryFor(telemetry),
  };
}
// ── Default cache adapters (expo-sqlite backed, graceful offline) ──

function defaultTelemetryCache(): TelemetryCacheAdapter {
  return {
    async getSolunarSnapshot(lat, lng, timestamp): Promise<SolunarSnapshot | null> {
      const db = await openAdvisorDb();
      if (!db) return null;
      const key = solunarCacheKey(lat, lng, timestamp);
      try {
        const rows = await db.getAllAsync<{ snapshot_json: string }>(
          `SELECT snapshot_json FROM ${ADVISOR_CACHE_TABLE} WHERE cache_key = ?;`,
          [key],
        );
        if (!rows || rows.length === 0) return null;
        return JSON.parse(rows[0]!.snapshot_json) as SolunarSnapshot;
      } catch (error) {
        log('warn', `Solunar cache read error [${key}].`, error);
        return null;
      }
    },
    async upsertSolunarSnapshot(lat, lng, timestamp, snapshot): Promise<void> {
      const db = await openAdvisorDb();
      if (!db) return;
      const key = solunarCacheKey(lat, lng, timestamp);
      try {
        await db.runAsync(
          `INSERT INTO ${ADVISOR_CACHE_TABLE} (cache_key, lat, lng, date_unix, snapshot_json, generated_at)` +
            ` VALUES (?, ?, ?, ?, ?, ?)` +
            ` ON CONFLICT(cache_key) DO UPDATE SET snapshot_json = excluded.snapshot_json,` +
            ` generated_at = excluded.generated_at;`,
          [key, lat, lng, utcDayStartMs(timestamp), JSON.stringify(snapshot), Date.now()],
        );
      } catch (error) {
        log('warn', `Solunar cache write error [${key}].`, error);
      }
    },
  };
}

function defaultTacticsCache(): TacticsCachePort {
  return {
    async getTactics(key: string): Promise<AITacticsResult | null> {
      const db = await openAdvisorDb();
      if (!db) return null;
      try {
        const rows = await db.getAllAsync<{ payload_json: string; expires_at: number }>(
          `SELECT payload_json, expires_at FROM ${TACTICS_CACHE_TABLE} WHERE cache_key = ?;`,
          [key],
        );
        if (!rows || rows.length === 0) return null;
        const row = rows[0]!;
        if (Date.now() > row.expires_at) return null;
        return JSON.parse(row.payload_json) as AITacticsResult;
      } catch (error) {
        log('warn', `Tactics cache read error [${key}].`, error);
        return null;
      }
    },
    async setTactics(key: string, payload: AITacticsResult): Promise<void> {
      const db = await openAdvisorDb();
      if (!db) return;
      try {
        await db.runAsync(
          `INSERT INTO ${TACTICS_CACHE_TABLE} (cache_key, payload_json, generated_at, expires_at)` +
            ` VALUES (?, ?, ?, ?)` +
            ` ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json,` +
            ` generated_at = excluded.generated_at, expires_at = excluded.expires_at;`,
          [key, JSON.stringify(payload), Date.now(), Date.now() + CACHE_TTL_MS],
        );
      } catch (error) {
        log('warn', `Tactics cache write error [${key}].`, error);
      }
    },
  };
}
function tacticsCacheKey(telemetry: SpotTelemetry): string {
  const lat = Math.round(telemetry.spot.latitude * 100);
  const lng = Math.round(telemetry.spot.longitude * 100);
  const hourBucket = Math.floor(telemetry.localHour / 3);
  const scoreBand = Math.floor(telemetry.biteProbabilityScore.score / 10);
  return `tactics:${lat}:${lng}:${hourBucket}:${scoreBand}:${telemetry.solunar.moonPhase}:${telemetry.tide.direction}:${telemetry.solunar.rating}`;
}

/**
 * Resolve fishing tactics for a compiled telemetry object.
 * 1. Build a deterministic cache key from the telemetry surface.
 * 2. Attempt to serve from the injected TacticsCachePort.
 * 3. On miss, generate a structured LLM prompt, materialise a deterministic
 *    network-stub breakdown, then write it through the cache.
 * Offline-first: without expo-sqlite the cache is a no-op and the stub still
 * returns a valid result.
 */
export async function fetchAITactics(telemetry: SpotTelemetry): Promise<AITacticsResult> {
  if (!telemetry || typeof telemetry !== 'object') {
    throw new Error('[Angler Copilot] fetchAITactics requires a SpotTelemetry payload.');
  }
  const key = tacticsCacheKey(telemetry);

  let cached: AITacticsResult | null = null;
  try {
    cached = await providers.tactics.getTactics(key);
  } catch (error) {
    log('warn', `Tactics cache lookup failed [${key}] - resolving fresh.`, error);
  }
  if (cached) {
    log('info', `Tactics cache hit [${key}].`);
    return { ...cached, source: 'cache', latencyMs: 0, cacheKey: key };
  }

  log('info', `Tactics cache miss - generating [${key}].`);
  const prompt = buildAIPrompt(telemetry);
  const start = Date.now();
  const breakdown = simulateAITacticsResponse(telemetry, prompt);
  const latencyMs = Math.max(0, Date.now() - start);

  const result: AITacticsResult = {
    ...breakdown,
    prompt,
    source: 'network-simulation',
    latencyMs,
    cacheKey: key,
  };
  try {
    await providers.tactics.setTactics(key, result);
  } catch (error) {
    log('warn', `Tactics cache write failed [${key}].`, error);
  }
  return result;
}

// ── Provider registry ──

const DEFAULT_ADAPTERS: FishingAdvisorProviders = {
  telemetry: defaultTelemetryCache(),
  tactics: defaultTacticsCache(),
};

let providers: FishingAdvisorProviders = { ...DEFAULT_ADAPTERS };

/**
 * Override (partially) the active providers. Intended for dependency injection
 * / unit tests. Fields left `undefined` keep their current value.
 */
export function configureFishingAdvisorProviders(
  next: Partial<FishingAdvisorProviders>,
): void {
  providers = { ...providers, ...next };
  log('info', 'FishingAdvisor providers updated.', {
    hasTelemetryOverride: typeof next.telemetry === 'object',
    hasTacticsOverride: typeof next.tactics === 'object',
  });
}

/** Reset all providers to the default expo-sqlite-backed adapters. */
export function resetFishingAdvisorProviders(): void {
  providers = { ...DEFAULT_ADAPTERS };
  log('info', 'FishingAdvisor providers reset to defaults.');
}

/**
 * Unit tests for the Angler Copilot Fishing Advisor engine.
 *
 * Covers the deterministic scoring matrix, the UTC-normalised tide model,
 * telemetry assembly + cache wiring (via injected adapters so expo-sqlite is
 * never loaded under Jest), the AI prompt builder, the network-stub tactic
 * resolver, and the provider registry.
 */

import {
  buildAIPrompt,
  calculateBiteProbabilityScore,
  calculateBiteScoreFromTelemetry,
  compileSpotTelemetry,
  configureFishingAdvisorProviders,
  fetchAITactics,
  resetFishingAdvisorProviders,
  simulateAITacticsResponse,
  type AITacticsResult,
  type BiteScoreInput,
  type ScoreFactors,
  type SolunarSnapshot,
  type SpotTelemetry,
  type TideDirection,
  type TideSnapshot,
  type TelemetryCacheAdapter,
  type TacticsCachePort,
} from '../fishingAdvisorEngine';

function iso(year: number, month: number, day: number, h: number, m = 0): string {
  return new Date(Date.UTC(year, month, day, h, m)).toISOString();
}

function makeSnapshot(over: Partial<SolunarSnapshot> = {}): SolunarSnapshot {
  return {
    moonPhase: 'Full Moon',
    illumination: 95,
    feedingIndex: 80,
    rating: 'EXCELLENT',
    majorWindows: [],
    minorWindows: [],
    ...over,
  };
}

const TS_Noon = Date.UTC(2024, 5, 15, 12, 0, 0);
const TS_Midnight = Date.UTC(2024, 5, 15, 0, 0, 0);
const TS_Dusk = Date.UTC(2024, 5, 15, 18, 0, 0);

function makeTideSnapshot(over: Partial<TideSnapshot> = {}): TideSnapshot {
  return {
    heightAtInstant: 2.6,
    direction: 'incoming',
    nextTurn: { time: TS_Noon, type: 'high' },
    turningPoints: [{ time: TS_Noon, height: 2.6, type: 'high' }],
    tidalRangeM: 1.6,
    ...over,
  };
}

function makeSpotTelemetry(over: Partial<SpotTelemetry> = {}): SpotTelemetry {
  const ts = TS_Dusk + 30 * 60_000;
  const base: SpotTelemetry = {
    telemetryId: `sol:${ts}`,
    spot: { latitude: -27.9625, longitude: 153.4264 },
    timestamp: ts,
    localHour: 18.5,
    tzOffsetMinutes: 0,
    solunar: makeSnapshot(),
    tide: makeTideSnapshot(),
    biteProbabilityScore: { score: 85, grade: 'EXCELLENT' },
    scoreBreakdown: {} as ScoreFactors,
    cached: true,
  };
  return { ...base, ...over };
}

function memoryTelemetryAdapter(fixed: SolunarSnapshot | null): TelemetryCacheAdapter {
  const onUpsert = jest.fn();
  return {
    getSolunarSnapshot: async () => fixed,
    upsertSolunarSnapshot: async () => {
      onUpsert();
    },
  };
}

function memoryTacticsAdapter(): { port: TacticsCachePort; store: Map<string, AITacticsResult> } {
  const store = new Map<string, AITacticsResult>();
  const port: TacticsCachePort = {
    getTactics: async (key) => store.get(key) ?? null,
    setTactics: async (key, payload) => {
      store.set(key, payload);
    },
  };
  return { port, store };
}

async function compileWithMemory(
  lat: number,
  lng: number,
  ts: number,
  fixed: SolunarSnapshot | null,
): Promise<SpotTelemetry> {
  configureFishingAdvisorProviders({ telemetry: memoryTelemetryAdapter(fixed) });
  return compileSpotTelemetry(lat, lng, ts);
}

afterEach(() => {
  resetFishingAdvisorProviders();
});

describe('calculateBiteProbabilityScore', () => {
  it('awards full solunar points when inside a major window', () => {
    const res = calculateBiteProbabilityScore({
      queryMs: TS_Noon,
      majorWindows: [{ start: iso(2024, 5, 15, 11, 0), end: iso(2024, 5, 15, 13, 0) }],
      minorWindows: [],
      moonIllumination: 50,
      localHour: 12,
      tideDirection: 'incoming',
      minutesToNextTurn: 0,
      tideAmplitudeM: 2.0,
    });
    expect(res.breakdown.majorWindowsOverlapped).toBe(1);
    expect(res.breakdown.minorWindowsOverlapped).toBe(0);
    expect(res.breakdown.solunarPoints).toBe(20);
    expect(res.breakdown.nearMajorBoundary).toBe(false);
  });

  it('awards proximity points just outside a major window', () => {
    const res = calculateBiteProbabilityScore({
      queryMs: TS_Noon,
      majorWindows: [{ start: iso(2024, 5, 15, 11, 0), end: iso(2024, 5, 15, 11, 45) }],
      minorWindows: [],
      moonIllumination: 50,
      localHour: 12,
      tideDirection: 'slack',
      minutesToNextTurn: 999,
      tideAmplitudeM: 0,
    });
    expect(res.breakdown.nearMajorBoundary).toBe(true);
    expect(res.breakdown.solunarPoints).toBe(8);
  });

  it('counts minor windows at a reduced weight', () => {
    const res = calculateBiteProbabilityScore({
      queryMs: TS_Noon,
      majorWindows: [],
      minorWindows: [{ start: iso(2024, 5, 15, 11, 0), end: iso(2024, 5, 15, 13, 0) }],
      moonIllumination: 50,
      localHour: 12,
      tideDirection: 'slack',
      minutesToNextTurn: 999,
      tideAmplitudeM: 0,
    });
    expect(res.breakdown.minorWindowsOverlapped).toBe(1);
    expect(res.breakdown.solunarPoints).toBe(5);
  });

  it('applies incoming vs outgoing tide bonuses correctly', () => {
    const base = (dir: TideDirection): BiteScoreInput => ({
      queryMs: TS_Noon,
      majorWindows: [],
      minorWindows: [],
      moonIllumination: 50,
      localHour: 12,
      tideDirection: dir,
      minutesToNextTurn: 999,
      tideAmplitudeM: 0,
    });
    expect(calculateBiteProbabilityScore(base('incoming')).breakdown.tidePoints).toBe(15);
    expect(calculateBiteProbabilityScore(base('outgoing')).breakdown.tidePoints).toBe(10);
    expect(calculateBiteProbabilityScore(base('slack')).breakdown.tidePoints).toBe(0);
        expect(calculateBiteProbabilityScore(base('incoming')).breakdown.timingPoints).toBe(2);
  });

  it('rewards a turning point within 30 minutes', () => {
    const res = calculateBiteProbabilityScore({
      queryMs: 0,
      majorWindows: [],
      minorWindows: [],
      moonIllumination: 50,
      localHour: 12,
      tideDirection: 'incoming',
      minutesToNextTurn: 15,
      tideAmplitudeM: 0,
    });
    expect(res.breakdown.tidePoints).toBe(30); // rising 15 + turn 15
  });

  it('scores twilight (dawn/dusk) with the full timing bonus', () => {
    const res = calculateBiteProbabilityScore({
      queryMs: 0,
      majorWindows: [],
      minorWindows: [],
      moonIllumination: 50,
      localHour: 6,
      tideDirection: 'slack',
      minutesToNextTurn: 999,
      tideAmplitudeM: 0,
    });
    expect(res.breakdown.timingPoints).toBe(20);
  });

  it('weights lunar phase extrema over quadrature', () => {
    const mk = (illum: number) =>
      calculateBiteProbabilityScore({
        queryMs: 0,
        majorWindows: [],
        minorWindows: [],
        moonIllumination: illum,
        localHour: 12,
        tideDirection: 'slack',
        minutesToNextTurn: 999,
        tideAmplitudeM: 0,
      });
    expect(mk(100).breakdown.phasePoints).toBe(10);
    expect(mk(0).breakdown.phasePoints).toBe(10);
    expect(mk(50).breakdown.phasePoints).toBe(0);
    expect(mk(70).breakdown.phasePoints).toBe(4);
  });

  it('clamps the result to [1, 100] and buckets into grades', () => {
    const perfect = calculateBiteProbabilityScore({
      queryMs: TS_Dusk,
      majorWindows: [
        { start: iso(2024, 5, 15, 16, 0), end: iso(2024, 5, 15, 20, 0) },
        { start: iso(2024, 5, 15, 17, 0), end: iso(2024, 5, 15, 21, 0) },
      ],
      minorWindows: [{ start: iso(2024, 5, 15, 17, 0), end: iso(2024, 5, 15, 19, 0) }],
      moonIllumination: 100,
      localHour: 18,
      tideDirection: 'incoming',
      minutesToNextTurn: 0,
      tideAmplitudeM: 2.0,
    });
    expect(perfect.breakdown.solunarPoints).toBe(40); // clamped from 45
    expect(perfect.breakdown.tidePoints).toBe(30); // clamped from 35
    expect(perfect.breakdown.timingPoints).toBe(20);
    expect(perfect.breakdown.phasePoints).toBe(10);
    expect(perfect.score).toBe(100);
    expect(perfect.grade).toBe('EXCELLENT');

    const minimal = calculateBiteProbabilityScore({
      queryMs: TS_Noon,
      majorWindows: [],
      minorWindows: [],
      moonIllumination: 50,
      localHour: 12,
      tideDirection: 'slack',
      minutesToNextTurn: 999,
      tideAmplitudeM: 0,
    });
    expect(minimal.score).toBe(2); // 0+0+2(twilight floor)+0
    expect(minimal.score).toBeGreaterThanOrEqual(1);
    expect(minimal.grade).toBe('POOR');
  });

  it('is deterministic: identical inputs yield identical outputs', () => {
    const input: BiteScoreInput = {
      queryMs: Date.UTC(2024, 11, 21, 10, 30, 0),
      majorWindows: [{ start: iso(2024, 11, 21, 9, 0), end: iso(2024, 11, 21, 11, 0) }],
      minorWindows: [{ start: iso(2024, 11, 21, 13, 0), end: iso(2024, 11, 21, 14, 0) }],
      moonIllumination: 72,
      localHour: 10.5,
      tideDirection: 'outgoing',
      minutesToNextTurn: 12,
      tideAmplitudeM: 1.6,
    };
    const a = calculateBiteProbabilityScore(input);
    const b = calculateBiteProbabilityScore(input);
    expect(b).toEqual(a);
  });
});

describe('deterministic tide model', () => {
  it('anchors on UTC midnight at the equator -> base height + incoming tide', async () => {
    const { tide } = await compileWithMemory(0, 0, TS_Midnight, makeSnapshot());
    expect(tide.heightAtInstant).toBeCloseTo(1.8, 5);
    expect(tide.direction).toBe('incoming'); // cos(0) = 1 > 0.05
    expect(tide.tidalRangeM).toBeCloseTo(1.6, 5);
    expect(tide.nextTurn).not.toBeNull();
    expect(tide.nextTurn!.type).toMatch(/^(high|low)$/);
    expect(Math.abs(tide.nextTurn!.time - TS_Midnight)).toBeLessThan(4 * 3_600_000);
  });

  it('turning points are fixed at high (2.6m) / low (1.0m) and alternate by type', async () => {
    const { tide } = await compileWithMemory(-27.9625, 153.4264, TS_Noon, makeSnapshot());
    expect(tide.turningPoints.length).toBeGreaterThanOrEqual(2);
    for (const tp of tide.turningPoints) {
      expect([1.0, 2.6]).toContain(tp.height);
      expect(tp.type).toBe(tp.height === 2.6 ? 'high' : 'low');
    }
  });

  it('nextTurn is the temporally nearest turning point', async () => {
    const ts = TS_Noon;
    const { tide } = await compileWithMemory(0, 0, ts, makeSnapshot());
    const nearest = tide.turningPoints.reduce((best, tp) =>
      Math.abs(tp.time - ts) < Math.abs(best.time - ts) ? tp : best,
    );
    expect(tide.nextTurn).toEqual({ time: nearest.time, type: nearest.type });
  });
});
describe('compileSpotTelemetry (cache wiring)', () => {
  it('serves a cached solunar snapshot without recomputing or upserting', async () => {
    const snapshot = makeSnapshot({ moonPhase: 'Last Quarter', illumination: 40 });
    const telemetry = await compileWithMemory(-27.9625, 153.4264, TS_Noon, snapshot);
    expect(telemetry.cached).toBe(true);
    expect(telemetry.solunar).toBe(snapshot);
    expect(telemetry.tide.direction).toMatch(/^(incoming|outgoing|slack)$/);
    expect(telemetry.biteProbabilityScore.score).toBeGreaterThanOrEqual(1);
  });

  it('on a cache miss it computes, persists (upsert) and marks cached=false', async () => {
    const onUpsert = jest.fn();
    configureFishingAdvisorProviders({
      telemetry: {
        getSolunarSnapshot: async () => null,
        upsertSolunarSnapshot: async () => onUpsert(),
      },
    });
    const telemetry = await compileSpotTelemetry(-27.9625, 153.4264, TS_Noon);
    expect(telemetry.cached).toBe(false);
    expect(onUpsert).toHaveBeenCalledTimes(1);
    expect(telemetry.solunar.moonPhase).toBeDefined();
    expect(telemetry.biteProbabilityScore.score).toBe(
      calculateBiteScoreFromTelemetry(telemetry).score,
    );
  });

  it('clamps latitude/longitude and is deterministic across repeated calls', async () => {
    const snapshot = makeSnapshot();
    const t1 = await compileWithMemory(-27.9625, 153.4264, TS_Noon, snapshot);
    const t2 = await compileWithMemory(-27.9625, 153.4264, TS_Noon, snapshot);
    expect(t1).toEqual(t2);
    expect(t1.spot.latitude).toBeCloseTo(-27.9625, 5);
    expect(t1.spot.longitude).toBeCloseTo(153.4264, 5);
  });
});

describe('fetchAITactics', () => {
  it('resolves tactics on a cache miss via the deterministic stub', async () => {
    const telemetry = await compileWithMemory(-27.9625, 153.4264, TS_Noon, null);
    const { port, store } = memoryTacticsAdapter();
    configureFishingAdvisorProviders({ tactics: port });
    const res = await fetchAITactics(telemetry);
    expect(res.source).toBe('network-simulation');
    expect(res.prompt).toContain('Angler Copilot');
    expect(res.cacheKey).toBeTruthy();
    expect(res.bestSuitedSpots.length).toBeGreaterThan(0);
    expect(res.recommendedLures.length).toBeGreaterThan(0);
    expect(res.idealBaits.length).toBeGreaterThan(0);
    expect(res.techniqueSummary.length).toBeGreaterThan(0);
    expect(store.size).toBe(1);
  });

  it('serves a previously cached payload on the second call', async () => {
    const { port, store } = memoryTacticsAdapter();
    configureFishingAdvisorProviders({ tactics: port });
    const telemetry = await compileWithMemory(-27.9625, 153.4264, TS_Noon, null);
    const first = await fetchAITactics(telemetry);
    expect(first.source).toBe('network-simulation');
    expect(store.size).toBe(1);
    const second = await fetchAITactics(telemetry);
    expect(second.source).toBe('cache');
    expect(second.latencyMs).toBe(0);
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(second.prompt).toBe(first.prompt);
  });
});

describe('buildAIPrompt', () => {
  it('embeds the telemetry context as markdown', () => {
    const prompt = buildAIPrompt(makeSpotTelemetry());
    expect(prompt).toContain('Angler Copilot');
    expect(prompt).toContain('Coordinates:');
    expect(prompt).toContain('Full Moon');
    expect(prompt).toContain('incoming');
    expect(prompt).toContain('Bite Probability Score');
    expect(prompt).toContain('techniqueSummary');
  });
});

describe('simulateAITacticsResponse (stub resolver)', () => {
  it('returns a well-formed, tide-aware breakdown', () => {
    const bd = simulateAITacticsResponse(makeSpotTelemetry(), buildAIPrompt(makeSpotTelemetry()));
    expect(bd.bestSuitedSpots[0]).toBe('Structure / drop-offs');
    expect(bd.bestSuitedSpots[bd.bestSuitedSpots.length - 1]).toMatch(/^Spot @ .*deg, .*deg$/);
    expect(bd.recommendedLures).toContain('Topwater popper');
    expect(bd.idealBaits.length).toBe(2); // June -> summer
    expect(bd.techniqueSummary).toContain('EXCELLENT');
    expect(bd.techniqueSummary).toContain('incoming');
  });

  it('does not mutate the input telemetry', () => {
    const t = makeSpotTelemetry();
    const before = JSON.stringify(t);
    simulateAITacticsResponse(t, '');
    expect(JSON.stringify(t)).toBe(before);
  });
});

describe('provider registry', () => {
  it('configureFishingAdvisorProviders swaps the telemetry adapter (miss -> upsert)', async () => {
    const onUpsert = jest.fn();
    configureFishingAdvisorProviders({
      telemetry: {
        getSolunarSnapshot: async () => null,
        upsertSolunarSnapshot: async () => onUpsert(),
      },
    });
    const t = await compileSpotTelemetry(-27.9625, 153.4264, TS_Noon);
    expect(t.cached).toBe(false);
    expect(onUpsert).toHaveBeenCalledTimes(1);
  });

  it('resetFishingAdvisorProviders restores defaults (no sqlite on invalid input)', async () => {
    configureFishingAdvisorProviders({ telemetry: memoryTelemetryAdapter(null) });
    resetFishingAdvisorProviders();
    await expect(fetchAITactics(null as unknown as SpotTelemetry)).rejects.toThrow(
      /requires a SpotTelemetry payload/,
    );
  });

  it('fetchAITactics rejects non-object payloads without touching providers', async () => {
    await expect(fetchAITactics(null as unknown as SpotTelemetry)).rejects.toThrow();
    await expect(fetchAITactics(undefined as unknown as SpotTelemetry)).rejects.toThrow();
  });
});



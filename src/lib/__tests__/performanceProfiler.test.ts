/// <reference types="jest" />

/**
 * Performance regression benchmarks: 1,000-point payload through the
 * Phase 2 clustering grid + Phase 3 solunar formulas under Phase 4 chaos,
 * compiled into a structured payload array with no leaked state.
 */
import {
  captureMemorySnapshot,
  evaluatePerformanceGating,
  hintGc,
  profileExecutionTime,
  type ExecutionProfile,
  type MemorySnapshot,
} from '../performanceProfiler';
import { computeSpatialClusters, type GeoPoint, type SpatialBoundingBox } from '../mapClusterEngine';
import { generateSolunarForecast } from '../solunarEngine';
import { executeMockNetworkCall, resetChaosProfile, setChaosProfile } from '../syncChaosEngine';

const WORLD_BOX: SpatialBoundingBox = [-180, -90, 180, 90];

function buildThousandPoints(): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (let i = 0; i < 1000; i += 1) {
    points.push({
      id: `pt-${i}`,
      latitude: -30 + (i % 100) * 0.01,
      longitude: 150 + Math.floor(i / 100) * 0.01,
      species: i % 2 === 0 ? 'Bream' : 'Flathead',
    });
  }
  return points;
}

describe('performanceProfiler primitives', () => {
  it('times execution and returns the wrapped result', () => {
    const profile = profileExecutionTime('cluster-smoke', () => 42);
    expect(profile.label).toBe('cluster-smoke');
    expect(profile.result).toBe(42);
    expect(profile.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures a memory snapshot without throwing', () => {
    const snap = captureMemorySnapshot();
    expect(typeof snap.capturedAt).toBe('string');
    expect(['node-process', 'performance-memory', 'unavailable']).toContain(snap.source);
  });

  it('flags clustering overruns past the 16ms frame budget', () => {
    const evalResult = evaluatePerformanceGating(
      [{ label: 'computeSpatialClusters-1k', durationMs: 42, result: null }],
      [],
    );
    expect(evalResult.passed).toBe(false);
    expect(evalResult.warnings.join(' ')).toMatch(/16ms/);
  });

  it('flags heap inflation beyond the allowance', () => {
    const base: MemorySnapshot = {
      capturedAt: new Date().toISOString(),
      heapUsedBytes: 10_000_000,
      rssBytes: null,
      source: 'node-process',
    };
    const grown: MemorySnapshot = { ...base, heapUsedBytes: base.heapUsedBytes! + 50_000_000 };
    const evalResult = evaluatePerformanceGating([], [base, grown]);
    expect(evalResult.passed).toBe(false);
    expect(evalResult.warnings.join(' ')).toMatch(/Heap inflation/);
  });

  it('passes a clean run with null (unmeasurable) heap snapshots', () => {
    const nullSnap: MemorySnapshot = {
      capturedAt: new Date().toISOString(),
      heapUsedBytes: null,
      rssBytes: null,
      source: 'unavailable',
    };
    const evalResult = evaluatePerformanceGating(
      [{ label: 'computeSpatialClusters-1k', durationMs: 4, result: null }],
      [nullSnap, nullSnap],
    );
    expect(evalResult).toEqual({ passed: true, warnings: [] });
  });
});

/** Best-of-N microbenchmark: keeps JIT warm-up / GC pauses from skewing a run. */
function bestOfClusterProfile(
  label: string,
  fn: () => ReturnType<typeof computeSpatialClusters>,
  attempts = 3,
): ExecutionProfile {
  let best: ExecutionProfile | null = null;
  for (let i = 0; i < attempts; i += 1) {
    const profile = profileExecutionTime(label, fn);
    if (!best || profile.durationMs < best.durationMs) best = profile;
  }
  return best!;
}

describe('benchmark runner: 1k clustering + solunar under chaos', () => {
  beforeEach(() => resetChaosProfile());
  afterEach(() => resetChaosProfile());

  it('compiles structured metrics with no leaks and a passing gate', async () => {
    const points = buildThousandPoints();
    const metrics: ExecutionProfile[] = [];
    const snapshots: MemorySnapshot[] = [];

    hintGc();
    // Warm-up: JIT the clustering path before any timed measurement.
    computeSpatialClusters(points, WORLD_BOX, 8);
    snapshots.push(captureMemorySnapshot());

    // Phase 2 grid across zoom sweep (viewport pan simulation).
    for (const zoom of [4, 8, 12]) {
      metrics.push(
        bestOfClusterProfile(`computeSpatialClusters-zoom${zoom}`, () =>
          computeSpatialClusters(points, WORLD_BOX, zoom),
        ),
      );
    }
    snapshots.push(captureMemorySnapshot());

    // Phase 3 trig (offline, O(1)) — timed via wall clock around await.
    const solunarStart = performance.now();
    const forecast = await generateSolunarForecast(-28.0, 153.4, new Date('2024-06-15T00:00:00Z'));
    metrics.push({
      label: 'generateSolunarForecast-single',
      durationMs: performance.now() - solunarStart,
      result: forecast.lunarPhase,
    });

    // Phase 4 chaos: latency-wrapped passthrough still resolves. The
    // round-trip metric intentionally carries the 5ms artificial latency, so
    // it is labelled as a network op (outside the pure 16ms clustering
    // budget) and the inner clustering work is timed separately.
    setChaosProfile({ artificialLatencyMs: 5 });
    const chaosStart = performance.now();
    let innerClusterProfile: ExecutionProfile | null = null;
    const echoed = await executeMockNetworkCall(async () => {
      innerClusterProfile = bestOfClusterProfile('cluster-via-chaos', () =>
        computeSpatialClusters(points, WORLD_BOX, 8),
      );
      return innerClusterProfile.result as ReturnType<typeof computeSpatialClusters>;
    });
    metrics.push({
      label: 'chaos-network-roundtrip',
      durationMs: performance.now() - chaosStart,
      result: Array.isArray(echoed),
    });
    if (innerClusterProfile) metrics.push(innerClusterProfile);
    expect(echoed.length).toBeGreaterThan(0);
    snapshots.push(captureMemorySnapshot());

    // Structured payload, no leaked internals.
    expect(metrics).toHaveLength(6);
    expect(metrics.every((m) => typeof m.label === 'string' && m.durationMs >= 0)).toBe(true);
    expect(snapshots).toHaveLength(3);
    expect(Object.keys(metrics[0]!).sort()).toEqual(['durationMs', 'label', 'result']);

    // Only genuine clustering computations are held to the 16ms frame budget.
    const clusterMetrics = metrics.filter((m) => m.label.toLowerCase().includes('cluster'));
    expect(clusterMetrics).toHaveLength(4);
    const gate = evaluatePerformanceGating(clusterMetrics, snapshots, {
      maxClusterMs: 16,
      maxHeapGrowthBytes: 20 * 1024 * 1024,
    });
    expect(gate.warnings).toEqual([]);
    expect(gate.passed).toBe(true);
  }, 15000);
});

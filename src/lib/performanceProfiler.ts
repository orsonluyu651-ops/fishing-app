/**
 * Performance profiler — lightweight, pure benchmarking suite for the
 * analytical libraries (Phase 2 clustering, Phase 3 solunar trig).
 *
 * No dependencies, no side effects beyond timing/GC hooks: safe to run in
 * Jest, dev-client, or EAS diagnostics builds.
 */

export interface ExecutionProfile {
  label: string;
  /** Wall-clock cost in milliseconds (high-precision `performance.now()`). */
  durationMs: number;
  /** Return value of the profiled function (kept so callers can assert it). */
  result: unknown;
}

export interface MemorySnapshot {
  capturedAt: string;
  /** Heap bytes when measurable, else null (graceful fallback). */
  heapUsedBytes: number | null;
  /** RSS bytes when measurable, else null. */
  rssBytes: number | null;
  /** Which source produced the numbers (or why none was available). */
  source: 'node-process' | 'performance-memory' | 'unavailable';
}

export interface GatingConstraints {
  /** Max allowed clustering compute window (default 16ms ≈ 60 FPS frame). */
  maxClusterMs?: number;
  /** Max allowed heap growth across a run in bytes (default 5 MB). */
  maxHeapGrowthBytes?: number;
}

export interface GatingEvaluation {
  passed: boolean;
  warnings: string[];
}

/**
 * Time a synchronous operation with `performance.now()`. Falls back to
 * `Date.now()` where high-precision timers are unavailable.
 */
export function profileExecutionTime<T>(label: string, targetFn: () => T): ExecutionProfile {
  const clock: () => number =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? () => performance.now()
      : () => Date.now();
  const start = clock();
  const result = targetFn();
  const durationMs = clock() - start;
  return { label, durationMs, result };
}

/**
 * Capture a heap/RSS snapshot. Prefers Node `process.memoryUsage()`,
 * then Chrome `performance.memory`, else returns nulls — never throws.
 */
export function captureMemorySnapshot(): MemorySnapshot {
  try {
    const proc = (globalThis as Record<string, any>).process;
    if (proc && typeof proc.memoryUsage === 'function') {
      const mem = proc.memoryUsage() as { heapUsed?: number; rss?: number };
      return {
        capturedAt: new Date().toISOString(),
        heapUsedBytes: typeof mem.heapUsed === 'number' ? mem.heapUsed : null,
        rssBytes: typeof mem.rss === 'number' ? mem.rss : null,
        source: 'node-process',
      };
    }
    const perf = (globalThis as Record<string, any>).performance;
    const heap = perf?.memory?.usedJSHeapSize;
    if (typeof heap === 'number') {
      return {
        capturedAt: new Date().toISOString(),
        heapUsedBytes: heap,
        rssBytes: null,
        source: 'performance-memory',
      };
    }
  } catch {
    // Fall through to the unavailable snapshot below.
  }
  return {
    capturedAt: new Date().toISOString(),
    heapUsedBytes: null,
    rssBytes: null,
    source: 'unavailable',
  };
}

/**
 * Structural regression gate: warns when any `computeSpatialClusters`-tagged
 * metric exceeds the frame budget, or when heap growth between the first
 * and last snapshot exceeds the inflation allowance. Unmeasurable memory
 * (nulls) never fails — only known growth does.
 */
export function evaluatePerformanceGating(
  metrics: ExecutionProfile[],
  snapshots: MemorySnapshot[],
  constraints: GatingConstraints = {},
): GatingEvaluation {
  const { maxClusterMs = 16, maxHeapGrowthBytes = 5 * 1024 * 1024 } = constraints;
  const warnings: string[] = [];

  for (const metric of metrics ?? []) {
    if (metric.label.toLowerCase().includes('cluster') && metric.durationMs > maxClusterMs) {
      warnings.push(
        `Clustering budget exceeded: "${metric.label}" took ${metric.durationMs.toFixed(2)}ms (> ${maxClusterMs}ms, 60 FPS).`,
      );
    }
  }

  const heapSeries = (snapshots ?? [])
    .map((s) => s.heapUsedBytes)
    .filter((v): v is number => typeof v === 'number');
  if (heapSeries.length >= 2) {
    const growth = heapSeries[heapSeries.length - 1]! - heapSeries[0]!;
    if (growth > maxHeapGrowthBytes) {
      warnings.push(
        `Heap inflation detected: +${growth} bytes across run (> ${maxHeapGrowthBytes} byte allowance).`,
      );
    }
  }

  return { passed: warnings.length === 0, warnings };
}

/** Convenience: run an optional GC hint before a benchmark run (best-effort). */
export function hintGc(): void {
  try {
    const gc = (globalThis as Record<string, any>).gc;
    if (typeof gc === 'function') gc();
  } catch {
    // GC hooks are unavailable — benchmarking proceeds without them.
  }
}

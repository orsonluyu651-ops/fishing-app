// ─────────────────────────────────────────────────────────────
// Client-side performance monitor core.
//
// One tiny, dependency-free tracer module that everything else can time
// against without importing native modules (safe under jest-expo and Expo Go
// alike — it only reads the clock and appends to in-memory sample buffers).
//
// Two tracers, matching the two lag surfaces this milestone cares about:
//   * traceNetworkRequest — server proxy / Supabase round trips, warning past
//     a 2500 ms latency window;
//   * traceStorageOperation — AsyncStorage I/O durations during large queue
//     string-salvaging cycles, with byte accounting so a multi-hundred-KB
//     payload is visible in the diagnostics card.
//
// Every tracer is behaviour-preserving by contract: the wrapped operation's
// return value and errors pass through untouched, and the tracer itself can
// never throw — a metrics failure must never become a feature failure.
// ─────────────────────────────────────────────────────────────

/** Latency window past which a server proxy call is reported as lagging. */
export const NETWORK_LATENCY_WARNING_MS = 2500;

/** Duration past which an AsyncStorage cycle is reported as slow. */
export const STORAGE_SLOW_WARNING_MS = 1500;

/** Payload size past which a storage cycle is flagged as a large string pass. */
export const LARGE_STORAGE_PAYLOAD_BYTES = 256 * 1024;

/** Sliding window sizes — old samples fall off so the card shows recent truth. */
const NETWORK_SAMPLE_WINDOW = 50;
const STORAGE_SAMPLE_WINDOW = 50;

export interface PerfSample {
  /** Wall-clock duration of the traced operation, in milliseconds. */
  durationMs: number;
  /** When the sample was captured (Date.now()). */
  timestamp: number;
  /** URL for network samples; tracer label for storage samples. */
  source: string;
  /** Payload size in bytes — storage string-salvaging cycles only. */
  bytes?: number;
  /** True when the traced operation rejected. */
  failed?: boolean;
}

export interface PerfStats {
  /** Number of samples in the sliding window. */
  count: number;
  /** Mean duration across the window, in milliseconds. */
  averageMs: number;
  /** Slowest duration in the window, in milliseconds. */
  maxMs: number;
  /** Samples that breached their warning threshold. */
  slowCount: number;
  /** Sum of recorded payload bytes (storage tracer only, when known). */
  totalBytes: number;
  /** Most recent sample's duration, in milliseconds (null before the first). */
  lastDurationMs: number | null;
}

export type PerfSampleListener = (sample: PerfSample) => void;

// ── Sample buffers ────────────────────────────────────────────────
// Kept module-private; callers read aggregates via getNetworkStats /
// getStorageStats so the buffer shape can evolve without breaking the UI.
const networkSamples: PerfSample[] = [];
const storageSamples: PerfSample[] = [];
let networkListener: PerfSampleListener | null = null;
let storageListener: PerfSampleListener | null = null;

// Clock reader. performance.now gives sub-ms resolution where available
// (Hermes on device, Node under jest); Date.now is the universal fallback.
const readClock: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

function recordSample(
  bucket: PerfSample[],
  windowSize: number,
  listener: PerfSampleListener | null,
  sample: PerfSample,
): void {
  try {
    bucket.push(sample);
    if (bucket.length > windowSize) bucket.splice(0, bucket.length - windowSize);
    listener?.(sample);
  } catch {
    // Metrics bookkeeping must never break the traced operation.
  }
}

function summarize(bucket: PerfSample[], warningThresholdMs: number): PerfStats {
  const count = bucket.length;
  if (count === 0) {
    return {
      count: 0,
      averageMs: 0,
      maxMs: 0,
      slowCount: 0,
      totalBytes: 0,
      lastDurationMs: null,
    };
  }
  const totalMs = bucket.reduce((sum, sample) => sum + sample.durationMs, 0);
  return {
    count,
    averageMs: totalMs / count,
    maxMs: bucket.reduce((max, sample) => Math.max(max, sample.durationMs), 0),
    slowCount: bucket.filter((sample) => sample.durationMs > warningThresholdMs).length,
    totalBytes: bucket.reduce((sum, sample) => sum + (sample.bytes ?? 0), 0),
    lastDurationMs: bucket[count - 1].durationMs,
  };
}

/**
 * Times an outgoing server/proxy call and flags it when it exceeds the
 * 2500 ms latency window. The execution block's value and errors pass through
 * untouched — this is a pass-through wrapper, not a policy boundary.
 *
 * @example
 * const rows = await traceNetworkRequest(`${url}/rest/v1/catches`, () =>
 *   supabase.from('catches').select('*'),
 * );
 */
export async function traceNetworkRequest<T>(
  url: string,
  executionBlock: () => T | Promise<T>,
): Promise<T> {
  const startedAt = readClock();
  let failed = false;
  try {
    return await executionBlock();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const durationMs = readClock() - startedAt;
    const source = typeof url === 'string' && url.length > 0 ? url : 'unknown-url';
    recordSample(networkSamples, NETWORK_SAMPLE_WINDOW, networkListener, {
      durationMs,
      timestamp: Date.now(),
      source,
      failed,
    });
    if (failed) {
      console.warn(
        `[perfMonitor] network call failed after ${Math.round(durationMs)}ms: ${source}`,
      );
    } else if (durationMs > NETWORK_LATENCY_WARNING_MS) {
      console.warn(
        `[perfMonitor] slow network call: ${source} took ${Math.round(durationMs)}ms ` +
          `(latency window ${NETWORK_LATENCY_WARNING_MS}ms)`,
      );
    }
  }
}

/**
 * Times an AsyncStorage I/O cycle — reads, writes and the string-salvaging
 * parse passes the offline catch queue performs over large payloads. Pass
 * `sizeBytes` when the payload length is known (write paths, salvage passes)
 * so the diagnostics card can correlate duration with payload weight.
 */
export async function traceStorageOperation<T>(
  label: string,
  operation: () => T | Promise<T>,
  sizeBytes?: number,
): Promise<T> {
  const startedAt = readClock();
  let failed = false;
  try {
    return await operation();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const durationMs = readClock() - startedAt;
    const source = typeof label === 'string' && label.length > 0 ? label : 'unknown-storage';
    const bytes =
      typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes >= 0
        ? Math.round(sizeBytes)
        : undefined;
    recordSample(storageSamples, STORAGE_SAMPLE_WINDOW, storageListener, {
      durationMs,
      timestamp: Date.now(),
      source,
      ...(bytes !== undefined ? { bytes } : {}),
      failed,
    });
    if (failed) {
      console.warn(
        `[perfMonitor] storage operation failed after ${Math.round(durationMs)}ms: ${source}`,
      );
    } else if (
      durationMs > STORAGE_SLOW_WARNING_MS ||
      (bytes !== undefined && bytes > LARGE_STORAGE_PAYLOAD_BYTES)
    ) {
      console.warn(
        `[perfMonitor] heavy storage cycle: ${source} took ${Math.round(durationMs)}ms` +
          (bytes !== undefined ? ` over ${(bytes / 1024).toFixed(1)}KB` : ''),
      );
    }
  }
}

/** Aggregated network latency picture for the diagnostics card. */
export function getNetworkStats(): PerfStats {
  return summarize(networkSamples, NETWORK_LATENCY_WARNING_MS);
}

/** Aggregated AsyncStorage throughput picture for the diagnostics card. */
export function getStorageStats(): PerfStats {
  return summarize(storageSamples, STORAGE_SLOW_WARNING_MS);
}

/** Raw sample copies (defensive: callers cannot mutate the live buffers). */
export function getNetworkSamples(): PerfSample[] {
  return networkSamples.map((sample) => ({ ...sample }));
}

export function getStorageSamples(): PerfSample[] {
  return storageSamples.map((sample) => ({ ...sample }));
}

/** Observes new samples as they land (useful for live-updating diagnostics). */
export function setPerfSampleListener(
  target: 'network' | 'storage',
  listener: PerfSampleListener | null,
): void {
  if (target === 'network') networkListener = listener;
  else storageListener = listener;
}

/** Clears both buffers — used by the diagnostics card's reset control. */
export function resetPerfStats(): void {
  networkSamples.length = 0;
  storageSamples.length = 0;
}


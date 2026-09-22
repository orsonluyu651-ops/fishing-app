/**
 * Sync chaos engine — programmable network-fault injector for sync tests.
 *
 * Pure, lightweight wrapper: `setChaosProfile()` arms packet-drop and
 * latency simulation; `executeMockNetworkCall()` evaluates the active
 * profile before letting a Supabase-bound call through. Production paths
 * never enable this — `syncQueue()` only consults it under the opt-in
 * `simulateChaos` flag.
 */

export interface ChaosProfile {
  /** Drop probability per call, 0 (never) .. 1 (always). Clamped. */
  packetDropRate: number;
  /** Artificial delay applied to every call, ms. Clamped at >= 0. */
  artificialLatencyMs: number;
}

const DEFAULT_CHAOS_PROFILE: ChaosProfile = {
  packetDropRate: 0,
  artificialLatencyMs: 0,
};

let activeChaosProfile: ChaosProfile = { ...DEFAULT_CHAOS_PROFILE };

/** Test/ops handle for deterministic drops without touching Math.random. */
let chaosRandomSource: () => number = Math.random;

/**
 * Override the packet-drop random source for deterministic test scenarios.
 * @param source Function returning a random-like value; values are compared to the active drop rate.
 * @returns Nothing.
 * @complexity O(1).
 */
export function setChaosRandomSource(source: () => number): void {
  chaosRandomSource = source;
}

/**
 * Arm or partially update the active fault-injection profile.
 * @param profile Drop probability and/or latency override; invalid values are clamped safely.
 * @returns A defensive snapshot of the applied profile.
 * @complexity O(1).
 */
export function setChaosProfile(profile: Partial<ChaosProfile>): ChaosProfile {
  const rate = profile.packetDropRate ?? activeChaosProfile.packetDropRate;
  const latency = profile.artificialLatencyMs ?? activeChaosProfile.artificialLatencyMs;
  activeChaosProfile = {
    packetDropRate: Math.min(1, Math.max(0, Number.isFinite(rate) ? rate : 0)),
    artificialLatencyMs: Math.min(30_000, Math.max(0, Number.isFinite(latency) ? latency : 0)),
  };
  return { ...activeChaosProfile };
}

/**
 * Read the active profile without exposing mutable internal state.
 * @returns A defensive profile copy.
 * @complexity O(1).
 */
export function getChaosProfile(): ChaosProfile {
  return { ...activeChaosProfile };
}

/**
 * Disable all simulation and restore `Math.random` as the random source.
 * @returns The reset profile snapshot.
 * @complexity O(1).
 */
export function resetChaosProfile(): ChaosProfile {
  activeChaosProfile = { ...DEFAULT_CHAOS_PROFILE };
  chaosRandomSource = Math.random;
  return { ...activeChaosProfile };
}

/**
 * Determine whether packet loss or latency simulation is currently active.
 * @returns `true` when either configured value is non-zero.
 * @complexity O(1).
 */
export function isChaosActive(): boolean {
  return activeChaosProfile.packetDropRate > 0 || activeChaosProfile.artificialLatencyMs > 0;
}

function chaosDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `apiCallFn` through the active chaos profile: roll for a packet
 * drop first (throws `TypeError: Network request failed`, matching the
 * `isNetworkError` classifier), otherwise await the call, applying the
 * artificial latency beforehand. Zero-profile = transparent passthrough.
 * @param apiCallFn Deferred network operation; it is not called when a synthetic drop occurs.
 * @returns The wrapped operation's resolved value.
 * @throws {TypeError} When the configured packet-drop roll fails.
 * @complexity O(1), excluding configured delay and wrapped operation cost.
 */
export async function executeMockNetworkCall<T>(apiCallFn: () => Promise<T>): Promise<T> {
  const { packetDropRate, artificialLatencyMs } = activeChaosProfile;
  if (artificialLatencyMs > 0) {
    await chaosDelay(artificialLatencyMs);
  }
  if (packetDropRate > 0 && chaosRandomSource() < packetDropRate) {
    throw new TypeError('Network request failed');
  }
  return apiCallFn();
}

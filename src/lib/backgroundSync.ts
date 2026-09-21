import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';
import { syncQueue } from './offlineCatchQueue';

// ─────────────────────────────────────────────────────────────
// Native background catch-sync task layer.
//
// Workflow: the app is minimized → the OS wakes the JS runtime on its
// background-fetch schedule (no sooner than the registered minimum interval)
// → this task reads the signed-in session and flushes that user's offline
// catch queue via the verified syncQueue() routine → the result flag tells
// the scheduler whether the wakeup was worth it, which steers future timing.
//
// defineTask MUST stay in the module's global scope — TaskManager restores
// registered tasks on a cold background launch with no React tree mounted,
// so a task defined inside a component lifecycle would simply never run.
// Registration (the OS-level subscription) is what happens on mount, via
// registerBackgroundCatchSync() from app/_layout.tsx.
// ─────────────────────────────────────────────────────────────

/** Global task name — the string the OS scheduler and TaskManager agree on. */
export const BACKGROUND_CATCH_SYNC_TASK = 'BACKGROUND_CATCH_SYNC_TASK';

/**
 * Strict minimum between background fetch cycles: 15 minutes, in seconds.
 * The BackgroundFetchOptions.minimumInterval field is seconds, and this is
 * the floor the platforms themselves enforce — declaring anything smaller
 * would either be ignored or throttle the battery for no throughput gain.
 */
export const BACKGROUND_SYNC_MINIMUM_INTERVAL_SECONDS = 15 * 60;

// Task definition — global scope, per TaskManager's cold-start contract.
TaskManager.defineTask(BACKGROUND_CATCH_SYNC_TASK, async () => {
  try {
    // Safely fetch current user credentials: the persisted Supabase session
    // is the only scoping source, and syncQueue refuses a blank user anyway.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      // Nobody signed in — there is nothing scoped to flush. Reporting NoData
      // (rather than Failed) keeps the scheduler from penalising the app for
      // an expected no-op.
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Automatic background pass: default options skip permanently-failed
    // entries, matching the NetInfo reconnect path's retry policy.
    const { synced } = await syncQueue(userId);

    // Accurate completion flags: NewData only when the wakeup actually moved
    // rows off the device, NoData when the queue was already empty/clean.
    return synced > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (error) {
    console.warn('[backgroundSync] background catch sync failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export interface BackgroundSyncRegistration {
  status: 'registered' | 'already-registered' | 'unavailable' | 'denied' | 'error';
  message?: string;
}

// One in-flight registration promise — mount effects, auth callbacks and the
// diagnostics card can all call registerBackgroundCatchSync() concurrently
// without double-registering or racing the status checks.
let registrationPromise: Promise<BackgroundSyncRegistration> | null = null;

async function performRegistration(): Promise<BackgroundSyncRegistration> {
  // Expo Go cannot schedule background fetch (Android) / iOS denies it in the
  // sandbox — degrade quietly instead of red-screening, matching the queue's
  // Expo Go-safe storage pattern.
  if (typeof TaskManager.isAvailableAsync === 'function') {
    const available = await TaskManager.isAvailableAsync();
    if (!available) {
      return {
        status: 'unavailable',
        message:
          'TaskManager unavailable (Expo Go / web) — background sync disabled for this session.',
      };
    }
  }

  // Respect the OS gate before asking for schedule time.
  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Denied ||
    status === BackgroundFetch.BackgroundFetchStatus.Restricted
  ) {
    return {
      status: 'denied',
      message: 'Background app refresh is disabled in system settings.',
    };
  }
  if (status !== BackgroundFetch.BackgroundFetchStatus.Available) {
    return {
      status: 'unavailable',
      message: 'Background fetch is not available on this device.',
    };
  }

  // Already registered by a previous session (registration persists across
  // restarts)? Skip the syscall — re-registering would reset the schedule.
  if (typeof TaskManager.isTaskRegisteredAsync === 'function') {
    const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_CATCH_SYNC_TASK);
    if (alreadyRegistered) {
      return { status: 'already-registered' };
    }
  }

  await BackgroundFetch.registerTaskAsync(BACKGROUND_CATCH_SYNC_TASK, {
    // Strict 15-minute minimum interval between wakeups.
    minimumInterval: BACKGROUND_SYNC_MINIMUM_INTERVAL_SECONDS,
    // Keep the schedule alive when Android users swipe the app away — the
    // offline queue should still drain in the background.
    stopOnTerminate: false,
    // Boot-time restart stays off: the queue re-registers on the next launch,
    // and silently waking at boot is more surprise than benefit.
    startOnBoot: false,
  });
  return { status: 'registered' };
}

/**
 * Registers the background catch-sync cycle (idempotent, Expo Go-safe).
 * Fire-and-forget from a mount effect; the returned status is surfaced on
 * the diagnostics card.
 */
export function registerBackgroundCatchSync(): Promise<BackgroundSyncRegistration> {
  if (registrationPromise) return registrationPromise;
  registrationPromise = performRegistration().catch((error) => {
    // Drop the memo so a later call can retry (e.g. permission granted after
    // a settings round-trip), then report the failure.
    registrationPromise = null;
    console.warn('[backgroundSync] task registration failed:', error);
    return {
      status: 'error',
      message: 'Background sync registration failed — it will retry on the next launch.',
    } satisfies BackgroundSyncRegistration;
  });
  return registrationPromise;
}

/**
 * Human-readable background sync state for the diagnostics card:
 * 'registered' | 'not registered' | 'unavailable'.
 */
export async function getBackgroundSyncStatus(): Promise<string> {
  try {
    if (!(await TaskManager.isAvailableAsync())) return 'unavailable';
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_CATCH_SYNC_TASK);
    return registered ? 'registered' : 'not registered';
  } catch {
    return 'unavailable';
  }
}



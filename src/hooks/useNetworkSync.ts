/**
 * Network Status Subscription & Sync Outbox Flush Hook
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Subscribes to real-time connectivity changes from NetInfo. When the device
 * transitions from a disconnected state to a fully online state
 * (isConnected === true && isInternetReachable === true), this hook wakes the
 * sync outbox worker via `drainOutbox()` from src/lib/syncEngine.ts.
 *
 * A debounce guard prevents duplicate or competing worker loops if the device
 * rapidly oscillates between towers while on the water.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import NetInfo, {
  NetInfoState,
  NetInfoStateType,
  NetInfoSubscription,
} from '@react-native-community/netinfo';
import { drainOutbox } from '../lib/syncEngine';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean;
  connectionType: NetInfoStateType;
  isConnectionExpensive: boolean | null;
}

export interface UseNetworkSyncResult {
  networkStatus: NetworkStatus;
  lastSyncTimestamp: number | null;
  isSyncing: boolean;
  error: string | null;
  flushNow: () => Promise<void>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum interval (ms) between drainOutbox invocations to debounce rapid flapping. */
const DEBOUNCE_MS = 5_000;

/** Maximum number of mutations to drain per batch. */
const DRAIN_BATCH_SIZE = 10;

// ── Defaults ──────────────────────────────────────────────────────────────────

const initialState: NetworkStatus = {
  isConnected: false,
  isInternetReachable: false,
  connectionType: NetInfoStateType.unknown,
  isConnectionExpensive: null,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Subscribes to network connectivity changes and automatically flushes the
 * sync outbox whenever the device regains full internet connectivity.
 *
 * @param autoFlush  - When false, the hook still subscribes and tracks state
 *                     but never auto-triggers drainOutbox(). Useful for
 *                     testing or manual control. Defaults to true.
 */
export function useNetworkSync(
  autoFlush: boolean = true,
): UseNetworkSyncResult {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>(initialState);
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Track the previous connection state to detect transitions.
  const prevConnectedRef = useRef<boolean>(false);
  // Debounce guard — prevents duplicate worker loops during tower hopping.
    const lastDrainTimestampRef = useRef<number>(0);

  /** Trigger an outbox drain immediately (bypassing debounce). */
  const flushNow = useCallback(async (): Promise<void> => {
    const now = Date.now();

    if (isSyncing) {
            return;
    }

    setIsSyncing(true);
    setError(null);

    try {
            const metrics = await drainOutbox(DRAIN_BATCH_SIZE);

      setLastSyncTimestamp(now);
      lastDrainTimestampRef.current = now;

          } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Sync Network Hook] Outbox drain failed:', msg);
      setError(`Sync failed: ${msg}`);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  /**
   * Debounce guard — ensures we don't fire drainOutbox() if the last drain
   * was within DEBOUNCE_MS. This prevents competing worker loops when the
   * device rapidly transitions between cell towers on the water.
   */
  const attemptDebouncedDrain = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastDrainTimestampRef.current;

    if (elapsed < DEBOUNCE_MS) {
            return;
    }

        void flushNow();
    }, [flushNow]);

  /**
   * Evaluate the current NetInfo state and decide whether to fire drainOutbox().
   * Fires only when the device transitions from disconnected → connected.
   */
  const handleNetInfoChange = useCallback(
    (state: NetInfoState) => {
      const wasConnected = state.isConnected ?? false;
      const isReachable = state.isInternetReachable ?? false;
      const isFullyOnline = wasConnected && isReachable;

            const newStatus: NetworkStatus = {
        isConnected: wasConnected,
        isInternetReachable: isReachable,
        connectionType: state.type,
        isConnectionExpensive: state.details?.isConnectionExpensive ?? null,
      };

      setNetworkStatus(newStatus);

      
      // Detect the transition: disconnected → connected
      if (isFullyOnline && !prevConnectedRef.current) {
                prevConnectedRef.current = true;

        if (autoFlush) {
          attemptDebouncedDrain();
        }
      } else if (!isFullyOnline && prevConnectedRef.current) {
                prevConnectedRef.current = false;
      }
    },
        [autoFlush, attemptDebouncedDrain],
  );

  useEffect(() => {
    
    // Seed initial state synchronously.
    NetInfo.fetch()
      .then((initialState) => {
        const wasConnected = initialState.isConnected ?? false;
        const isReachable = initialState.isInternetReachable ?? false;

                const status: NetworkStatus = {
          isConnected: wasConnected,
          isInternetReachable: isReachable,
          connectionType: initialState.type,
          isConnectionExpensive: initialState.details?.isConnectionExpensive ?? null,
        };

        setNetworkStatus(status);
        prevConnectedRef.current = wasConnected && isReachable;

              })
      .catch((err: unknown) => {
        console.error('[Sync Network Hook] Initial NetInfo.fetch failed:', err);
        setError(
          `Initial network check failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    // Subscribe to real-time changes.
    const subscription: NetInfoSubscription = NetInfo.addEventListener(handleNetInfoChange);

    
    return () => {
            subscription();
    };
  }, [handleNetInfoChange]);

  return {
    networkStatus,
    lastSyncTimestamp,
    isSyncing,
    error,
    flushNow,
  };
}
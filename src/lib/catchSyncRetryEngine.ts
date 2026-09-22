import AsyncStorage from '@react-native-async-storage/async-storage';
import { synchronizeCatchQueue } from './catchSyncEngine';

let retryTimerId: ReturnType<typeof setTimeout> | null = null;
let currentRetryCount = 0;
const MAX_RETRY_LIMIT = 5;

/**
 * Initiates an incremental backing-off background polling sequence to force queue processing updates.
 */
export function scheduleSyncRetryWithBackoff(onSyncComplete?: (success: boolean) => void): void {
  if (retryTimerId) return; // Prevent creating duplicate overlapping polling loops

  const attemptQueueSync = async () => {
    if (currentRetryCount >= MAX_RETRY_LIMIT) {
      stopSyncRetryPolling();
      if (onSyncComplete) onSyncComplete(false);
      return;
    }

    currentRetryCount++;
    const fullSuccess = await synchronizeCatchQueue();

    if (fullSuccess) {
      stopSyncRetryPolling();
      if (onSyncComplete) onSyncComplete(true);
    } else {
      // Calculate geometric progression delays (1.5s, 3s, 4.5s, 6s...)
      const nextDelay = currentRetryCount * 1500;
      retryTimerId = setTimeout(attemptQueueSync, nextDelay);
    }
  };

  attemptQueueSync();
}

/**
 * Resets local monitoring interval indexes to an absolute zero state.
 */
export function stopSyncRetryPolling(): void {
  if (retryTimerId) {
    clearTimeout(retryTimerId);
    retryTimerId = null;
  }
  currentRetryCount = 0;
}

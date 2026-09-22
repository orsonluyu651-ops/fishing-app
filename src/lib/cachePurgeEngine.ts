import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PurgeSummaryReport {
  scannedCount: number;
  purgedCount: number;
  remainingCount: number;
  success: boolean;
}

/**
 * Reviews stored cache payload rows and removes structures older than the specified day ceiling.
 */
export async function executingPurgeOnExpiredCache(
  storageKey: string,
  ageInDaysThreshold: number,
): Promise<PurgeSummaryReport> {
  try {
    const rawData = await AsyncStorage.getItem(storageKey);
    if (!rawData) {
      return { scannedCount: 0, purgedCount: 0, remainingCount: 0, success: true };
    }

    const items: Array<{ id: string; timestamp: string }> = JSON.parse(rawData);
    if (!Array.isArray(items)) throw new Error('Invalid schema structure intercepted during clean');

    const now = new Date().getTime();
    const thresholdMs = ageInDaysThreshold * 24 * 60 * 60 * 1000;

    const activeItems = items.filter((item) => {
      const itemAge = now - new Date(item.timestamp).getTime();
      return itemAge <= thresholdMs;
    });

    const purgedCount = items.length - activeItems.length;

    if (purgedCount > 0) {
      await AsyncStorage.setItem(storageKey, JSON.stringify(activeItems));
    }

    return {
      scannedCount: items.length,
      purgedCount,
      remainingCount: activeItems.length,
      success: true,
    };
  } catch (err) {
    console.error(`Cache purge processing failure for key ${storageKey}:`, err);
    return { scannedCount: 0, purgedCount: 0, remainingCount: 0, success: false };
  }
}

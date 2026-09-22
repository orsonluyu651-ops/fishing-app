import AsyncStorage from '@react-native-async-storage/async-storage';
import { executingPurgeOnExpiredCache } from '../cachePurgeEngine';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));

describe('Local AsyncStorage Cache Expiry and Cleanup Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('safely sweeps out data packets that exceed specified day boundaries', async () => {
    const currentClock = new Date();
    const expiredClock = new Date();
    expiredClock.setDate(expiredClock.getDate() - 45); // Set to 45 days ago to trigger explicit purging walls

    const mockCacheDataset = [
      { id: 'fresh_1', timestamp: currentClock.toISOString() },
      { id: 'stale_2', timestamp: expiredClock.toISOString() },
    ];

    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockCacheDataset));

    const report = await executingPurgeOnExpiredCache('@sample_test_key', 30); // 30-day cutoff point wall
    expect(report.success).toBe(true);
    expect(report.purgedCount).toBe(1);
    expect(report.remainingCount).toBe(1);
    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });

  it('returns clean report summaries when targeting missing keys', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

    const report = await executingPurgeOnExpiredCache('@empty_key', 30);
    expect(report.scannedCount).toBe(0);
    expect(report.purgedCount).toBe(0);
    expect(report.remainingCount).toBe(0);
    expect(report.success).toBe(true);
    // setItem should not be called when there's nothing to write back
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('retains all items when none exceed the age threshold', async () => {
    const now = new Date();
    const recentItem = { id: 'r1', timestamp: now.toISOString() };
    const slightlyOld = { id: 'r2', timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 23).toISOString() }; // 23 hours ago

    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify([recentItem, slightlyOld]));

    const report = await executingPurgeOnExpiredCache('@recent_key', 1); // 1-day threshold
    expect(report.success).toBe(true);
    expect(report.purgedCount).toBe(0);
    expect(report.remainingCount).toBe(2);
    expect(report.scannedCount).toBe(2);
    // No write-back needed since nothing was purged
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('purges all items when every entry is older than the threshold', async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);

    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      JSON.stringify([
        { id: 'a', timestamp: oldDate.toISOString() },
        { id: 'b', timestamp: oldDate.toISOString() },
      ])
    );

    const report = await executingPurgeOnExpiredCache('@all_stale_key', 30);
    expect(report.success).toBe(true);
    expect(report.purgedCount).toBe(2);
    expect(report.remainingCount).toBe(0);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@all_stale_key', '[]');
  });

  it('returns a failure report when the stored JSON is malformed', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('not-valid-json{{{');

    const report = await executingPurgeOnExpiredCache('@bad_json_key', 7);
    expect(report.success).toBe(false);
    expect(report.scannedCount).toBe(0);
    expect(report.purgedCount).toBe(0);
  });

  it('returns a failure report when the stored data is not an array', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ id: 'single', timestamp: new Date().toISOString() }));

    const report = await executingPurgeOnExpiredCache('@not_array_key', 7);
    expect(report.success).toBe(false);
  });

  it('handles an empty array stored in AsyncStorage gracefully', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify([]));

    const report = await executingPurgeOnExpiredCache('@empty_array_key', 30);
    expect(report.success).toBe(true);
    expect(report.scannedCount).toBe(0);
    expect(report.purgedCount).toBe(0);
    expect(report.remainingCount).toBe(0);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

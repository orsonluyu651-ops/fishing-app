import { scheduleSyncRetryWithBackoff, stopSyncRetryPolling } from '../catchSyncRetryEngine';
import { synchronizeCatchQueue } from '../catchSyncEngine';

jest.mock('../catchSyncEngine', () => ({
  synchronizeCatchQueue: jest.fn(() => Promise.resolve(true)),
}));

describe('Automated Offline Sync Retry Watchdog Engine', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    stopSyncRetryPolling();
  });

  afterEach(() => {
    jest.useRealTimers();
    stopSyncRetryPolling();
  });

  it('stops polling immediately if the upload sequence passes completely', async () => {
    const callback = jest.fn();
    (synchronizeCatchQueue as jest.Mock).mockResolvedValueOnce(true);

    scheduleSyncRetryWithBackoff(callback);
    await jest.runAllTimersAsync();

    expect(synchronizeCatchQueue).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(true);
  });

  it('progressively backs off and retries up to the limit if network routes fail', async () => {
    const callback = jest.fn();
    (synchronizeCatchQueue as jest.Mock).mockResolvedValue(false); // Force continuous failures

    scheduleSyncRetryWithBackoff(callback);
    await jest.runAllTimersAsync();

    expect(synchronizeCatchQueue).toHaveBeenCalledTimes(5);
    expect(callback).toHaveBeenCalledWith(false);
  });

  it('does not start a second polling loop while one is already active', async () => {
    const callback = jest.fn();
    (synchronizeCatchQueue as jest.Mock).mockResolvedValue(false);

    scheduleSyncRetryWithBackoff(callback);
    scheduleSyncRetryWithBackoff(callback); // Duplicate call — should be ignored
    await jest.runAllTimersAsync();

    // Only one initial call should have been made; subsequent timers fire the same loop
    expect(synchronizeCatchQueue).toHaveBeenCalledTimes(5);
  });

  it('clears state when stopSyncRetryPolling is called mid-backoff', async () => {
    const callback = jest.fn();
    (synchronizeCatchQueue as jest.Mock).mockResolvedValue(false);

    scheduleSyncRetryWithBackoff(callback);
    // Advance partway through the backoff chain, then stop
    jest.advanceTimersByTime(1000);
    stopSyncRetryPolling();
    jest.advanceTimersByTime(10000);

    // Should have only the first attempt before stop was called
    expect(synchronizeCatchQueue).toHaveBeenCalledTimes(1);
    // Callback should never have been invoked since we aborted mid-chain
    expect(callback).not.toHaveBeenCalled();
  });

  it('resets retry count so a fresh call starts from zero', async () => {
    const callback = jest.fn();
    (synchronizeCatchQueue as jest.Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    scheduleSyncRetryWithBackoff(callback);
    await jest.advanceTimersByTimeAsync(1500); // first backoff delay
    await jest.advanceTimersByTimeAsync(3000); // second backoff delay

    // After two failures and one success, callback should resolve true
    expect(callback).toHaveBeenCalledWith(true);
  });
});

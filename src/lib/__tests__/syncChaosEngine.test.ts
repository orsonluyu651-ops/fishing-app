/// <reference types="jest" />

/**
 * Chaos injection validation: the sync queue must never drop records under
 * synthetic packet loss — rows survive with attempts +1 and drain once the
 * channel clears; latency injection delays but never corrupts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  enqueueCatch,
  loadQueue,
  syncQueue,
  type QueuedCatch,
} from '../offlineCatchQueue';
import {
  executeMockNetworkCall,
  getChaosProfile,
  isChaosActive,
  resetChaosProfile,
  setChaosProfile,
  setChaosRandomSource,
} from '../syncChaosEngine';
import { supabase } from '../supabase';

const mockInsertResponse: { data: unknown; error: unknown } = { data: null, error: null };
const mockLookupResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      upsert: jest.fn(() => ({
        select: jest.fn(() => Promise.resolve(mockInsertResponse)),
      })),
      select: jest.fn(() =>
        Object.assign(Promise.resolve(mockInsertResponse), {
          eq: () => ({
            maybeSingle: () => Promise.resolve(mockLookupResponse),
          }),
        }),
      ),
    })),
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn(() => Promise.resolve({ error: null })),
      })),
    },
  },
}));

function makeEntry(overrides: Partial<QueuedCatch> = {}): Omit<QueuedCatch, 'id' | 'attempts' | 'createdAt' | 'uploadedPath'> {
  return {
    userId: 'user-1',
    species: 'bream',
    length: 30,
    latitude: null,
    longitude: null,
    photoUri: null,
    ...overrides,
  };
}

let consoleErrorSpy: jest.SpyInstance;
beforeAll(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterAll(() => {
  consoleErrorSpy.mockRestore();
});

beforeEach(async () => {
  await AsyncStorage.clear();
  mockInsertResponse.data = null;
  mockInsertResponse.error = null;
  mockLookupResponse.data = null;
  mockLookupResponse.error = null;
  resetChaosProfile();
});

describe('setChaosProfile / executeMockNetworkCall', () => {
  it('clamps out-of-range profiles and reports activity', () => {
    expect(isChaosActive()).toBe(false);
    const clamped = setChaosProfile({ packetDropRate: 9, artificialLatencyMs: -50 });
    expect(clamped.packetDropRate).toBe(1);
    expect(clamped.artificialLatencyMs).toBe(0);
    expect(isChaosActive()).toBe(true);
    expect(getChaosProfile()).toEqual(clamped);
  });

  it('passes calls through transparently when disarmed', async () => {
    const fn = jest.fn(async () => 'ok');
    await expect(executeMockNetworkCall(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws TypeError: Network request failed on a scripted drop', async () => {
    setChaosProfile({ packetDropRate: 1 });
    setChaosRandomSource(() => 0); // always below rate → always drops
    await expect(executeMockNetworkCall(async () => 'ok')).rejects.toThrow(
      'Network request failed',
    );
  });

  it('applies artificial latency before resolving', async () => {
    setChaosProfile({ artificialLatencyMs: 30 });
    const start = Date.now();
    await expect(executeMockNetworkCall(async () => 'ok')).resolves.toBe('ok');
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
  });
});

describe('syncQueue + simulateChaos: never drops records', () => {
  it('keeps the row with attempts +1 on a total packet-loss pass, then drains clean', async () => {
    await enqueueCatch(makeEntry());
    setChaosProfile({ packetDropRate: 1 });
    setChaosRandomSource(() => 0);

    const storm = await syncQueue('user-1', { simulateChaos: true });
    expect(storm).toEqual({ synced: 0, failed: 1 });
    const held = await loadQueue();
    expect(held).toHaveLength(1);
    expect(held[0]!.attempts).toBe(1);

    // Channel clears — next pass re-queues naturally and syncs.
    resetChaosProfile();
    mockInsertResponse.data = [{ id: 'catch-row-1' }];
    const clear = await syncQueue('user-1', { simulateChaos: true });
    expect(clear).toEqual({ synced: 1, failed: 0 });
    expect(await loadQueue()).toEqual([]);
  });

  it('survives chaos on the conflict probe without losing the row', async () => {
    await enqueueCatch(makeEntry());
    setChaosProfile({ packetDropRate: 1 });
    setChaosRandomSource(() => 0);

    const storm = await syncQueue('user-1', { checkConflicts: true, simulateChaos: true });
    expect(storm.failed).toBe(1);
    expect(await loadQueue()).toHaveLength(1);

    resetChaosProfile();
    mockInsertResponse.data = [{ id: 'catch-row-1' }];
    const clear = await syncQueue('user-1', { checkConflicts: true });
    expect(clear).toEqual({ synced: 1, failed: 0 });
    expect(await loadQueue()).toEqual([]);
  });
});

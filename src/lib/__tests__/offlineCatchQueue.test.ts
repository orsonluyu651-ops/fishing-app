/// <reference types="jest" />

/**
 * Unit baseline for src/lib/offlineCatchQueue.ts.
 *
 * Covers the failure classifier and the queue-level behaviour the sync loop
 * derives from it:
 *   1. isPermanentFailure — a 4xx HTTP response must be classed as a permanent
 *      failure; transient conditions (408/429/5xx/network) must not be.
 *   2. syncQueue — when the `catches` upsert rejects with a 4xx, the entry is
 *      flagged failed in one hop (straight to FAILED_ATTEMPT_THRESHOLD, not
 *      +1), automatic background sync stops re-attempting it, and only an
 *      explicit includeFailed retry spends another round trip.
 *
 * Native modules are stood in by jest.setup.js (AsyncStorage, NetInfo,
 * expo-file-system). The Supabase client is mocked below so these tests never
 * touch the network.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  FAILED_ATTEMPT_THRESHOLD,
  enqueueCatch,
  isFailedEntry,
  isPermanentFailure,
  loadQueue,
  newQueueId,
  syncQueue,
  type QueuedCatch,
} from '../offlineCatchQueue';
import { supabase } from '../supabase';

// Response holders the jest.mock factory reads at call time (the `mock*`
// prefix is jest's sanctioned way for a module factory to see outer scope).
// Tests retarget these per case; beforeEach resets them to "success".
const mockInsertResponse: { data: unknown; error: unknown } = { data: null, error: null };
const mockLookupResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      // Path A — insert: from('catches').upsert(...).select('id')
      upsert: jest.fn(() => ({
        select: jest.fn(() => Promise.resolve(mockInsertResponse)),
      })),
      // Path B — dedupe recovery: from('catches').select('id').eq(...).maybeSingle()
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

// Typed handle onto the mocked builder so tests can count round trips.
const fromMock = supabase.from as unknown as jest.Mock;

function makeEntry(
  overrides: Partial<QueuedCatch> = {},
): Omit<QueuedCatch, 'id' | 'attempts' | 'createdAt' | 'uploadedPath'> {
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

beforeEach(async () => {
  await AsyncStorage.clear();
  fromMock.mockClear();
  mockInsertResponse.data = null;
  mockInsertResponse.error = null;
  mockLookupResponse.data = null;
  mockLookupResponse.error = null;
});

// ─────────────────────────────────────────────────────────────
// Spec 1 — isPermanentFailure classification
// ─────────────────────────────────────────────────────────────
describe('isPermanentFailure', () => {
  describe('4xx HTTP responses — permanent', () => {
    it.each([400, 401, 403, 404, 409, 422])(
      'flags HTTP %i as a permanent failure',
      (status) => {
        expect(isPermanentFailure({ status })).toBe(true);
      },
    );

    it('reads the status off the statusCode field Supabase/PostgREST errors carry', () => {
      expect(
        isPermanentFailure({ statusCode: 403, code: '42501', message: 'insufficient_privilege' }),
      ).toBe(true);
    });

    it('accepts a numeric status supplied as a string', () => {
      expect(isPermanentFailure({ statusCode: '400' })).toBe(true);
    });
  });

  describe('transient conditions — must stay retryable', () => {
    it('treats 408 request timeouts as retryable', () => {
      expect(isPermanentFailure({ status: 408 })).toBe(false);
    });

    it('treats 429 rate limits as retryable', () => {
      expect(isPermanentFailure({ status: 429 })).toBe(false);
    });

    it('treats 5xx server errors as retryable', () => {
      for (const status of [500, 502, 503, 504]) {
        expect(isPermanentFailure({ status })).toBe(false);
      }
    });

    it('treats 3xx redirects as retryable', () => {
      expect(isPermanentFailure({ status: 302 })).toBe(false);
    });

    it('never classifies a network drop as permanent, even if a status rode along', () => {
      expect(isPermanentFailure({ status: 403, message: 'network request failed' })).toBe(false);
      expect(isPermanentFailure(new Error('fetch failed'))).toBe(false);
    });

    it('defaults unrecognised error shapes to retryable', () => {
      expect(isPermanentFailure(new Error('boom'))).toBe(false);
      expect(isPermanentFailure(undefined)).toBe(false);
      expect(isPermanentFailure({})).toBe(false);
    });
  });

  describe('Postgres SQLSTATE codes — deterministic rejections', () => {
    it('flags RLS refusals (42501) and undefined columns (42703) — SQLSTATE 42%', () => {
      expect(isPermanentFailure({ code: '42501' })).toBe(true);
      expect(isPermanentFailure({ code: '42703' })).toBe(true);
    });

    it('flags data exceptions (22xxx) and integrity violations (23xxx)', () => {
      expect(isPermanentFailure({ code: '22P02' })).toBe(true);
      expect(isPermanentFailure({ code: '23505' })).toBe(true);
    });
  });
});

describe('newQueueId', () => {
  it('mints RFC 4122 UUIDs — the idempotency key format migration 0015 expects', () => {
    expect(newQueueId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Spec 2 — syncQueue treats 4xx responses as the permanent-failure
// category: flagged in one hop, not re-attempted automatically.
// ─────────────────────────────────────────────────────────────
describe('syncQueue — 4xx responses flag the entry under the permanent-failure category', () => {
  const PERMANENT_4XX = { statusCode: 403, code: '42501', message: 'insufficient_privilege' };

  // The queue logs every sync failure via console.error by design. Silence it
  // for this block only — the specs assert on queue state, not on the log.
  let consoleErrorSpy: jest.SpyInstance;
  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('jumps a queued catch to failed in one hop when the insert rejects with a 4xx', async () => {
    await enqueueCatch(makeEntry());
    mockInsertResponse.error = PERMANENT_4XX;

    const result = await syncQueue('user-1');

    expect(result).toEqual({ synced: 0, failed: 1 });
    const entries = await loadQueue();
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    // Straight to the failure threshold — NOT attempts + 1. The backend has
    // already given a definitive answer; no point rediscovering it.
    expect(entry.attempts).toBe(FAILED_ATTEMPT_THRESHOLD);
    expect(isFailedEntry(entry)).toBe(true);
    // Exactly one round trip was spent.
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it('stops automatic sync from re-attempting a permanent failure, but honours an explicit retry', async () => {
    await enqueueCatch(makeEntry());
    mockInsertResponse.error = PERMANENT_4XX;
    await syncQueue('user-1');
    expect(fromMock).toHaveBeenCalledTimes(1);

    // Automatic background sync (the NetInfo reconnect path): the entry is
    // skipped, so a deterministic rejection stops hitting the backend.
    const second = await syncQueue('user-1');
    expect(second).toEqual({ synced: 0, failed: 0 });
    expect(fromMock).toHaveBeenCalledTimes(1);

    // A user-initiated retry is the only path that spends another round trip.
    const manual = await syncQueue('user-1', { includeFailed: true });
    expect(manual).toEqual({ synced: 0, failed: 1 });
    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it('clears the entry once the same 4xx turns into a success on the manual retry', async () => {
    await enqueueCatch(makeEntry());
    mockInsertResponse.error = PERMANENT_4XX;
    await syncQueue('user-1');

    mockInsertResponse.error = null;
    mockInsertResponse.data = [{ id: 'catch-row-1' }];

    const result = await syncQueue('user-1', { includeFailed: true });

    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(await loadQueue()).toEqual([]);
  });

  it('keeps transient failures on the +1 attempts ladder instead of flagging them', async () => {
    await enqueueCatch(makeEntry());
    mockInsertResponse.error = new Error('Network request failed');

    const result = await syncQueue('user-1');

    expect(result).toEqual({ synced: 0, failed: 1 });
    const entries = await loadQueue();
    const entry = entries[0]!;
    // Network drops are ambiguous, so the entry earns attempts one at a time
    // and stays below the "needs attention" threshold.
    expect(entry.attempts).toBe(1);
    expect(isFailedEntry(entry)).toBe(false);
  });
});

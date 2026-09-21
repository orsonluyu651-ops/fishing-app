/// <reference types="jest" />

/**
 * Unit tests for src/lib/offlineQueueMutation.ts.
 *
 * Covers:
 *   1. updateQueuedCatchEntry - in-place mutation with attempt reset
 *   2. updateQueuedCatchEntry - photo URI changes with staging
 *   3. reconcileCatchConflict - client-wins strategy
 *   4. reconcileCatchConflict - server-wins strategy
 *   5. reconcileCatchConflict - merge-fields strategy
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  updateQueuedCatchEntry,
  reconcileCatchConflict,
  type ConflictResolutionStrategy,
} from '../offlineQueueMutation';
import { QueuedCatch, newQueueId, enqueueCatch, loadQueue } from '../offlineCatchQueue';
import { supabase } from '../supabase';

// Response holders the jest.mock factory reads at call time.
const mockInsertResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      upsert: jest.fn(() => ({
        select: jest.fn(() => Promise.resolve(mockInsertResponse)),
      })),
      select: jest.fn(() =>
        Object.assign(Promise.resolve(mockInsertResponse), {
          eq: () => ({
            maybeSingle: () => Promise.resolve(mockInsertResponse),
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

function makeEntry(overrides: Partial<QueuedCatch> = {}): QueuedCatch {
  return {
    id: newQueueId(),
    userId: 'user-1',
    species: 'bream',
    length: 30,
    latitude: null,
    longitude: null,
    photoUri: null,
    createdAt: new Date().toISOString(),
    attempts: 3,
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockInsertResponse.data = null;
  mockInsertResponse.error = null;
});

// ─────────────────────────────────────────────────────────────
// Spec 1 — updateQueuedCatchEntry
// ─────────────────────────────────────────────────────────────
describe('updateQueuedCatchEntry', () => {
  it('updates a queued catch entry in place and resets attempts to 0', async () => {
    const entry = makeEntry({ species: 'bream', length: 30, attempts: 3 });
    const enqueued = await enqueueCatch(entry);
    
    // Use the ID from the enqueued entry, not the original entry
    // (enqueueCatch generates a new ID if none is provided)
    const updated = await updateQueuedCatchEntry(enqueued.id, {
      species: 'Dusky Flathead',
      length: 45,
    });

    expect(updated).not.toBeNull();
    expect(updated?.species).toBe('Dusky Flathead');
    expect(updated?.length).toBe(45);
    expect(updated?.attempts).toBe(0);

    const queue = await loadQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.species).toBe('Dusky Flathead');
    expect(queue[0]!.length).toBe(45);
    expect(queue[0]!.attempts).toBe(0);
  });

  it('returns null when the entry is not found', async () => {
    const result = await updateQueuedCatchEntry('nonexistent-id', { species: 'bream' });
    expect(result).toBeNull();
  });

  it('preserves other fields when only some are updated', async () => {
    const entry = makeEntry({ species: 'bream', length: 30, latitude: -33.8651, longitude: 151.2093, attempts: 2 });
    const enqueued = await enqueueCatch(entry);

    const updated = await updateQueuedCatchEntry(enqueued.id, { length: 35 });

    expect(updated).not.toBeNull();
    expect(updated?.species).toBe('bream');
    expect(updated?.length).toBe(35);
    expect(updated?.latitude).toBe(-33.8651);
    expect(updated?.longitude).toBe(151.2093);
    expect(updated?.attempts).toBe(0);
  });

  it('resets attempts even when updating photoUri', async () => {
    const entry = makeEntry({ species: 'bream', attempts: 4 });
    const enqueued = await enqueueCatch(entry);

    const updated = await updateQueuedCatchEntry(enqueued.id, { photoUri: 'file:///path/to/new/photo.jpg' });

    expect(updated).not.toBeNull();
    expect(updated?.attempts).toBe(0);
    expect(updated?.photoUri).toBe('file:///path/to/new/photo.jpg');
  });
});

// ─────────────────────────────────────────────────────────────
// Spec 2 — reconcileCatchConflict
// ─────────────────────────────────────────────────────────────
describe('reconcileCatchConflict', () => {
  const localVersion: QueuedCatch = {
    id: 'local-id',
    userId: 'user-1',
    species: 'Bream',
    length: 30,
    latitude: null,
    longitude: null,
    photoUri: null,
    createdAt: '2024-01-15T10:00:00.000Z',
    attempts: 3,
  };

  const remoteVersion: Partial<QueuedCatch> = {
    id: 'remote-id',
    species: 'Bream',
    length: 28,
    createdAt: '2024-01-15T11:00:00.000Z',
    userId: 'user-1',
    latitude: -33.8651,
    longitude: 151.2093,
    photoUri: null,
    attempts: 0,
  };

  describe('client-wins strategy', () => {
    it('keeps the local version as-is', () => {
      const result = reconcileCatchConflict(localVersion, remoteVersion, 'client-wins');
      expect(result.localAction).toBe('keep');
      expect(result.resolvedCatch).toEqual(localVersion);
      expect(result.summary).toContain('Client-wins');
    });
  });

  describe('server-wins strategy', () => {
    it('returns the remote version and marks for removal', () => {
      const result = reconcileCatchConflict(localVersion, remoteVersion, 'server-wins');
      expect(result.localAction).toBe('remove');
      expect(result.resolvedCatch).toEqual(remoteVersion);
      expect(result.summary).toContain('Server-wins');
    });
  });

  describe('merge-fields strategy', () => {
    it('merges fields keeping server timestamps', () => {
      const result = reconcileCatchConflict(localVersion, remoteVersion, 'merge-fields');
      expect(result.localAction).toBe('update');
      expect(result.resolvedCatch.species).toBe('Bream');
      expect(result.resolvedCatch.length).toBe(28);
      expect(result.resolvedCatch.createdAt).toBe('2024-01-15T11:00:00.000Z');
      expect(result.resolvedCatch.attempts).toBe(0);
      expect(result.summary).toContain('Merge-fields');
    });

    it('preserves local species when server has none', () => {
      const localWithSpecies: QueuedCatch = { ...localVersion, species: 'Dusky Flathead' };
      const remoteNoSpecies: Partial<QueuedCatch> = {};
      const result = reconcileCatchConflict(localWithSpecies, remoteNoSpecies, 'merge-fields');
      expect(result.resolvedCatch.species).toBe('Dusky Flathead');
    });

    it('preserves local length when server has none', () => {
      const localWithLength: QueuedCatch = { ...localVersion, length: 45 };
      const remoteNoLength: Partial<QueuedCatch> = { length: null };
      const result = reconcileCatchConflict(localWithLength, remoteNoLength, 'merge-fields');
      expect(result.resolvedCatch.length).toBe(45);
    });

    it('falls back to local createdAt when server has none', () => {
      const localWithCreatedAt: QueuedCatch = { ...localVersion, createdAt: '2024-01-15T10:00:00.000Z' };
      const remoteNoCreatedAt: Partial<QueuedCatch> = {};
      const result = reconcileCatchConflict(localWithCreatedAt, remoteNoCreatedAt, 'merge-fields');
      expect(result.resolvedCatch.createdAt).toBe('2024-01-15T10:00:00.000Z');
    });
  });

  it('defaults to client-wins for unknown strategies', () => {
    const result = reconcileCatchConflict(localVersion, remoteVersion, 'unknown' as ConflictResolutionStrategy);
    expect(result.localAction).toBe('keep');
    expect(result.resolvedCatch).toEqual(localVersion);
    expect(result.summary).toContain('Unknown strategy');
  });
});
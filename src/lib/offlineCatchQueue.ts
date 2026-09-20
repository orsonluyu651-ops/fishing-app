import { File, Directory, Paths } from 'expo-file-system';
import { supabase } from './supabase';

// Offline catch queue: when a log submission fails with a network error out
// on the water, the payload (+ persistent photo copy) is saved and synced
// automatically on reconnect, oldest first.
//
// Storage note (Expo Go): standalone '@react-native-async-storage/async-storage'
// throws "Native module is null" inside standard Expo Go, which red-screens the
// app at import/first-call time. We therefore load it lazily and fall back to
// an in-memory queue (session-scoped) so Expo Go testing never crashes. On a
// dev-client / native build the real AsyncStorage is used and the queue
// persists across restarts.

export interface QueuedCatch {
  id: string;
  userId: string;
  species: string;
  length: number | null;
  latitude: number | null;
  longitude: number | null;
  photoUri: string | null;
  createdAt: string;
  attempts: number;
  /**
   * Storage object path, written the moment a photo upload succeeds. Persisting
   * it immediately is what lets a retry that follows a failed database insert
   * skip the photo step instead of re-uploading the same object.
   */
  uploadedPath?: string | null;
}

const QUEUE_KEY = '@tidewire:pending_catches:v1';
const PHOTO_DIR_NAME = 'pending-catch-photos';

// ── Expo Go-safe storage ────────────────────────────────────────────
// Lazily require AsyncStorage so a missing/broken native module never throws
// at import time. If the native module is null (standard Expo Go), every call
// degrades to an in-memory queue instead of red-screening.
type StorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

let asyncStorage: StorageLike | null = null;
let asyncStorageFailed = false;
const memoryFallback: Record<string, string> = {};

function getStorage(): StorageLike {
  if (asyncStorage) return asyncStorage;
  if (!asyncStorageFailed) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@react-native-async-storage/async-storage');
      const candidate: StorageLike | undefined = mod?.default ?? mod;
      if (candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function') {
        asyncStorage = candidate;
        return asyncStorage;
      }
    } catch {
      // fall through to memory fallback below
    }
    asyncStorageFailed = true;
    console.warn(
      '[offlineCatchQueue] AsyncStorage native module unavailable (Expo Go?) — using in-memory queue for this session.'
    );
  }
  return {
    getItem: async (key: string) => memoryFallback[key] ?? null,
    setItem: async (key: string, value: string) => {
      memoryFallback[key] = value;
    },
  };
}

// ── Serialized queue access (concurrency lock) ──────────────────────
// Every mutation is funnelled through one promise chain, so overlapping
// triggers — a NetInfo reconnect racing the user tapping the sync banner, or
// two rapid offline submissions — can never interleave their
// read-modify-write cycles. Without this, two concurrent syncs both read the
// same queue and insert the same catch, and a racing enqueue can be dropped.
let queueLock: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(task: () => Promise<T>): Promise<T> {
  // Chain onto the previous task regardless of whether it settled or rejected,
  // so a single failure can never wedge the lock for every later caller.
  const result = queueLock.then(task, task);
  queueLock = result.catch(() => undefined);
  return result;
}

function parseQueue(raw: string | null): QueuedCatch[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedCatch[]) : [];
  } catch (error) {
    console.error('Error parsing offline catch queue:', error);
    return [];
  }
}

// Unlocked read/write primitives. Only the public entry points above acquire
// the lock; internal helpers must use these directly, because calling a locked
// function from inside a locked section would deadlock against its own chain.
async function readQueue(): Promise<QueuedCatch[]> {
  try {
    return parseQueue(await getStorage().getItem(QUEUE_KEY));
  } catch (error) {
    console.error('Error loading offline catch queue:', error);
    return [];
  }
}

async function writeQueue(queue: QueuedCatch[]): Promise<void> {
  try {
    await getStorage().setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('Error saving offline catch queue (non-blocking):', error);
  }
}

/** Read the whole queue. Read-only, so it never needs the lock. */
export async function loadQueue(): Promise<QueuedCatch[]> {
  return readQueue();
}

export async function persistQueuedPhoto(sourceUri: string | null, queueId: string): Promise<string | null> {
  if (!sourceUri) return null;
  try {
    const extension = sourceUri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
    const dir = new Directory(Paths.document, PHOTO_DIR_NAME);
    if (!dir.exists) dir.create();
    const dest = new File(dir, `${queueId}.${extension}`);
    const src = new File(sourceUri);
    src.copy(dest);
    return dest.uri;
  } catch (error) {
    console.error('Error persisting queued photo:', error);
    return sourceUri;
  }
}

function deleteQueuedPhoto(photoUri: string | null): void {
  if (!photoUri) return;
  try {
    const file = new File(photoUri);
    if (file.exists) file.delete();
  } catch (error) {
    console.error('Error deleting queued photo:', error);
  }
}


export function enqueueCatch(
  entry: Omit<QueuedCatch, 'id' | 'attempts' | 'createdAt' | 'uploadedPath'>,
): Promise<QueuedCatch> {
  // Locked: this is a read-modify-write on the shared queue. Unlocked, a second
  // rapid offline submission (or a submit racing an in-flight sync) would read
  // the same snapshot and overwrite the other's entry.
  return withQueueLock(async () => {
    const queue = await readQueue();
    const queued: QueuedCatch = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      attempts: 0,
      createdAt: new Date().toISOString(),
      uploadedPath: null,
    };
    queued.photoUri = await persistQueuedPhoto(entry.photoUri, queued.id);
    queue.push(queued);
    await writeQueue(queue);
    return queued;
  });
}

// ── Unlocked queue mutations ────────────────────────────────────────
// Callers must already hold the lock (syncQueue and enqueueCatch do). They go
// through readQueue/writeQueue rather than the public API so they cannot
// re-enter the lock their caller holds, which would deadlock.

async function removeFromQueue(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.filter((item) => item.id !== id));
}

async function bumpAttempts(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.map((item) => (item.id === id ? { ...item, attempts: item.attempts + 1 } : item)));
}

/**
 * Records a successful photo upload onto the queued entry immediately.
 *
 * This closes the partial-failure trap: if the catches insert that follows then
 * fails on a network drop, the entry already carries the uploaded path, so the
 * next retry reuses it. Without it the retry re-uploads to a path that already
 * exists and, because the bucket writes with `upsert: false`, can never succeed.
 */
async function markPhotoUploaded(id: string, uploadedPath: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.map((item) => (item.id === id ? { ...item, uploadedPath } : item)));
}

// Real implementation. Assumes the caller holds the lock (syncQueue does).
async function uploadQueuedCatchUnlocked(entry: QueuedCatch): Promise<string> {
  // 1) Photo — skipped entirely when a previous attempt already uploaded it.
  //    This is what makes a retry after a failed insert idempotent: the object
  //    exists and the bucket writes with upsert: false, so uploading the same
  //    path a second time could never succeed.
  let mediaPath: string | null = entry.uploadedPath ?? null;
  if (entry.photoUri && !mediaPath) {
    const extension = entry.photoUri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
    const filePath = `${entry.userId}/${entry.id}.${extension}`;
    const file = new File(entry.photoUri);
    const bytes = await file.bytes();
    const contentType =
      extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
    const { error: uploadError } = await supabase.storage
      .from('catch-media')
      .upload(filePath, bytes, { contentType, upsert: false });
    if (uploadError) throw uploadError;

    mediaPath = filePath;
    // Persist the progress *before* the insert, so a network drop between the
    // two steps cannot strand the entry on a duplicate-upload retry loop.
    await markPhotoUploaded(entry.id, filePath);
  }

  const { data, error } = await supabase
    .from('catches')
    .insert({
      user_id: entry.userId,
      species: entry.species,
      length: entry.length,
      media_path: mediaPath,
      environmental:
        entry.latitude !== null && entry.longitude !== null
          ? { latitude: entry.latitude, longitude: entry.longitude }
          : {},
      captured_at: entry.createdAt,
    })
    .select('id')
    .single();
  if (error) throw error;

  deleteQueuedPhoto(entry.photoUri);
  await removeFromQueue(entry.id);
  return data.id as string;
}

/**
 * Replays one queued catch. Exported for direct use, but takes the lock so it
 * can never race a background sync. syncQueue calls the unlocked variant
 * because it already holds the lock.
 */
export function uploadQueuedCatch(entry: QueuedCatch): Promise<string> {
  return withQueueLock(() => uploadQueuedCatchUnlocked(entry));
}

export interface SyncResult {
  synced: number;
  failed: number;
}

/** Entries belonging to one user. Single source of truth for the scoping rule. */
export function pendingForUser(queue: QueuedCatch[], userId: string | null): QueuedCatch[] {
  if (!userId) return [];
  return queue.filter((entry) => entry.userId === userId);
}

/**
 * Flushes the queue for the signed-in user, oldest first.
 *
 * Scoped to `currentUserId` deliberately: the catch-media bucket RLS only
 * accepts writes under a folder named after auth.uid(), so replaying another
 * account's queued catch would always be rejected and would strand that entry.
 * Catches queued by a different user are left untouched until their owner
 * signs back in.
 *
 * Runs inside the queue lock, so a NetInfo reconnect racing a banner tap
 * produces one pass instead of two concurrent passes that double-insert.
 */
export function syncQueue(currentUserId: string): Promise<SyncResult> {
  if (!currentUserId) return Promise.resolve({ synced: 0, failed: 0 });

  return withQueueLock(async () => {
    const queue = await readQueue();
    const targets = pendingForUser(queue, currentUserId);

    let synced = 0;
    let failed = 0;
    for (const target of targets) {
      // Re-read under the lock so we always upload exactly what is stored. A
      // failed attempt below leaves its entry in place, so the snapshot stays
      // valid for the remaining entries.
      const entry = (await readQueue()).find((item) => item.id === target.id);
      if (!entry) continue;
      try {
        await uploadQueuedCatchUnlocked(entry);
        synced += 1;
      } catch (error) {
        console.error(`Error syncing queued catch ${entry.id}:`, error);
        await bumpAttempts(entry.id);
        failed += 1;
      }
    }
    return { synced, failed };
  });
}

export function isNetworkError(error: any): boolean {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return (
    message.includes('network request failed') ||
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnaborted') ||
    message.includes('enotfound') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('network error') ||
    message.includes('no internet') ||
    message.includes('offline') ||
    message.includes('failed to fetch') ||
    message.includes('load failed')
  );
}

import { File, Directory, Paths } from 'expo-file-system';
import { supabase } from './supabase';
import { traceStorageOperation } from './perfMonitor';
import type {
  ConflictResolutionStrategy,
  ReconcileResult,
} from './offlineQueueMutation';

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

// client_queue_id has to be a real UUID: the column is typed uuid and doubles as
// the dedupe key for a replayed insert (migration 0015). Entries written before
// this existed carry a timestamp-based id, so the pattern is also used to decide
// whether dedupe can be offered for a given entry.
const CLIENT_QUEUE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Failed attempts before an entry stops reading as merely "waiting" and starts
// reading as "needs attention". Kept here so the UI and any future retry cap
// share one definition of failure.
export const FAILED_ATTEMPT_THRESHOLD = 5;

/** True once an entry has failed often enough to be worth flagging to the user. */
export function isFailedEntry(entry: QueuedCatch): boolean {
  return entry.attempts >= FAILED_ATTEMPT_THRESHOLD;
}

/** Pulls an HTTP-ish status off a Supabase or storage error, when it carries one. */
function getErrorStatus(error: any): number | null {
  const raw = error?.status ?? error?.statusCode;
  const status = typeof raw === 'string' ? Number(raw) : raw;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

/**
 * True when retrying the same payload cannot possibly succeed.
 *
 * Postgres data exceptions (/^22/), integrity constraint violations (/^23/) and
 * SQLSTATE /^42/ - which covers 42501 insufficient_privilege, i.e. an RLS
 * refusal, and 42703 undefined_column, e.g. a catch carrying client_queue_id
 * before migration 0015 is applied - are all deterministic. So are 4xx HTTP
 * responses. Those entries are failed immediately so they stop hitting the
 * backend on every reconnect.
 *
 * Transient conditions stay retryable: network drops, 408 timeouts, 429 rate
 * limits and any 5xx, plus 3xx.
 *
 * Anything unrecognised is deliberately treated as retryable - a catch the
 * angler actually landed should never be written off because we failed to
 * recognise an error shape.
 */
export function isPermanentFailure(error: any): boolean {
  if (isNetworkError(error)) return false;

  const status = getErrorStatus(error);
  if (status !== null) {
    if (status === 408 || status === 429) return false;
    if (status >= 500) return false;
    if (status >= 400) return true;
  }

  const code = error?.code;
  if (typeof code === 'string' && /^(22|23|42)/.test(code)) return true;

  return false;
}

// Generates the idempotency key for one catch. Exported so a caller that writes
// a catch directly can mint the id up front and hand the SAME value to the queue
// if that write fails - otherwise a committed-but-unacknowledged insert would be
// replayed under a fresh id and duplicated.
export function newQueueId(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  // RFC 4122 v4 built on Math.random. This value only has to be unique, never
  // unguessable - it is an idempotency key, not a credential or a token.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

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

export function withQueueLock<T>(task: () => Promise<T>): Promise<T> {
  // Chain onto the previous task regardless of whether it settled or rejected,
  // so a single failure can never wedge the lock for every later caller.
  const result = queueLock.then(task, task);
  queueLock = result.catch(() => undefined);
  return result;
}

/** Structural check for a queue entry, used to drop only the broken rows. */
function isQueuedCatch(value: unknown): value is QueuedCatch {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<QueuedCatch>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.userId === 'string' &&
    candidate.userId.length > 0 &&
    typeof candidate.species === 'string'
  );
}

/**
 * Best-effort recovery of a payload that will not parse as a whole.
 *
 * Queue entries are flat objects serialised back to back, so the only separators
 * between them are `},{`. Splitting on that lets each entry be parsed on its
 * own, which means one corrupt row costs only itself instead of the angler's
 * entire pending cache. Deliberately best-effort: a value that itself contains
 * the literal `},{` may still be lost, but that is a far better outcome than
 * discarding everything.
 */
function salvageQueueEntries(raw: string): QueuedCatch[] {
  const recovered: QueuedCatch[] = [];
  for (const fragment of raw.split(/\}\s*,\s*\{/)) {
    // Re-add the braces the split consumed, tolerating the array brackets that
    // bracket the first and last fragment.
    const body = fragment
      .trim()
      .replace(/^\[?\s*\{?/, '')
      .replace(/\}?\s*\]?$/, '');
    if (!body) continue;
    try {
      const parsed = JSON.parse(`{${body}}`);
      if (isQueuedCatch(parsed)) recovered.push(parsed);
    } catch {
      // This fragment is the un-parseable row. Drop it and keep the rest.
    }
  }
  return recovered;
}

/**
 * Reads the queue, salvaging what it can rather than flushing the cache.
 *
 * Previously any parse failure returned [] and silently destroyed every pending
 * catch. Now a malformed payload is logged, then recovered row by row, and rows
 * that are individually broken are the only thing dropped.
 */
function parseQueue(raw: string | null): QueuedCatch[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('Offline catch queue payload is not valid JSON; salvaging entries:', error);
    const salvaged = salvageQueueEntries(raw);
    console.warn(
      `[offlineCatchQueue] Recovered ${salvaged.length} entr(ies) from a corrupt payload.`,
    );
    return salvaged;
  }

  if (!Array.isArray(parsed)) {
    console.error('Offline catch queue payload is not an array; salvaging entries.');
    return salvageQueueEntries(raw);
  }

  // Whole payload parsed: drop only the rows that are structurally broken.
  const valid = parsed.filter(isQueuedCatch);
  if (valid.length !== parsed.length) {
    console.warn(
      `[offlineCatchQueue] Dropped ${parsed.length - valid.length} malformed queue entr(ies).`,
    );
  }
  return valid;
}

// Unlocked read/write primitives. Only the public entry points above acquire
// the lock; internal helpers must use these directly, because calling a locked
// function from inside a locked section would deadlock against its own chain.
async function readQueue(): Promise<QueuedCatch[]> {
  try {
    // Both storage phases are traced so the diagnostics card sees the real
    // cost of a large queue payload: the raw I/O read, then the parse (which
    // is where the string-salvaging recovery runs) weighted by payload bytes.
    const raw = await traceStorageOperation(
      'offlineCatchQueue.read',
      () => getStorage().getItem(QUEUE_KEY),
    );
    return await traceStorageOperation(
      'offlineCatchQueue.parseQueue',
      () => parseQueue(raw),
      raw?.length,
    );
  } catch (error) {
    console.error('Error loading offline catch queue:', error);
    return [];
  }
}

async function writeQueue(queue: QueuedCatch[]): Promise<void> {
  try {
    // Serialise outside the tracer so the sample records exactly the storage
    // write duration, with the payload's byte weight attached.
    const payload = JSON.stringify(queue);
    await traceStorageOperation(
      'offlineCatchQueue.write',
      () => getStorage().setItem(QUEUE_KEY, payload),
      payload.length,
    );
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

/**
 * Erases every cached photo copy belonging to a queue entry.
 *
 * Two passes on purpose. The recorded `photoUri` is deleted first - which
 * matters because persistQueuedPhoto falls back to the picker's own URI if the
 * copy failed, so the file is not always inside the pending directory. Then
 * pending-catch-photos/ is swept for any copy still named after the entry, so a
 * discard can never leak storage even if the recorded URI was lost or rewritten.
 */
function deleteQueuedPhotoFiles(queueId: string, photoUri: string | null): void {
  deleteQueuedPhoto(photoUri);
  try {
    const dir = new Directory(Paths.document, PHOTO_DIR_NAME);
    if (!dir.exists) return;
    for (const item of dir.list()) {
      if (Paths.basename(item.uri).startsWith(`${queueId}.`) && item.exists) {
        item.delete();
      }
    }
  } catch (error) {
    console.error('Error sweeping cached photos for a discarded catch:', error);
  }
}


/**
 * Adds a catch to the queue, oldest-last.
 *
 * `presetId` lets a caller that already attempted a direct insert reuse that
 * attempt's client_queue_id for the queued retry, so the retry deduplicates
 * against a row that may have committed without its response arriving. Callers
 * must pass a value from newQueueId(); a non-UUID would simply lose dedupe.
 */
export function enqueueCatch(
  entry: Omit<QueuedCatch, 'id' | 'attempts' | 'createdAt' | 'uploadedPath'>,
  presetId?: string,
): Promise<QueuedCatch> {
  // Locked: this is a read-modify-write on the shared queue. Unlocked, a second
  // rapid offline submission (or a submit racing an in-flight sync) would read
  // the same snapshot and overwrite the other's entry.
  return withQueueLock(async () => {
    const queue = await readQueue();
    const queued: QueuedCatch = {
      ...entry,
      id: presetId ?? newQueueId(),
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

/**
 * Removes one queued catch and erases its cached photo.
 *
 * Returns false when the id was not queued. Takes the lock so a discard cannot
 * interleave with an in-flight sync, which would otherwise finish uploading an
 * entry the user just removed.
 */
export function discardQueuedCatch(id: string): Promise<boolean> {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const entry = queue.find((item) => item.id === id);
    if (!entry) return false;
    await writeQueue(queue.filter((item) => item.id !== id));
    deleteQueuedPhotoFiles(id, entry.photoUri);
    return true;
  });
}

// ── Unlocked queue mutations ────────────────────────────────────────
// Callers must already hold the lock (syncQueue and enqueueCatch do). They go
// through readQueue/writeQueue rather than the public API so they cannot
// re-enter the lock their caller holds, which would deadlock.

export { readQueue, writeQueue };

async function removeFromQueue(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.filter((item) => item.id !== id));
}

async function bumpAttempts(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.map((item) => (item.id === id ? { ...item, attempts: item.attempts + 1 } : item)));
}

/**
 * Jumps an entry straight to the failure threshold.
 *
 * Used when the backend has already given a definitive answer: there is no point
 * spending four more round trips rediscovering the same rejection, and the entry
 * needs to stop looking merely "waiting" the moment we know it is stuck.
 */
async function markEntryFailed(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(
    queue.map((item) =>
      item.id === id ? { ...item, attempts: Math.max(item.attempts, FAILED_ATTEMPT_THRESHOLD) } : item,
    ),
  );
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

  // 2) Row insert, deduplicated on the queue entry's own UUID.
  //
  // upsert with ignoreDuplicates maps to ON CONFLICT (client_queue_id) DO
  // NOTHING, so replaying an already-committed catch is a no-op instead of a
  // 23505 unique violation. Because the conflicting row is never inserted, the
  // AFTER INSERT create_feed_post_on_catch trigger does not fire again either,
  // so a retry cannot mint a second feed post.
  const canDedupe = CLIENT_QUEUE_ID_PATTERN.test(entry.id);

  // .select() deliberately without .single(): a deduplicated upsert returns ZERO
  // rows, and .single() would surface that as a PGRST116 error rather than the
  // successful sync that it actually is.
  const { data, error } = await supabase
    .from('catches')
    .upsert(
      {
        user_id: entry.userId,
        species: entry.species,
        length: entry.length,
        media_path: mediaPath,
        environmental:
          entry.latitude !== null && entry.longitude !== null
            ? { latitude: entry.latitude, longitude: entry.longitude }
            : {},
        captured_at: entry.createdAt,
        // Legacy entries predate UUID ids; syncing them without the key is better
        // than failing the uuid cast and stranding them forever.
        ...(canDedupe ? { client_queue_id: entry.id } : {}),
      },
      { onConflict: 'client_queue_id', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw error;

  let catchId = (data?.[0]?.id as string | undefined) ?? null;
  if (!catchId && canDedupe) {
    // Zero rows means the conflict was ignored, i.e. an earlier attempt already
    // committed this catch and only its response was lost. Recover the id so the
    // queue entry can still be cleared instead of retrying forever.
    const { data: existing, error: lookupError } = await supabase
      .from('catches')
      .select('id')
      .eq('client_queue_id', entry.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    catchId = (existing?.id as string | undefined) ?? null;
  }
  if (!catchId) {
    throw new Error('Catch insert returned no row and no existing catch was found.');
  }

  deleteQueuedPhoto(entry.photoUri);
  await removeFromQueue(entry.id);
  return catchId;
}

/**
 * Replays one queued catch. Exported for direct use, but takes the lock so it
 * can never race a background sync. syncQueue calls the unlocked variant
 * because it already holds the lock.
 */
export function uploadQueuedCatch(entry: QueuedCatch): Promise<string> {
  return withQueueLock(() => uploadQueuedCatchUnlocked(entry));
}

/**
 * Fetch the server-side row for a queued entry via its dedupe key
 * (`client_queue_id`). Returns null when there is no remote row yet (pure
 * insert — no collision possible), when the entry predates UUID dedupe
 * keys, or when the lookup itself fails (fail-open: the upsert still runs).
 */
export async function fetchRemoteCatchSnapshot(
  entry: QueuedCatch,
): Promise<RemoteCatchSnapshot | null> {
  if (!CLIENT_QUEUE_ID_PATTERN.test(entry.id)) return null;
  try {
    const { data, error } = await supabase
      .from('catches')
      .select('id,species,length,media_path,environmental,captured_at,updated_at,client_queue_id')
      .eq('client_queue_id', entry.id)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, any>;
    const env = (row.environmental ?? {}) as Record<string, any>;
    return {
      id: String(row.id ?? ''),
      species: (row.species as string | null) ?? null,
      length: (row.length as number | null) ?? null,
      latitude: typeof env.latitude === 'number' ? env.latitude : null,
      longitude: typeof env.longitude === 'number' ? env.longitude : null,
      photoUri: (row.media_path as string | null) ?? null,
      createdAt: (row.captured_at as string | null) ?? null,
      updatedAt: ((row.updated_at ?? row.captured_at) as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/** Map a remote snapshot onto the Partial<QueuedCatch> shape the reconciler expects. */
export function remoteSnapshotToPartial(remote: RemoteCatchSnapshot): Partial<QueuedCatch> {
  return {
    id: remote.id,
    species: remote.species ?? '',
    length: remote.length ?? null,
    latitude: remote.latitude ?? null,
    longitude: remote.longitude ?? null,
    photoUri: remote.photoUri ?? null,
    createdAt: remote.createdAt ?? '',
    attempts: 0,
  };
}

/**
 * Timestamp-collision check: true when the server row carries an `updatedAt`
 * differing from the local `createdAt` baseline. Missing timestamps fail
 * open (no collision) so legacy rows never false-positive.
 */
export function hasTimestampCollision(
  localEntry: QueuedCatch,
  remote: RemoteCatchSnapshot | null,
): boolean {
  if (!remote) return false;
  if (!remote.updatedAt) return false;
  if (!localEntry.createdAt) return false;
  return remote.updatedAt !== localEntry.createdAt;
}

/**
 * Probe for a collision without mutating anything. Returns the trapped
 * conflict when a remote row exists with a mismatched timestamp, else null.
 */
export async function detectCatchConflict(entry: QueuedCatch): Promise<CatchConflict | null> {
  const remote = await fetchRemoteCatchSnapshot(entry);
  if (!hasTimestampCollision(entry, remote)) return null;
  const snapshot = remote as RemoteCatchSnapshot;
  return {
    localEntry: entry,
    remoteSnapshot: snapshot,
    remoteAsPartial: remoteSnapshotToPartial(snapshot),
  };
}

/** True when an upsert rejection is a uniqueness collision (409 / PG 23505). */
export function isConflictError(error: any): boolean {
  const status = getErrorStatus(error);
  if (status === 409) return true;
  const code = String((error as any)?.code ?? '');
  return code === '23505';
}

/**
 * Route a trapped conflict through reconcileCatchConflict() and apply the
 * resulting localAction (caller must hold the queue lock):
 * - keep (client-wins): leave the entry; caller proceeds to upsert.
 * - remove (server-wins): drop the queue entry + cached photo.
 * - update (merge-fields): write merged fields back into the queue;
 *   caller proceeds to upsert the merged row.
 */
export async function reconcileAndApplyCatchConflict(
  conflict: CatchConflict,
  strategy: ConflictResolutionStrategy,
): Promise<ReconcileResult> {
  // Lazy require avoids the static cycle:
  // offlineQueueMutation imports withQueueLock/readQueue/writeQueue from here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { reconcileCatchConflict } = require('./offlineQueueMutation') as typeof import('./offlineQueueMutation');
  const result = reconcileCatchConflict(conflict.localEntry, conflict.remoteAsPartial, strategy);
  if (result.localAction === 'remove') {
    await removeFromQueue(conflict.localEntry.id);
    deleteQueuedPhotoFiles(conflict.localEntry.id, conflict.localEntry.photoUri);
  } else if (result.localAction === 'update') {
    const queue = await readQueue();
    const idx = queue.findIndex((item) => item.id === conflict.localEntry.id);
    if (idx >= 0) {
      queue[idx] = {
        ...queue[idx]!,
        ...(result.resolvedCatch as Partial<QueuedCatch>),
        id: conflict.localEntry.id,
        userId: conflict.localEntry.userId,
        attempts: 0,
      };
      await writeQueue(queue);
    }
  }
  return result;
}

export interface SyncResult {
  synced: number;
  failed: number;
}

/** Minimal remote snapshot used only for collision detection. */
export interface RemoteCatchSnapshot {
  id: string;
  species?: string | null;
  length?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  photoUri?: string | null;
  createdAt?: string | null;
  /** Server `updated_at` (or `captured_at` fallback) — collision signal. */
  updatedAt?: string | null;
}

/** A trapped collision awaiting a resolution rule. */
export interface CatchConflict {
  localEntry: QueuedCatch;
  remoteSnapshot: RemoteCatchSnapshot;
  remoteAsPartial: Partial<QueuedCatch>;
}

/** Resolution requested by the visual picker / caller hook. */
export type ConflictDecision = ConflictResolutionStrategy | 'defer';

/**
 * Hook invoked when a collision is trapped and no static strategy was
 * supplied. Return a strategy to resolve now, or `'defer'` (or null) to
 * suspend the loop for that row so the picker overlay can ask the angler.
 */
export type ConflictDecisionHook = (
  conflict: CatchConflict,
) => ConflictDecision | null | undefined | Promise<ConflictDecision | null | undefined>;

/** Module-level shelf for deferred conflicts surfaced to the picker UI. */
let pendingCatchConflicts: CatchConflict[] = [];

/** Conflicts deferred via `'defer'` — the picker overlay drains this. */
export function getPendingCatchConflicts(): CatchConflict[] {
  return [...pendingCatchConflicts];
}

/** Remove one deferred conflict once the angler has resolved it. */
export function clearPendingCatchConflict(id: string): void {
  pendingCatchConflicts = pendingCatchConflicts.filter((c) => c.localEntry.id !== id);
}

/** Test/shutdown helper — drops every deferred conflict. */
export function clearPendingCatchConflicts(): void {
  pendingCatchConflicts = [];
}

/** Entries belonging to one user. Single source of truth for the scoping rule. */
export function pendingForUser(queue: QueuedCatch[], userId: string | null): QueuedCatch[] {
  if (!userId) return [];
  return queue.filter((entry) => entry.userId === userId);
}

export interface SyncQueueOptions {
  /**
   * When false (the default, i.e. automatic background sync) an entry that has
   * already reached FAILED_ATTEMPT_THRESHOLD is skipped, so a deterministic
   * failure stops hammering the backend on every reconnect. A user-initiated
   * retry passes true to give those entries another chance.
   */
  includeFailed?: boolean;
  /**
   * Opt-in pre-upsert conflict probe. When true, syncQueue fetches the remote
   * row for each dedupe-capable entry and routes timestamp collisions through
   * `reconcileCatchConflict()` before the `.upsert()`. Off by default so the
   * hot path spends zero extra round trips.
   */
  checkConflicts?: boolean;
  /**
   * Static resolution rule applied to every trapped collision. When omitted,
   * `onConflict` (or the deferred picker shelf) decides per row.
   */
  conflictStrategy?: ConflictResolutionStrategy;
  /**
   * Per-row hook for collisions: return a strategy to resolve immediately,
   * or 'defer'/null to suspend the loop for that row and surface it to the
   * `CatchConflictPicker` overlay via `getPendingCatchConflicts()`.
   */
  onConflict?: ConflictDecisionHook;
  /**
   * Opt-in chaos injection (tests only). When true, every Supabase-bound
   * call in this pass — conflict probes and row upserts — runs through
   * `executeMockNetworkCall()` under the armed `setChaosProfile()`.
   * Synthetic drops surface as transient network errors: the row is kept
   * with attempts +1 so the next pass re-queues it naturally. Off by
   * default; production never enables this.
   */
  simulateChaos?: boolean;
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
export function syncQueue(
  currentUserId: string,
  options: SyncQueueOptions = {},
): Promise<SyncResult> {
  const { includeFailed = false, checkConflicts = false, conflictStrategy, onConflict, simulateChaos = false } = options;
  if (!currentUserId) return Promise.resolve({ synced: 0, failed: 0 });

  return withQueueLock(async () => {
    // Chaos wrapper is resolved lazily (syncChaosEngine imports nothing from
    // here, but lazy keeps the hot path free of any overhead when disabled).
    const { executeMockNetworkCall } = simulateChaos
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ? (require('./syncChaosEngine') as typeof import('./syncChaosEngine'))
      : { executeMockNetworkCall: <T>(fn: () => Promise<T>) => fn() };
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

      // Hard cap: automatic sync leaves known-bad entries alone instead of
      // retrying them on every reconnect. Only an explicit user retry
      // (includeFailed) re-attempts them.
      if (!includeFailed && isFailedEntry(entry)) continue;

      // ── Sync conflict interceptor (opt-in via checkConflicts) ──
      // Before the standard .upsert(), fetch the remote row and compare
      // timestamps. A mismatch means the record was modified both locally
      // and on the server while offline — route it through
      // reconcileCatchConflict() with the selected resolution rule.
      // Unset strategy + no hook decision suspends the loop for that row:
      // the conflict is shelved for the CatchConflictPicker overlay and
      // the entry is re-queued untouched.
      if (checkConflicts) {
        let trapped: CatchConflict | null = null;
        try {
          trapped = await executeMockNetworkCall(() => detectCatchConflict(entry));
        } catch (error) {
          // Chaos-injected drop on the probe: treat as transient — keep the
          // row with attempts +1 so the next pass re-queues it naturally.
          console.error(`Error syncing queued catch ${entry.id}:`, error);
          await bumpAttempts(entry.id);
          failed += 1;
          continue;
        }
        if (trapped) {
          let decision: ConflictDecision | null | undefined = conflictStrategy;
          if (!decision && onConflict) {
            decision = await onConflict(trapped);
          }
          if (!decision || decision === 'defer') {
            if (!pendingCatchConflicts.some((c) => c.localEntry.id === trapped.localEntry.id)) {
              pendingCatchConflicts.push(trapped);
            }
            continue;
          }
          const applied = await reconcileAndApplyCatchConflict(trapped, decision);
          if (applied.localAction === 'remove') {
            // server-wins: adopted the backend version — counts as synced.
            clearPendingCatchConflict(trapped.localEntry.id);
            synced += 1;
            continue;
          }
          clearPendingCatchConflict(trapped.localEntry.id);
          // keep/update: fall through to the upsert with resolved fields.
        }
      }

      try {
        await executeMockNetworkCall(() => uploadQueuedCatchUnlocked(entry));
        synced += 1;
      } catch (error) {
        console.error(`Error syncing queued catch ${entry.id}:`, error);
        // A deterministic rejection goes straight to failed rather than
        // spending the remaining attempts rediscovering the same answer.
        if (isPermanentFailure(error)) {
          await markEntryFailed(entry.id);
        } else {
          await bumpAttempts(entry.id);
        }
        failed += 1;
      }
    }
    return { synced, failed };
  });
}

/**
 * Resolve one deferred conflict from the picker overlay (takes the queue
 * lock): applies the chosen strategy transactionally, drops the shelf entry,
 * and — for keep/update — re-queues the sync task by leaving the (possibly
 * merged) entry in place so the next `syncQueue()` pass uploads it.
 * Returns null when the conflict is no longer pending.
 */
export function resolvePendingCatchConflict(
  conflictId: string,
  decision: ConflictResolutionStrategy,
): Promise<ReconcileResult | null> {
  return withQueueLock(async () => {
    const conflict = pendingCatchConflicts.find((c) => c.localEntry.id === conflictId);
    if (!conflict) return null;
    const result = await reconcileAndApplyCatchConflict(conflict, decision);
    clearPendingCatchConflict(conflictId);
    return result;
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

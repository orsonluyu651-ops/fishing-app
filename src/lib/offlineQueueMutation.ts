import { File, Directory, Paths } from 'expo-file-system';
import { QueuedCatch, withQueueLock, readQueue, writeQueue } from './offlineCatchQueue';
/**
 * Offline Edit Engine — transactional mutations on queued catch entries.
 *
 * Allows users to modify catches that are still in the offline queue (not yet
 * synced to the backend) before they are sent. This includes resetting failure
 * counters and managing photo asset swaps.
 */

// ── Photo asset management ──────────────────────────────────────────────────

/**
 * Stage a photo in the pending-catch-photos directory under a queue-entry-scoped
 * filename. Deletes the old asset if it lived there previously.
 *
 * Returns the new URI if a photo was provided and valid, otherwise null.
 */
async function stageQueuedPhoto(
  photoUri: string | null,
  queueId: string,
): Promise<string | null> {
  if (!photoUri) return null;

  const pendingDir = new Directory(Paths.document, 'pending-catch-photos');
  if (!pendingDir.exists) pendingDir.create();

  const extension = photoUri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
  const newFile = new File(pendingDir, `${queueId}.${extension}`);

  // If the source is a different file, copy it; otherwise just ensure it exists.
  if (photoUri !== newFile.uri) {
    const src = new File(photoUri);
    if (src.exists) {
      src.copy(newFile);
    } else {
      // Source doesn't exist — drop the photo reference.
      return null;
    }
  }

  // Remove any stale photo files for this queue entry.
  deleteQueuedPhotoFromPendingDir(queueId);

  return newFile.uri;
}

/**
 * Deletes any photo file in pending-catch-photos/ that belongs to a queue entry.
 */
function deleteQueuedPhotoFromPendingDir(queueId: string): void {
  try {
    const dir = new Directory(Paths.document, 'pending-catch-photos');
    if (!dir.exists) return;
    for (const item of dir.list()) {
      if (Paths.basename(item.uri).startsWith(`${queueId}.`) && item.exists) {
        item.delete();
      }
    }
  } catch (error) {
    console.error('Error deleting old pending photo:', error);
  }
}

// ── Queue mutation primitives (must be called under queue lock) ─────────────

/**
 * Internal: reads the queue, applies a partial update to a matching entry, and
 * writes it back. Callers must hold the queue lock.
 */
async function applyQueuedCatchUpdateUnlocked(
  id: string,
  partial: Partial<QueuedCatch>,
): Promise<QueuedCatch | null> {
  const queue = await readQueue();
  const idx = queue.findIndex((item) => item.id === id);
  if (idx < 0) return null;

  const entry = queue[idx]!;

  // Determine if the photo is changing.
  const newPhotoUri = partial.photoUri ?? entry.photoUri;
  const photoChanged = partial.photoUri !== undefined && newPhotoUri !== entry.photoUri;

  // Build the updated entry.
  const updated: QueuedCatch = {
    ...entry,
    ...partial,
    photoUri: newPhotoUri,
    // Reset failure counter on any successful edit — the user has interacted
    // with the entry, so it should not be penalised for prior sync failures.
    attempts: 0,
  };

  // Handle photo asset swap if needed.
  if (photoChanged) {
    const stagedUri = await stageQueuedPhoto(partial.photoUri ?? null, entry.id);
    // If staging failed (e.g., source file doesn't exist), keep the original URI
    // if provided, otherwise use the staged URI.
    updated.photoUri = stagedUri ?? partial.photoUri ?? entry.photoUri;
  }

  queue[idx] = updated;
  await writeQueue(queue);

  return updated;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolution strategy for catch conflicts.
 */
export type ConflictResolutionStrategy = 'client-wins' | 'server-wins' | 'merge-fields';

/**
 * Result of a conflict reconciliation.
 */
export interface ReconcileResult {
  /** The resolved catch data to use going forward. */
  resolvedCatch: Partial<QueuedCatch>;
  /** Whether the local queue entry should be kept, updated, or removed. */
  localAction: 'keep' | 'update' | 'remove';
  /** Human-readable summary for logging or UI. */
  summary: string;
}

/**
 * Reconcile a conflict between a locally queued catch and a remote version.
 *
 * Strategies:
 * - `client-wins`: Force-overwrite the backend with the client's current queue
 *   modifications. The local entry is kept with its current data.
 * - `server-wins`: Clear the local queue record and silently adopt the backend
 *   configuration. The local entry is removed.
 * - `merge-fields`: Combine fields intelligently — merge localised comments while
 *   keeping the server's precise timestamp records.
 */
export function reconcileCatchConflict(
  localVersion: QueuedCatch,
  remoteVersion: Partial<QueuedCatch>,
  strategy: ConflictResolutionStrategy,
): ReconcileResult {
  switch (strategy) {
    case 'client-wins': {
      // Keep the local version as-is — it will overwrite the server on next sync.
      return {
        resolvedCatch: localVersion,
        localAction: 'keep',
        summary: `Client-wins: local catch "${localVersion.species}" will overwrite remote record.`,
      };
    }

    case 'server-wins': {
      // Adopt the server version and remove the local queue entry.
      return {
        resolvedCatch: remoteVersion,
        localAction: 'remove',
        summary: `Server-wins: local catch "${localVersion.species}" discarded in favour of remote record.`,
      };
    }

    case 'merge-fields': {
      // Merge: keep server's authoritative fields (timestamps, IDs) but preserve
      // local user-generated content (comments, notes, species if more specific).
      const merged: Partial<QueuedCatch> = {
        ...remoteVersion,
        // Preserve local species if the user provided a more specific one and server has none.
        species: remoteVersion.species || localVersion.species || '',
        // Use server's length if available, otherwise fall back to local.
        length: remoteVersion.length ?? localVersion.length ?? null,
        // Preserve local photo if the user added one and server doesn't have it.
        photoUri: localVersion.photoUri || remoteVersion.photoUri || null,
        // Reset attempts since we're resolving the conflict.
        attempts: 0,
        // Keep server's createdAt if available, otherwise use local.
        createdAt: (remoteVersion as any).createdAt || localVersion.createdAt,
      };

      return {
        resolvedCatch: merged,
        localAction: 'update',
        summary: `Merge-fields: combined local "${localVersion.species}" with remote record, keeping server timestamps.`,
      };
    }

    default:
      // Should never happen due to type constraints, but be defensive.
      return {
        resolvedCatch: localVersion,
        localAction: 'keep',
        summary: `Unknown strategy "${strategy}"; defaulting to client-wins.`,
      };
  }
}

/**
 * Update a queued catch entry in place.
 *
 * Locates the target catch by its unique ID, applies the partial data updates,
 * resets its `failCount` (attempts) to 0, and saves the modified payload.
 *
 * If the update changes the catch photo path, the old asset in
 * `pending-catch-photos/` is removed and the new photo is staged there.
 *
 * @param id - The unique ID of the queued catch to update.
 * @param partialCatchData - The fields to update (partial QueuedCatch).
 * @returns The updated QueuedCatch entry, or null if the entry was not found.
 *
 * @example
 * ```ts
 * const updated = await updateQueuedCatchEntry('uuid-here', {
 *   species: 'Dusky Flathead',
 *   length: 45,
 * });
 * ```
 */
export async function updateQueuedCatchEntry(
  id: string,
  partialCatchData: Partial<QueuedCatch>,
): Promise<QueuedCatch | null> {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const entry = queue.find((item) => item.id === id);

    if (!entry) {
      console.warn(`[offlineQueueMutation] Cannot update: no queued catch with id "${id}".`);
      return null;
    }

    return applyQueuedCatchUpdateUnlocked(id, partialCatchData);
  });
}

/**
 * Get a queued catch entry by ID without modifying it.
 *
 * @param id - The unique ID of the queued catch to retrieve.
 * @returns The QueuedCatch entry, or null if not found.
 */
export async function getQueuedCatchEntry(id: string): Promise<QueuedCatch | null> {
  const { loadQueue } = await import('./offlineCatchQueue');
  const queue = await loadQueue();
  return queue.find((item) => item.id === id) ?? null;
}



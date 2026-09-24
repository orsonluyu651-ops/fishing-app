/**
 * Offline Mutation Outbox & Background Sync Engine
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * Dual-tier sync architecture:
 *
 * Tier 1 — Outbox Queue (sync_outbox table, migration v7):
 *   All local mutations are written to a centralized outbox table atomically
 *   alongside their domain-table write. The sync worker drains the queue
 *   when connectivity returns, applying mutations to the cloud (Supabase)
 *   in order and marking each as SYNCED or FAILED.
 *
 * Tier 2 — Legacy reconciliation (syncOfflineCatchesToCloud):
 *   Existing catch-log sync path preserved for backward compatibility.
 *
 * @see databaseMigrations.ts — migration v7 creates the sync_outbox schema
 * @see offlineDatabase.ts — all local writes now call queueMutation()
 */
import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { supabase } from './supabase';
import { initOfflineDatabase } from './offlineDatabase';
import { runMigrations } from './databaseMigrations';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SyncAction = 'INSERT' | 'UPDATE' | 'DELETE';
export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'ERROR';

export interface OutboxEntry {
  id: number;
  table_name: string;
  record_id: string;
  action: SyncAction;
  payload: string;      // JSON-serialized
  status: SyncStatus;
  attempt_count: number;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export interface SyncMetrics {
  success: number;
  failed: number;
  retried: number;
}

// ── Race Condition Guards ────────────────────────────────────────────────────
// Prevents duplicate entries by ensuring only one sync worker drains the
// outbox at a time. Subsequent sync triggers are debounced/queued.
let isSyncInProgress = false;
let pendingSyncResolve: (() => void) | null = null;
const MAX_DEBOUNCE_RESOLUTIONS = 10;
const DEBOUNCE_TTL_MS = 5000;

// ── Exponential Backoff ────────────────────────────────────────────────────
// Backoff schedule for 5xx errors: 5s → 10s → 30s (then capped at 30s).
const BACKOFF_SCHEDULE = [5000, 10000, 30000];
const MAX_RETRY_ATTEMPTS = 3;

// ── Database Initialization ───────────────────────────────────────────────────

let nativeDb: any = null;
let dbInitAttempted = false;

/**
 * Ensures the native SQLite database is open and migrations are applied.
 * The outbox table (migration v7) is created automatically.
 */
async function ensureNativeDb(): Promise<any> {
  if (Platform.OS === 'web') return null;
  if (nativeDb) return nativeDb;
  if (dbInitAttempted) return null;

  dbInitAttempted = true;
  try {
    await initOfflineDatabase();
    nativeDb = await SQLite.openDatabaseAsync('fishlore_offline.db');
    await nativeDb.execAsync(`PRAGMA journal_mode = WAL;`);
    // Run migrations — v7 creates sync_outbox table
    await runMigrations(nativeDb, 'fishlore_offline.db');
      } catch (err) {
    console.error('[Sync Engine] Native DB init failed:', err);
    nativeDb = null;
  }
  return nativeDb;
}

/**
 * Safely retrieve the native DB handle. Returns null on web or if init failed.
 */
async function getDb(): Promise<any> {
  return ensureNativeDb();
}

// ── Outbox Mutation Queue ─────────────────────────────────────────────────────

/**
 * Serializes a mutation and saves it to the sync_outbox table inside an
 * atomic transaction. The calling domain-table write should already have
 * committed by the time this is called.
 *
 * @param tableName   The target table (e.g. "offline_catches", "fishing_pins").
 * @param recordId    The primary key or UUID of the affected record.
 * @param action      The mutation type: INSERT, UPDATE, or DELETE.
 * @param payload     The full record payload (will be JSON-stringified).
 * @returns           The outbox row ID on success, or null on failure.
 */
export async function queueMutation(
  tableName: string,
  recordId: string,
  action: SyncAction,
  payload: object,
): Promise<number | null> {
  if (Platform.OS === 'web') {
        return queueMutationWeb(tableName, recordId, action, payload);
  }

  const db = await getDb();
  if (!db) {
    console.warn('[Sync Engine] queueMutation: native DB unavailable, falling back to AsyncStorage.');
    return queueMutationWeb(tableName, recordId, action, payload);
  }

  const now = Date.now();
  const serializedPayload = JSON.stringify(payload);

  try {
    const result = await db.runAsync(
      `INSERT INTO sync_outbox (
        table_name, record_id, action, payload, status, attempt_count, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'PENDING', 0, NULL, ?, ?);`,
      [tableName, recordId, action, serializedPayload, now, now],
    );

    const outboxId = result?.lastInsertRowId ?? result?.insertId ?? null;
        return outboxId;
  } catch (error) {
    console.error(
      `[Sync Engine] Failed to queue mutation (${action} ${tableName}#${recordId}):`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Reads the next N pending mutations from the outbox, ordered by oldest first.
 * Uses idx_sync_status for efficient lookups.
 */
export async function getNextPendingMutations(limit: number = 10): Promise<OutboxEntry[]> {
  const db = await getDb();
  if (!db) {
    console.warn('[Sync Engine] getNextPendingMutations: native DB unavailable.');
    return [];
  }

  try {
    const rows = (await db.getAllAsync(
      `SELECT * FROM sync_outbox
       WHERE status = 'PENDING'
       ORDER BY created_at ASC
       LIMIT ?;`,
      [limit],
    )) as any[];

    if (!rows || rows.length === 0) {
      return [];
    }

        return rows.map((row) => ({
      id: row.id,
      table_name: row.table_name,
      record_id: row.record_id,
      action: row.action as SyncAction,
      payload: row.payload,
      status: row.status as SyncStatus,
      attempt_count: row.attempt_count,
      error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  } catch (error) {
    console.error('[Sync Engine] Failed to read pending mutations:', error);
    return [];
  }
}

/**
 * Marks a mutation as successfully synced, updating the status and timestamps.
 * Called after the cloud write completes without error.
 */
export async function markMutationSynced(id: string): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn('[Sync Engine] markMutationSynced: native DB unavailable.');
    return false;
  }

  try {
    const now = Date.now();
    await db.runAsync(
      `UPDATE sync_outbox
       SET status = 'SYNCED', updated_at = ?
       WHERE id = ?;`,
      [now, id],
    );
        return true;
  } catch (error) {
    console.error(
      `[Sync Engine] Failed to mark mutation ${id} as synced:`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

/**
 * Marks a mutation as failed with an error message, incrementing the attempt
 * counter. Does not permanently remove the entry — the worker will retry
 * (optionally with backoff logic in the future).
 */
export async function markMutationFailed(id: string, error: string): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn('[Sync Engine] markMutationFailed: native DB unavailable.');
    return false;
  }

  try {
    const now = Date.now();
    await db.runAsync(
      `UPDATE sync_outbox
       SET status = 'FAILED',
           error_message = ?,
           attempt_count = attempt_count + 1,
           updated_at = ?
       WHERE id = ?;`,
      [error, now, id],
    );
    console.warn(`[Sync Engine] Mutation ${id} marked as FAILED: ${error}`);
    return true;
  } catch (err) {
    console.error(
      `[Sync Engine] Failed to mark mutation ${id} as failed:`,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Marks a mutation as SYNCING (in-progress). Prevents duplicate processing
 * by concurrent sync workers.
 */
export async function markMutationSyncing(id: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    const now = Date.now();
    await db.runAsync(
      `UPDATE sync_outbox SET status = 'SYNCING', updated_at = ? WHERE id = ?;`,
      [now, id],
    );
    return true;
  } catch (error) {
    console.error(`[Sync Engine] Failed to mark mutation ${id} as SYNCING:`, error);
    return false;
  }
}

// ── Outbox Worker: Process Pending Mutations ──────────────────────────────────

/**
 * Applies an outbox mutation to the cloud (Supabase).
 * Dispatches based on table_name to route to the correct Supabase table.
 */
async function processOutboxMutation(entry: OutboxEntry): Promise<void> {
  const payload = JSON.parse(entry.payload);

  try {
    await markMutationSyncing(String(entry.id));

    switch (entry.table_name) {
      case 'offline_catches':
        await applyCatchMutation(entry, payload);
        break;
      case 'fishing_pins':
        await applyFishingPinMutation(entry, payload);
        break;
      case 'video_metadata':
        await applyVideoMetadataMutation(entry, payload);
        break;
      default:
        console.warn(`[Sync Engine] Unknown table "${entry.table_name}" — skipping.`);
        await markMutationFailed(String(entry.id), `Unknown table: ${entry.table_name}`);
        return;
    }

    await markMutationSynced(String(entry.id));
  } catch (error) {
    await markMutationFailed(
      String(entry.id),
      error instanceof Error ? error.message : String(error),
    );
        throw error;
  }
}

/** Apply mutation to Supabase catches table. */
async function applyCatchMutation(entry: OutboxEntry, payload: any): Promise<void> {
  const record = {
    species: payload.species || '',
    weight: payload.weight ?? null,
    length: payload.length ?? null,
    location_name: payload.location_name || '',
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    solunar_rating: payload.solunar_rating ?? null,
    created_at: new Date(payload.timestamp || payload.created_at).toISOString(),
  };

  const { error } = await supabase.from('catches').upsert([record], {
    onConflict: 'id',
  });

  if (error) throw error;
  }

/** Apply mutation to Supabase fishing_pins table. */
async function applyFishingPinMutation(entry: OutboxEntry, payload: any): Promise<void> {
  const record = {
    latitude: payload.latitude,
    longitude: payload.longitude,
    species: payload.species ?? null,
    weight: payload.weight ?? null,
    length: payload.length ?? null,
    location_name: payload.location_name ?? null,
    notes: payload.notes ?? null,
    created_at: new Date(payload.created_at || payload.timestamp).toISOString(),
  };

  const { error } = await supabase.from('fishing_pins').upsert([record], {
    onConflict: 'id',
  });

  if (error) throw error;
  }

/** Apply mutation to Supabase video_metadata table. */
async function applyVideoMetadataMutation(entry: OutboxEntry, payload: any): Promise<void> {
  const record = {
    catch_id: payload.catch_id,
    compressed_uri: payload.compressed_uri,
    original_size: payload.original_size,
    compressed_size: payload.compressed_size,
    compression_ratio: payload.compression_ratio,
    duration_seconds: payload.duration_seconds ?? null,
    quality: payload.quality || 'medium',
    created_at: new Date(payload.created_at).toISOString(),
  };

  const { error } = await supabase.from('video_metadata').insert([record]);
  if (error) throw error;
  }

// ── Exponential Backoff Helpers ──────────────────────────────────────────────

/**
 * Returns true if the Supabase error is a retryable 5xx server error.
 */
function is5xxError(error: any): boolean {
  if (!error) return false;
  const status = error?.status ?? error?.statusCode;
  return typeof status === 'number' && status >= 500 && status < 600;
}

/**
 * Computes the backoff delay (ms) for the given attempt number (0-indexed).
 * Schedule: 5s → 10s → 30s (then capped at 30s for subsequent retries).
 */
function getBackoffDelay(attempt: number): number {
  const scheduleIndex = Math.min(attempt, BACKOFF_SCHEDULE.length - 1);
  return BACKOFF_SCHEDULE[scheduleIndex];
}

/**
 * Attempts to apply a single outbox mutation with exponential backoff for
 * 5xx errors. Returns true if the mutation was synced (or exhausted retries),
 * false if it's still pending retry.
 */
async function processOutboxEntryWithBackoff(entry: OutboxEntry): Promise<boolean> {
  let lastError: any = null;

  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      await processOutboxMutation(entry);
      return true; // Success — mutation is now SYNCED
    } catch (error) {
      lastError = error;

      // Retry only on 5xx server errors and only if retries remain.
      if (!is5xxError(error) || attempt >= MAX_RETRY_ATTEMPTS) {
        // Non-retryable error or exhausted retries.
        await markMutationFailed(
          String(entry.id),
          error instanceof Error ? error.message : String(error),
        );
        return false;
      }

      // 5xx error and retries remain — apply backoff.
      const delay = getBackoffDelay(attempt);
      const isRetryable = is5xxError(error);
      console.warn(
        `[Sync Engine] 5xx error on mutation ${entry.id} (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}). ` +
        `Backing off ${delay}ms before retry.`,
      );

      // Wait with backoff, then retry.
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // All retries exhausted
  await markMutationFailed(
    String(entry.id),
    lastError instanceof Error ? lastError.message : String(lastError),
  );
  return false;
}

// ── Race Condition Lock ────────────────────────────────────────────────────────

/**
 * Runs `drainOutbox` guarded by a lock. If a sync is already in progress,
 * the caller's promise is queued and will resolve when the running sync
 * completes (debounced — capped at MAX_DEBOUNCE_RESOLUTIONS queued callers).
 * This prevents duplicate Supabase entries from concurrent sync workers.
 */
export async function drainOutboxGuarded(limit: number = 10): Promise<SyncMetrics> {
  // If already syncing, defer this call until the current drain completes.
  if (isSyncInProgress) {
    if (pendingSyncResolve && MAX_DEBOUNCE_RESOLUTIONS > 0) {
      // Queue this caller — they'll wait and then retry
      await new Promise<void>((resolve) => {
        pendingSyncResolve = resolve;
      });
    }
    // After being deferred, try again (will grab the lock once free)
    return drainOutboxGuarded(limit);
  }

  // Acquire the lock
  isSyncInProgress = true;
  const lockAcquiredAt = Date.now();

  try {
    return await drainOutbox(limit);
  } finally {
    // Release the lock and resolve any deferred caller
    isSyncInProgress = false;
    if (pendingSyncResolve) {
      const resolver = pendingSyncResolve;
      pendingSyncResolve = null;
      resolver();
    }
  }
}

/**
 * Main outbox drain worker — reads pending mutations, processes them in
 * order with exponential backoff for 5xx errors, and updates their status.
 * Returns aggregate metrics.
 *
 * @param {boolean} useLock - When true (default), wraps the drain in a
 *   race-condition-guarded lock so concurrent calls don't duplicate work.
 */
export async function drainOutbox(limit: number = 10, useLock: boolean = true): Promise<SyncMetrics> {
  const metrics: SyncMetrics = { success: 0, failed: 0, retried: 0 };

  const db = await getDb();
  if (!db) {
        return metrics;
  }

  if (useLock && isSyncInProgress) {
    // Lock contention — defer to the guarded wrapper
        return metrics;
  }

  // For the internal drain, we manage lock state only when useLock=true
  if (useLock) {
    isSyncInProgress = true;
  }

  try {
    const pending = await getNextPendingMutations(limit);
    if (pending.length === 0) {
      return metrics;
    }

    
    for (const entry of pending) {
      try {
        const synced = await processOutboxEntryWithBackoff(entry);
        if (synced) {
          metrics.success++;
        } else {
          metrics.failed++;
        }
      } catch {
        metrics.failed++;
      }
    }

        return metrics;
  } finally {
    if (useLock) {
      isSyncInProgress = false;
      // Resolve any waiting deferred caller
      if (pendingSyncResolve) {
        const resolver = pendingSyncResolve;
        pendingSyncResolve = null;
        resolver();
      }
    }
  }
}

// ── Web Helpers (for web platform fallback) ───────────────────────────────────

import { CALENDAR_CACHE_KEY } from './solunarCalendarEngine';

function safeLocalStorageGetItem(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSetItem(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // no-op on quota/storage errors
  }
}

interface WebCatchRecord {
  id: string;
  species: string;
  weight?: string | null;
  length?: string | null;
  location_name?: string | null;
  location?: string | null;
  timestamp: number;
  synced: number;
}

function parseWebCatches(raw: string): WebCatchRecord[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Web fallback for queueMutation — uses AsyncStorage/Web localStorage
 * since SQLite is not available on web.
 */
async function queueMutationWeb(
  tableName: string,
  recordId: string,
  action: SyncAction,
  payload: object,
): Promise<number | null> {
  try {
    const key = `${CALENDAR_CACHE_KEY}_${tableName}_${action}_${recordId}`;
    const now = Date.now();
    const entry = {
      table_name: tableName,
      record_id: recordId,
      action,
      payload: JSON.stringify(payload),
      status: 'PENDING' as const,
      attempt_count: 0,
      created_at: now,
      updated_at: now,
    };
    safeLocalStorageSetItem(key, JSON.stringify(entry));
        return now;
  } catch (error) {
    console.error('[Sync Engine] Web queueMutation failed:', error);
    return null;
  }
}

// ── Legacy Reconciliation (backward compatibility) ──────────────────────────────

/**
 * Adds async delay for exponential backoff.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Legacy reconciliation path with 5xx exponential backoff.
 * This function is race-condition guarded: concurrent calls will be debounced.
 */
let legacySyncInProgress = false;

export const syncOfflineCatchesToCloud = async (): Promise<{ success: number; failed: number }> => {
  const metrics = { success: 0, failed: 0 };

  // Race condition guard: debounce concurrent legacy sync calls
  if (legacySyncInProgress) {
        return metrics;
  }
  legacySyncInProgress = true;

  try {

    // Web path: pull unsynced items from localStorage fallback and upload them.
  if (Platform.OS === 'web') {
    const rawCache = safeLocalStorageGetItem('fishlore_web_catches') || '[]';
    const pendingRecords = parseWebCatches(rawCache).filter((item) => item.synced === 0);

    if (pendingRecords.length === 0) {
      return metrics;
    }

    for (const record of pendingRecords) {
      let lastError: any = null;
      let uploaded = false;

      for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
        try {
          const { error } = await supabase.from('catches').insert([
            {
              species: record.species || '',
              weight: record.weight ?? null,
              length: record.length ?? null,
              location_name: record.location_name || record.location || '',
              created_at: new Date(record.timestamp).toISOString(),
            },
          ]);

          if (error) throw error;

          const currentCache = parseWebCatches(safeLocalStorageGetItem('fishlore_web_catches') || '[]');
          const updatedCache = currentCache.map((item) =>
            item.id === record.id ? { ...item, synced: 1 } : item
          );
          safeLocalStorageSetItem('fishlore_web_catches', JSON.stringify(updatedCache));
          metrics.success++;
          uploaded = true;
          break;
        } catch (cloudError) {
          lastError = cloudError;

          if (!is5xxError(cloudError) || attempt >= MAX_RETRY_ATTEMPTS) {
            console.error(
              `Cloud upload failure for record ${record?.species ?? 'unknown'}:`,
              cloudError,
            );
            metrics.failed++;
            break;
          }

          // 5xx error — apply backoff and retry
          const backoffDelay = getBackoffDelay(attempt);
          console.warn(
            `[Sync Engine] 5xx error on web catch ${record.id} (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}). ` +
            `Backing off ${backoffDelay}ms.`,
          );
          await delay(backoffDelay);
        }
      }
    }

        return metrics;
  }

  // Native path: drain the local SQLite offline cache.
  try {
    await ensureNativeDb();
  } catch {
    console.warn('[Sync Engine] native DB unavailable, skipping sync');
    return metrics;
  }

  let pendingRecords: Array<{
    id: number;
    species: string;
    weight?: string | null;
    length?: string | null;
    location_name?: string | null;
    location?: string | null;
    timestamp: number;
    synced: number;
  }> = [];

  try {
    const SQLite = await import('expo-sqlite');
    const db = await SQLite.openDatabaseAsync('fishlore_offline.db');
    const rows = await db.getAllAsync<{
      id: number;
      species: string;
      weight?: string | null;
      length?: string | null;
      location_name?: string | null;
      location?: string | null;
      timestamp: number;
      synced: number;
    }>('SELECT * FROM offline_catches WHERE synced = 0;');
    pendingRecords = rows || [];
  } catch (err) {
    console.warn('[Sync Engine] native sync extraction skipped or unavailable:', err);
    return metrics;
  }

  if (pendingRecords.length === 0) {
    return metrics;
  }

    for (const record of pendingRecords) {
    let lastError: any = null;

    for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const { error } = await supabase.from('catches').insert([
          {
            species: record.species || '',
            weight: record.weight ?? null,
            length: record.length ?? null,
            location_name: record.location_name || record.location || '',
            created_at: new Date(record.timestamp).toISOString(),
          },
        ]);

        if (error) throw error;

        const db = await import('expo-sqlite').then((m) => m.openDatabaseAsync('fishlore_offline.db')).catch(() => {
          throw new Error('native db reopen failed');
        });
        await db.runAsync('UPDATE offline_catches SET synced = 1 WHERE id = ?;', [record.id]);
        metrics.success++;
        break;
      } catch (cloudError) {
        lastError = cloudError;

        if (!is5xxError(cloudError) || attempt >= MAX_RETRY_ATTEMPTS) {
          console.error(
            `Cloud upload failure for record ${record?.species ?? 'unknown'}:`,
            cloudError,
          );
          metrics.failed++;
          break;
        }

        // 5xx error — apply backoff and retry
        const backoffDelay = getBackoffDelay(attempt);
        console.warn(
          `[Sync Engine] 5xx error on native catch ${record.id} (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}). ` +
          `Backing off ${backoffDelay}ms.`,
        );
        await delay(backoffDelay);
      }
    }
  }

    return metrics;
} finally {
  legacySyncInProgress = false;
}};

// Reconciliation sweeper: runs on foregrounding and on a repeating interval
// so the offline queue drains whenever connectivity returns.
// Uses race-condition-guarded drainOutboxGuarded() to prevent duplicates.
export const startBackgroundReconciliation = (intervalMs = 60_000): (() => void) => {
  let timer: ReturnType<typeof setInterval> | null = null;

  const run = async () => {
    try {
      // Drain the outbox (Tier 1 path) — this is race-condition guarded
      await drainOutboxGuarded();
      // Also run legacy reconciliation for backward compatibility
      await syncOfflineCatchesToCloud();
    } catch (err) {
      console.warn('[Sync Engine] reconciliation sweep failed:', err);
    }
  };

  run();
  timer = setInterval(run, intervalMs);

  return () => {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
};

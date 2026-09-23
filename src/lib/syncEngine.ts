import { Platform } from 'react-native';
import { supabase } from './supabase';
import { initOfflineDatabase } from './offlineDatabase';

// Deferred DB initializer so the sync worker doesn't block root mount.
let nativeDb: Awaited<ReturnType<typeof initOfflineDatabase>> | null = null;

async function ensureNativeDb(): Promise<void> {
  if (nativeDb !== null) return;
  try {
    await initOfflineDatabase();
  } catch (err) {
    console.warn('[syncEngine] offline DB init failed:', err);
  }
}

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

function parseWebCatches(raw: string): Array<{
  id: string;
  species: string;
  weight?: string | null;
  length?: string | null;
  location_name?: string | null;
  location?: string | null;
  timestamp: number;
  synced: number;
}> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const syncOfflineCatchesToCloud = async (): Promise<{ success: number; failed: number }> => {
  const metrics = { success: 0, failed: 0 };

  // Web path: pull unsynced items from localStorage fallback and upload them.
  if (Platform.OS === 'web') {
    const rawCache = safeLocalStorageGetItem('fishlore_web_catches') || '[]';
    const pendingRecords = parseWebCatches(rawCache).filter((item) => item.synced === 0);

    if (pendingRecords.length === 0) {
      return metrics;
    }

    for (const record of pendingRecords) {
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
      } catch (cloudError) {
        console.error(`Cloud upload failure for record ${record?.species ?? 'unknown'}:`, cloudError);
        metrics.failed++;
      }
    }

    console.log(`[syncEngine] Web sync run finished. Dispatched: ${metrics.success}, Suspended: ${metrics.failed}`);
    return metrics;
  }

  // Native path: drain the local SQLite offline cache.
  try {
    await ensureNativeDb();
  } catch {
    console.warn('[syncEngine] native DB unavailable, skipping sync');
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
    console.warn('[syncEngine] native sync extraction skipped or unavailable:', err);
    return metrics;
  }

  if (pendingRecords.length === 0) {
    return metrics;
  }

  for (const record of pendingRecords) {
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
    } catch (cloudError) {
      console.error(`Cloud upload failure for record ${record?.species ?? 'unknown'}:`, cloudError);
      metrics.failed++;
    }
  }

  console.log(`[syncEngine] Native sync run finished. Dispatched: ${metrics.success}, Suspended: ${metrics.failed}`);
  return metrics;
};

// Reconciliation sweeper: runs on foregrounding and on a repeating interval
// so the offline queue drains whenever connectivity returns.
export const startBackgroundReconciliation = (intervalMs = 60_000): () => void => {
  let timer: ReturnType<typeof setInterval> | null = null;

  const run = async () => {
    try {
      await syncOfflineCatchesToCloud();
    } catch (err) {
      console.warn('[syncEngine] reconciliation sweep failed:', err);
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

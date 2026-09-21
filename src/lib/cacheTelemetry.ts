import { Directory, File, Paths } from 'expo-file-system';
import { loadQueue } from './offlineCatchQueue';
import { getBackgroundSyncStatus } from './backgroundSync';

// Cache Telemetry & Purge Engine
// Crawls the local map tile cache tree to report exact on-disk byte counts
// and file counts, and provides a safe purge path that reclaims space
// without touching the offline catch queue.

const TILES_DIR_NAME = 'tiles';
const PENDING_PHOTO_DIR_NAME = 'pending-catch-photos';
const TEMP_SUBDIR_NAMES = ['downloads', 'tmp', 'image_picker'];
const KB_THRESHOLD = 1024 * 1024;

async function crawlDirectory(dir: Directory): Promise<{ bytes: number; files: number }> {
  const r = { bytes: 0, files: 0 };
  try {
    if (!dir.exists) return r;
    for (const e of dir.list()) {
      if (e instanceof File) { if (e.exists) { try { const b = await e.bytes(); r.bytes += b.length; } catch {} r.files++; } }
      else if (e instanceof Directory) { if (e.exists) { const s = await crawlDirectory(e); r.bytes += s.bytes; r.files += s.files; } }
    }
  } catch {}
  return r;
}

function formatBytes(t: number): string {
  if (t < KB_THRESHOLD) { const k = t / 1024; return k < 100 ? k.toFixed(1) + ' KB' : Math.round(k) + ' KB'; }
  const m = t / (1024 * 1024);
  return m < 100 ? m.toFixed(2) + ' MB' : Math.round(m) + ' MB';
}

export interface CacheTelemetry {
  totalBytes: number; formattedVolume: string; fileCount: number;
  tileCacheBytes: number; tileCacheFileCount: number;
  queueDepth: number; backgroundSyncStatus: string; pendingPhotoCount: number;
}

export async function getCacheTelemetryDetails(): Promise<CacheTelemetry> {
  const td = new Directory(Paths.document, TILES_DIR_NAME);
  const [ts, temp, q, pd] = await Promise.all([
    crawlDirectory(td), crawlTempDirectories(), loadQueue(),
    crawlDirectory(new Directory(Paths.document, PENDING_PHOTO_DIR_NAME))
  ]);
  return {
    totalBytes: ts.bytes + temp.bytes + pd.bytes,
    formattedVolume: formatBytes(ts.bytes + temp.bytes + pd.bytes),
    fileCount: ts.files + temp.files + pd.files,
    tileCacheBytes: ts.bytes, tileCacheFileCount: ts.files,
    queueDepth: q.length, backgroundSyncStatus: await getBackgroundSyncStatus(),
    pendingPhotoCount: pd.files,
  };
}

async function crawlTempDirectories(): Promise<{ bytes: number; files: number }> {
  const r = { bytes: 0, files: 0 };
  for (const s of TEMP_SUBDIR_NAMES) {
    const d = new Directory(Paths.document, s);
    if (!d.exists) continue;
    const st = await crawlDirectory(d);
    r.bytes += st.bytes; r.files += st.files;
  }
  return r;
}

export interface PurgeResult {
  success: boolean; message: string;
  reclaimedBytes: number; tileFilesDeleted: number;
}

export async function purgeMapTileCache(): Promise<PurgeResult> {
  const c = await new Promise<number>((res) => {
    require('expo-alert').Alert.alert(
      'Clear Map Cache',
      'This will delete all downloaded offline map tiles.\nYour offline catch queue and queued photos will NOT be affected.\n\nContinue?',
      [{ text: 'Cancel', style: 'cancel', onPress: () => res(0) },
       { text: 'Clear', style: 'destructive', onPress: () => res(1) }]
    );
  });
  if (c !== 1) return { success: false, message: 'Cache clear cancelled by user.', reclaimedBytes: 0, tileFilesDeleted: 0 };
  const td2 = new Directory(Paths.document, TILES_DIR_NAME);
  let rb = 0, td3 = 0;
  try {
    if (!td2.exists) return { success: true, message: 'Map tile cache was already empty.', reclaimedBytes: 0, tileFilesDeleted: 0 };
    const ps = await crawlDirectory(td2);
    rb = ps.bytes; td3 = ps.files;
    await deleteDirectoryRecursive(td2);
    return { success: true, message: `Cleared ${td3} tile file(s) — reclaimed ${formatBytes(rb)}.`, reclaimedBytes: rb, tileFilesDeleted: td3 };
  } catch (e) {
    console.error('[cacheTelemetry] Failed to purge map tile cache:', e);
    return { success: false, message: 'Failed to clear map tile cache. Please try again.', reclaimedBytes: rb, tileFilesDeleted: td3 };
  }
}

async function deleteDirectoryRecursive(dir: Directory): Promise<void> {
  try {
    if (!dir.exists) return;
    for (const e of dir.list()) {
      if (e instanceof File) { if (e.exists) await e.delete(); }
      else if (e instanceof Directory) { if (e.exists) await deleteDirectoryRecursive(e); }
    }
    if (dir.exists) await dir.delete();
  } catch (e) { console.error('[cacheTelemetry] Error deleting directory tree:', e); throw e; }
}
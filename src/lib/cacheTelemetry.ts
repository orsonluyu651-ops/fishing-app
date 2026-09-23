/**
 * Cache Telemetry — WEB stub.
 *
 * Platform-extension sibling of `cacheTelemetry.native.ts`. Metro resolves
 * the `.native` file for iOS/Android (full expo-file-system crawl) and this
 * file for web, where `expo-file-system` has no implementation
 * (`Directory.validatePath is not a function`). Web has no on-disk tile
 * cache, so telemetry reports a zeroed in-memory state and purge is a no-op.
 */

export interface CacheTelemetry {
  totalBytes: number; formattedVolume: string; fileCount: number;
  tileCacheBytes: number; tileCacheFileCount: number;
  queueDepth: number; backgroundSyncStatus: string; pendingPhotoCount: number;
}

export interface PurgeResult {
  success: boolean; message: string;
  reclaimedBytes: number; tileFilesDeleted: number;
}

export async function getCacheTelemetryDetails(): Promise<CacheTelemetry> {
  return {
    totalBytes: 0,
    formattedVolume: '0.0 KB',
    fileCount: 0,
    tileCacheBytes: 0,
    tileCacheFileCount: 0,
    queueDepth: 0,
    backgroundSyncStatus: 'unavailable on web',
    pendingPhotoCount: 0,
  };
}

export async function purgeMapTileCache(): Promise<PurgeResult> {
  return {
    success: true,
    message: 'Map tile cache is not stored on disk in the web preview — nothing to clear.',
    reclaimedBytes: 0,
    tileFilesDeleted: 0,
  };
}
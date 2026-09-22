import * as FileSystem from 'expo-file-system';

export interface CacheResolutionReport {
  localUri: string;
  isPreCached: boolean;
  success: boolean;
}

const _fs = FileSystem as unknown as { cacheDirectory: string };
const FEED_IMAGE_CACHE_DIR = `${_fs.cacheDirectory}feed_media_cache/`;

/**
 * Asserts the existence of the background asset media cache subdirectory layout.
 */
async function ensureCacheDirectoryExists(): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(FEED_IMAGE_CACHE_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(FEED_IMAGE_CACHE_DIR, { intermediates: true });
    }
  } catch (err) {
    console.error('Cache folder structure validation error:', err);
  }
}

/**
 * Validates, fetches, and maps a remote network asset straight to local cache storage lines.
 */
export async function cacheRemoteFeedImage(remoteUrl: string): Promise<CacheResolutionReport> {
  if (!remoteUrl || !remoteUrl.startsWith('http')) {
    return { localUri: remoteUrl ?? '', isPreCached: false, success: false };
  }

  try {
    await ensureCacheDirectoryExists();

    // Compile hash filename to prevent cache identifier collisions
    const urlHash = Math.abs(
      remoteUrl.split('').reduce((s, c) => Math.imul(31, s) + c.charCodeAt(0) | 0, 0)
    ).toString(36);
    const fileExtension = remoteUrl.split('.').pop()?.split('?')[0] ?? 'jpg';
    const localTargetUri = `${FEED_IMAGE_CACHE_DIR}${urlHash}.${fileExtension}`;

    const fileInfo = await FileSystem.getInfoAsync(localTargetUri);
    if (fileInfo.exists) {
      return { localUri: localTargetUri, isPreCached: true, success: true };
    }

    const downloadResult = await FileSystem.downloadAsync(remoteUrl, localTargetUri);

    return {
      localUri: downloadResult.uri,
      isPreCached: false,
      success: downloadResult.status === 200,
    };
  } catch (err) {
    console.error(`Media pre-fetching network failure for URL ${remoteUrl}:`, err);
    return { localUri: remoteUrl, isPreCached: false, success: false };
  }
}

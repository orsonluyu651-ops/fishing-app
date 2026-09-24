import { Platform } from 'react-native';

/** Lazily resolves react-native-fs only on native; returns null on web. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getRNFS = (): any | null => {
  if (Platform.OS === 'web') return null;
  try {
    return require('react-native-fs');
  } catch (e) {
    console.warn('[Media Pipeline] react-native-fs unavailable:', e);
    return null;
  }
};

/** react-native-video-helper is native-only; lazy-load on demand. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getVideoHelper = (): any | null => {
  if (Platform.OS === 'web') return null;
  try {
    return require('react-native-video-helper');
  } catch (e) {
    console.warn('[Media Pipeline] react-native-video-helper unavailable:', e);
    return null;
  }
};

/**
 * Quality presets that map to react-native-video-helper's `quality` option.
 * - `high`   → preserves more detail (slowest encode)
 * - `medium`  → balanced speed/detail
 * - `low`     → fastest encode, smallest output
 */
export type VideoQuality = 'high' | 'medium' | 'low';

export interface CompressionOptions {
  quality?: VideoQuality;
  startTime?: number; // seconds from 0
  endTime?: number; // seconds from 0
}

/**
 * Result of a successful compression run.
 */
export interface CompressedVideoResult {
  uri: string;
  sizeInBytes: number;
  duration: number; // seconds
  compressionRatio: string; // e.g. "75.2%"
}

/** 50 MB in bytes — threshold for the fast-path skip. */
const SIZE_THRESHOLD_50MB = 50 * 1024 * 1024;

/**
 * Asynchronously compresses (or copies) a source video URI into the app's
 * sandboxed caches directory. Returns a fully-typed result describing the
 * compressed output.
 *
 * SAFETY GUARD: When the source is already under 50 MB **and** the caller
 * requests `quality: 'high'`, the file is simply copied to the destination —
 * no hardware encoder cycles are wasted on an already-optimized asset.
 *
 * Output is always written to `RNFS.CachesDirectoryPath` to guarantee
 * sandboxed stability across iOS and Android.
 */
export async function compressFeedVideo(
  sourceUri: string,
  options: CompressionOptions = {},
): Promise<CompressedVideoResult> {
  const { quality = 'medium', startTime = 0, endTime } = options;

  // ── Web fallback: native FS + encoder unavailable, return a mock passthrough ─
  if (Platform.OS === 'web') {
    console.log('[Media Pipeline] Web platform — skipping native video compression.');
    return {
      uri: sourceUri,
      sizeInBytes: 0,
      duration: endTime && startTime ? endTime - startTime : 0,
      compressionRatio: '0.0%',
    };
  }

  const RNFS = getRNFS();
  if (!RNFS) {
    throw new Error(
      'compressFeedVideo: react-native-fs is not available on this platform',
    );
  }

      // ── Stat the source file ─────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sourceStat: any;
  try {
    sourceStat = await RNFS.stat(sourceUri);
  } catch (statError) {
    console.error('[Media Pipeline] Unable to stat source video:', statError);
    throw new Error(
      `compressFeedVideo: source file not found — ${sourceUri}`,
    );
  }

  if (!sourceStat.isFile()) {
    throw new Error(
      `compressFeedVideo: source is not a regular file — ${sourceUri}`,
    );
  }

  console.log(
    `[Media Pipeline] Source video: ${sourceUri} — ${sourceStat.size} bytes`,
  );

  // ── Fast-path: skip compression if small + high quality ──────────────────
  if (sourceStat.size < SIZE_THRESHOLD_50MB && quality === 'high') {
    console.log(
      '[Media Pipeline] Skipping compression (under 50 MB + high quality fast-path)',
    );
    const destPath = `${RNFS.CachesDirectoryPath}/${generateTempName(
      sourceUri,
      'copied',
    )}`;

    try {
      await RNFS.copyFile(sourceUri, destPath);
      const destStat = await RNFS.stat(destPath);
      return {
        uri: destPath,
        sizeInBytes: destStat.size,
        duration: 0,
        compressionRatio: calculateCompressionRatio(
          sourceStat.size,
          destStat.size,
        ),
      };
    } catch (copyError) {
      console.error('[Media Pipeline] Copy fast-path failed:', copyError);
      throw copyError;
    }
  }

    // ── Real compression via react-native-video-helper ────────────────────────
  const outputDir = `${RNFS.CachesDirectoryPath}/compressed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    await RNFS.mkdir(outputDir, {
      NSURLIsExcludedFromBackupKey: true, // iOS: keep out of iCloud backups
    });

    console.log(
      `[Media Pipeline] Compressing video to: ${outputDir} (quality: ${quality})`,
    );

        const VideoHelper = getVideoHelper();
    if (!VideoHelper) {
      throw new Error(
        'compressFeedVideo: react-native-video-helper is not available on this platform',
      );
    }

    const compressedUri: string = await VideoHelper.compress(sourceUri, {
      startTime,
      endTime,
      quality,
      defaultOrientation: 0,
    });

    // Move the helper's output into our deterministic sandbox directory.
    const filename = compressedUri.split('/').pop() ?? 'compressed.mp4';
    const destFile = `${outputDir}/${filename}`;

    if (compressedUri !== destFile) {
            await RNFS.copyFile(compressedUri, destFile).catch((copyErr: any) => {
        console.error('[Media Pipeline] Copy to cache failed:', copyErr);
        throw copyErr;
      });
      // Clean up the temporary output the helper created in its own cache area.
      await RNFS.unlink(compressedUri).catch(() => {});
    }

    const destStat = await RNFS.stat(destFile);

    // The VideoHelper API doesn't expose duration metadata on its output.
    // When no startTime/endTime trimming is specified we default to 0.
    // A production implementation would use a native module such as
    // react-native-video's onLoadMetadata to read the actual duration.
    const duration = endTime && startTime ? endTime - startTime : 0;

    return {
      uri: destFile,
      sizeInBytes: destStat.size,
      duration,
      compressionRatio: calculateCompressionRatio(sourceStat.size, destStat.size),
    };
  } catch (error: unknown) {
    console.error('[Media Pipeline] Compression failed:', error);
    throw new Error(
      `compressFeedVideo: compression pipeline error — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Generate a unique-ish filename for a copied file in the caches directory.
 */
function generateTempName(sourceUri: string, suffix: string): string {
  const ext = sourceUri.split('.').pop()?.toLowerCase() ?? 'mp4';
  const base = sourceUri.split('/').pop()?.split('.')[0] ?? 'video';
  return `${base}_${suffix}_${Date.now()}.${ext}`;
}

/**
 * Returns a human-readable percentage string describing how much the file
 * shrank (e.g. "75.2%"). Negative values mean the output is larger.
 */
function calculateCompressionRatio(
  originalBytes: number,
  compressedBytes: number,
): string {
  if (originalBytes <= 0) return 'N/A';
  const saved = ((originalBytes - compressedBytes) / originalBytes) * 100;
  return `${saved.toFixed(1)}%`;
}

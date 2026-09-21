import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Client-side catch photo pre-processing, applied before anything leaves the
 * device — the direct bucket upload and the offline queue both persist from the
 * URI this module produces, so every downstream path inherits the same limits.
 *
 * Two hard requirements:
 *
 * 1. Storage bounds — camera originals on modern phones are 12–48 MP. Every
 *    catch photo is scaled so its longest edge fits inside
 *    MAX_CATCH_IMAGE_DIMENSION and re-encoded at CATCH_IMAGE_QUALITY, which
 *    shrinks a multi-megabyte bucket object to tens of kilobytes without any
 *    visible difference at feed card size.
 * 2. Privacy — the feed is public. A photo straight from the camera roll still
 *    carries EXIF metadata, including the GPS coordinates of the exact spot it
 *    was taken. Saving a manipulated image re-encodes the pixels into a brand
 *    new file in the app's cache directory, and that fresh JPEG carries no EXIF
 *    payload at all — so the secret-spot coordinates never reach the bucket,
 *    the offline queue's local copy, or anyone who later downloads the object.
 */

/** Longest allowed edge (px) for an uploaded catch photo. */
export const MAX_CATCH_IMAGE_DIMENSION = 1200;

/** JPEG compression baseline (0.0–1.0) for an uploaded catch photo. */
export const CATCH_IMAGE_QUALITY = 0.8;

export interface OptimizedImage {
  /** File URI of the re-encoded image in the app's cache directory. */
  uri: string;
  width: number;
  height: number;
}

/**
 * Fits a width/height pair inside a square bounding box without upscaling.
 *
 * Pure and exported for unit testing: it decides the target dimensions the
 * manipulator pipeline will resize to. Small images pass through untouched —
 * scaling them up would waste bytes and sharpen nothing.
 */
export function fitWithinBounds(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    longest <= maxDimension
  ) {
    return { width, height };
  }
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Bounds and re-encodes a catch photo before upload.
 *
 * Pipeline: render the source once to read its true dimensions, add a resize
 * action only when the image actually exceeds the bounding box, render again,
 * then save as a fresh JPEG at the strict quality baseline. The save always
 * happens — even for already-small images — because re-encoding is what strips
 * the EXIF/GPS metadata.
 *
 * Throws when the source is unreadable (corrupt file, unsupported format). The
 * picker flow treats that as a privacy failure and refuses to attach the photo
 * as-is rather than uploading it with its metadata intact.
 */
export async function optimizeCatchImage(uri: string): Promise<OptimizedImage> {
  const context = ImageManipulator.manipulate(uri);

  const source = await context.renderAsync();
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    throw new Error(`optimizeCatchImage: could not read image dimensions from ${uri}`);
  }

  const target = fitWithinBounds(source.width, source.height, MAX_CATCH_IMAGE_DIMENSION);
  const scaled = target.width !== source.width || target.height !== source.height;
  if (scaled) {
    context.resize({ width: target.width, height: target.height });
  }
  const rendered = scaled ? await context.renderAsync() : source;

  try {
    const saved = await rendered.saveAsync({
      compress: CATCH_IMAGE_QUALITY,
      format: SaveFormat.JPEG,
    });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } finally {
    // Release the native bitmaps — the encoder has written its output to disk,
    // so nothing needs the in-memory renders after this point.
    source.release();
    if (rendered !== source) {
      rendered.release();
    }
  }
}

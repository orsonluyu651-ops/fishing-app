import { Directory, File, Paths } from 'expo-file-system';

// ─────────────────────────────────────────────────────────────
// Map tile cache — local persistence for off-grid navigation.
//
// Tiles live in an isolated directory under the app's documents folder:
//   ${Paths.document.uri}tiles/{z}_{x}_{y}.png
// Filenames are deterministic (Web Mercator z/x/y flattened to one level),
// so a cached tile is found with a pure string lookup — no index, no DB.
//
// Downloads go through expo-file-system's File.downloadFileAsync with a
// descriptive User-Agent (OpenStreetMap tile policy requires one) and are
// throttled: at most 3 parallel transfers, one shared AbortSignal, and every
// per-tile failure is trapped so a dead link never rejects the batch.
// ─────────────────────────────────────────────────────────────

export const TILE_SOURCE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const TILES_DIR_NAME = 'tiles';
const TILE_USER_AGENT = 'Fishlore/1.0 (fishlore-app; offline map tile cache)';
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 17;

export interface Bbox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface DownloadSummary {
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
  truncated: boolean;
  cancelled: boolean;
}

const WEB_MERCATOR_MAX_LAT = 85.05112878;
let tilesDir: Directory | null = null;

function getTilesDir(): Directory {
  if (!tilesDir) {
    const dir = new Directory(Paths.document, TILES_DIR_NAME);
    if (!dir.exists) dir.create();
    tilesDir = dir;
  }
  return tilesDir;
}

/** Base URI of the tile cache, with a trailing slash — safe to concatenate. */
export function getTilesDirUri(): string {
  return getTilesDir().uri;
}

// ── Web Mercator math ──────────────────────────────────────────────
export function lngToTileX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * Math.pow(2, zoom);
}

export function latToTileY(lat: number, zoom: number): number {
  const clamped = Math.min(Math.max(lat, -WEB_MERCATOR_MAX_LAT), WEB_MERCATOR_MAX_LAT);
  const latRad = (clamped * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, zoom);
}

function clampZoom(zoom: number): number {
  return Math.min(Math.max(Math.round(zoom), MIN_ZOOM), MAX_ZOOM);
}

function clampTile(value: number, zoom: number): number {
  const max = Math.pow(2, zoom) - 1;
  return Math.min(Math.max(value, 0), max);
}

/** Deterministic, collision-free filename for one Web Mercator tile. */
export function tileFileName(coord: TileCoord): string {
  const z = clampZoom(coord.z);
  return `${z}_${clampTile(coord.x, z)}_${clampTile(coord.y, z)}.png`;
}

/** Local cache URI for one tile: ${Paths.document.uri}tiles/{z}_{x}_{y}.png */
export function getTileLocalUri(coord: TileCoord): string {
  return `${getTilesDirUri()}${tileFileName(coord)}`;
}

/**
 * The offline UrlTile template. Swapping the UrlTile urlTemplate to this
 * string (when NetInfo reports the device offline) re-points the map's
 * rendering to the local cache with zero component re-wiring.
 */
export function getOfflineTileUrlTemplate(): string {
  return `${getTilesDirUri()}{z}_{x}_{y}.png`;
}

export function isTileCached(coord: TileCoord): boolean {
  try {
    return new File(getTilesDir(), tileFileName(coord)).exists;
  } catch {
    return false;
  }
}

/**
 * Number of tile PNGs currently sitting in the local cache. Used by the
 * diagnostics card's "cached map tiles" indicator. Never throws — a missing
 * or unreadable cache directory simply reports zero.
 */
export function countCachedTiles(): number {
  try {
    const dir = getTilesDir();
    if (!dir.exists) return 0;
    // The tiles directory is flat ({z}_{x}_{y}.png one level deep), so the
    // listing length is the tile count; subdirectories are filtered out for
    // safety in case a future layout nests anything.
    const listing = dir.list();
    let count = 0;
    for (const entry of listing) {
      if (entry instanceof File) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

export type TileFetchResult = 'downloaded' | 'cached' | 'failed';

/** Downloads one tile. Never throws — a bad tile is a counted miss, not a crash. */
export async function downloadTile(
  coord: TileCoord,
  signal?: AbortSignal,
): Promise<TileFetchResult> {
  try {
    if (isTileCached(coord)) return 'cached';
    const remote = TILE_SOURCE_URL_TEMPLATE
      .replace('{z}', String(coord.z))
      .replace('{x}', String(coord.x))
      .replace('{y}', String(coord.y));
    await File.downloadFileAsync(remote, new File(getTilesDir(), tileFileName(coord)), {
      headers: { 'User-Agent': TILE_USER_AGENT },
      idempotent: true,
      signal,
    });
    return 'downloaded';
  } catch (error) {
    if (!signal?.aborted) {
      console.warn(`[mapTileCache] tile z${coord.z}/${coord.x}/${coord.y} failed:`, error);
    }
    return 'failed';
  }
}

export function tilesForBbox(bbox: Bbox, zoom: number): TileCoord[] {
  const z = clampZoom(zoom);
  const latNorth = Math.min(Math.max(Math.max(bbox.minLat, bbox.maxLat), -WEB_MERCATOR_MAX_LAT), WEB_MERCATOR_MAX_LAT);
  const latSouth = Math.min(Math.max(Math.min(bbox.minLat, bbox.maxLat), -WEB_MERCATOR_MAX_LAT), WEB_MERCATOR_MAX_LAT);
  const west = Math.min(bbox.minLng, bbox.maxLng);
  const east = Math.max(bbox.minLng, bbox.maxLng);

  const minX = clampTile(Math.floor(lngToTileX(west, z)), z);
  const maxX = clampTile(Math.floor(lngToTileX(east, z)), z);
  const minY = clampTile(Math.floor(latToTileY(latNorth, z)), z);
  const maxY = clampTile(Math.floor(latToTileY(latSouth, z)), z);

  const coords: TileCoord[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      coords.push({ z, x, y });
    }
  }
  return coords;
}

export interface DownloadRangeOptions {
  /** Called after every settled tile with the running (completed, total) counts. */
  onProgress?: (completed: number, total: number) => void;
  /** Parallel transfer cap. The task contract fixes this at 3. */
  concurrency?: number;
  /** Hard budget so a wide bbox can never explode storage or hammer the host. */
  maxTiles?: number;
  /** Cancels the crawl: queued tiles stop and in-flight downloads abort. */
  signal?: AbortSignal;
}

/**
 * Crawls the target area zoom-level by zoom-level (outer zooms first — they
 * give the widest offline context per tile), downloading tiles into the cache
 * with at most `concurrency` (default 3) parallel transfers.
 *
 * Every per-tile error is trapped into the summary; network drops mid-batch
 * degrade to counted failures instead of rejecting, so callers can keep the
 * map interactive no matter what.
 */
export async function downloadTileRange(
  bbox: Bbox,
  minZoom: number,
  maxZoom: number,
  options: DownloadRangeOptions = {},
): Promise<DownloadSummary> {
  const { onProgress, concurrency = 3, maxTiles = 400, signal } = options;

  const lo = clampZoom(Math.min(minZoom, maxZoom));
  const hi = clampZoom(Math.max(minZoom, maxZoom));

  // Outer zooms first; stop collecting once the tile budget is reached.
  const queue: TileCoord[] = [];
  let truncated = false;
  for (let z = lo; z <= hi; z++) {
    const level = tilesForBbox(bbox, z);
    const room = maxTiles - queue.length;
    if (level.length > room) {
      queue.push(...level.slice(0, Math.max(room, 0)));
      truncated = true;
      break;
    }
    queue.push(...level);
  }
  if (queue.length === 0) {
    return { total: 0, downloaded: 0, skipped: 0, failed: 0, truncated, cancelled: false };
  }

  const total = queue.length;
  const summary: DownloadSummary = {
    total,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    truncated,
    cancelled: false,
  };
  let cursor = 0;
  let completed = 0;

  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      if (signal?.aborted) {
        summary.cancelled = true;
        return;
      }
      const coord = queue[cursor++];
      const result = await downloadTile(coord, signal);
      if (result === 'downloaded') summary.downloaded += 1;
      else if (result === 'cached') summary.skipped += 1;
      else summary.failed += 1;
      completed += 1;
      onProgress?.(completed, total);
    }
  };

  const lanes = Math.min(Math.max(concurrency, 1), queue.length);
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  return summary;
}

/** Expands a MapView region into a padded bbox for prefetching around it. */
export function regionToBbox(
  region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number },
  padding = 2,
): Bbox {
  const halfLat = (region.latitudeDelta * padding) / 2;
  const halfLng = (region.longitudeDelta * padding) / 2;
  return {
    minLat: region.latitude - halfLat,
    maxLat: region.latitude + halfLat,
    minLng: region.longitude - halfLng,
    maxLng: region.longitude + halfLng,
  };
}

/** Apparent Web Mercator zoom level of a MapView region. */
export function zoomForRegion(region: {
  latitudeDelta: number;
  longitudeDelta: number;
}): number {
  const delta = Math.min(region.latitudeDelta, region.longitudeDelta) || region.latitudeDelta;
  if (delta <= 0) return MAX_ZOOM;
  return clampZoom(Math.log2(360 / delta));
}

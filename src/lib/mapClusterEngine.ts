import { SavedSpotMarker } from './mapSpotEngine';

/** Legacy map marker shape emitted by {@link clusterMarkersByGrid}. */
export interface MapClusterNode {
  id: string;
  latitude: number;
  longitude: number;
  isCluster: boolean;
  pointCount: number;
  name: string;
}

/**
 * Raw catch coordinate input for viewport-zoom spatial reduction.
 * Distinct from {@link MapCluster}: a single ungrouped catch location.
 */
export interface GeoPoint {
  id: string;
  latitude: number;
  longitude: number;
  species: string;
}

/**
 * Grouped density cluster produced by {@link computeSpatialClusters}.
 * `expansionZoom` is the zoom level at which the cluster is expected to
 * split apart; `containsIds` lists every grouped point id.
 */
export interface MapCluster {
  id: string;
  latitude: number;
  longitude: number;
  pointCount: number;
  expansionZoom: number;
  containsIds: string[];
}

/** Geographic viewport tuple in `[minLongitude, minLatitude, maxLongitude, maxLatitude]` order. */
export type SpatialBoundingBox = [number, number, number, number];

function clampZoom(zoomLevel: number): number {
  if (!Number.isFinite(zoomLevel)) return 0;
  return Math.min(22, Math.max(0, Math.floor(zoomLevel)));
}

/** Cell size in degrees halves with every zoom step (z0 ≈ 8°). */
function cellSizeForZoom(zoom: number): number {
  return 8 / Math.pow(2, zoom);
}

function isInsideBox(lat: number, lng: number, box: SpatialBoundingBox): boolean {
  const [minLng, minLat, maxLng, maxLat] = box;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

/**
 * Narrow an output value from {@link computeSpatialClusters} to a density cluster.
 * @param value Raw point or cluster output.
 * @returns `true` when the value carries cluster membership metadata.
 * @complexity O(1).
 */
function isClusterNode(value: GeoPoint | MapCluster): value is MapCluster {
  return (
    (value as MapCluster).pointCount !== undefined &&
    Array.isArray((value as MapCluster).containsIds)
  );
}

export { isClusterNode };

/**
 * Reduces close-proximity catch coordinates into discrete density clusters
 * for the given viewport box and zoom level.
 *
 * Pure + dependency-free: filters to the bounding box, buckets points into
 * a zoom-scaled degree grid (halving per zoom step), and emits singletons
 * as raw {@link GeoPoint}s and multi-point cells as centroid {@link MapCluster}s.
 * Single-pass O(n) — safe to call on every viewport pan without blocking UI.
 * @param points Catch coordinates to reduce. Invalid coordinates are skipped.
 * @param boundingBox Inclusive viewport bounds in longitude/latitude order.
 * @param zoomLevel Requested map zoom, clamped to integer range 0–22.
 * @returns Raw singletons and deterministic centroid clusters in cell insertion order.
 * @complexity O(n) time and O(n) additional space.
 */
export function computeSpatialClusters(
  points: GeoPoint[],
  boundingBox: SpatialBoundingBox,
  zoomLevel: number,
): (GeoPoint | MapCluster)[] {
  if (!points || points.length === 0) return [];
  if (!boundingBox || boundingBox.length !== 4) return [];

  const zoom = clampZoom(zoomLevel);
  const cell = cellSizeForZoom(zoom);
  const cells = new Map<string, GeoPoint[]>();

  for (const point of points) {
    if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
    if (!isInsideBox(point.latitude, point.longitude, boundingBox)) continue;
    const key = `${Math.floor(point.latitude / cell)}:${Math.floor(point.longitude / cell)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(point);
    else cells.set(key, [point]);
  }

  const result: (GeoPoint | MapCluster)[] = [];
  for (const bucket of cells.values()) {
    if (bucket.length === 1) {
      result.push(bucket[0]!);
    } else {
      const latitude = bucket.reduce((sum, p) => sum + p.latitude, 0) / bucket.length;
      const longitude = bucket.reduce((sum, p) => sum + p.longitude, 0) / bucket.length;
      const containsIds = bucket.map((p) => p.id);
      result.push({
        id: `cluster_${containsIds.slice().sort().join('_')}`,
        latitude,
        longitude,
        pointCount: bucket.length,
        expansionZoom: Math.min(22, zoom + 1),
        containsIds,
      });
    }
  }
  return result;
}

/**
 * Legacy pairwise marker clustering retained for existing saved-spot consumers.
 * @param spots Saved spot markers to group.
 * @param gridResolution Maximum latitude/longitude delta for a group, in degrees.
 * @returns Legacy display nodes with waypoint-count labels.
 * @complexity O(n²) time and O(n) additional space; use {@link computeSpatialClusters} for viewport-scale data.
 */
export function clusterMarkersByGrid(spots: SavedSpotMarker[], gridResolution = 0.01): MapClusterNode[] {
  if (!spots || spots.length === 0) return [];

  const clusters: MapClusterNode[] = [];
  const processedIndices = new Set<number>();

  for (let i = 0; i < spots.length; i++) {
    if (processedIndices.has(i)) continue;

    const baseSpot = spots[i];
    const groupedSpots: SavedSpotMarker[] = [baseSpot];
    processedIndices.add(i);

    for (let j = i + 1; j < spots.length; j++) {
      if (processedIndices.has(j)) continue;

      const compareSpot = spots[j];
      const latDelta = Math.abs(baseSpot.latitude - compareSpot.latitude);
      const lngDelta = Math.abs(baseSpot.longitude - compareSpot.longitude);

      if (latDelta <= gridResolution && lngDelta <= gridResolution) {
        groupedSpots.push(compareSpot);
        processedIndices.add(j);
      }
    }

    if (groupedSpots.length > 1) {
      // Compute bounding center average coordinates
      const avgLat = groupedSpots.reduce((sum, s) => sum + s.latitude, 0) / groupedSpots.length;
      const avgLng = groupedSpots.reduce((sum, s) => sum + s.longitude, 0) / groupedSpots.length;

      clusters.push({
        id: `cluster_${baseSpot.id ?? i}`,
        latitude: avgLat,
        longitude: avgLng,
        isCluster: true,
        pointCount: groupedSpots.length,
        name: `${groupedSpots.length} Waypoints Cluster`,
      });
    } else {
      clusters.push({
        id: baseSpot.id ?? `spot_${i}`,
        latitude: baseSpot.latitude,
        longitude: baseSpot.longitude,
        isCluster: false,
        pointCount: 1,
        name: baseSpot.name,
      });
    }
  }

  return clusters;
}

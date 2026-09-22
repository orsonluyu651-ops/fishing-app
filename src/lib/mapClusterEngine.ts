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

// ════════════════════════════════════════════════════════════════════
// Quadtree spatial index (Phase 2)
//
// Build once per dataset change (O(n log n)), query per viewport pan
// O(log n + k) — inverts the rebuild-per-call cost of
// {@link computeSpatialClusters} for static catch datasets.
//
// Design contract (docs/phase2-quadtree-seam-audit.md §2.2):
//   * leaf state is DERIVED (`children === null`) — never stored
//     alongside children (single source of leaf-truth);
//   * fixed 4-tuple child order NW, NE, SW, SE;
//   * sub-quadrant split at the midpoint of the node bounds (never the
//     point centroid — keeps tree shape input-order-independent);
//   * points exactly on a split midline go to the lower/left quadrant
//     (deterministic, order-independent);
//   * `SpatialBoundingBox` tuple order preserved verbatim:
//     [minLng, minLat, maxLng, maxLat];
//   * insertion silently skips points outside the root box or with
//     non-finite coordinates (same convention as the grid engine's
//     input guard above);
//   * nodes at QUADTREE_MAX_DEPTH stop splitting and absorb unboundedly
//     (identical-coordinate pileups can never recurse forever), so
//     insertion is strictly O(QUADTREE_MAX_DEPTH) per point.
// ════════════════════════════════════════════════════════════════════

/** Max points held in a leaf before it subdivides. */
export const QUADTREE_NODE_CAPACITY = 8;

/** Hard recursion stop — bbox at depth 12 ≈ sub-meter cells. */
export const QUADTREE_MAX_DEPTH = 12;

/** A quadtree node. Leaf while `children === null` (derived, never stored). */
export interface QuadtreeNode {
  bounds: SpatialBoundingBox;
  depth: number;
  points: GeoPoint[];
  children: [QuadtreeNode, QuadtreeNode, QuadtreeNode, QuadtreeNode] | null;
}

/** Derived leaf predicate — the single source of leaf truth. */
export function isQuadtreeLeaf(node: QuadtreeNode): boolean {
  return node.children === null;
}

/**
 * Factory: an empty quadtree node covering `box` (root when depth 0).
 * The bounds tuple is copied so later mutation of the caller's array
 * cannot corrupt the index.
 * @complexity O(1).
 */
export function createQuadtree(box: SpatialBoundingBox, depth: number = 0): QuadtreeNode {
  return {
    bounds: [box[0], box[1], box[2], box[3]],
    depth,
    points: [],
    children: null,
  };
}

// ── Quadrant layout (fixed NW, NE, SW, SE child order) ──────────────

/**
 * Splits `box` at its bounds midpoint into the four preallocated quadrant
 * boxes, in the fixed NW, NE, SW, SE child order (audit §2.2 — midpoint of
 * the node bounds, never the point centroid, keeps the tree shape
 * input-order-independent). Bounds are laid out inclusively on shared
 * edges, so a point exactly on a midline is contained by exactly the first
 * matching child in child order — routing stays deterministic.
 * @complexity O(1).
 */
function splitQuadrants(
  box: SpatialBoundingBox,
): [SpatialBoundingBox, SpatialBoundingBox, SpatialBoundingBox, SpatialBoundingBox] {
  const midLng = (box[0] + box[2]) / 2;
  const midLat = (box[1] + box[3]) / 2;
  return [
    [midLng, midLat, box[2], box[3]], // NW — upper lng/lat half
    [midLng, box[1], box[2], midLat], // NE — high lng, low lat half
    [box[0], box[1], midLng, midLat], // SW — low lng, low lat half
    [box[0], midLat, midLng, box[3]], // SE — low lng, high lat half
  ];
}

/**
 * Subdivides a saturated leaf: preallocates the four child nodes from the
 * quadrant layout, drains the leaf payload, and re-routes every point down
 * (children tile the parent exactly, so no point can ever be dropped).
 * @complexity O(QUADTREE_NODE_CAPACITY) per split.
 */
function splitNode(node: QuadtreeNode): void {
  const children = splitQuadrants(node.bounds).map((bounds) =>
    createQuadtree(bounds, node.depth + 1),
  ) as [QuadtreeNode, QuadtreeNode, QuadtreeNode, QuadtreeNode];

  const overflow = node.points;
  node.points = [];
  node.children = children;

  for (const point of overflow) insert(node, point);
}

/**
 * Inserts one point into the quadtree, splitting leaves recursively when
 * {@link QUADTREE_NODE_CAPACITY} is exceeded. Points outside the node's
 * bounds (including the root box) and non-finite coordinates are silently
 * skipped — the same input convention as the grid engine's guard above.
 * Leaves at {@link QUADTREE_MAX_DEPTH} stop splitting and absorb
 * unboundedly, so identical-coordinate pileups can never recurse forever.
 * @param node Subtree root to insert into (usually the quadtree root).
 * @param point Catch coordinate to index.
 * @complexity O(QUADTREE_MAX_DEPTH) amortized per point.
 */
export function insert(node: QuadtreeNode, point: GeoPoint): void {
  if (!node || !point) return;
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;
  if (!isInsideBox(point.latitude, point.longitude, node.bounds)) return;

  if (node.children) {
    // Interior: route into the first quadrant that contains the point.
    for (const child of node.children) {
      if (isInsideBox(point.latitude, point.longitude, child.bounds)) {
        insert(child, point);
        return;
      }
    }
    return; // Unreachable: children tile the parent exactly.
  }

  node.points.push(point);
  if (node.points.length > QUADTREE_NODE_CAPACITY && node.depth < QUADTREE_MAX_DEPTH) {
    splitNode(node);
  }
}

/** Inclusive AABB overlap test for two [minLng, minLat, maxLng, maxLat] boxes. */
function boxesIntersect(a: SpatialBoundingBox, b: SpatialBoundingBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/**
 * Collects every indexed point inside `viewport` using O(log n + k)
 * subdivision: subtrees whose bounds do not intersect the viewport box are
 * short-circuited away before descent, and only surviving leaves are
 * scanned linearly.
 * @param node Subtree root to query (usually the quadtree root).
 * @param viewport Inclusive [minLng, minLat, maxLng, maxLat] query box.
 * @returns Matching points in deterministic depth-first child order.
 * @complexity O(log n + k) for evenly distributed points; O(n) worst case
 * on degenerate pileups (bounded by the depth cap).
 */
export function queryViewport(node: QuadtreeNode, viewport: SpatialBoundingBox): GeoPoint[] {
  if (!node || !viewport || viewport.length !== 4) return [];

  // Short-circuit: a box that misses the viewport cannot contain a match.
  if (!boxesIntersect(node.bounds, viewport)) return [];

  if (node.children) {
    const matches: GeoPoint[] = [];
    for (const child of node.children) {
      matches.push(...queryViewport(child, viewport));
    }
    return matches;
  }

  return node.points.filter((p) => isInsideBox(p.latitude, p.longitude, viewport));
}


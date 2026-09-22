import {
  clusterMarkersByGrid,
  computeSpatialClusters,
  createQuadtree,
  insert,
  isClusterNode,
  isQuadtreeLeaf,
  QUADTREE_MAX_DEPTH,
  QUADTREE_NODE_CAPACITY,
  queryViewport,
} from '../mapClusterEngine';
import type { GeoPoint, MapCluster, QuadtreeNode, SpatialBoundingBox } from '../mapClusterEngine';
import { SavedSpotMarker } from '../mapSpotEngine';

const WORLD_BOX: SpatialBoundingBox = [-180, -90, 180, 90];

describe('Geospatial Map Grid Clustering Engine', () => {
  it('consolidates coordinate marks sitting inside grid thresholds safely', () => {
    const adjacentSpots: SavedSpotMarker[] = [
      { id: 's1', user_id: 'u1', name: 'Snag A', latitude: -28.0160, longitude: 153.4000 },
      { id: 's2', user_id: 'u1', name: 'Snag B', latitude: -28.0165, longitude: 153.4005 },
    ];

    const nodes = clusterMarkersByGrid(adjacentSpots, 0.01);
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.isCluster).toBe(true);
    expect(nodes[0]!.pointCount).toBe(2);
  });

  it('preserves single isolated markers as distinct non-cluster elements', () => {
    const distantSpots: SavedSpotMarker[] = [
      { id: 's1', user_id: 'u1', name: 'River Point', latitude: -28.0100, longitude: 153.4000 },
      { id: 's2', user_id: 'u1', name: 'Ocean Reef', latitude: -28.1500, longitude: 153.5500 },
    ];

    const nodes = clusterMarkersByGrid(distantSpots, 0.01);
    expect(nodes.length).toBe(2);
    expect(nodes.every((n) => !n.isCluster)).toBe(true);
  });

  it('gracefully outputs an empty array when given an empty marker list', () => {
    const nodes = clusterMarkersByGrid([]);
    expect(nodes).toEqual([]);
  });

  it('returns an empty array when input is null or undefined', () => {
    expect(clusterMarkersByGrid(null as unknown as SavedSpotMarker[])).toEqual([]);
    expect(clusterMarkersByGrid(undefined as unknown as SavedSpotMarker[])).toEqual([]);
  });

  it('groups three closely-packed spots into a single cluster with correct average center', () => {
    const spots: SavedSpotMarker[] = [
      { id: 'a', user_id: 'u1', name: 'A', latitude: -28.01, longitude: 153.40 },
      { id: 'b', user_id: 'u1', name: 'B', latitude: -28.012, longitude: 153.405 },
      { id: 'c', user_id: 'u1', name: 'C', latitude: -28.014, longitude: 153.408 },
    ];

    const nodes = clusterMarkersByGrid(spots, 0.01);
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.isCluster).toBe(true);
    expect(nodes[0]!.pointCount).toBe(3);
    expect(nodes[0]!.latitude).toBeCloseTo(-28.012, 3);
    expect(nodes[0]!.longitude).toBeCloseTo(153.404333, 3);
  });

  it('separates spots that exceed grid resolution on either axis', () => {
    const spots: SavedSpotMarker[] = [
      { id: 'x', user_id: 'u1', name: 'X', latitude: -28.0100, longitude: 153.4000 },
      { id: 'y', user_id: 'u1', name: 'Y', latitude: -28.0100, longitude: 153.4200 }, // 0.02 lng delta
    ];

    const nodes = clusterMarkersByGrid(spots, 0.01);
    expect(nodes.length).toBe(2);
    expect(nodes.every((n) => !n.isCluster)).toBe(true);
  });

  it('maintains stable point count after processing with a custom grid resolution', () => {
    const spots: SavedSpotMarker[] = [
      { id: 's1', user_id: 'u1', name: 'Spot 1', latitude: -28.01, longitude: 153.40 },
      { id: 's2', user_id: 'u1', name: 'Spot 2', latitude: -28.011, longitude: 153.401 },
      { id: 's3', user_id: 'u1', name: 'Spot 3', latitude: -28.05, longitude: 153.45 },
    ];

    const nodes = clusterMarkersByGrid(spots, 0.005);
    // s1 and s2 are within 0.005, s3 is far away
    expect(nodes.some((n) => n.isCluster && n.pointCount === 2)).toBe(true);
    expect(nodes.some((n) => !n.isCluster && n.pointCount === 1)).toBe(true);
  });

  it('uses the spot name for non-cluster single-node markers', () => {
    const spots: SavedSpotMarker[] = [
      { id: 'p1', user_id: 'u1', name: 'Secret Snag', latitude: -28.01, longitude: 153.40 },
    ];
    const nodes = clusterMarkersByGrid(spots);
    expect(nodes[0]!.name).toBe('Secret Snag');
    expect(nodes[0]!.id).toBe('p1');
  });
});

describe('computeSpatialClusters (bounding-box + zoom reduction)', () => {
  const trio: GeoPoint[] = [
    { id: 'a', latitude: -28.01, longitude: 153.4, species: 'Bream' },
    { id: 'b', latitude: -28.011, longitude: 153.401, species: 'Flathead' },
    { id: 'c', latitude: -28.5, longitude: 154.0, species: 'Snapper' },
  ];

  it('groups close-proximity points at low zoom and emits centroid clusters', () => {
    const out = computeSpatialClusters(trio, WORLD_BOX, 4);
    const cluster = out.find(isClusterNode);
    expect(cluster).toBeDefined();
    expect((cluster as MapCluster).pointCount).toBe(2);
    expect((cluster as MapCluster).containsIds.slice().sort()).toEqual(['a', 'b']);
    expect((cluster as MapCluster).expansionZoom).toBe(5);
  });

  it('splits the same points into raw GeoPoints at high zoom', () => {
    const out = computeSpatialClusters(trio, WORLD_BOX, 14);
    expect(out.some(isClusterNode)).toBe(false);
    expect(out).toHaveLength(3);
    expect(out.every((n) => !isClusterNode(n) && typeof (n as GeoPoint).species === 'string')).toBe(true);
  });

  it('filters points outside the [minLng, minLat, maxLng, maxLat] box', () => {
    const box: SpatialBoundingBox = [153.39, -28.02, 153.41, -28.0];
    const out = computeSpatialClusters(trio, box, 14);
    expect(out).toHaveLength(2);
    expect(out.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('preserves GeoPoint vs MapCluster type separation via the guard', () => {
    const out = computeSpatialClusters(trio, WORLD_BOX, 4);
    for (const node of out) {
      if (isClusterNode(node)) {
        expect(node.containsIds.length).toBe(node.pointCount);
      } else {
        expect((node as GeoPoint).species).toBeDefined();
      }
    }
  });

  it('returns [] for empty or invalid input without throwing', () => {
    expect(computeSpatialClusters([], WORLD_BOX, 8)).toEqual([]);
    expect(computeSpatialClusters(null as unknown as GeoPoint[], WORLD_BOX, 8)).toEqual([]);
    expect(computeSpatialClusters(trio, null as unknown as SpatialBoundingBox, 8)).toEqual([]);
  });
});

describe('Quadtree spatial index (Phase 2)', () => {
  const BOX: SpatialBoundingBox = [153.3, -28.1, 153.6, -27.8];

  const point = (id: string, latitude: number, longitude: number): GeoPoint => ({
    id,
    latitude,
    longitude,
    species: 'Bream',
  });

  it('createQuadtree copies the bounds tuple and starts as a derived leaf', () => {
    const box: SpatialBoundingBox = [0, 0, 10, 10];
    const root = createQuadtree(box);
    box[0] = 999; // caller-side mutation must never corrupt the index
    expect(root.bounds).toEqual([0, 0, 10, 10]);
    expect(root.depth).toBe(0);
    expect(root.points).toEqual([]);
    expect(root.children).toBeNull();
    expect(isQuadtreeLeaf(root)).toBe(true);
  });

  it('holds up to node capacity in the root leaf without splitting', () => {
    const root = createQuadtree(BOX);
    for (let i = 0; i < QUADTREE_NODE_CAPACITY; i += 1) {
      insert(root, point(`p${i}`, -28.05 + i * 0.005, 153.35 + i * 0.005));
    }
    expect(isQuadtreeLeaf(root)).toBe(true);
    expect(root.points).toHaveLength(QUADTREE_NODE_CAPACITY);
  });

  it('splits into four quadrant children once capacity is exceeded', () => {
    const root = createQuadtree(BOX);
    for (let i = 0; i <= QUADTREE_NODE_CAPACITY; i += 1) {
      insert(root, point(`p${i}`, -28.0 + i * 0.01, 153.35 + i * 0.01));
    }
    expect(root.children).not.toBeNull();
    expect(root.children).toHaveLength(4);
    expect(root.points).toHaveLength(0); // interior nodes carry no payload
    expect(root.children!.every(isQuadtreeLeaf)).toBe(true);
    expect(root.children!.every((child) => child.depth === 1)).toBe(true);
  });

  it('queryViewport returns exactly the points inside the box and none outside', () => {
    const root = createQuadtree(BOX);
    const pts = [
      point('in-a', -27.9, 153.4),
      point('in-b', -28.0, 153.5),
      point('out-c', -29.5, 150.0), // outside the root box entirely
      point('in-d', -27.85, 153.55),
    ];
    for (const p of pts) insert(root, p);
    const out = queryViewport(root, BOX);
    expect(out.map((p) => p.id).sort()).toEqual(['in-a', 'in-b', 'in-d']);
  });

  it('short-circuits viewports that do not intersect the indexed bounds', () => {
    const root = createQuadtree(BOX);
    insert(root, point('a', -27.9, 153.4));
    expect(queryViewport(root, [0, 0, 1, 1])).toEqual([]);
    expect(queryViewport(root, [150, -30, 151, -29])).toEqual([]);
  });

  it('includes points sitting exactly on the viewport boundary (inclusive edges)', () => {
    const root = createQuadtree(BOX);
    insert(root, point('corner', -28.1, 153.3)); // exact min corner of BOX
    insert(root, point('edge', -27.8, 153.45)); // exact max-lat edge midpoint
    const out = queryViewport(root, BOX);
    expect(out.map((p) => p.id).sort()).toEqual(['corner', 'edge']);
  });

  it('routes midline points deterministically regardless of insertion order', () => {
    const forward = createQuadtree([0, 0, 10, 10]);
    const reverse = createQuadtree([0, 0, 10, 10]);
    const pts = [
      point('m-center', 5, 5), // exactly on both midlines
      point('m-east', 2, 5), // exactly on the lng midline
      point('m-north', 5, 2), // exactly on the lat midline
      point('c0', 1, 1),
      point('c1', 1, 2),
      point('c2', 2, 1),
      point('c3', 8, 8),
      point('c4', 9, 9),
      point('c5', 8, 9),
      point('c6', 9, 8),
      point('corner-max', 10, 10),
    ];
    for (const p of pts) insert(forward, p);
    for (const p of [...pts].reverse()) insert(reverse, p);

    const ids = (tree: QuadtreeNode) =>
      queryViewport(tree, [0, 0, 10, 10]).map((p) => p.id).sort();
    expect(ids(forward)).toEqual(ids(reverse));
    expect(ids(forward)).toEqual(
      expect.arrayContaining(['m-center', 'm-east', 'm-north', 'corner-max']),
    );
    expect(ids(forward)).toHaveLength(pts.length);
  });

  it('absorbs identical-coordinate pileups at max depth without recursing forever', () => {
    const root = createQuadtree([0, 0, 10, 10]);
    for (let i = 0; i < 200; i += 1) insert(root, point(`dup-${i}`, 5, 5));

    expect(queryViewport(root, [0, 0, 10, 10])).toHaveLength(200);

    // The deepest node must respect the hard depth cap.
    let deepest: QuadtreeNode = root;
    while (deepest.children) deepest = deepest.children[0]!;
    expect(deepest.depth).toBeLessThanOrEqual(QUADTREE_MAX_DEPTH);
  });

  it('silently skips points outside the root box and non-finite coordinates', () => {
    const root = createQuadtree(BOX);
    expect(() => {
      insert(root, point('north', 40, 153.4)); // outside root lat range
      insert(root, point('nan', Number.NaN, 153.4));
      insert(root, point('inf', -27.9, Number.POSITIVE_INFINITY));
    }).not.toThrow();
    expect(root.points).toHaveLength(0);
    expect(queryViewport(root, BOX)).toEqual([]);
  });

  it('is defensive against null nodes, points, and malformed viewports', () => {
    const root = createQuadtree(BOX);
    expect(() => insert(null as unknown as QuadtreeNode, point('x', -27.9, 153.4))).not.toThrow();
    expect(() => insert(root, null as unknown as GeoPoint)).not.toThrow();
    expect(queryViewport(null as unknown as QuadtreeNode, BOX)).toEqual([]);
    expect(queryViewport(root, [1, 2] as unknown as SpatialBoundingBox)).toEqual([]);
  });
});

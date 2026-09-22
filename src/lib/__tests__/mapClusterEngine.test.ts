import { clusterMarkersByGrid, computeSpatialClusters, isClusterNode } from '../mapClusterEngine';
import type { GeoPoint, MapCluster, SpatialBoundingBox } from '../mapClusterEngine';
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

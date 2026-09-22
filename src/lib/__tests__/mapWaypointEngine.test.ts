import { processCatchesIntoWaypoints, type CatchRecordWithCoords } from '../mapWaypointEngine';

describe('Geospatial Catch Waypoint and Map Marker Processing Engine', () => {
  it('groups overlapping catches at identical coordinates into a single map pinpoint node', () => {
    const mixedCatches: CatchRecordWithCoords[] = [
      { id: 'c1', weight: 6.2, species: 'Flathead', latitude: -27.94321, longitude: 153.41234, location_name: 'Seaway' },
      { id: 'c2', weight: 3.5, species: 'Bream', latitude: -27.94321, longitude: 153.41234, location_name: 'Seaway' },
    ];

    const nodes = processCatchesIntoWaypoints(mixedCatches);
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.catchIds).toEqual(['c1', 'c2']);
    expect(nodes[0]!.description).toContain('Flathead (6.2 lbs)');
    expect(nodes[0]!.description).toContain('Bream (3.5 lbs)');
  });

  it('filters out records that carry missing, zeroed, or out-of-bounds coordinates cleanly', () => {
    const faultyCatches: CatchRecordWithCoords[] = [
      { id: 'c1', weight: 4.0, latitude: 0, longitude: 153.0 }, // Invalid zero point intersection
      { id: 'c2', weight: 2.1, latitude: 120.5, longitude: 45.0 }, // Latitude out of bounds
      { id: 'c3', weight: 5.5, latitude: -27.5, longitude: 153.5, location_name: 'Valid Spot' },
    ];

    const nodes = processCatchesIntoWaypoints(faultyCatches);
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.title).toBe('Valid Spot');
  });

  it('safely evaluates empty or null datasets without crashing layout processes', () => {
    expect(processCatchesIntoWaypoints([])).toEqual([]);
    expect(processCatchesIntoWaypoints(null as unknown as CatchRecordWithCoords[])).toEqual([]);
  });

  it('assigns default title "Fishing Hotspot" when location_name is missing', () => {
    const records: CatchRecordWithCoords[] = [
      { id: 'r1', weight: 10.0, latitude: -28.0, longitude: 153.4 },
    ];

    const nodes = processCatchesIntoWaypoints(records);
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.title).toBe('Fishing Hotspot');
  });

  it('uses "Unknown Species" as label when species is absent', () => {
    const records: CatchRecordWithCoords[] = [
      { id: 'r1', weight: 7.0, latitude: -28.1, longitude: 153.45 },
    ];

    const nodes = processCatchesIntoWaypoints(records);
    expect(nodes[0]!.description).toContain('Unknown Species');
  });

  it('creates separate waypoint nodes when coordinates differ', () => {
    const records: CatchRecordWithCoords[] = [
      { id: 'a', weight: 4.0, species: 'Bream', latitude: -28.0, longitude: 153.4, location_name: 'Point A' },
      { id: 'b', weight: 5.0, species: 'Snapper', latitude: -28.1, longitude: 153.5, location_name: 'Point B' },
    ];

    const nodes = processCatchesIntoWaypoints(records);
    expect(nodes.length).toBe(2);
    expect(nodes.map((n) => n.id).sort()).toEqual(['wp_a', 'wp_b'].sort());
  });

  it('skips records with undefined latitude or longitude', () => {
    const records: CatchRecordWithCoords[] = [
      { id: 'bad1', weight: 3.0, latitude: undefined, longitude: 153.0, location_name: 'No Lat' },
      { id: 'bad2', weight: 3.0, latitude: -28.0, longitude: undefined, location_name: 'No Lng' },
      { id: 'good', weight: 6.0, latitude: -28.0, longitude: 153.0, location_name: 'Good Spot' },
    ];

    const nodes = processCatchesIntoWaypoints(records);
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.id).toBe('wp_good');
  });

  it('deduplicates by rounded 5-decimal coordinate key, merging multiple catches', () => {
    // Use coordinates that share identical 5-decimal keys
    const mergeRecords: CatchRecordWithCoords[] = [
      { id: 'm1', weight: 2.0, species: 'Fish A', latitude: -28.00001, longitude: 153.40001, location_name: 'A' },
      { id: 'm2', weight: 3.0, species: 'Fish B', latitude: -28.00001, longitude: 153.40001, location_name: 'B' },
      { id: 'm3', weight: 4.0, species: 'Fish C', latitude: -28.1, longitude: 153.5, location_name: 'C' },
    ];

    const mergedNodes = processCatchesIntoWaypoints(mergeRecords);
    expect(mergedNodes.length).toBe(2);
    const merged = mergedNodes.find((n) => n.catchIds.length === 2);
    expect(merged).toBeDefined();
    expect(merged!.catchIds).toContain('m1');
    expect(merged!.catchIds).toContain('m2');
  });
});

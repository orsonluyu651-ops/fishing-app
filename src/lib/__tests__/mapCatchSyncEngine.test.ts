import { compileCatchesToMarkers } from '../mapCatchSyncEngine';
import { CatchRecord } from '../exportEngine';

describe('Geospatial Catch Mapping Synchronizer Engine', () => {
  const mockCatches: CatchRecord[] = [
    { id: '101', weight: 14.2, species: 'Mangrove Jack', location_name: 'Coomera River', created_at: '2026-03-22T08:00:00Z' },
    { id: '102', weight: 8.5, species: 'Bream', location_name: 'Nerang River', created_at: '2026-03-21T14:00:00Z' },
  ];

  it('transforms catch payload structures into visible map marker nodes safely', () => {
    const markers = compileCatchesToMarkers(mockCatches);
    expect(markers.length).toBe(2);
    expect(markers[0].id).toBe('catch_101');
    expect(markers[0].name).toContain('Mangrove Jack');
    expect(markers[1].id).toBe('catch_102');
    expect(markers[1].name).toContain('Bream');
  });

  it('gracefully returns empty arrays when history items are missing', () => {
    const markers = compileCatchesToMarkers([]);
    expect(markers).toEqual([]);
  });

  it('returns an empty array when passed null or undefined', () => {
    expect(compileCatchesToMarkers(null as unknown as CatchRecord[])).toEqual([]);
    expect(compileCatchesToMarkers(undefined as unknown as CatchRecord[])).toEqual([]);
  });

  it('produces deterministic marker IDs and names with stable weight formatting', () => {
    const markers = compileCatchesToMarkers(mockCatches);
    expect(markers[0].id).toMatch(/^catch_/);
    expect(markers[0].name).toMatch(/Mangrove Jack/);
    expect(markers[0].name).toMatch(/14\.2 lbs/);
  });

  it('places each marker near the fallback coordinate cluster without throwing', () => {
    const markers = compileCatchesToMarkers(mockCatches);
    markers.forEach((m) => {
      expect(typeof m.latitude).toBe('number');
      expect(typeof m.longitude).toBe('number');
      expect(m.name).not.toBeNull();
      expect(m.user_id).toBe('SYSTEM_PARSED_ENTITY');
    });
  });
});

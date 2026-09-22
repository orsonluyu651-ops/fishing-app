import { calculateHaversineDistanceKm, filterSpotsByProximity } from '../mapProximityEngine';
import { SavedSpotMarker } from '../mapSpotEngine';

describe('Geospatial Haversine Proximity Filter Engine', () => {
  const goldCoastCenter = { lat: -28.0167, lng: 153.4000 };
  const mockSpots: SavedSpotMarker[] = [
    { id: 's1', user_id: 'u1', name: 'Close Snag Point', latitude: -28.0200, longitude: 153.4100 }, // ~1 km away
    { id: 's2', user_id: 'u1', name: 'Far Snag Point', latitude: -28.4500, longitude: 153.5000 },    // ~45 km away
  ];

  it('accurately evaluates kilometers using spherical trigonometry formulas', () => {
    const distance = calculateHaversineDistanceKm(-28.0167, 153.4000, -28.0200, 153.4100);
    expect(distance).toBeLessThan(2);
    expect(distance).toBeGreaterThan(0.5);
  });

  it('returns near-zero distance for identical coordinates', () => {
    const distance = calculateHaversineDistanceKm(-28.0167, 153.4000, -28.0167, 153.4000);
    expect(distance).toBeLessThan(0.01);
  });

  it('filters out marker objects located outside the specified maximum range boundary', () => {
    const filtered = filterSpotsByProximity(mockSpots, {
      currentLat: goldCoastCenter.lat,
      currentLng: goldCoastCenter.lng,
      maxDistanceKm: 10,
    });

    expect(filtered.length).toBe(1);
    expect(filtered[0]!.name).toBe('Close Snag Point');
  });

  it('returns all markers when the range covers every spot', () => {
    const filtered = filterSpotsByProximity(mockSpots, {
      currentLat: goldCoastCenter.lat,
      currentLng: goldCoastCenter.lng,
      maxDistanceKm: 100,
    });
    expect(filtered.length).toBe(2);
  });

  it('gracefully yields clean empty lists when empty arrays are parsed', () => {
    const filtered = filterSpotsByProximity([], {
      currentLat: -28.0,
      currentLng: 153.4,
      maxDistanceKm: 5,
    });
    expect(filtered).toEqual([]);
  });

  it('gracefully yields clean empty lists when passed null or undefined', () => {
    expect(filterSpotsByProximity(null as unknown as SavedSpotMarker[], { currentLat: 0, currentLng: 0, maxDistanceKm: 10 })).toEqual([]);
    expect(filterSpotsByProximity(undefined as unknown as SavedSpotMarker[], { currentLat: 0, currentLng: 0, maxDistanceKm: 10 })).toEqual([]);
  });

  it('computes a long-range distance between distant cities correctly', () => {
    // Approximate distance between Gold Coast (-28.0167, 153.4) and Sydney (-33.8688, 151.2093)
    const distance = calculateHaversineDistanceKm(-28.0167, 153.4, -33.8688, 151.2093);
    expect(distance).toBeGreaterThan(650);
    expect(distance).toBeLessThan(750);
  });
});

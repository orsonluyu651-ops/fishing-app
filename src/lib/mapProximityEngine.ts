import { SavedSpotMarker } from './mapSpotEngine';

export interface ProximityFilterConfig {
  currentLat: number;
  currentLng: number;
  maxDistanceKm: number;
}

/**
 * Calculates the absolute great-circle distance between two coordinate pairs using the Haversine formula.
 */
export function calculateHaversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const EARTH_RADIUS_KM = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Prunes and screens target marker blocks that sit entirely outside designated kilometer ranges.
 */
export function filterSpotsByProximity(spots: SavedSpotMarker[], config: ProximityFilterConfig): SavedSpotMarker[] {
  if (!spots || spots.length === 0) return [];

  return spots.filter((spot) => {
    const distance = calculateHaversineDistanceKm(
      config.currentLat,
      config.currentLng,
      spot.latitude,
      spot.longitude
    );
    return distance <= config.maxDistanceKm;
  });
}

export interface CatchRecordWithCoords {
  id: string;
  species?: string;
  weight: number;
  latitude?: number;
  longitude?: number;
  location_name?: string;
}

export interface MapWaypointNode {
  id: string;
  coordinate: {
    latitude: number;
    longitude: number;
  };
  title: string;
  description: string;
  catchIds: string[];
}

/**
 * Parses catch arrays, filters bounding coordinates, and aggregates localized spatial markers.
 */
export function processCatchesIntoWaypoints(catches: CatchRecordWithCoords[]): MapWaypointNode[] {
  const safeCatches = catches || [];
  const waypointMap: Record<string, MapWaypointNode> = {};

  for (const item of safeCatches) {
    const lat = item.latitude;
    const lng = item.longitude;

    // 1. Enforce strict geographic spatial range boundaries (skip invalid or raw 0 coordinates)
    if (lat === undefined || lng === undefined || lat === null || lng === null || lat === 0 || lng === 0) {
      continue;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      continue;
    }

    // 2. Derive coordinate key signature to group overlapping markers on identical nodes
    const coordinateKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`;

    const speciesLabel = item.species?.trim() || 'Unknown Species';
    const detailString = `${speciesLabel} (${item.weight} lbs)`;

    if (waypointMap[coordinateKey]) {
      // Append secondary text definitions for co-located catch indicators
      waypointMap[coordinateKey].description += `, ${detailString}`;
      waypointMap[coordinateKey].catchIds.push(item.id);
    } else {
      waypointMap[coordinateKey] = {
        id: `wp_${item.id}`,
        coordinate: { latitude: lat, longitude: lng },
        title: item.location_name?.trim() || 'Fishing Hotspot',
        description: detailString,
        catchIds: [item.id],
      };
    }
  }

  return Object.values(waypointMap);
}

import * as FileSystem from 'expo-file-system';

export interface MapBoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  minZoom: number;
  maxZoom: number;
}

/**
 * Converts standard coordinate bounding fragments into specific OpenStreetMap/Mapbox tile coordinates.
 */
export function getTileCoordinates(lat: number, lng: number, zoom: number) {
  const x = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
  const y = Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
  return { x, y };
}

/**
 * Iterates through coordinates at various zoom depths to systematically save tiles locally.
 */
export async function downloadOfflineMapRegion(box: MapBoundingBox, onProgress: (progress: number) => void): Promise<string[]> {
  const localPaths: string[] = [];
  try {
    const cacheDir = (FileSystem as unknown as { cacheDirectory: string }).cacheDirectory + 'map_tiles/';
    const dirInfo = await FileSystem.getInfoAsync(cacheDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
    }

    let totalTiles = 0;
    // Calculate total operations footprint upfront
    for (let z = box.minZoom; z <= box.maxZoom; z++) {
      const start = getTileCoordinates(box.maxLat, box.minLng, z);
      const end = getTileCoordinates(box.minLat, box.maxLng, z);
      totalTiles += (end.x - start.x + 1) * (end.y - start.y + 1);
    }

    let currentTileCount = 0;

    for (let z = box.minZoom; z <= box.maxZoom; z++) {
      const start = getTileCoordinates(box.maxLat, box.minLng, z);
      const end = getTileCoordinates(box.minLat, box.maxLng, z);

      for (let x = start.x; x <= end.x; x++) {
        for (let y = start.y; y <= end.y; y++) {
          const tileUrl = `https://openstreetmap.org{z}/${x}/${y}.png`;
          const localPath = `${cacheDir}${z}_${x}_${y}.png`;

          const fileCheck = await FileSystem.getInfoAsync(localPath);
          if (!fileCheck.exists) {
            await FileSystem.downloadAsync(tileUrl, localPath);
          }

          localPaths.push(localPath);
          currentTileCount++;
          onProgress(currentTileCount / totalTiles);
        }
      }
    }
    return localPaths;
  } catch (err) {
    console.error("Offline tile sync collection failed:", err);
    return [];
  }
}

import * as FileSystem from 'expo-file-system';
import { getTileCoordinates, downloadOfflineMapRegion, type MapBoundingBox } from '../mapCacheEngine';

const mockGetInfoAsync = FileSystem.getInfoAsync as jest.MockedFunction<typeof FileSystem.getInfoAsync>;
const mockMakeDirectoryAsync = FileSystem.makeDirectoryAsync as jest.MockedFunction<typeof FileSystem.makeDirectoryAsync>;
const mockDownloadAsync = FileSystem.downloadAsync as jest.MockedFunction<typeof FileSystem.downloadAsync>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Offline Map Tile Engine Validation", () => {
  describe("getTileCoordinates", () => {
    it("correctly maps geographic coordinates to grid tokens", () => {
      const coords = getTileCoordinates(-28.0167, 153.4000, 10); // Gold Coast Area
      expect(coords.x).toBeGreaterThan(0);
      expect(coords.y).toBeGreaterThan(0);
    });

    it("returns deterministic values for the same input", () => {
      const a = getTileCoordinates(-28.0167, 153.4000, 10);
      const b = getTileCoordinates(-28.0167, 153.4000, 10);
      expect(a.x).toBe(b.x);
      expect(a.y).toBe(b.y);
    });

    it("scales with zoom level — higher zoom produces larger tile indices", () => {
      const low = getTileCoordinates(0, 0, 5);
      const high = getTileCoordinates(0, 0, 10);
      expect(high.x).toBeGreaterThan(low.x);
      expect(high.y).toBeGreaterThan(low.y);
    });

    it("clamps to valid tile ranges at extreme latitudes", () => {
      const north = getTileCoordinates(85, 0, 15);
      const south = getTileCoordinates(-85, 0, 15);
      expect(north.x).toBeGreaterThanOrEqual(0);
      expect(north.y).toBeGreaterThanOrEqual(0);
      expect(south.x).toBeGreaterThanOrEqual(0);
      expect(south.y).toBeGreaterThanOrEqual(0);
    });
  });

  describe("downloadOfflineMapRegion", () => {
    it("orchestrates iterative tile downlinks completely", async () => {
      const progressSpy = jest.fn();
      (mockGetInfoAsync as jest.Mock).mockImplementation(async (uri: string) => ({
        exists: uri.includes("exists"),
        size: 0,
      }));
      (mockDownloadAsync as jest.Mock).mockResolvedValue({ uri: "file://downloaded-tile.png" } as never);
      (mockMakeDirectoryAsync as jest.Mock).mockResolvedValue(undefined as never);

      const box: MapBoundingBox = { minLat: -28.02, maxLat: -28.01, minLng: 153.39, maxLng: 153.40, minZoom: 12, maxZoom: 12 };

      const tiles = await downloadOfflineMapRegion(box, progressSpy);
      expect(tiles.length).toBeGreaterThan(0);
      expect(progressSpy).toHaveBeenCalled();
    });

    it("skips tiles that already exist on disk", async () => {
      const progressSpy = jest.fn();
      let callCount = 0;
      (mockGetInfoAsync as jest.Mock).mockImplementation(async (uri: string) => {
        callCount++;
        // First half of calls return exists:true (simulating pre-cached tiles)
        return { exists: callCount <= 2, size: callCount <= 2 ? 2048 : 0 } as never;
      });
      (mockDownloadAsync as jest.Mock).mockResolvedValue({ uri: "file://new-tile.png" } as never);
      (mockMakeDirectoryAsync as jest.Mock).mockResolvedValue(undefined as never);

      const box: MapBoundingBox = { minLat: -28.02, maxLat: -28.00, minLng: 153.39, maxLng: 153.41, minZoom: 12, maxZoom: 12 };

      await downloadOfflineMapRegion(box, progressSpy);

      const downloadCalls = (mockDownloadAsync as jest.Mock).mock.calls.length;
      expect(downloadCalls).toBeLessThan(callCount);
    });

    it("creates the cache directory if it does not exist", async () => {
      (mockGetInfoAsync as jest.Mock).mockImplementation(async (uri: string) => {
        if (uri.includes("map_tiles")) return { exists: false, size: 0 } as never;
        return { exists: false, size: 0 } as never;
      });
      (mockMakeDirectoryAsync as jest.Mock).mockResolvedValue(undefined as never);
      (mockDownloadAsync as jest.Mock).mockResolvedValue({ uri: "file://tile.png" } as never);

      const progressSpy = jest.fn();
      const box: MapBoundingBox = { minLat: -28.02, maxLat: -28.01, minLng: 153.39, maxLng: 153.40, minZoom: 12, maxZoom: 12 };

      await downloadOfflineMapRegion(box, progressSpy);

      expect(mockMakeDirectoryAsync).toHaveBeenCalledWith(expect.stringContaining("map_tiles"), expect.any(Object));
    });

    it("returns an empty array when the download throws", async () => {
      (mockGetInfoAsync as jest.Mock).mockRejectedValue(new Error("disk full"));
      (mockMakeDirectoryAsync as jest.Mock).mockRejectedValue(new Error("disk full"));

      const progressSpy = jest.fn();
      const box: MapBoundingBox = { minLat: -28.02, maxLat: -28.01, minLng: 153.39, maxLng: 153.40, minZoom: 12, maxZoom: 12 };

      const tiles = await downloadOfflineMapRegion(box, progressSpy);

      expect(tiles).toEqual([]);
      expect(progressSpy).not.toHaveBeenCalled();
    });

    it("handles multi-zoom downloads with progress callbacks across levels", async () => {
      const progressValues: number[] = [];
      (mockGetInfoAsync as jest.Mock).mockImplementation(async () => ({ exists: false, size: 0 } as never));
      (mockDownloadAsync as jest.Mock).mockResolvedValue({ uri: "file://tile.png" } as never);
      (mockMakeDirectoryAsync as jest.Mock).mockResolvedValue(undefined as never);

      const box: MapBoundingBox = { minLat: -28.02, maxLat: -28.01, minLng: 153.39, maxLng: 153.40, minZoom: 11, maxZoom: 12 };

      await downloadOfflineMapRegion(box, (p) => progressValues.push(p));

      expect(progressValues.length).toBeGreaterThan(1);
      expect(progressValues[progressValues.length - 1]).toBeCloseTo(1.0, 0);
    });
  });
});

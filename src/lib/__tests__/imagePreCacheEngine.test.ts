import * as FileSystem from 'expo-file-system';
import { cacheRemoteFeedImage } from '../imagePreCacheEngine';

jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file://mock-cache/',
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false })),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  downloadAsync: jest.fn(() =>
    Promise.resolve({ uri: 'file://mock-cache/feed_media_cache/abc.jpg', status: 200 })
  ),
}));

describe('Social Feed Media Pre-Caching and Interception Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('downloads remote assets and maps them to local directory paths on first request', async () => {
    const report = await cacheRemoteFeedImage('https://example.com/image.jpg');
    expect(report.success).toBe(true);
    expect(report.isPreCached).toBe(false);
    expect(FileSystem.downloadAsync).toHaveBeenCalled();
  });

  it('returns local cache URI immediately if the image file already exists on disk', async () => {
    (FileSystem.getInfoAsync as jest.Mock)
      .mockResolvedValueOnce({ exists: true }) // Directory exists
      .mockResolvedValueOnce({ exists: true }); // File exists

    const report = await cacheRemoteFeedImage('https://example.com/image.jpg');
    expect(report.success).toBe(true);
    expect(report.isPreCached).toBe(true);
    expect(FileSystem.downloadAsync).not.toHaveBeenCalled();
  });

  it('gracefully returns the original URL if it is malformed or invalid', async () => {
    const report = await cacheRemoteFeedImage('invalid-link');
    expect(report.success).toBe(false);
    expect(report.localUri).toBe('invalid-link');
  });

  it('returns the original URL when passed an empty string', async () => {
    const report = await cacheRemoteFeedImage('');
    expect(report.success).toBe(false);
    expect(report.localUri).toBe('');
  });

  it('returns the original URL when passed null', async () => {
    const report = await cacheRemoteFeedImage(null as unknown as string);
    expect(report.success).toBe(false);
    expect(report.localUri).toBe('');
  });

  it('uses the file extension from the remote URL for the cached filename', async () => {
    (FileSystem.downloadAsync as jest.Mock).mockResolvedValueOnce({
      uri: 'file://mock-cache/feed_media_cache/abc.png',
      status: 200,
    });
    const report = await cacheRemoteFeedImage('https://example.com/photo.png');
    expect(report.success).toBe(true);
    expect(report.localUri).toContain('.png');
  });

  it('falls back to jpg extension when the URL has no recognizable extension', async () => {
    const report = await cacheRemoteFeedImage('https://example.com/api/image');
    expect(report.success).toBe(true);
    expect(report.localUri).toContain('.jpg');
  });

  it('handles download failures by returning success: false with the original URL', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: true }); // dir ok
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: false }); // file missing
    (FileSystem.downloadAsync as jest.Mock).mockRejectedValueOnce(new Error('network error'));

    const report = await cacheRemoteFeedImage('https://cdn.example.com/fresh.jpg');
    expect(report.success).toBe(false);
    expect(report.localUri).toBe('https://cdn.example.com/fresh.jpg');
    expect(report.isPreCached).toBe(false);
  });
});

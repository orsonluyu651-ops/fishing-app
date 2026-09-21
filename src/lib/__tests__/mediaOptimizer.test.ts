/**
 * Unit tests for the catch photo optimizer.
 *
 * expo-image-manipulator is a native module, so it is jest.mock'd here with a
 * deterministic stand-in (same pattern as the network mocks in jest.setup.js
 * and offlineCatchQueue.test.ts): the pipeline's *decisions* — resize or
 * pass-through, the quality/format it saves with, whether native bitmaps get
 * released — are what these tests pin down, not pixel output.
 */
import {
  fitWithinBounds,
  optimizeCatchImage,
  MAX_CATCH_IMAGE_DIMENSION,
  CATCH_IMAGE_QUALITY,
} from '../mediaOptimizer';

interface MockState {
  width: number;
  height: number;
  failRender: boolean;
  resizes: Array<Record<string, unknown>>;
  saved: Array<Record<string, unknown>>;
  released: number;
}

const mockState: MockState = (
  jest.requireMock('expo-image-manipulator') as { __mockState: MockState }
).__mockState;

jest.mock('expo-image-manipulator', () => {
  const state = {
    width: 4000,
    height: 3000,
    failRender: false,
    resizes: [] as Array<Record<string, unknown>>,
    saved: [] as Array<Record<string, unknown>>,
    released: 0,
  };

  class MockImageRef {
    uri: string;
    width: number;
    height: number;
    constructor(uri: string, width: number, height: number) {
      this.uri = uri;
      this.width = width;
      this.height = height;
    }
    async saveAsync(options: Record<string, unknown>) {
      state.saved.push({ ...options });
      return {
        uri: 'file:///mock-cache/optimized-catch.jpg',
        width: this.width,
        height: this.height,
      };
    }
    release() {
      state.released += 1;
    }
  }

  class MockContext {
    private uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    resize(size: Record<string, unknown>) {
      state.resizes.push({ ...size });
      return this;
    }
    async renderAsync() {
      if (state.failRender) throw new Error('render failed');
      // Honours applied resize actions, like the real pipeline: a second render
      // after .resize() resolves to the resized dimensions.
      const lastResize = state.resizes[state.resizes.length - 1];
      const width = typeof lastResize?.width === 'number' ? lastResize.width : state.width;
      const height = typeof lastResize?.height === 'number' ? lastResize.height : state.height;
      return new MockImageRef(this.uri, width, height);
    }
  }

  return {
    __esModule: true,
    __mockState: state,
    ImageManipulator: { manipulate: (uri: string) => new MockContext(uri) },
    SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
  };
});

beforeEach(() => {
  mockState.width = 4000;
  mockState.height = 3000;
  mockState.failRender = false;
  mockState.resizes = [];
  mockState.saved = [];
  mockState.released = 0;
});

describe('fitWithinBounds', () => {
  it('scales the longest edge down to the bounding size (landscape)', () => {
    expect(fitWithinBounds(4000, 3000, MAX_CATCH_IMAGE_DIMENSION)).toEqual({
      width: 1200,
      height: 900,
    });
  });

  it('scales the longest edge down to the bounding size (portrait)', () => {
    expect(fitWithinBounds(3000, 4000, MAX_CATCH_IMAGE_DIMENSION)).toEqual({
      width: 900,
      height: 1200,
    });
  });

  it('never upscales an image already within bounds', () => {
    expect(fitWithinBounds(800, 600, MAX_CATCH_IMAGE_DIMENSION)).toEqual({ width: 800, height: 600 });
    expect(fitWithinBounds(1200, 800, MAX_CATCH_IMAGE_DIMENSION)).toEqual({
      width: 1200,
      height: 800,
    });
  });

  it('preserves aspect ratio and never rounds to zero pixels', () => {
    expect(fitWithinBounds(2400, 3, MAX_CATCH_IMAGE_DIMENSION)).toEqual({ width: 1200, height: 2 });
    expect(fitWithinBounds(3, 2400, MAX_CATCH_IMAGE_DIMENSION)).toEqual({ width: 2, height: 1200 });
  });
});

describe('optimizeCatchImage', () => {
  it('resizes oversized images and re-encodes at the strict quality baseline', async () => {
    const result = await optimizeCatchImage('file:///camera-roll/catch.jpg');

    expect(mockState.resizes).toEqual([{ width: 1200, height: 900 }]);
    expect(mockState.saved).toEqual([{ compress: CATCH_IMAGE_QUALITY, format: 'jpeg' }]);
    expect(result).toEqual({
      uri: 'file:///mock-cache/optimized-catch.jpg',
      width: 1200,
      height: 900,
    });
    // Both native renders (source + resized) are released.
    expect(mockState.released).toBe(2);
  });

  it('re-encodes in-bounds images without resizing — the re-encode strips EXIF', async () => {
    mockState.width = 800;
    mockState.height = 600;

    const result = await optimizeCatchImage('file:///camera-roll/small.jpg');

    expect(mockState.resizes).toEqual([]);
    expect(mockState.saved).toEqual([{ compress: CATCH_IMAGE_QUALITY, format: 'jpeg' }]);
    expect(result.uri).toBe('file:///mock-cache/optimized-catch.jpg');
    // Pass-through renders share one ImageRef, released exactly once.
    expect(mockState.released).toBe(1);
  });

  it('fails closed when the source image dimensions are unreadable', async () => {
    mockState.width = 0;

    await expect(optimizeCatchImage('file:///camera-roll/corrupt.jpg')).rejects.toThrow(
      /could not read image dimensions/,
    );
    expect(mockState.saved).toEqual([]);
  });

  it('propagates native render failures to the caller', async () => {
    mockState.failRender = true;

    await expect(optimizeCatchImage('file:///camera-roll/broken.jpg')).rejects.toThrow(
      /render failed/,
    );
    expect(mockState.saved).toEqual([]);
  });
});

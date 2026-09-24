/**
 * Global type declarations for react-native-video-helper.
 * This package ships without TypeScript definitions, so we declare
 * the minimal surface area we consume in videoCompressionPipeline.ts.
 */

interface CompressOptions {
  startTime?: number;
  endTime?: number;
  quality?: 'high' | 'medium' | 'low';
  defaultOrientation?: number;
}

declare module 'react-native-video-helper' {
  const VideoHelper: {
    compress(source: string, options: CompressOptions): Promise<string>;
  };
  export default VideoHelper;
}

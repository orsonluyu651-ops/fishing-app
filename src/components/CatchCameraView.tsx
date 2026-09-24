import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  GestureResponderEvent,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { CameraType, FlashMode, CameraMode } from 'expo-camera';
import { compressFeedVideo } from '../lib/videoCompressionPipeline';

export type CaptureMode = 'photo' | 'video';

export interface CaughtMedia {
  uri: string;
  mode: CaptureMode;
  timestamp: number;
}

export interface CatchCameraViewProps {
  visible: boolean;
  onClose: () => void;
  onCapture: (media: CaughtMedia) => void;
};

export default function CatchCameraView({
  visible,
  onClose,
  onCapture,
}: CatchCameraViewProps) {
    const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [recording, setRecording] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const cameraRef = useRef<CameraView>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible && !permission?.granted) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

    if (!visible) return null;

  if (!permission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Requesting camera permission…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Camera permission denied.</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.permissionButton}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

    const toggleCamera = () => {
    setFacing((prev: CameraType) =>
      prev === 'back' ? 'front' : 'back',
    );
  };

  const toggleFlash = () => {
    setFlash((prev: FlashMode) => {
      if (prev === 'off') return 'on';
      if (prev === 'on') return 'auto';
      return 'off';
    });
  };

    const getFlashLabel = (): string => {
    if (flash === 'off') return 'FLASH: OFF';
    if (flash === 'on') return 'FLASH: ON';
    return 'FLASH: AUTO';
  };

  const takePicture = useCallback(async (): Promise<void> => {
    if (!cameraRef.current) {
      console.warn('[Catch Camera] Camera ref is null — cannot take picture.');
      return;
    }

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        base64: false,
      });

      if (photo?.uri) {
                onCapture({ uri: photo.uri, mode: 'photo', timestamp: Date.now() });
      }
    } catch (error) {
      console.error('[Catch Camera] Photo capture failed:', error);
      Alert.alert('Capture Error', 'Unable to take the photo. Please try again.');
    }
    }, [onCapture]);

  const startRecording = useCallback(async (): Promise<void> => {
    if (!cameraRef.current) {
      console.warn('[Catch Camera] Camera ref is null — cannot record.');
      return;
    }

    setRecording(true);
    
    try {
            const video = await cameraRef.current.recordAsync({
        maxDuration: 60,
      });

      setRecording(false);

      if (video?.uri) {
        
        try {
          const compressed = await compressFeedVideo(video.uri, { quality: 'medium' });
                    onCapture({ uri: compressed.uri, mode: 'video', timestamp: Date.now() });
        } catch (compressError) {
          console.error('[Catch Camera] Compression failed, falling back to original:', compressError);
          onCapture({ uri: video.uri, mode: 'video', timestamp: Date.now() });
        }
      }
    } catch (error) {
      setRecording(false);
      console.error('[Catch Camera] Video recording failed:', error);
      Alert.alert('Recording Error', 'Unable to record video. Please try again.');
    }
  }, [onCapture]);

  const stopRecording = useCallback(async (): Promise<void> => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }

    if (!recording) {
      await takePicture();
      return;
    }

    if (cameraRef.current) {
            cameraRef.current.stopRecording();
    }
    setRecording(false);
  }, [recording, takePicture]);

  const handleCapturePressIn = (): void => {
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      startRecording();
    }, 500);
  };

  const handleCapturePressOut = async (): Promise<void> => {
    await stopRecording();
  };

  const handleCapturePress = async (_event: GestureResponderEvent): Promise<void> => {
    if (Platform.OS === 'web') {
      await takePicture();
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
                facing={facing}
        flash={flash}
        mode={'picture' as CameraMode}
        mute={false}
      />

      {/* ── Top Bar: Flash + Close ── */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={toggleFlash} style={styles.topBarButton}>
          <Text style={styles.topBarText}>{getFlashLabel()}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={styles.topBarButton}>
          <Text style={styles.topBarText}>✕ CLOSE</Text>
        </TouchableOpacity>
      </View>

      {/* ── Bottom Controls ── */}
      <View style={styles.bottomBar}>
        <TouchableOpacity onPress={toggleCamera} style={styles.bottomButton}>
          <Text style={styles.bottomButtonText}>⟲ FLIP</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPressIn={handleCapturePressIn}
          onPressOut={handleCapturePressOut}
          onPress={handleCapturePress}
          style={[
            styles.captureButton,
            recording && styles.captureButtonRecording,
          ]}
          activeOpacity={0.8}
        >
          <View style={styles.captureButtonInner} />
          {recording && <Text style={styles.recordingLabel}>● REC</Text>}
        </TouchableOpacity>

        <View style={styles.bottomButton} />
              <View style={styles.bottomButton} />
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'space-between',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionText: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: '#0284c7',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  topBarButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  topBarText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 40,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    gap: 30,
  },
  bottomButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    width: 80,
    alignItems: 'center',
  },
  bottomButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  captureButtonRecording: {
    backgroundColor: '#ef4444',
    borderColor: '#ffffff',
  },
  captureButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ffffff',
  },
  recordingLabel: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
  },
});
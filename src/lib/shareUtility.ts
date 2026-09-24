import { Alert, Platform } from 'react-native';

// Platform-gated module reference so react-native-share's native binary
// (and its TurboModuleRegistry lookup) is NEVER eagerly imported on web.
// On web this stays `undefined` until the first native-platform call path.
let NativeShare: typeof import('react-native-share')['default'] | undefined;

/** Lazily resolves the native Share module, guarded for web/non-native. */
function getNativeShare() {
  if (typeof NativeShare !== 'undefined') {
    return NativeShare;
  }
  if (Platform.OS === 'web') {
    return undefined;
  }
  try {
    // Dynamic require keeps react-native-share out of the web module graph.
    const ShareModule = require('react-native-share');
    NativeShare = ShareModule && ShareModule.default ? ShareModule.default : ShareModule;
    return NativeShare;
  } catch (e) {
    console.warn('[Share Utility] Native share module unavailable:', e);
    return undefined;
  }
}

interface ShareCatchPayload {
  title: string;
  weight?: string;
  locationName?: string;
  imageUrl?: string;
  shareText?: string; // Optional custom text for privacy-safe exports
}

export const shareCatchLog = async (payload: ShareCatchPayload): Promise<void> => {
  // Use privacy-safe text if provided, otherwise fall back to the legacy message.
  const defaultMessage = `🎣 Caught a massive ${payload.title}${payload.weight ? ` (${payload.weight})` : ''}${payload.locationName ? ` at ${payload.locationName}` : ''}! Tracked via the Fishlore App. 📈`;
  const shareMessage = payload.shareText ?? defaultMessage;

  
  // WEB PLATFORM GUARD: If running inside Safari or Chrome, use browser alert fallbacks
  if (Platform.OS === 'web') {
    alert(`[Web Share Link] ${shareMessage}`);
    return;
  }

  try {
    const NativeShare = getNativeShare();
    if (!NativeShare) {
      console.warn('[Share Utility] Native share unavailable — falling back to alert.');
      Alert.alert('Sharing Unavailable', 'Could not open the system share sheet on this device.');
      return;
    }
    const shareOptions: any = {
      message: shareMessage,
      title: 'Fishlore App Catch Share',
      subject: `New catch: ${payload.title}`,
    };

    // If a local file:// URI is provided, attach it as a file asset
    if (payload.imageUrl && payload.imageUrl.startsWith('file://')) {
      shareOptions.url = payload.imageUrl;
      shareOptions.type = 'image/png';
          } else if (payload.imageUrl && payload.imageUrl.startsWith('http')) {
      // Remote URL — append as a link in the message
      shareOptions.message = `${shareMessage}\n🔗 ${payload.imageUrl}`;
          } else {
    }

    const result = await NativeShare.open(shareOptions);

    if (result) {
          } else {
          }
  } catch (error: any) {
    if (error?.message?.includes('cancelled') || error?.code === 'EA_CANCELLED') {
            return;
    }
    console.error('[Share Utility] Share error:', error);
    Alert.alert('Sharing Unavailable', 'Could not open the system share sheet.');
  }
};

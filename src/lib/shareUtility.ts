import { Share, Alert, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';

interface ShareCatchPayload {
  title: string;
  weight?: string;
  locationName?: string;
  imageUrl?: string;
}

export const shareCatchLog = async (payload: ShareCatchPayload): Promise<void> => {
  const shareMessage = `🎣 Caught a massive ${payload.title}${payload.weight ? ` (${payload.weight})` : ''}${payload.locationName ? ` at ${payload.locationName}` : ''}! Tracked via the Fishlore App. 📈`;

  // WEB PLATFORM GUARD: If running inside Safari or Chrome, use browser alert fallbacks
  if (Platform.OS === 'web') {
    alert(`[Web Share Link] ${shareMessage}`);
    return;
  }

  try {
    // expo-sharing requires local file:// URIs. If it is a web URL, fall back to text sharing automatically.
    if (payload.imageUrl && payload.imageUrl.startsWith('file://') && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(payload.imageUrl, {
        dialogTitle: `Share your ${payload.title}`,
        mimeType: 'image/png',
        UTI: 'public.png',
      });
      return;
    }

    const textPayload = payload.imageUrl && !payload.imageUrl.startsWith('file://')
      ? `${shareMessage}\n📷 View Catch: ${payload.imageUrl}`
      : shareMessage;

    await Share.share({
      message: textPayload,
      title: 'Fishlore App Catch Share',
    });
  } catch (error) {
    Alert.alert('Sharing Unavailable', 'Could not open the system share sheet.');
    console.error('Share error:', error);
  }
};

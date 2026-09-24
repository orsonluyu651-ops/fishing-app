import { Alert, Platform } from 'react-native';
import Share from 'react-native-share';

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

  console.log('[Share Utility] Preparing share sheet for:', payload.title);

  // WEB PLATFORM GUARD: If running inside Safari or Chrome, use browser alert fallbacks
  if (Platform.OS === 'web') {
    alert(`[Web Share Link] ${shareMessage}`);
    return;
  }

  try {
    const shareOptions: any = {
      message: shareMessage,
      title: 'Fishlore App Catch Share',
      subject: `New catch: ${payload.title}`,
    };

    // If a local file:// URI is provided, attach it as a file asset
    if (payload.imageUrl && payload.imageUrl.startsWith('file://')) {
      shareOptions.url = payload.imageUrl;
      shareOptions.type = 'image/png';
      console.log('[Share Utility] Attaching local file asset:', payload.imageUrl);
    } else if (payload.imageUrl && payload.imageUrl.startsWith('http')) {
      // Remote URL — append as a link in the message
      shareOptions.message = `${shareMessage}\n🔗 ${payload.imageUrl}`;
      console.log('[Share Utility] Using remote URL in message:', payload.imageUrl);
    } else {
      console.log('[Share Utility] Text-only share (no media asset).');
    }

    const result = await Share.open(shareOptions);

        if (result) {
      console.log('[Share Utility] Share completed with message:', result.message);
    } else {
      console.log('[Share Utility] Share returned no result.');
    }
  } catch (error: any) {
    if (error?.message?.includes('cancelled') || error?.code === 'EA_CANCELLED') {
      console.log('[Share Utility] Share cancelled by user.');
      return;
    }
    console.error('[Share Utility] Share error:', error);
    Alert.alert('Sharing Unavailable', 'Could not open the system share sheet.');
  }
};

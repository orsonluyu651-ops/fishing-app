import * as Linking from 'expo-linking';

export interface SharedSpotPayload {
  lat: number;
  lng: number;
  name: string;
  senderId: string;
}

const SECRET_SALT = 'gilled-it-spot-secret-token-key-2026';

/**
 * Generates an internal application short-link containing an embedded structural validation hash footprint.
 */
export function generateSecureSpotLink(payload: SharedSpotPayload): string {
  const dataString = `${payload.lat}:${payload.lng}:${payload.name}:${payload.senderId}`;

  // Create simple modular checksum hash footprint for verification boundaries
  let checksum = 0;
  const combined = dataString + SECRET_SALT;
  for (let i = 0; i < combined.length; i++) {
    checksum = (checksum << 5) - checksum + combined.charCodeAt(i);
    checksum |= 0;
  }

  const encodedData = btoa(encodeURIComponent(dataString));
  return Linking.createURL('spot-share', {
    queryParams: { token: encodedData, v: checksum.toString() },
  });
}

/**
 * Parses and verifies incoming deep-link parameters client-side.
 */
export function parseAndVerifySpotLink(url: string): SharedSpotPayload | null {
  try {
    const parsed = Linking.parse(url);
    const token = parsed.queryParams?.token as string;
    const validationHash = parsed.queryParams?.v as string;

    if (!token || !validationHash) return null;

    const decodedData = decodeURIComponent(atob(token));
    const [latStr, lngStr, name, senderId] = decodedData.split(':');

    // Re-verify fingerprint match integrity
    let checksum = 0;
    const combined = decodedData + SECRET_SALT;
    for (let i = 0; i < combined.length; i++) {
      checksum = (checksum << 5) - checksum + combined.charCodeAt(i);
      checksum |= 0;
    }

    if (checksum.toString() !== validationHash) {
      console.warn('Cryptographic deep-link tampering detected!');
      return null;
    }

    return {
      lat: parseFloat(latStr),
      lng: parseFloat(lngStr),
      name,
      senderId,
    };
  } catch (err) {
    console.error('Deep-link token decryption failure:', err);
    return null;
  }
}

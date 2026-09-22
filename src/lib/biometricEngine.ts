import * as LocalAuthentication from 'expo-local-authentication';

export interface BiometricSecurityStatus {
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedTypes: LocalAuthentication.AuthenticationType[];
}

/**
 * Inspects device underlying hardware capabilities and configurations.
 */
export async function getSupportedDeviceBiometrics(): Promise<BiometricSecurityStatus> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

    return { hasHardware, isEnrolled, supportedTypes };
  } catch (err) {
    console.error('Local hardware auditing security failure:', err);
    return { hasHardware: false, isEnrolled: false, supportedTypes: [] };
  }
}

/**
 * Triggers native operating system prompt layout views requesting localized authentication clearance.
 */
export async function authenticateWithBiometrics(reasonMessage: string): Promise<boolean> {
  try {
    const status = await getSupportedDeviceBiometrics();
    if (!status.hasHardware || !status.isEnrolled) return false;

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reasonMessage,
      fallbackLabel: 'Enter Passcode',
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });

    return result.success;
  } catch (err) {
    console.error('Biometric execution handshake crash:', err);
    return false;
  }
}

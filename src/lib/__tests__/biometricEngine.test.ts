import * as LocalAuthentication from 'expo-local-authentication';
import { getSupportedDeviceBiometrics, authenticateWithBiometrics } from '../biometricEngine';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(() => Promise.resolve(true)),
  isEnrolledAsync: jest.fn(() => Promise.resolve(true)),
  supportedAuthenticationTypesAsync: jest.fn(() => Promise.resolve([1])),
  authenticateAsync: jest.fn(() => Promise.resolve({ success: true, type: 'faceId' })),
  AuthenticationType: { FACE_ID: 1, TOUCH_ID: 2, FINGERPRINT: 3, IRIS: 4, BIOOMETRIC: 5 },
}));

describe('Native Hardware Security Verification Matrix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('correctly maps hardware configurations to standard capabilities models', async () => {
    const audit = await getSupportedDeviceBiometrics();
    expect(audit.hasHardware).toBe(true);
    expect(audit.isEnrolled).toBe(true);
    expect(audit.supportedTypes).toContain(1);
  });

  it('resolves logical execution loops smoothly on successful prompt completions', async () => {
    const clearance = await authenticateWithBiometrics('Verify Identity');
    expect(clearance).toBe(true);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalled();
  });

  it('gracefully returns false if device hardware features are entirely missing', async () => {
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValueOnce(false);
    const result = await authenticateWithBiometrics('Verify Identity');
    expect(result).toBe(false);
  });

  it('returns false when biometric enrollment is absent', async () => {
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValueOnce(false);
    const result = await authenticateWithBiometrics('Verify Identity');
    expect(result).toBe(false);
  });

  it('returns false when authentication is explicitly denied', async () => {
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({
      success: false,
      type: 'passcode',
    });
    const result = await authenticateWithBiometrics('Verify Identity');
    expect(result).toBe(false);
  });
});

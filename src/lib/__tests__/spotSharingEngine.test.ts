import { generateSecureSpotLink, parseAndVerifySpotLink } from '../spotSharingEngine';

jest.mock('expo-linking', () => ({
  createURL: jest.fn((path, config) => {
    return `fishingapp://${path}?token=${config.queryParams.token}&v=${config.queryParams.v}`;
  }),
  parse: jest.fn((url) => {
    const urlObj = new URL(url.replace('fishingapp://', 'https://localhost/'));
    return {
      queryParams: {
        token: urlObj.searchParams.get('token'),
        v: urlObj.searchParams.get('v'),
      },
    };
  }),
}));

describe('Cryptographic Spot deep-linking validation networks', () => {
  const sampleSpot = { lat: -28.0167, lng: 153.4000, name: 'Secret Reef Point', senderId: 'u77' };

  it('correctly serializes coordinate strings into verifiable short URL structures', () => {
    const deepLink = generateSecureSpotLink(sampleSpot);
    expect(deepLink).toContain('fishingapp://spot-share');
    expect(deepLink).toContain('token=');
    expect(deepLink).toContain('v=');
  });

  it('successfully decrypts and unpacks untampered coordinate packages', () => {
    const deepLink = generateSecureSpotLink(sampleSpot);
    const decrypted = parseAndVerifySpotLink(deepLink);

    expect(decrypted).not.toBeNull();
    expect(decrypted!.lat).toBe(-28.0167);
    expect(decrypted!.name).toBe('Secret Reef Point');
    expect(decrypted!.senderId).toBe('u77');
    expect(decrypted!.lng).toBe(153.4);
  });

  it('immediately rejects deep links with modified data payloads', () => {
    const deepLink = generateSecureSpotLink(sampleSpot);
    // Introduce deliberate payload tampering to simulate link manipulation attacks
    const tamperedLink = deepLink.replace('token=', 'token=XyZ_');
    const result = parseAndVerifySpotLink(tamperedLink);

    expect(result).toBeNull();
  });

  it('returns null for a malformed base64 token', () => {
    const fakeUrl = 'fishingapp://spot-share?token=NOT_BASE64!&v=123';
    const result = parseAndVerifySpotLink(fakeUrl);
    expect(result).toBeNull();
  });

  it('returns null when the validation hash is missing', () => {
    const fakeUrl = 'fishingapp://spot-share?token=abc';
    const result = parseAndVerifySpotLink(fakeUrl);
    expect(result).toBeNull();
  });
});

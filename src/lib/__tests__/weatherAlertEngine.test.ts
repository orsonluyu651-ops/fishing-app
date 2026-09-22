import { auditSpotSafetyConditions } from '../weatherAlertEngine';

declare const global: typeof globalThis;

let mockFetch: jest.SpyInstance;

describe('Weather Alert Warning Threshold Engine', () => {
  const mockSafeSpot = { user_id: 'u1', name: 'Calm River Delta', latitude: -28.0, longitude: 153.4 };

  beforeEach(() => {
    mockFetch = jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            current: { wind_speed_10m: 0 },
            hourly: { wave_height: [0] },
          }),
        ok: true,
        status: 200,
      } as Response)
    );
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  it('correctly reports safe conditions when metrics fall below hazard boundaries', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            current: { wind_speed_10m: 12.5 },
            hourly: { wave_height: [0.4] },
          }),
        ok: true,
        status: 200,
      } as Response)
    );

    const check = await auditSpotSafetyConditions(mockSafeSpot);
    expect(check.isSevere).toBe(false);
    expect(check.warningMessage).toBeNull();
    expect(check.windSpeed).toBe(12.5);
    expect(check.waveHeight).toBe(0.4);
  });

  it('successfully triggers severe hazard warnings during wind spikes', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            current: { wind_speed_10m: 52.0 }, // Exceeds 46 km/h safety wall
            hourly: { wave_height: [1.1] },
          }),
        ok: true,
        status: 200,
      } as Response)
    );

    const check = await auditSpotSafetyConditions(mockSafeSpot);
    expect(check.isSevere).toBe(true);
    expect(check.warningMessage).toContain('Hazardous marine environment');
    expect(check.windSpeed).toBe(52.0);
  });

  it('triggers severe warning when wave height exceeds the 2.5 m threshold', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            current: { wind_speed_10m: 10.0 },
            hourly: { wave_height: [3.2] },
          }),
        ok: true,
        status: 200,
      } as Response)
    );

    const check = await auditSpotSafetyConditions(mockSafeSpot);
    expect(check.isSevere).toBe(true);
    expect(check.waveHeight).toBe(3.2);
    expect(check.warningMessage).not.toBeNull();
  });

  it('returns safe defaults when the weather API call throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network failure'));

    const check = await auditSpotSafetyConditions(mockSafeSpot);
    expect(check.isSevere).toBe(false);
    expect(check.warningMessage).toBeNull();
    expect(check.windSpeed).toBe(0);
    expect(check.waveHeight).toBe(0);
  });

  it('returns safe defaults when the API response lacks expected fields', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        json: () => Promise.resolve({}),
        ok: true,
        status: 200,
      } as Response)
    );

    const check = await auditSpotSafetyConditions(mockSafeSpot);
    expect(check.isSevere).toBe(false);
    expect(check.warningMessage).toBeNull();
  });
});

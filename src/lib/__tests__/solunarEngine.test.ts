import { calculateSolunarWindows, fetchMarineTelemetry, generateSolunarForecast } from '../solunarEngine';

declare const global: typeof globalThis;

let mockFetch: jest.SpyInstance;

describe('Solunar and Marine Calculation Matrices', () => {
  beforeEach(() => {
    mockFetch = jest.spyOn(global, 'fetch').mockReturnValue(
      Promise.resolve({
        json: () =>
          Promise.resolve({
            current: { wave_height: 1.2, wave_period: 8.5, sea_surface_temperature: 21.4 },
          }),
        ok: true,
        status: 200,
      } as Response)
    );
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  it('correctly maps mock data array items to interface elements', async () => {
    const data = await fetchMarineTelemetry(-28.0, 153.4);
    expect(data).not.toBeNull();
    expect(data!.waveHeight).toBe(1.2);
    expect(data!.waterTemp).toBe(21.4);
    expect(data!.wavePeriod).toBe(8.5);
  });

  it('returns null when the marine API call throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network failure'));

    const data = await fetchMarineTelemetry(-28.0, 153.4);
    expect(data).toBeNull();
  });

  it('bounds dynamic feeding indexes between safe structural limits', () => {
    const calculation = calculateSolunarWindows(new Date(), -28.0, 153.4);
    expect(calculation.feedingScore).toBeGreaterThanOrEqual(10);
    expect(calculation.feedingScore).toBeLessThanOrEqual(100);
  });

  it('returns deterministic solunar windows with consistent time ranges', () => {
    const calc1 = calculateSolunarWindows(new Date('2024-06-15'), 0, 0);
    const calc2 = calculateSolunarWindows(new Date('2024-06-15'), 0, 0);
    expect(calc1.feedingScore).toBe(calc2.feedingScore);
    expect(calc1.majorStart).toBe('05:30 AM');
    expect(calc1.majorEnd).toBe('07:30 AM');
    expect(calc1.minorStart).toBe('11:15 AM');
    expect(calc1.minorEnd).toBe('12:15 PM');
  });

  it('clamps extremely high solunar scores to the 100 ceiling', () => {
    const calculation = calculateSolunarWindows(new Date(2024, 0, 1), 0, 0);
    expect(calculation.feedingScore).toBeLessThanOrEqual(100);
    expect(calculation.feedingScore).toBeGreaterThanOrEqual(10);
  });
});

describe('generateSolunarForecast (offline trig engine)', () => {
  it('resolves a full moon with ~100% illumination on 2024-01-25', async () => {
    const forecast = await generateSolunarForecast(-28.0, 153.4, new Date('2024-01-25T12:00:00Z'));
    expect(forecast.lunarPhase).toBe('Full Moon');
    expect(forecast.illuminationPercentage).toBeGreaterThanOrEqual(90);
  });

  it('resolves a new moon with ~0% illumination on 2024-01-11', async () => {
    const forecast = await generateSolunarForecast(-28.0, 153.4, new Date('2024-01-11T12:00:00Z'));
    expect(forecast.lunarPhase).toBe('New Moon');
    expect(forecast.illuminationPercentage).toBeLessThanOrEqual(10);
  });

  it('emits two 2h majors and two 1h minors with a valid rating', async () => {
    const forecast = await generateSolunarForecast(-28.0, 153.4, new Date('2024-06-15T00:00:00Z'));
    expect(forecast.majorStrikeWindows).toHaveLength(2);
    expect(forecast.minorStrikeWindows).toHaveLength(2);
    for (const w of forecast.majorStrikeWindows) {
      const spanHrs = (Date.parse(w.end) - Date.parse(w.start)) / 3_600_000;
      expect(spanHrs).toBeCloseTo(2, 5);
    }
    for (const w of forecast.minorStrikeWindows) {
      const spanHrs = (Date.parse(w.end) - Date.parse(w.start)) / 3_600_000;
      expect(spanHrs).toBeCloseTo(1, 5);
    }
    expect(['POOR', 'FAIR', 'GOOD', 'EXCELLENT']).toContain(forecast.overallActivityRating);
  });

  it('shifts lunar transit with observer longitude', async () => {
    const east = await generateSolunarForecast(0, 150, new Date('2024-06-15T00:00:00Z'));
    const west = await generateSolunarForecast(0, -150, new Date('2024-06-15T00:00:00Z'));
    expect(east.majorStrikeWindows[0]!.start).not.toBe(west.majorStrikeWindows[0]!.start);
  });

  it('never throws on invalid coordinates or null dates', async () => {
    const forecast = await generateSolunarForecast(
      NaN,
      Number.POSITIVE_INFINITY,
      null as unknown as Date,
    );
    expect(forecast.illuminationPercentage).toBeGreaterThanOrEqual(0);
    expect(forecast.illuminationPercentage).toBeLessThanOrEqual(100);
    expect(forecast.majorStrikeWindows).toHaveLength(2);
    expect(forecast.minorStrikeWindows).toHaveLength(2);
  });
});


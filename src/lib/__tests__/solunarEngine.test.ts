import {
  buildSolunarDayForecast,
  calculateSolunarWindows,
  computeLunarTransitOffsets,
  fetchMarineTelemetry,
  generateSolunarForecast,
  getSynodicMoonState,
  SYNODIC_MONTH,
} from '../solunarEngine';

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

describe('Phase 3 synodic tracker, transit engine & day windows', () => {
  it('tracks exact lunar illumination and phase for epoch timestamps', () => {
    const full = getSynodicMoonState(new Date('2024-01-25T12:00:00Z'));
    expect(full.phaseName).toBe('Full Moon');
    expect(full.illumination).toBeGreaterThanOrEqual(90);
    // ~6 h BEFORE exact full (17:54Z) — the disk is still physically growing.
    expect(full.waxing).toBe(true);
    expect(full.ageDays).toBeGreaterThanOrEqual(0);
    expect(full.ageDays).toBeLessThan(SYNODIC_MONTH);
    expect(full.phaseFraction).toBeGreaterThanOrEqual(0);
    expect(full.phaseFraction).toBeLessThan(1);

    // A day later the disk is definitively past full and shrinking.
    const pastFull = getSynodicMoonState(new Date('2024-01-26T12:00:00Z'));
    expect(pastFull.waxing).toBe(false);
    expect(pastFull.illumination).toBeGreaterThanOrEqual(85);

    const newMoon = getSynodicMoonState(new Date('2024-01-11T12:00:00Z'));
    expect(newMoon.phaseName).toBe('New Moon');
    expect(newMoon.illumination).toBeLessThanOrEqual(10);
    expect(newMoon.waxing).toBe(true);
  });

  it('accepts raw epoch milliseconds identically to Date instances', () => {
    const fromMs = getSynodicMoonState(Date.UTC(2024, 0, 25, 12));
    const fromDate = getSynodicMoonState(new Date('2024-01-25T12:00:00Z'));
    expect(fromMs).toEqual(fromDate);
  });

  it('never throws on invalid tracker input', () => {
    expect(() => getSynodicMoonState(Number.NaN)).not.toThrow();
    expect(() => getSynodicMoonState(new Date('not-a-date'))).not.toThrow();
    const state = getSynodicMoonState(Number.NaN);
    expect(state.illumination).toBeGreaterThanOrEqual(0);
    expect(state.illumination).toBeLessThanOrEqual(100);
  });

  it('shifts transits with longitude and keeps offsets in [0, 24)', () => {
    const east = computeLunarTransitOffsets(new Date('2024-06-15T00:00:00Z'), 150);
    const west = computeLunarTransitOffsets(new Date('2024-06-15T00:00:00Z'), -150);
    expect(east.upperTransitUTC).not.toBe(west.upperTransitUTC);
    for (const offsets of [east, west]) {
      const values = [
        offsets.upperTransitUTC,
        offsets.lowerTransitUTC,
        offsets.moonriseUTC,
        offsets.moonsetUTC,
      ];
      for (const value of values) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(24);
        expect(Number.isFinite(value)).toBe(true);
      }
      // Lower transit sits half a lunar day (24.8412 / 2 h) after the upper.
      expect(offsets.lowerTransitUTC).toBeCloseTo((offsets.upperTransitUTC + 12.4206) % 24, 9);
    }
  });

  it('falls back safely on invalid transit inputs', () => {
    const offsets = computeLunarTransitOffsets(new Date('not-a-date'), Number.NaN);
    for (const value of Object.values(offsets)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('builds structured day forecasts with 2h majors and 1h minors', () => {
    const day = buildSolunarDayForecast(-28.0, 153.4, new Date('2024-06-15T00:00:00Z'));
    expect(day.date).toBe('2024-06-15T00:00:00.000Z');
    expect(day.majorWindows).toHaveLength(2);
    expect(day.minorWindows).toHaveLength(2);
    for (const w of day.majorWindows) {
      expect((Date.parse(w.end) - Date.parse(w.start)) / 3_600_000).toBeCloseTo(2, 5);
    }
    for (const w of day.minorWindows) {
      expect((Date.parse(w.end) - Date.parse(w.start)) / 3_600_000).toBeCloseTo(1, 5);
    }
    expect(day.feedingIndex).toBeGreaterThanOrEqual(10);
    expect(day.feedingIndex).toBeLessThanOrEqual(100);
    expect(['POOR', 'FAIR', 'GOOD', 'EXCELLENT']).toContain(day.rating);
    expect(day.latitudeFallbackApplied).toBe(false);
  });

  it('applies fallback parameters at extreme high/low latitudes without throwing', () => {
    for (const lat of [90, -90, 80, -80, Number.NaN]) {
      const day = buildSolunarDayForecast(lat, 153.4, new Date('2024-06-15T00:00:00Z'));
      expect(day.majorWindows).toHaveLength(2);
      expect(day.minorWindows).toHaveLength(2);
      for (const w of [...day.majorWindows, ...day.minorWindows]) {
        expect(Number.isFinite(Date.parse(w.start))).toBe(true);
        expect(Number.isFinite(Date.parse(w.end))).toBe(true);
      }
    }
    expect(
      buildSolunarDayForecast(80, 153.4, new Date('2024-06-15T00:00:00Z')).latitudeFallbackApplied,
    ).toBe(true);
    expect(
      buildSolunarDayForecast(-80, 153.4, new Date('2024-06-15T00:00:00Z')).latitudeFallbackApplied,
    ).toBe(true);
    expect(
      buildSolunarDayForecast(66, 153.4, new Date('2024-06-15T00:00:00Z')).latitudeFallbackApplied,
    ).toBe(false);
  });
});


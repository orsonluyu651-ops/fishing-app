import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// ── Coordinate + Date Types ─────────────────────────────────────────────────
export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type TideEntry = {
  time: Date;
  height: number; // metres
  type: 'high' | 'low';
};

export type FeedingWindow = {
  type: 'major' | 'minor';
  start: Date;
  end: Date;
  label: string;
};

export type SolunarDay = {
  date: Date;
  coordinates: Coordinates;
  moonPhase: number; // 0.0 → 1.0
  activityIndex: number; // 0–100
  rating: 'POOR' | 'AVERAGE' | 'GOOD' | 'PEAK BITING WINDOW';
  majorWindows: FeedingWindow[];
  minorWindows: FeedingWindow[];
  tides: TideEntry[];
};

// Default Gold Coast Seaway coordinates
const DEFAULT_COORDINATES: Coordinates = {
  latitude: -27.9625,
  longitude: 153.4264,
};

// Synodic month period in milliseconds (29.530588 days)
const SYNODIC_MONTH_MS = 29.530588 * 24 * 60 * 60 * 1000;

/**
 * Calculate the moon phase (0–1) for a given date.
 * Based on a known new moon epoch reference.
 */
const calculateMoonPhase = (date: Date): number => {
  // Known new moon reference: 2000-01-06 18:14 UTC
  const newMoonEpoch = Date.UTC(2000, 0, 6, 18, 14, 0);
  const elapsed = date.getTime() - newMoonEpoch;
  // Normalize into a 0–1 cycle
  let phase = (elapsed % SYNODIC_MONTH_MS) / SYNODIC_MONTH_MS;
  if (phase < 0) phase += 1;
  return phase;
};

/**
 * Compute a simulated Activity Index (0–100) based on moon phase.
 * Peak activity occurs around full moon and new moon transitions.
 */
export const calculateActivityIndex = (moonPhase: number): number => {
  // Map moon phase to a 0–360 degree position
  const degrees = moonPhase * 360;
  // Activity peaks at 0° (new) and 180° (full), dips at 90° (first quarter) and 270° (last quarter)
  const rad = (degrees - 180) * (Math.PI / 180);
  // Use cosine wave: peaks at 0 and 180°
  const raw = Math.cos(rad);
  // Normalize to 0–100 range
  return Math.round(((raw + 1) / 2) * 100);
};

/**
 * Convenience: get the solunar rating string for a given Date directly.
 * Defaults to Gold Coast coordinates.
 */
export const getSolunarRatingForDate = (date: Date = new Date()): 'POOR' | 'AVERAGE' | 'GOOD' | 'PEAK BITING WINDOW' => {
  const phase = calculateMoonPhase(date);
  const index = calculateActivityIndex(phase);
  if (index >= 80) return 'PEAK BITING WINDOW';
  if (index >= 60) return 'GOOD';
  if (index >= 40) return 'AVERAGE';
  return 'POOR';
};

/**
 * Simulated Major Feeding Windows: 2-hour duration centered around lunar transit.
 * Two windows per day — one near lunar transit, one near under-foot (opposite).
 */
const calculateMajorWindows = (baseDate: Date): FeedingWindow[] => {
  const startOfDay = new Date(baseDate);
  startOfDay.setHours(0, 0, 0, 0);

  // Simulated lunar transit times (~12h40m apart, varying by day)
  const transitHour = 8 + Math.sin(baseDate.getDate()) * 1.5; // varies ±1h30m
  const underFootHour = transitHour + 12.67; // ~12h 40min later

  const makeWindow = (centerHour: number, label: string): FeedingWindow => {
    const start = new Date(startOfDay);
    start.setHours(Math.floor(centerHour) - 1, Math.floor((centerHour % 1) * 60), 0, 0);
    const end = new Date(start);
    end.setTime(start.getTime() + 2 * 60 * 60 * 1000); // 2 hours
    return { type: 'major', start, end, label };
  };

  return [
    makeWindow(transitHour, 'Lunar Transit'),
    makeWindow(underFootHour, 'Under-foot'),
  ];
};

/**
 * Simulated Minor Feeding Windows: 1-hour duration centered around moonrise/moonset.
 * Two windows per day.
 */
const calculateMinorWindows = (baseDate: Date): FeedingWindow[] => {
  const startOfDay = new Date(baseDate);
  startOfDay.setHours(0, 0, 0, 0);

  // Simulated moonrise/moonset times (~12h 50min apart with daily drift)
  const moonriseHour = 5 + Math.cos(baseDate.getDate() * 0.5) * 1.4;
  const moonsetHour = moonriseHour + 12.8;

  const makeWindow = (centerHour: number, label: string): FeedingWindow => {
    const start = new Date(startOfDay);
    start.setHours(Math.floor(centerHour) - 0.5, Math.floor((centerHour % 1) * 60), 0, 0);
    const end = new Date(start);
    end.setTime(start.getTime() + 1 * 60 * 60 * 1000); // 1 hour
    return { type: 'minor', start, end, label };
  };

  return [
    makeWindow(moonriseHour, 'Moonrise'),
    makeWindow(moonsetHour, 'Moonset'),
  ];
};

/**
 * Simulated tidal pattern using a simple sinusoidal model.
 * Two high tides and two low tides per ~12h 25m tidal cycle.
 */
const calculateTides = (baseDate: Date, coordinates: Coordinates): TideEntry[] => {
  const startOfDay = new Date(baseDate);
  startOfDay.setHours(0, 0, 0, 0);

  // Gold Coast has a mixed, mainly diurnal tide — simulate semi-diurnal with phase shift
  const tidalPeriod = 12.42; // hours per tidal half-cycle
  const baseHeight = 1.8;     // mean water level in metres (Gold Coast approx)
  const tideAmp = 0.8;        // amplitude in metres
  const phaseShift = (coordinates.latitude * 0.01) % (2 * Math.PI);

  const tides: TideEntry[] = [];
  // Sample at ~3h intervals across the day for smooth curve
  for (let hour = 0; hour <= 24; hour += 3) {
    const t = hour;
    const radians = (t / tidalPeriod) * 2 * Math.PI + phaseShift;
    const height = baseHeight + tideAmp * Math.sin(radians);

    if (hour === 0) continue;
    const prevT = hour - 3;
    const prevRad = (prevT / tidalPeriod) * 2 * Math.PI + phaseShift;
    const prevHeight = baseHeight + tideAmp * Math.sin(prevRad);

    const isHigh = height > prevHeight;
    const midTime = new Date(startOfDay);
    midTime.setHours(hour - 1, 30, 0, 0);

    tides.push({
      time: midTime,
      height: Math.round(height * 100) / 100,
      type: isHigh ? 'high' : 'low',
    });
  }

  // Take the first 4 entries (2 highs + 2 lows for a semi-diurnal day)
  return tides.slice(0, 4);
};

/**
 * Main calculation function — pure computation, no React rendering.
 */
export const calculateSolunarDay = (
  date: Date = new Date(),
  coordinates: Coordinates = DEFAULT_COORDINATES,
): SolunarDay => {
  const moonPhase = calculateMoonPhase(date);
  const activityIndex = calculateActivityIndex(moonPhase);

  return {
    date: new Date(date),
    coordinates,
    moonPhase,
    activityIndex,
      rating: getSolunarRatingForDate(date),
    majorWindows: calculateMajorWindows(date),
    minorWindows: calculateMinorWindows(date),
        tides: calculateTides(date, coordinates),
  };
};

// ── Time formatting helper ──────────────────────────────────────────────────
const formatTime = (d: Date): string =>
  d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true });

// ── Moon phase icon based on phase value ─────────────────────────────────────
const getMoonIcon = (phase: number): string => {
  if (phase < 0.125 || phase >= 0.875) return '🌑'; // New Moon
  if (phase < 0.375) return '🌒'; // Waxing Crescent
  if (phase < 0.625) return '🌕'; // Full Moon
  if (phase < 0.875) return '🌗'; // Waning Gibbous
    return '🌑';
};

// ── Main Presentation Component ─────────────────────────────────────────────
export type SolunarForecasterProps = {
  date?: Date;
  coordinates?: Coordinates;
};

export default function SolunarForecaster({
  date = new Date(),
  coordinates = DEFAULT_COORDINATES,
}: SolunarForecasterProps) {
  const solunar = calculateSolunarDay(date, coordinates);

  return (
    <View style={styles.container}>
      {/* Header row: moon icon + activity index */}
      <View style={styles.header}>
        <Text style={styles.moonIcon}>{getMoonIcon(solunar.moonPhase)}</Text>
        <View style={styles.activityBlock}>
          <Text style={styles.activityValue}>{solunar.activityIndex}%</Text>
          <Text
            style={[
              styles.activityRating,
              solunar.activityIndex >= 80 && styles.ratingPeak,
              solunar.activityIndex >= 60 && solunar.activityIndex < 80 && styles.ratingGood,
              solunar.activityIndex >= 40 && solunar.activityIndex < 60 && styles.ratingAvg,
              solunar.activityIndex < 40 && styles.ratingPoor,
            ]}
          >
            {solunar.rating}
          </Text>
        </View>
      </View>

      {/* Major feeding windows (2-hour) */}
      <View style={styles.windowSection}>
        <Text style={styles.sectionTitle}>🔥 Major Feeding Windows</Text>
        {solunar.majorWindows.map((w, i) => (
          <View key={`major-${i}`} style={styles.windowRow}>
            <Text style={styles.windowDot}>●</Text>
            <Text style={styles.windowTime}>{formatTime(w.start)}–{formatTime(w.end)}</Text>
            <Text style={styles.windowLabel}>{w.label}</Text>
          </View>
        ))}
      </View>

      {/* Minor feeding windows (1-hour) */}
      <View style={styles.windowSection}>
        <Text style={styles.sectionTitle}>🌙 Minor Feeding Windows</Text>
        {solunar.minorWindows.map((w, i) => (
          <View key={`minor-${i}`} style={styles.windowRow}>
            <Text style={styles.windowDot}>○</Text>
            <Text style={styles.windowTime}>{formatTime(w.start)}–{formatTime(w.end)}</Text>
            <Text style={styles.windowLabel}>{w.label}</Text>
          </View>
        ))}
      </View>

      {/* Tide table (sinusoidal rhythm vector) */}
      <View style={styles.windowSection}>
        <Text style={styles.sectionTitle}>🌊 Tidal Coefficients</Text>
        {solunar.tides.map((t, i) => (
          <View key={`tide-${i}`} style={styles.windowRow}>
            <Text style={styles.windowDot}>{t.type === 'high' ? '▲' : '▼'}</Text>
            <Text style={styles.windowTime}>{formatTime(t.time)}</Text>
            <Text style={styles.windowLabel}>
              {t.type.toUpperCase()} • {t.height}m
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 16,
    marginVertical: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  moonIcon: {
    fontSize: 40,
  },
  activityBlock: {
    alignItems: 'flex-end',
  },
  activityValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffffff',
  },
  activityRating: {
    fontSize: 13,
    fontWeight: '600',
    color: '#cbd5e1',
  },
  ratingPeak: { color: '#10b981' },
  ratingGood: { color: '#38bdf8' },
  ratingAvg: { color: '#fbbf24' },
  ratingPoor: { color: '#ef4444' },
  windowSection: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
  },
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  windowDot: {
    fontSize: 16,
    color: '#0284c7',
    minWidth: 20,
  },
  windowTime: {
    fontSize: 14,
    color: '#cbd5e1',
    flex: 1,
  },
  windowLabel: {
    fontSize: 12,
    color: '#94a3b8',
  },
});




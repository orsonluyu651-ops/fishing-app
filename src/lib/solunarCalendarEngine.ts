import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Coordinates, SolunarDay, calculateSolunarDay } from '../components/SolunarForecaster';
import { runMigrations } from './databaseMigrations';

/**
 * 30-Day Offshore Forecasting Calendar
 * Centralizes offline solunar + moon phase forecasting with dual-tier caching:
 *   1. SQLite (fishlore_offline.db) — deep-offline via migration v6 tables
 *   2. AsyncStorage — web/lighter fallback cache
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalendarForecastEntry {
  date: number;           // Unix timestamp (midnight UTC of target date)
  isoDate: string;         // e.g. "2025-07-15"
  moonPhase: number;       // 0.0 → 1.0
  activityIndex: number;   // 0–100
  rating: 'POOR' | 'AVERAGE' | 'GOOD' | 'PEAK BITING WINDOW';
  moonIcon: string;        // Unicode moon phase icon
  majorWindowCount: number;
  minorWindowCount: number;
  peakStartTime?: string;   // First major window start time, if high activity
  coordinates: {
    latitude: number;
    longitude: number;
  };
}

export interface CalendarCacheMetadata {
  coordinateKey: string;
  generatedAt: number;
  forecastRange: [number, number];
  totalDays: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CALENDAR_DAYS = 30;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const CALENDAR_CACHE_KEY = 'solunar_calendar_30day_cache';
export const CALENDAR_META_KEY = 'solunar_calendar_30day_meta';

const DEFAULT_COORDINATES: Coordinates = {
  latitude: -27.9625,
  longitude: 153.4264,
};

// ── Moon Phase Icons ─────────────────────────────────────────────────────────

export const getMoonIcon = (phase: number): string => {
  if (phase < 0.0625 || phase >= 0.9375) return '🌑'; // New Moon
  if (phase < 0.1875) return '🌒';                    // Waxing Crescent
  if (phase < 0.3125) return '🌓';                    // First Quarter
  if (phase < 0.4375) return '🌔';                    // Waxing Gibbous
  if (phase < 0.5625) return '🌕';                    // Full Moon
  if (phase < 0.6875) return '🌖';                    // Waning Gibbous
  if (phase < 0.8125) return '🌗';                    // Last Quarter
  if (phase < 0.9375) return '🌘';                    // Waning Crescent
  return '🌑';
};

// ── Coordinate Key Generation ─────────────────────────────────────────────────

function coordinateKey(coords: Coordinates): string {
  return `${coords.latitude.toFixed(4)}_${coords.longitude.toFixed(4)}`;
}

// ── SQLite Database Handle ────────────────────────────────────────────────────

let calendarDd: any = null;

async function getCalendarDb(): Promise<any> {
  if (Platform.OS === 'web') return null;
  if (!calendarDd) {
    calendarDd = await SQLite.openDatabaseAsync('fishlore_offline.db');
    await calendarDd.execAsync(`PRAGMA journal_mode = WAL;`);
    await runMigrations(calendarDd, 'fishlore_offline.db');
  }
    return calendarDd;
}

// ── SQLite Persistence ────────────────────────────────────────────────────────

/**
 * Persists a 30-day forecast to SQLite for deep-offline access.
 */
export async function persistCalendarToSqlite(
  entries: CalendarForecastEntry[],
  coords: Coordinates,
): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  try {
    const db = await getCalendarDb();
    if (!db) return false;

    await db.withTransactionAsync(async () => {
      // Clear existing cache for these coordinates
      await db.runAsync(
        `DELETE FROM solunar_calendar_cache WHERE latitude = ? AND longitude = ?;`,
        [coords.latitude, coords.longitude],
      );

      // Batch insert all 30 days
      for (const entry of entries) {
        await db.runAsync(
          `INSERT INTO solunar_calendar_cache (
            iso_date, date_unix, moon_phase, activity_index, rating,
            moon_icon, major_count, minor_count, peak_time,
            latitude, longitude, generated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            entry.isoDate,
            entry.date,
            entry.moonPhase,
            entry.activityIndex,
            entry.rating,
            entry.moonIcon,
            entry.majorWindowCount,
            entry.minorWindowCount,
            entry.peakStartTime ?? null,
            coords.latitude,
            coords.longitude,
            Date.now(),
          ],
        );
      }
    });

    console.log(`[Solunar Calendar] SQLite cache written: ${entries.length} entries for (${coords.latitude}, ${coords.longitude})`);
    return true;
  } catch (error) {
    console.error('[Solunar Calendar] SQLite cache write failed:', error);
    return false;
  }
}

/**
 * Reads cached 30-day forecast from SQLite for given coordinates.
 * Returns null if cache miss, expired, or error.
 */
export async function loadCalendarFromSqlite(
  coords: Coordinates,
): Promise<CalendarForecastEntry[] | null> {
  if (Platform.OS === 'web') return null;

  try {
    const db = await getCalendarDb();
    if (!db) return null;

    const now = Date.now();
    const cutoff = now - CACHE_TTL_MS;

    const rows = await db.getAllAsync(
      `SELECT * FROM solunar_calendar_cache
       WHERE latitude = ? AND longitude = ?
       AND generated_at >= ?
       ORDER BY date_unix ASC;`,
      [coords.latitude, coords.longitude, cutoff],
    );

    if (!rows || rows.length === 0) {
      console.log('[Solunar Calendar] SQLite cache miss — need to regenerate.');
      return null;
    }

    const entries: CalendarForecastEntry[] = rows.map((row: any) => ({
      date: row.date_unix,
      isoDate: row.iso_date,
      moonPhase: row.moon_phase,
      activityIndex: row.activity_index,
      rating: row.rating as CalendarForecastEntry['rating'],
      moonIcon: row.moon_icon,
      majorWindowCount: row.major_count,
      minorWindowCount: row.minor_count,
      peakStartTime: row.peak_time ?? undefined,
      coordinates: {
        latitude: row.latitude,
        longitude: row.longitude,
      },
    }));

        console.log(`[Solunar Calendar] SQLite cache hit: ${entries.length} entries restored.`);
    return entries;
  } catch (error) {
    console.error('[Solunar Calendar] SQLite cache read failed:', error);
    return null;
  }
}

/**
 * Persists entries to AsyncStorage as a fallback cache.
 */
export async function persistToAsyncStorage(
  entries: CalendarForecastEntry[],
  coords: Coordinates,
): Promise<void> {
  try {
    const key = `${CALENDAR_CACHE_KEY}_${coordinateKey(coords)}`;
    const payload = {
      entries,
      meta: {
        coordinateKey: coordinateKey(coords),
        generatedAt: Date.now(),
        forecastRange: [entries[0]?.date, entries[entries.length - 1]?.date] as [number, number],
        totalDays: entries.length,
      } as CalendarCacheMetadata,
    };
    await AsyncStorage.setItem(key, JSON.stringify(payload));
    console.log(`[Solunar Calendar] AsyncStorage cache written: ${entries.length} days`);
  } catch (error) {
    console.error('[Solunar Calendar] AsyncStorage cache write failed:', error);
  }
}

/**
 * Loads entries from AsyncStorage fallback cache.
 */
export async function loadFromAsyncStorage(
  coords: Coordinates,
): Promise<CalendarForecastEntry[] | null> {
  try {
    const key = `${CALENDAR_CACHE_KEY}_${coordinateKey(coords)}`;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;

    const { entries, meta } = JSON.parse(raw) as {
      entries: CalendarForecastEntry[];
      meta: CalendarCacheMetadata;
    };

    if (Date.now() - meta.generatedAt > CACHE_TTL_MS) {
      console.log('[Solunar Calendar] AsyncStorage cache expired.');
      return null;
    }

    console.log(`[Solunar Calendar] AsyncStorage cache hit: ${entries.length} days.`);
    return entries;
  } catch (error) {
    console.error('[Solunar Calendar] AsyncStorage cache read failed:', error);
    return null;
  }
}

/** Clear all calendar caches. */
export async function clearCalendarCache(coords?: Coordinates): Promise<void> {
  if (coords) {
    const key = `${CALENDAR_CACHE_KEY}_${coordinateKey(coords)}`;
    await AsyncStorage.removeItem(key);
  } else {
    const keys = await AsyncStorage.getAllKeys();
    const calendarKeys = keys.filter((k) => k.startsWith(CALENDAR_CACHE_KEY));
    await AsyncStorage.multiRemove(calendarKeys);
  }

  if (Platform.OS !== 'web') {
    try {
      const db = await getCalendarDb();
      if (db) {
        if (coords) {
          await db.runAsync(
            `DELETE FROM solunar_calendar_cache WHERE latitude = ? AND longitude = ?;`,
            [coords.latitude, coords.longitude],
          );
        } else {
          await db.runAsync(`DELETE FROM solunar_calendar_cache;`);
        }
      }
    } catch (error) {
      console.error('[Solunar Calendar] SQLite cache clear failed:', error);
    }
  }

    console.log('[Solunar Calendar] All caches cleared.');
}

// ── Core Engine: 30-Day Forecast Generation ───────────────────────────────────

/** Format a Date to a human-readable time string (e.g. "06:30 AM"). */
function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/**
 * Pure compute loop — generates 30 days of solunar forecast entries
 * based on the supplied coordinates. Returns a scannable summary optimized
 * for UI display.
 */
export function generate30DayForecast(
  coordinates: Coordinates = DEFAULT_COORDINATES,
  startDate: Date = new Date(),
): CalendarForecastEntry[] {
  const entries: CalendarForecastEntry[] = [];

  for (let i = 0; i < CALENDAR_DAYS; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    date.setHours(12, 0, 0, 0); // Noon to avoid DST edge effects

    const solunar: SolunarDay = calculateSolunarDay(date, coordinates);

    // Find the first peak window start time if the day is high value
    let peakStartTime: string | undefined;
    if (solunar.rating === 'PEAK BITING WINDOW' || solunar.activityIndex >= 80) {
      peakStartTime = solunar.majorWindows[0]?.start
        ? formatTime(solunar.majorWindows[0].start)
        : undefined;
    }

    const isoDate = date.toISOString().split('T')[0];
    const entry: CalendarForecastEntry = {
      date: date.getTime(),
      isoDate,
      moonPhase: solunar.moonPhase,
      activityIndex: solunar.activityIndex,
      rating: solunar.rating,
      moonIcon: getMoonIcon(solunar.moonPhase),
      majorWindowCount: solunar.majorWindows.length,
      minorWindowCount: solunar.minorWindows.length,
      peakStartTime,
      coordinates: {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      },
    };

    entries.push(entry);
  }

  console.log(
    `[Solunar Calendar] Generated ${entries.length}-day forecast for (${coordinates.latitude}, ${coordinates.longitude}).`,
  );

  return entries;
}

/**
 * High-level entry point: returns cached forecast if valid, otherwise
 * generates, caches, and returns fresh data.
 */
export async function getOrCreateCalendar(
  coordinates: Coordinates = DEFAULT_COORDINATES,
): Promise<CalendarForecastEntry[]> {
  // Try SQLite first (deep offline)
  const sqliteCache = await loadCalendarFromSqlite(coordinates);
  if (sqliteCache) return sqliteCache;

  // Try AsyncStorage fallback (web / lighter cache)
  const asyncCache = await loadFromAsyncStorage(coordinates);
  if (asyncCache) return asyncCache;

  // Cache miss — generate fresh
  console.log('[Solunar Calendar] Cache miss — computing 30-day forecast...');
  const entries = generate30DayForecast(coordinates);

  // Persist to both (best effort)
  const sqliteOk = await persistCalendarToSqlite(entries, coordinates);
  if (!sqliteOk) {
    await persistToAsyncStorage(entries, coordinates);
  }

  return entries;
}

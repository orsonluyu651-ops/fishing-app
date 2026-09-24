import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { getSolunarRatingForDate } from '../components/SolunarForecaster';

interface OfflineCatch {
  id?: number;
  species: string;
  weight?: string;
  length?: string;
  location_name: string;
  timestamp: number;
  synced: number; // 0 = pending, 1 = synced
  solunar_rating?: string;
}

let nativeDb: any = null;

export const initOfflineDatabase = async (): Promise<void> => {
  if (Platform.OS === 'web') {
    console.log('📦 Storage Engine: Safari Web Session Mode Initialized.');
    if (!localStorage.getItem('fishlore_web_catches')) {
      localStorage.setItem('fishlore_web_catches', JSON.stringify([]));
    }
    return;
  }

  try {
    nativeDb = await SQLite.openDatabaseAsync('fishlore_offline.db');
        await nativeDb.execAsync(`
      PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS offline_catches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        species TEXT NOT NULL,
        weight TEXT,
        length TEXT,
        location_name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        synced INTEGER DEFAULT 0,
        latitude REAL,
        longitude REAL,
        solunar_rating TEXT
      );
    `);
    // Idempotent schema guard: add geo columns to databases seeded before the
    // columns existed. ALTER TABLE IF EXISTS skips the migration on fresh files.
    await nativeDb.execAsync(`
      ALTER TABLE offline_catches ADD COLUMN latitude REAL;
      ALTER TABLE offline_catches ADD COLUMN longitude REAL;
    `);
    console.log('💾 Storage Engine: Native expo-sqlite Container Formatted.');
  } catch (error) {
    console.error('Offline DB Initialization failure:', error);
  }
};

export const getOfflineCatchPins = async (): Promise<
  Array<{ id: string; species: string; location_name: string; latitude: number; longitude: number }>
> => {
  if (Platform.OS === 'web') {
    // Web fallback mirrors the localStorage cache; geo pins may not be present
    // in the lightweight seed model, so return the subset that has coordinates.
    try {
      const raw = localStorage.getItem('fishlore_web_catches') || '[]';
      return JSON.parse(raw)
        .filter((item: any) => item.latitude != null && item.longitude != null)
        .map((item: any) => ({
          id: String(item.id),
          species: item.species,
          location_name: item.location_name,
          latitude: item.latitude,
          longitude: item.longitude,
        }));
    } catch {
      return [];
    }
  }

  if (!nativeDb) return [];
  try {
    const rows = await nativeDb.getAllAsync(
      '     SELECT id, species, location_name, latitude, longitude, solunar_rating FROM offline_catches WHERE latitude IS NOT NULL AND longitude IS NOT NULL;',
    );
    return (rows || []).map((row: any) => ({
      id: String(row.id),
      species: row.species,
      location_name: row.location_name,
      latitude: row.latitude,
      longitude: row.longitude,
    }));
  } catch (error) {
    console.error('Failed to read offline catch pins:', error);
    return [];
  }
};

export const queueOfflineCatch = async (catchLog: Omit<OfflineCatch, 'id' | 'synced'>): Promise<void> => {
  // Auto-calculate the solunar activity rating for this catch's timestamp.
  const solunarRating = getSolunarRatingForDate(new Date(catchLog.timestamp));

  if (Platform.OS === 'web') {
    const webCache = JSON.stringify([...JSON.parse(localStorage.getItem('fishlore_web_catches') || '[]'), { ...catchLog, id: Date.now(), synced: 0, solunar_rating: solunarRating }]);
    localStorage.setItem('fishlore_web_catches', webCache);
    console.log('📦 Web Cache Synced:', catchLog.species);
    return;
  }

  if (!nativeDb) return;
  try {
    await nativeDb.runAsync(
      'INSERT INTO offline_catches (species, weight, length, location_name, timestamp, synced, solunar_rating) VALUES (?, ?, ?, ?, ?, 0, ?);',
      [catchLog.species, catchLog.weight || null, catchLog.length || null, catchLog.location_name, catchLog.timestamp, solunarRating]
    );
    console.log('💾 Native Cache Queued:', catchLog.species);
  } catch (error) {
    console.error('Failed to cache record:', error);
  }
};

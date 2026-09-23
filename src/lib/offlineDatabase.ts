import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';

interface OfflineCatch {
  id?: number;
  species: string;
  weight?: string;
  length?: string;
  location_name: string;
  timestamp: number;
  synced: number; // 0 = pending, 1 = synced
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
        synced INTEGER DEFAULT 0
      );
    `);
    console.log('💾 Storage Engine: Native expo-sqlite Container Formatted.');
  } catch (error) {
    console.error('Offline DB Initialization failure:', error);
  }
};

export const queueOfflineCatch = async (catchLog: Omit<OfflineCatch, 'id' | 'synced'>): Promise<void> => {
  if (Platform.OS === 'web') {
    const webCache = JSON.stringify([...JSON.parse(localStorage.getItem('fishlore_web_catches') || '[]'), { ...catchLog, id: Date.now(), synced: 0 }]);
    localStorage.setItem('fishlore_web_catches', webCache);
    console.log('📦 Web Cache Synced:', catchLog.species);
    return;
  }

  if (!nativeDb) return;
  try {
    await nativeDb.runAsync(
      'INSERT INTO offline_catches (species, weight, length, location_name, timestamp, synced) VALUES (?, ?, ?, ?, ?, 0);',
      [catchLog.species, catchLog.weight || null, catchLog.length || null, catchLog.location_name, catchLog.timestamp]
    );
    console.log('💾 Native Cache Queued:', catchLog.species);
  } catch (error) {
    console.error('Failed to cache record:', error);
  }
};

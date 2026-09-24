import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Platform,
  Alert,
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
} from 'react-native';
import MapView, {
  Marker,
  Callout,
  LongPressEvent,
} from 'react-native-maps';
import * as SQLite from 'expo-sqlite';
import { getSolunarRatingForDate } from '../components/SolunarForecaster';

// ── Gold Coast viewport (Southport Seaway) ──────────────────────────────────
const GOLD_COAST_REGION = {
  latitude: -27.9625,
  longitude: 153.4264,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

export type CatchPin = {
  id: number;
  latitude: number;
  longitude: number;
  species: string;
  weight: string | null;
  length: string | null;
  location_name: string;
  timestamp: number;
  solunar_rating: string | null;
};

// ── Master offline catch database (fishlore_offline.db) ─────────────────────
const FISHING_DB = 'fishlore_offline.db';

/**
 * Master offline catch database hook.
 * Uses the newer expo-sqlite async API surface:
 * - openDatabaseAsync  (opens fishlore_offline.db)
 * - execAsync          (creates table / schema guards)
 * - getAllAsync        (reads catch logs with coordinates)
 * - runAsync           (inserts new catch pins)
 *
 * This query pulls from the production `offline_catches` tracking layer
 * (src/lib/offlineDatabase.ts) — the single source of truth for logged catches.
 */
const useCatchPinsDb = () => {
  const [db, setDb] = useState<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    // Android/iOS only — react-native-maps codegen doesn't ship for web.
    if (Platform.OS === 'web') return;
    (async () => {
      try {
        const database = await SQLite.openDatabaseAsync(FISHING_DB);
        // Ensure geo columns exist on legacy databases (idempotent ALTER guard).
                await database.execAsync(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS offline_catches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            species     TEXT NOT NULL,
            weight      TEXT,
            length      TEXT,
            location_name TEXT NOT NULL,
            timestamp   INTEGER NOT NULL,
            synced      INTEGER DEFAULT 0,
            latitude    REAL,
            longitude   REAL,
            solunar_rating TEXT
          );
        `);
        await database.execAsync(`
          ALTER TABLE offline_catches ADD COLUMN latitude REAL;
          ALTER TABLE offline_catches ADD COLUMN longitude REAL;
          ALTER TABLE offline_catches ADD COLUMN solunar_rating TEXT;
        `);
        if (active) {
          setDb(database);
          setReady(true);
        }
      } catch (err) {
        console.error('[FishingMapScreen] SQLite init failed:', err);
      }
    })();
    return () => { active = false; };
  }, []);

  const loadPins = useCallback(async (): Promise<CatchPin[]> => {
    if (!db) return [];
    // Query master offline_catches table for entries with coordinate data.
        const rows = (await db.getAllAsync(
      'SELECT id, latitude, longitude, species, weight, length, location_name, timestamp, solunar_rating FROM offline_catches WHERE latitude IS NOT NULL AND longitude IS NOT NULL;',
    )) as CatchPin[] | undefined;
    return rows ?? [];
  }, [db]);

    const insertPin = useCallback(
    async (pin: Omit<CatchPin, 'id'>): Promise<void> => {
      if (!db) return;
      await db.runAsync(
        'INSERT INTO offline_catches (latitude, longitude, species, weight, length, location_name, timestamp, solunar_rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
        pin.latitude,
        pin.longitude,
        pin.species,
        pin.weight,
        pin.length,
        pin.location_name,
        pin.timestamp,
        pin.solunar_rating,
      );
    },
    [db],
  );

  return { db, ready, insertPin, loadPins };
};

// ── Solunar badge color + emoji mapper ────────────────────────────────────────
type SolunarBadge = {
  color: string;
  emoji: string;
};

const getSolunarBadge = (rating: string | null): SolunarBadge => {
  switch (rating) {
    case 'PEAK BITING WINDOW':
      return { color: '#16a34a', emoji: '🔥' };
    case 'GOOD':
      return { color: '#2563eb', emoji: '🎣' };
    case 'AVERAGE':
      return { color: '#eab308', emoji: '⏳' };
    case 'POOR':
      return { color: '#dc2626', emoji: '🌬️' };
    default:
      return { color: '#6b7280', emoji: '•' };
  }
};

export default function FishingMapScreen() {
  const mapRef = useRef<MapView | null>(null);
  const [pins, setPins] = useState<CatchPin[]>([]);
  const [loading, setLoading] = useState(true);
  const { ready, insertPin, loadPins } = useCatchPinsDb();

  // Mount: populate local pins from SQLite.
  useEffect(() => {
    let active = true;
    if (!ready) return;
    (async () => {
      const rows = await loadPins();
      if (active) setPins(rows);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [ready, loadPins]);

  // Long-press → prompt for a label → persist to SQLite → re-render marker.
  const handleLongPress = useCallback(
    async (event: LongPressEvent) => {
      const { latitude, longitude } = event.nativeEvent.coordinate;
      Alert.prompt(
        'Label this spot',
        'Enter a species name (e.g., Snapper, Kingfish):',
        async (text: string | undefined) => {
          const trimmed = (text ?? '').trim();
          if (!trimmed) return;
                    const timestamp = Date.now();
          const solunarRating = getSolunarRatingForDate(new Date(timestamp));
          await insertPin({ latitude, longitude, species: trimmed, weight: null, length: null, location_name: 'Gold Coast Waterways', timestamp, solunar_rating: solunarRating });
          setPins((prev) => [
            { id: Date.now(), latitude, longitude, species: trimmed, weight: null, length: null, location_name: 'Gold Coast Waterways', timestamp, solunar_rating: solunarRating },
            ...prev,
          ]);
        },
        'plain-text',
        undefined,
        'default',
      );
        },
    [insertPin],
  );

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={undefined}  // iOS: native Apple Maps engine (avoids Google billing); Android: default Google provider
        initialRegion={GOLD_COAST_REGION}
        toolbarEnabled={false}
        showsCompass={false}
        onLongPress={handleLongPress}
      >
                        {pins.map((pin) => {
          const badge = getSolunarBadge(pin.solunar_rating);
          return (
            <Marker
              key={`catch-${pin.id}`}
              coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
              pinColor="#0d9488"
            >
              <Callout style={styles.calloutContainer} tooltip={false}>
                <View style={styles.calloutBubble}>
                  {/* Bold heading: species + size metrics */}
                  <Text style={styles.calloutHeading}>
                    {pin.species}
                    {pin.weight ? ` • ${pin.weight}` : ''}
                    {pin.length ? ` · ${pin.length}cm` : ''}
                  </Text>

                  {/* Color-coded solunar badge bubble */}
                  <View style={[styles.solunarBadge, { backgroundColor: badge.color }]}>
                    <Text style={styles.solunarBadgeText}>
                      {badge.emoji} {pin.solunar_rating || 'UNKNOWN'}
                    </Text>
                  </View>

                  {/* Metadata row: location + localized date */}
                  <View style={styles.calloutMetaRow}>
                    <Text style={styles.calloutMetaText}>
                      📍 {pin.location_name}
                    </Text>
                    <Text style={styles.calloutMetaText}>
                      📅 {new Date(pin.timestamp).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </Text>
                  </View>
                </View>
              </Callout>
            </Marker>
          );
        })}
      </MapView>

      {loading && (
        <View style={styles.overlay}>
          <ActivityIndicator color="#0284c7" />
          <Text style={styles.overlayText}>Loading catch pins…</Text>
        </View>
      )}

      <View style={styles.legend}>
        <Text style={styles.legendText}>Long-press to tag a catch</Text>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1 },
    map: { ...StyleSheet.absoluteFill },
  overlay: {
        ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
  },
  overlayText: { marginTop: 12, color: '#0284c7', fontSize: 13, fontWeight: '600' },
  legend: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
    legendText: { fontSize: 12, color: '#475569' },
  // ── Custom Callout styles ───────────────────────────────────────────────
  calloutContainer: {
    width: 240,
    height: 120,
  },
  calloutBubble: {
    width: 220,
    minHeight: 80,
    padding: 10,
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  calloutHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 6,
  },
  solunarBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 6,
  },
  solunarBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  calloutMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  calloutMetaText: {
    fontSize: 11,
    color: '#94a3b8',
    flex: 1,
  },
});


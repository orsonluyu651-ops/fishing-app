/**
 * FishloreMap — WEB fallback.
 *
 * Platform-extension sibling of `FishloreMap.native.tsx`. Metro resolves
 * `FishloreMap.native` for iOS/Android (full react-native-maps engine) and
 * this file for web, so `react-native-maps` (codegenNativeComponent) never
 * enters the web module graph.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GeoPoint } from '@/lib/mapClusterEngine';

export interface Hotspot {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  fish: string;
}

const HOTSPOTS: Hotspot[] = [
  { id: '1', name: 'Southport Seaway', latitude: -27.937, longitude: 153.431, fish: 'Jewfish & Flathead' },
  { id: '2', name: 'Broadwater Banks', latitude: -27.915, longitude: 153.415, fish: 'Whiting & Bream' },
  { id: '3', name: 'Jumpinpin Channel', latitude: -27.718, longitude: 153.444, fish: 'Big Flathead' },
];

export { HOTSPOTS };

export interface FishloreMapProps {
  onHotspotChange?: (spot: Hotspot) => void;
}

export default function FishloreMap({ onHotspotChange }: FishloreMapProps = {}) {
  const [activeSpot, setActiveSpot] = useState<Hotspot>(HOTSPOTS[0]);

  return (
    <View style={styles.card}>
      <View style={styles.mapContainer}>
        <View style={styles.fallback}>
          <Ionicons name="map-outline" size={48} color="#0284c7" />
          <Text style={styles.fallbackTitle}>Maps unavailable on web</Text>
          <Text style={styles.fallbackText}>
            Interactive charts render in the Fishlore iOS / Android app. Active
            hotspot: {activeSpot.name} ({activeSpot.fish}).
          </Text>
        </View>
      </View>

      <Text style={styles.label}>Select Gold Coast Hotspot:</Text>
      <View style={styles.buttonRow}>
        {HOTSPOTS.map((spot) => (
          <TouchableOpacity
            key={spot.id}
            onPress={() => { setActiveSpot(spot); onHotspotChange?.(spot); }}
            style={[styles.btn, activeSpot.id === spot.id && styles.activeBtn]}
          >
            <Text style={[styles.btnText, activeSpot.id === spot.id && styles.activeBtnText]}>
              {spot.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginTop: 12,
  },
  mapContainer: {
    height: 300,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#bae6fd',
    backgroundColor: '#e0f2fe',
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  fallbackTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  fallbackText: { fontSize: 13, color: '#475569', textAlign: 'center', lineHeight: 19 },

  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 8, marginTop: 12 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between' },
  btn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
    alignItems: 'center',
    marginHorizontal: 2,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  activeBtn: { backgroundColor: '#0284c7', borderColor: '#0284c7' },
  btnText: { fontSize: 11, fontWeight: '600', color: '#475569' },
  activeBtnText: { color: '#fff' },
});

// --- Leaderboard Hook (stubbed): isolated from external services to keep
// the Guide map bundle self-contained. Returns an empty, non-loading state
// until a real leaderboard service lands.
export function useMapLeaderboard(_activeSpecies: string) {
  return { leaderboard: [] as GeoPoint[], isLoading: false };
}

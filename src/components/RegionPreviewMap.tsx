import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const HOTSPOTS = [
  { id: '1', name: 'Southport Seaway', lat: '-27.9372', lng: '153.4312', fish: 'Jewfish & Flathead' },
  { id: '2', name: 'Broadwater Banks', lat: '-27.9158', lng: '153.4091', fish: 'Whiting & Bream' },
  { id: '3', name: 'Jumpinpin Channel', lat: '-27.7214', lng: '153.4445', fish: 'Big Flathead' },
];

export default function RegionPreviewMap() {
  const [activeSpot, setActiveSpot] = useState(HOTSPOTS[0]);

  return (
    <View style={styles.card}>
      <View style={styles.mapCanvas}>
        <Ionicons name="compass" size={40} color="#0284c7" />
        <Text style={styles.coordinates}>Lat: {activeSpot.lat} | Lng: {activeSpot.lng}</Text>
        <Text style={styles.targetFish}>🎯 Target: {activeSpot.fish}</Text>
      </View>
      <Text style={styles.label}>Select Gold Coast Hotspot:</Text>
      <View style={styles.buttonRow}>
        {HOTSPOTS.map((spot) => (
          <TouchableOpacity 
            key={spot.id} 
            onPress={() => setActiveSpot(spot)} 
            style={[styles.btn, activeSpot.id === spot.id && styles.activeBtn]}
          >
            <Text style={[styles.btnText, activeSpot.id === spot.id && styles.activeBtnText]}>{spot.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', marginTop: 12 },
  mapCanvas: { height: 150, backgroundColor: '#e0f2fe', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#bae6fd' },
  coordinates: { fontSize: 14, fontWeight: 'bold', color: '#0f172a', marginTop: 8 },
  targetFish: { fontSize: 12, color: '#64748b', marginTop: 2 },
  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 8 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between' },
  btn: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, backgroundColor: '#f1f5f9', borderRadius: 6, alignItems: 'center', marginHorizontal: 2, borderWidth: 1, borderColor: '#e2e8f0' },
  activeBtn: { backgroundColor: '#0284c7', borderColor: '#0284c7' },
  btnText: { fontSize: 11, fontWeight: '600', color: '#475569' },
  activeBtnText: { color: '#fff' }
});

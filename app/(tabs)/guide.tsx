import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import FishloreMap, { Hotspot } from '../../src/components/FishloreMap';
import { AnglerCopilotCard } from '../../src/components/AnglerCopilotCard';

export default function GuideScreen() {
  const [selectedSpot, setSelectedSpot] = useState<Hotspot>({
    id: '1',
    name: 'Southport Seaway',
    latitude: -27.937,
    longitude: 153.431,
    fish: 'Jewfish & Flathead',
  });

  console.log('[Guide UI Integration] Selected hotspot:', selectedSpot.name, selectedSpot.latitude, selectedSpot.longitude);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* 🧭 Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Marine Guide</Text>
        <Text style={styles.headerSubtitle}>Gold Coast Boating & Angling Hub</Text>
      </View>

      {/* 🗺️ Interactive GPS Map Integration Canvas */}
      <Text style={styles.sectionTitle}>Interactive GPS Fishing Hotspots</Text>
      <FishloreMap onHotspotChange={setSelectedSpot} />

      {/* 🎣 AI Angler Copilot Card — sits between the hotspot picker and regulations */}
      <View style={styles.copilotContainer}>
        <AnglerCopilotCard
          latitude={selectedSpot.latitude}
          longitude={selectedSpot.longitude}
          locationName={selectedSpot.name}
        />
      </View>

      {/* 📝 Local Fishing QLD Regulations */}
      <Text style={styles.sectionTitle}>Local Regulations & Slot Limits</Text>
      <View style={styles.regCard}>
        <Text style={styles.regSpecies}>🐟 Dusky Flathead</Text>
        <Text style={styles.regDetails}>Slot Limit: 40 - 75 cm | Bag Limit: 5 per person</Text>
      </View>
      <View style={styles.regCard}>
        <Text style={styles.regSpecies}>🐟 Yellowfin Whiting</Text>
        <Text style={styles.regDetails}>Min Size: 25 cm | Bag Limit: 30 per person</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  contentContainer: { padding: 16, paddingBottom: 32 },
  header: { marginBottom: 20 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#0f172a' },
  headerSubtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#0f172a', marginBottom: 12, marginTop: 16 },
  copilotContainer: { marginTop: 16 },
  regCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 10 },
  regSpecies: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  regDetails: { fontSize: 13, color: '#475569' }
});

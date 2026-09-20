import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function AlertsScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* 📡 Live Broadcast Header */}
      <View style={styles.broadcastHeader}>
        <View style={styles.pulseContainer}>
          <View style={styles.pulseCircle} />
          <Text style={styles.broadcastTitle}>Live Marine Dispatch</Text>
        </View>
        <Text style={styles.broadcastSubtitle}>Gold Coast Region • Updated Just Now</Text>
      </View>

      {/* ⚠️ CRITICAL SAFETY ALERT */}
      <View style={[styles.alertCard, styles.criticalCard]}>
        <View style={styles.alertHeaderRow}>
          <Ionicons name="warning" size={24} color="#dc2626" />
          <Text style={[styles.alertTypeTitle, styles.criticalText]}>SEVERE WEATHER ADVISORY</Text>
        </View>
        <Text style={styles.alertLocation}>📍 Southport Seaway & Jumpinpin Bar</Text>
        <Text style={styles.alertDescription}>
          Dangerous coastal bars. Wind gusts exceeding 25 knots from the SE are creating hazardous breaking seas. Crossing is strongly discouraged for vessel hulls under 6 meters.
        </Text>
        <View style={styles.timeTagContainer}>
          <Text style={styles.timeTagText}>Expires: Tonight 8:00 PM</Text>
        </View>
      </View>

      {/* 🎯 SOLUNAR ACTIVITY FEED */}
      <View style={[styles.alertCard, styles.infoCard]}>
        <View style={styles.alertHeaderRow}>
          <Ionicons name="analytics" size={24} color="#0284c7" />
          <Text style={[styles.alertTypeTitle, styles.infoText]}>SOLUNAR BITE WINDOW</Text>
        </View>
        <Text style={styles.alertLocation}>📍 Broadwater Channel Edges</Text>
        <Text style={styles.alertDescription}>
          Major afternoon feeding window opening shortly. Tidal currents are interacting with local structure. High probability of surface activity for Whiting and Flathead.
        </Text>
        <View style={[styles.timeTagContainer, styles.infoTag]}>
          <Text style={[styles.timeTagText, styles.infoTagText]}>Window: 4:15 PM – 6:45 PM</Text>
        </View>
      </View>

      {/* 🛡️ REGS UPDATE */}
      <View style={[styles.alertCard, styles.standardCard]}>
        <View style={styles.alertHeaderRow}>
          <Ionicons name="shield-checkmark" size={24} color="#475569" />
          <Text style={styles.alertTypeTitle}>QLD FISHERIES COMPLIANCE</Text>
        </View>
        <Text style={styles.alertLocation}>📍 Regional Marine Patrols</Text>
        <Text style={styles.alertDescription}>
          Fisheries officers actively inspecting slot limits and bag counts at boat ramps across the Broadwater. Ensure all catch logs are accurate before hitting the ramps.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  contentContainer: { padding: 16, paddingBottom: 32 },
  broadcastHeader: { marginBottom: 20, paddingLeft: 4 },
  pulseContainer: { flexDirection: 'row', alignItems: 'center' },
  pulseCircle: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444', marginRight: 8 },
  broadcastTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  broadcastSubtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  alertCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16 },
  criticalCard: { borderColor: '#fecaca', backgroundColor: '#fff5f5' },
  infoCard: { borderColor: '#bae6fd', backgroundColor: '#f0f9ff' },
  standardCard: { backgroundColor: '#fff' },
  alertHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  alertTypeTitle: { fontSize: 14, fontWeight: 'bold', color: '#1e293b', marginLeft: 8, letterSpacing: 0.3 },
  criticalText: { color: '#b91c1c' },
  infoText: { color: '#0369a1' },
  alertLocation: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 6 },
  alertDescription: { fontSize: 14, color: '#475569', lineHeight: 20 },
  timeTagContainer: { backgroundColor: '#fee2e2', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginTop: 12 },
  timeTagText: { fontSize: 11, fontWeight: '700', color: '#991b1b' },
  infoTag: { backgroundColor: '#e0f2fe' },
  infoTagText: { color: '#0369a1' }
});

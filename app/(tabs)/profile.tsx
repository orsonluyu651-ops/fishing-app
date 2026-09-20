import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function ProfileScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* 👤 Profile Header Card */}
      <View style={styles.profileHeaderCard}>
        <View style={styles.avatarContainer}>
          <Ionicons name="person-circle" size={80} color="#0284c7" />
          <View style={styles.rankBadge}>
            <Text style={styles.rankBadgeText}>PRO ANGLER</Text>
          </View>
        </View>
        <Text style={styles.usernameText}>GoldCoast_Fisher</Text>
        <Text style={styles.locationText}>📍 Queensland, Australia</Text>
      </View>

      {/* 📊 Angling Stats Grid */}
      <Text style={styles.sectionTitle}>Angling Stats Log</Text>
      <View style={styles.grid}>
        <View style={styles.gridCard}>
          <Ionicons name="fish-outline" size={26} color="#0284c7" />
          <Text style={styles.cardValue}>42</Text>
          <Text style={styles.cardLabel}>Total Catches</Text>
        </View>

        <View style={styles.gridCard}>
          <Ionicons name="map-outline" size={26} color="#10b981" />
          <Text style={styles.cardValue}>5</Text>
          <Text style={styles.cardLabel}>Saved Hotspots</Text>
        </View>

        <View style={styles.gridCard}>
          <Ionicons name="trophy-outline" size={26} color="#eab308" />
          <Text style={styles.cardValue}>Level 8</Text>
          <Text style={styles.cardLabel}>Club Ranking</Text>
        </View>

        <View style={styles.gridCard}>
          <Ionicons name="time-outline" size={26} color="#8b5cf6" />
          <Text style={styles.cardValue}>184h</Text>
          <Text style={styles.cardLabel}>Time on Water</Text>
        </View>
      </View>

      {/* 🎯 Favorite Target Species */}
      <Text style={styles.sectionTitle}>Favorite Target Species</Text>
      <View style={styles.speciesList}>
        <View style={styles.speciesItem}>
          <Ionicons name="checkmark-circle" size={20} color="#0284c7" />
          <Text style={styles.speciesName}>Dusky Flathead</Text>
        </View>
        <View style={styles.speciesItem}>
          <Ionicons name="checkmark-circle" size={20} color="#0284c7" />
          <Text style={styles.speciesName}>Yellowfin Whiting</Text>
        </View>
        <View style={styles.speciesItem}>
          <Ionicons name="checkmark-circle" size={20} color="#0284c7" />
          <Text style={styles.speciesName}>Mangrove Jack</Text>
        </View>
      </View>

      {/* ⚙️ Account Quick Actions */}
      <TouchableOpacity style={styles.actionButton}>
        <Ionicons name="settings-outline" size={20} color="#475569" />
        <Text style={styles.actionButtonText}>Angler Settings</Text>
        <Ionicons name="chevron-forward" size={18} color="#94a3b8" style={styles.rightIcon} />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  contentContainer: { padding: 16, paddingBottom: 32 },
  profileHeaderCard: { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 20 },
  avatarContainer: { alignItems: 'center', marginBottom: 12, position: 'relative' },
  rankBadge: { backgroundColor: '#0284c7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, position: 'absolute', bottom: -4 },
  rankBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  usernameText: { fontSize: 20, fontWeight: 'bold', color: '#0f172a', marginTop: 4 },
  locationText: { fontSize: 13, color: '#64748b', marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#0f172a', marginBottom: 12, marginLeft: 2, marginTop: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 12 },
  gridCard: { backgroundColor: '#fff', width: '48%', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', marginBottom: 12 },
  cardValue: { fontSize: 18, fontWeight: 'bold', color: '#0f172a', marginTop: 6, marginBottom: 2 },
  cardLabel: { fontSize: 12, color: '#64748b', fontWeight: '500' },
  speciesList: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 16, marginBottom: 20 },
  speciesItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  speciesName: { fontSize: 14, fontWeight: '600', color: '#334155', marginLeft: 10 },
  actionButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  actionButtonText: { fontSize: 14, fontWeight: '600', color: '#475569', marginLeft: 10 },
  rightIcon: { marginLeft: 'auto' }
});

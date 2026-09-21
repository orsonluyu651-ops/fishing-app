import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getCacheTelemetryDetails, purgeMapTileCache, type CacheTelemetry, type PurgeResult } from '../../src/lib/cacheTelemetry';
import { supabase } from '../../src/lib/supabase';
import { compileCatchAnalytics, type RawCatchRecord, type CatchAnalytics } from '../../src/lib/analyticsEngine';
import { AnalyticsChartPanel } from '../../src/lib/analyticsCharts';

export default function ProfileScreen() {
  const [telemetry, setTelemetry] = useState<CacheTelemetry | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<PurgeResult | null>(null);
  const [analytics, setAnalytics] = useState<CatchAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  const refreshTelemetry = async () => {
    setIsRefreshing(true);
    try {
      const data = await getCacheTelemetryDetails();
      setTelemetry(data);
    } catch (error) {
      console.error('[profile] Failed to load cache telemetry:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const loadAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const { data, error } = await supabase
        .from('catches')
        .select('id, species, length, weight, captured_at, user_id, spot_id, environmental')
        .order('captured_at', { ascending: false });

      if (error) {
        console.error('[profile] Failed to load catch analytics:', error);
        setAnalytics({ totalCatches: 0, speciesBreakdown: [], moonPhaseDistribution: [], monthlyCatchVelocity: [], averageLength: null, topSpecies: '', catchDateRange: { startDate: null, endDate: null } });
      } else {
        const rawCatches: RawCatchRecord[] = (data || []).map(row => ({
          id: row.id,
          species: row.species,
          length: row.length,
          weight: row.weight,
          captured_at: row.captured_at,
          user_id: row.user_id,
          spot_id: row.spot_id,
          environmental: row.environmental,
        }));
        setAnalytics(compileCatchAnalytics(rawCatches));
      }
    } catch (error) {
      console.error('[profile] Failed to load catch analytics:', error);
      setAnalytics({ totalCatches: 0, speciesBreakdown: [], moonPhaseDistribution: [], monthlyCatchVelocity: [], averageLength: null, topSpecies: '', catchDateRange: { startDate: null, endDate: null } });
    } finally {
      setAnalyticsLoading(false);
    }
  };

  useEffect(() => {
    refreshTelemetry();
    loadAnalytics();
  }, []);

  const handlePurgeCache = async () => {
    setIsPurging(true);
    setPurgeResult(null);
    try {
      const result = await purgeMapTileCache();
      setPurgeResult(result);
      if (result.success) {
        await refreshTelemetry();
      }
    } catch (error) {
      console.error('[profile] Cache purge failed:', error);
    } finally {
      setIsPurging(false);
    }
  };

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

      {/* 📊 Performance Analytics Chart */}
      <Text style={styles.sectionTitle}>Performance Analytics</Text>
      <AnalyticsChartPanel analytics={analytics || { totalCatches: 0, speciesBreakdown: [], moonPhaseDistribution: [], monthlyCatchVelocity: [], averageLength: null, topSpecies: '', catchDateRange: { startDate: null, endDate: null } }} isLoading={analyticsLoading} />

      {/* 📡 Cache Status Card — Diagnostics Interface */}
      <Text style={styles.sectionTitle}>Cache & Sync Status</Text>
      <View style={styles.cacheCard}>
        {isRefreshing ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#0284c7" />
            <Text style={styles.loadingText}>Loading cache stats...</Text>
          </View>
        ) : telemetry ? (
          <>
            <View style={styles.cacheRow}>
              <Ionicons name="folder-open" size={22} color="#0284c7" />
              <View style={styles.cacheInfo}>
                <Text style={styles.cacheLabel}>Map Tile Cache</Text>
                <Text style={styles.cacheValue}>{telemetry.formattedVolume}</Text>
                <Text style={styles.cacheSubtext}>{telemetry.tileCacheFileCount} tiles</Text>
              </View>
            </View>
            <View style={[styles.cacheRow, styles.divider]}>
              <Ionicons name="sync" size={22} color="#10b981" />
              <View style={styles.cacheInfo}>
                <Text style={styles.cacheLabel}>Offline Catch Queue</Text>
                <Text style={styles.cacheValue}>{telemetry.queueDepth} entries</Text>
                <Text style={styles.cacheSubtext}>Pending catches waiting to sync</Text>
              </View>
            </View>
            <View style={[styles.cacheRow, styles.divider]}>
              <Ionicons name="rocket" size={22} color={telemetry.backgroundSyncStatus === 'registered' ? '#10b981' : '#f59e0b'} />
              <View style={styles.cacheInfo}>
                <Text style={styles.cacheLabel}>Background Sync</Text>
                <Text style={[styles.cacheValue, telemetry.backgroundSyncStatus === 'registered' ? styles.statusActive : styles.statusInactive]}>
                  {telemetry.backgroundSyncStatus}
                </Text>
                <Text style={styles.cacheSubtext}>
                  {telemetry.backgroundSyncStatus === 'registered' ? 'Automatic sync enabled' : telemetry.backgroundSyncStatus === 'not registered' ? 'Tap settings to enable' : 'Unavailable on this device'}
                </Text>
              </View>
            </View>
            {purgeResult && (
              <View style={[styles.resultBanner, purgeResult.success ? styles.resultSuccess : styles.resultError]}>
                <Text style={styles.resultText}>{purgeResult.message}</Text>
              </View>
            )}
            <TouchableOpacity
              style={[styles.purgeButton, isPurging && styles.purgeButtonDisabled]}
              onPress={handlePurgeCache}
              disabled={isPurging}
            >
              <Ionicons name={isPurging ? 'refresh' : 'trash-outline'} size={20} color={isPurging ? '#fff' : '#dc2626'} />
              <Text style={[styles.purgeButtonText, isPurging && styles.purgeButtonTextDisabled]}>
                {isPurging ? 'Clearing cache...' : 'Clear Map Cache'}
              </Text>
              {isPurging && <ActivityIndicator color="#fff" style={styles.purgeSpinner} />}
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.errorText}>Failed to load cache statistics.</Text>
        )}
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
  rightIcon: { marginLeft: 'auto' },

  // Cache Status Card styles
  cacheCard: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 16, marginBottom: 20 },
  cacheRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  divider: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  cacheInfo: { flex: 1, marginLeft: 12 },
  cacheLabel: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  cacheValue: { fontSize: 16, fontWeight: 'bold', color: '#0f172a', marginTop: 2 },
  cacheSubtext: { fontSize: 12, color: '#64748b', marginTop: 2 },
  statusActive: { color: '#10b981' },
  statusInactive: { color: '#f59e0b' },
  resultBanner: { padding: 10, borderRadius: 8, marginTop: 12, alignItems: 'center' },
  resultSuccess: { backgroundColor: '#dcfce7', borderWidth: 1, borderColor: '#86efac' },
  resultError: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5' },
  resultText: { fontSize: 13, fontWeight: '500', color: '#1f2937' },
  purgeButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#dc2626', padding: 12, borderRadius: 8, marginTop: 12 },
  purgeButtonDisabled: { backgroundColor: '#94a3b8' },
  purgeButtonText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  purgeButtonTextDisabled: { color: '#e2e8f0' },
  purgeSpinner: { marginLeft: 8 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  loadingText: { marginLeft: 8, fontSize: 14, color: '#64748b' },
  errorText: { fontSize: 14, color: '#dc2626', textAlign: 'center', padding: 12 }
});

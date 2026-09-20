import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';

type VerificationStatus = 'verified' | 'pending' | 'flagged' | 'unverified';
type EnvironmentalLog = { weather?: string | null; water_temperature?: number | string | null; wind?: string | null; tide_state?: string | null };
type VerificationAnalysis = { metrics?: { species_confidence?: number; measurement_confidence?: number; image_manipulation_score?: number; duplicate_score?: number }; flags?: string[]; model_version?: string };
type CatchRecord = { id: string; species: string; length: number | null; weight: number | null; bait: string | null; lure: string | null; captured_at: string; verification_status: VerificationStatus; verification_score: number; verification_analysis: VerificationAnalysis | null; environmental: EnvironmentalLog | null; profiles: { username: string | null } | { username: string | null }[] | null };

type RawCatchRecord = Omit<CatchRecord, 'profiles'> & { profiles: CatchRecord['profiles'] };

function clampPercent(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.round(Math.max(0, Math.min(1, numeric)) * 100) : 0;
}

function profileName(profiles: CatchRecord['profiles']): string {
  if (Array.isArray(profiles)) return profiles[0]?.username ?? 'Anonymous angler';
  return profiles?.username ?? 'Anonymous angler';
}

function statusCopy(status: VerificationStatus) {
  if (status === 'verified') return { label: 'Verified', color: '#047857', background: '#ecfdf5' };
  if (status === 'flagged') return { label: 'Flagged for review', color: '#b91c1c', background: '#fef2f2' };
  if (status === 'pending') return { label: 'Pending review', color: '#b45309', background: '#fffbeb' };
  return { label: 'Not verified', color: '#6b7280', background: '#f3f4f6' };
}

function weatherIcon(weather: string | null | undefined): keyof typeof Ionicons.glyphMap {
  const value = weather?.toLowerCase() ?? '';
  if (value.includes('rain')) return 'rainy-outline';
  if (value.includes('storm')) return 'thunderstorm-outline';
  if (value.includes('overcast')) return 'cloudy-outline';
  if (value.includes('cloud')) return 'partly-sunny-outline';
  if (value.includes('wind')) return 'flag-outline';
  return 'sunny-outline';
}

function MetricBar({ label, value, inverse = false }: { label: string; value: unknown; inverse?: boolean }) {
  const raw = clampPercent(value);
  const percent = inverse ? 100 - raw : raw;
  return (
    <View style={styles.metricBlock}>
      <View style={styles.metricHeader}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{percent}%</Text></View>
      <View style={styles.metricTrack}><View style={[styles.metricFill, { width: `${percent}%` }]} /></View>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string | null }) {
  if (!value) return null;
  return <View style={styles.infoRow}><Ionicons name={icon} size={19} color="#075ea8" /><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

function EnvironmentItem({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value?: string | number | null }) {
  return <View style={styles.environmentItem}><Ionicons name={icon} size={20} color="#075ea8" /><Text style={styles.environmentLabel}>{label}</Text><Text style={styles.environmentValue}>{value || 'Not recorded'}</Text></View>;
}

function LoadingSkeleton() {
  return <View style={styles.skeletonPage}><View style={[styles.skeleton, styles.skeletonSmall]} /><View style={[styles.skeleton, styles.skeletonTitle]} /><View style={[styles.skeleton, styles.skeletonWide]} /><View style={styles.skeletonCard}><View style={[styles.skeleton, styles.skeletonMedium]} /><View style={[styles.skeleton, styles.skeletonMeasurement]} /></View><View style={styles.skeletonCard}><View style={[styles.skeleton, styles.skeletonMedium]} /><View style={[styles.skeleton, styles.skeletonLine]} /><View style={[styles.skeleton, styles.skeletonLine]} /></View></View>;
}

export default function CatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [record, setRecord] = useState<CatchRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!id) { setError('No catch record was specified.'); setLoading(false); return; }
      try {
        const { data, error: queryError } = await supabase.from('catches').select('id, species, length, weight, bait, lure, captured_at, verification_status, verification_score, verification_analysis, environmental, profiles(username)').eq('id', id).maybeSingle();
        if (queryError) throw queryError;
        if (active) setRecord(data as RawCatchRecord | null);
      } catch (loadError: any) {
        if (active) setError(loadError.message || 'Unable to load this catch record.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [id]);

  if (loading) return <LoadingSkeleton />;
  if (error || !record) return <View style={styles.centered}><Ionicons name="fish-outline" size={42} color="#9ca3af" /><Text style={styles.fallbackTitle}>Catch record not found</Text><Text style={styles.fallbackText}>{error ?? 'This catch may have been removed.'}</Text><TouchableOpacity style={styles.backButton} onPress={() => router.back()}><Text style={styles.backButtonText}>Go back</Text></TouchableOpacity></View>;

  const environmental = record.environmental ?? {};
  const metrics = record.verification_analysis?.metrics ?? {};
  const status = statusCopy(record.verification_status);
  const name = profileName(record.profiles);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.backLink} onPress={() => router.back()}><Ionicons name="arrow-back" size={18} color="#075ea8" /><Text style={styles.backLinkText}>Back</Text></TouchableOpacity>
      <View style={styles.hero}><View style={styles.avatar}><Text style={styles.avatarText}>{name[0]?.toUpperCase() ?? '?'}</Text></View><View><Text style={styles.angler}>{name}</Text><Text style={styles.timestamp}>{new Date(record.captured_at).toLocaleString()}</Text></View></View>
      <Text style={styles.species}>{record.species}</Text><Text style={styles.subtitle}>Verified catch log</Text>

      <View style={styles.measureCard}><View style={styles.measurement}><Ionicons name="resize-outline" size={22} color="#075ea8" /><Text style={styles.measureLabel}>Length</Text><Text style={styles.measureValue}>{record.length ?? '—'}<Text style={styles.unit}> cm</Text></Text></View><View style={styles.divider} /><View style={styles.measurement}><Ionicons name="scale-outline" size={22} color="#075ea8" /><Text style={styles.measureLabel}>Weight</Text><Text style={styles.measureValue}>{record.weight ?? '—'}<Text style={styles.unit}> kg</Text></Text></View></View>

      {record.bait || record.lure ? <View style={styles.card}><Text style={styles.cardTitle}>Tackle Box</Text><InfoRow icon="fish-outline" label="Bait" value={record.bait} /><InfoRow icon="flash-outline" label="Lure" value={record.lure} /></View> : null}
      <View style={styles.card}><Text style={styles.cardTitle}>Environmental Log</Text><View style={styles.environmentGrid}><EnvironmentItem icon={weatherIcon(environmental.weather)} label="Weather" value={environmental.weather} /><EnvironmentItem icon="thermometer-outline" label="Water temp" value={environmental.water_temperature ? `${environmental.water_temperature} °C` : null} /><EnvironmentItem icon="navigate-outline" label="Wind" value={environmental.wind} /><EnvironmentItem icon="swap-vertical-outline" label="Tide" value={environmental.tide_state} /></View></View>

      <View style={styles.card}><View style={styles.verificationHeader}><View><Text style={styles.cardTitle}>AI Verification Status</Text><Text style={styles.verificationScore}>{Math.round(record.verification_score * 100)}% confidence</Text></View><View style={[styles.statusBadge, { backgroundColor: status.background }]}><Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text></View></View><MetricBar label="Species confidence" value={metrics.species_confidence} /><MetricBar label="Measurement consistency" value={metrics.measurement_confidence} /><MetricBar label="Forensics / anti-manipulation" value={metrics.image_manipulation_score ?? 1} inverse /><MetricBar label="Duplicate check" value={metrics.duplicate_score ?? 1} inverse />{record.verification_analysis?.model_version ? <Text style={styles.modelVersion}>Model: {record.verification_analysis.model_version}</Text> : null}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f8fa' }, content: { padding: 20, paddingTop: 58, paddingBottom: 40 }, backLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 24 }, backLinkText: { color: '#075ea8', fontWeight: '700', fontSize: 15 }, hero: { flexDirection: 'row', alignItems: 'center' }, avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#075ea8', alignItems: 'center', justifyContent: 'center', marginRight: 12 }, avatarText: { color: '#fff', fontSize: 18, fontWeight: '800' }, angler: { color: '#1f2937', fontSize: 16, fontWeight: '700' }, timestamp: { color: '#6b7280', fontSize: 12, marginTop: 3 }, species: { color: '#102a43', fontSize: 32, fontWeight: '800', marginTop: 24 }, subtitle: { color: '#6b7280', fontSize: 14, marginTop: 3, marginBottom: 16 }, measureCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eaf4ff', borderRadius: 16, padding: 18, marginBottom: 14 }, measurement: { flex: 1, alignItems: 'center' }, divider: { width: 1, height: 58, backgroundColor: '#bfdbfe' }, measureLabel: { color: '#315b7d', fontSize: 12, marginTop: 6 }, measureValue: { color: '#102a43', fontSize: 28, fontWeight: '800', marginTop: 2 }, unit: { fontSize: 14, fontWeight: '600' }, card: { backgroundColor: '#fff', borderRadius: 16, padding: 17, marginBottom: 14, borderWidth: 1, borderColor: '#e5edf2' }, cardTitle: { color: '#1f2937', fontSize: 17, fontWeight: '800', marginBottom: 13 }, infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, gap: 10 }, infoLabel: { color: '#6b7280', width: 70 }, infoValue: { color: '#1f2937', fontWeight: '600', flex: 1 }, environmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, environmentItem: { width: '47%', minHeight: 70, backgroundColor: '#f6fafc', borderRadius: 11, padding: 11 }, environmentLabel: { color: '#6b7280', fontSize: 11, marginTop: 5 }, environmentValue: { color: '#1f2937', fontWeight: '700', marginTop: 3 }, verificationHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }, verificationScore: { color: '#6b7280', fontSize: 12, marginTop: 3 }, statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }, statusText: { fontSize: 12, fontWeight: '800' }, metricBlock: { marginBottom: 13 }, metricHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }, metricLabel: { color: '#4b5563', fontSize: 12 }, metricValue: { color: '#1f2937', fontSize: 12, fontWeight: '700' }, metricTrack: { height: 7, borderRadius: 4, backgroundColor: '#e5e7eb', overflow: 'hidden' }, metricFill: { height: '100%', borderRadius: 4, backgroundColor: '#168aad' }, modelVersion: { color: '#9ca3af', fontSize: 10, marginTop: 4 }, centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#f5f8fa' }, fallbackTitle: { color: '#374151', fontSize: 19, fontWeight: '800', marginTop: 12 }, fallbackText: { color: '#6b7280', textAlign: 'center', marginTop: 7, lineHeight: 20 }, backButton: { backgroundColor: '#075ea8', borderRadius: 9, paddingHorizontal: 18, paddingVertical: 11, marginTop: 18 }, backButtonText: { color: '#fff', fontWeight: '700' }, skeletonPage: { flex: 1, backgroundColor: '#f5f8fa', padding: 20, paddingTop: 64 }, skeleton: { backgroundColor: '#dbe5eb', borderRadius: 7 }, skeletonSmall: { width: 55, height: 16, marginBottom: 28 }, skeletonTitle: { width: '62%', height: 30, marginBottom: 9 }, skeletonWide: { width: '40%', height: 14, marginBottom: 20 }, skeletonCard: { backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 14, height: 130 }, skeletonMedium: { width: '35%', height: 17, marginBottom: 20 }, skeletonMeasurement: { width: '75%', height: 35 }, skeletonLine: { width: '88%', height: 13, marginBottom: 12 },
});

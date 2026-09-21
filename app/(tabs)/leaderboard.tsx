/**
 * Leaderboard Tab — Real-time Global Angler Rankings
 *
 * Shows two ranked lists:
 *   — Top anglers by cumulative catch weight
 *   — Most diverse species catchers
 *
 * Features:
 *   - Podium showcase header for top-3 weight leaders
 *   - FlatList with initialNumToRender={10} for smooth rendering
 *   - "Pro" tag on premium angler entries
 *   - Timeframe selector: weekly / monthly / all-time
 */

import { useEffect, useState, useCallback } from 'react';
import {
  FlatList,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchLeaderboardMetrics, type LeaderboardTimeframe, type AnglerRankEntry } from '@/lib/leaderboardEngine';
import { usePremiumStatus } from '@/lib/premiumAccess';

const TIMEFRAME_OPTIONS: { key: LeaderboardTimeframe; label: string }[] = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'all-time', label: 'All-Time' },
];

const CrownColors: Record<number, string> = {
  1: '#FFD700',
  2: '#C0C0C0',
  3: '#CD7F32',
};

const CrownIcons: Record<number, keyof typeof Ionicons.glyphMap> = {
  1: 'trophy',
  2: 'medal',
  3: 'medal-outline',
};

const podiumStyles = StyleSheet.create({
  container: {
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 16,
  },
  podiumSlot: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderRadius: 12,
  },
  crownContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  proBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#007AFF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  proText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  username: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
    marginBottom: 2,
  },
  weight: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 2,
  },
  rank: {
    fontSize: 11,
    color: '#9ca3af',
  },
});

function PodiumHeader({ top3 }: { top3: AnglerRankEntry[] }) {
  if (!top3 || top3.length === 0) {
    return null;
  }

  return (
    <View style={podiumStyles.container}>
      <View style={podiumStyles.row}>
        {top3.map((angler, idx) => {
          const position = idx + 1;
          const crownColor = CrownColors[position] ?? '#999';
          const CrownIcon = CrownIcons[position];
          return (
            <View key={angler.user_id} style={[podiumStyles.podiumSlot, { backgroundColor: crownColor + '20' }]}>
              <View style={[podiumStyles.crownContainer, { backgroundColor: crownColor }]}>
                <Ionicons name={CrownIcon} size={28} color="#fff" />
              </View>
              {angler.is_pro && <View style={podiumStyles.proBadge}><Text style={podiumStyles.proText}>Pro</Text></View>}
              <Text style={podiumStyles.username}>{angler.username || 'anon'}</Text>
              <Text style={podiumStyles.weight}>{angler.total_weight.toFixed(1)} lbs</Text>
              <Text style={podiumStyles.rank}>#{position}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
  },
  info: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  username: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  proTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#f0f7ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  proText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#007AFF',
  },
  stats: {
    fontSize: 12,
    color: '#9ca3af',
  },
});

function LeaderboardRow({ rank, angler }: { rank: number; angler: AnglerRankEntry }) {
  return (
    <View style={rowStyles.row}>
      <View style={[rowStyles.rankBadge, rank < 4 && { backgroundColor: CrownColors[rank]! + '20' }]}>
        {rank <= 3 ? (
          <Ionicons name={CrownIcons[rank]!} size={16} color={CrownColors[rank]!} />
        ) : (
          <Text style={rowStyles.rankText}>{rank}</Text>
        )}
      </View>
      <View style={rowStyles.info}>
        <View style={rowStyles.nameRow}>
          <Text style={rowStyles.username}>{angler.username || 'anon angler'}</Text>
          {angler.is_pro && (
            <View style={rowStyles.proTag}>
              <Ionicons name="shield-checkmark" size={10} color="#007AFF" />
              <Text style={rowStyles.proText}>Pro</Text>
            </View>
          )}
        </View>
        <Text style={rowStyles.stats}>
          {angler.total_weight.toFixed(1)} lbs {'\u00B7'} {angler.catch_count} catches {'\u00B7'} {angler.species_count} species
        </Text>
      </View>
        </View>
  );
}

export default function LeaderboardScreen() {
  const [timeframe, setTimeframe] = useState<LeaderboardTimeframe>('all-time');
  const [rankings, setRankings] = useState<AnglerRankEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { isPro } = usePremiumStatus();

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const metrics = await fetchLeaderboardMetrics(timeframe);
      setRankings(metrics.weightRankings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const metrics = await fetchLeaderboardMetrics(timeframe);
      setRankings(metrics.weightRankings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setRefreshing(false);
    }
  }, [timeframe]);

  const handleTimeframeChange = useCallback((newTimeframe: LeaderboardTimeframe) => {
    setTimeframe(newTimeframe);
  }, []);

  const renderItem = useCallback(({ item, index }: { item: AnglerRankEntry; index: number }) => (
    <LeaderboardRow rank={index + 1} angler={item} />
  ), []);

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading leaderboard…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.timeframeBar}>
        {TIMEFRAME_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.timeframeBtn, timeframe === opt.key && styles.timeframeBtnActive]}
            onPress={() => handleTimeframeChange(opt.key)}
          >
            <Text style={[styles.timeframeLabel, timeframe === opt.key && styles.timeframeLabelActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={rankings}
        keyExtractor={(item) => item.user_id}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        onRefresh={handleRefresh}
        refreshing={refreshing}
        ListHeaderComponent={<PodiumHeader top3={rankings.slice(0, 3)} />}
        ListEmptyComponent={
          error ? (
            <View style={styles.errorContainer}>
              <Ionicons name="cloud-offline-outline" size={40} color="#999" />
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={handleRefresh}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No catches logged yet.</Text>
            </View>
          )
        }
        renderItem={renderItem}
      />

      {rankings.length > 0 && !isPro && (
        <View style={styles.upgradeHint}>
          <Text style={styles.upgradeText}>Go Pro to unlock all leaderboard features</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 15,
    color: '#6b7280',
  },
  timeframeBar: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  timeframeBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  timeframeBtnActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  timeframeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  timeframeLabelActive: {
    color: '#fff',
  },
  errorContainer: {
    alignItems: 'center',
    paddingTop: 40,
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 15,
    color: '#9ca3af',
  },
  upgradeHint: {
    padding: 12,
    backgroundColor: '#fffbeb',
    borderTopWidth: 1,
    borderTopColor: '#fed7aa',
    alignItems: 'center',
  },
  upgradeText: {
    fontSize: 13,
    color: '#92400e',
    fontWeight: '600',
  },
});
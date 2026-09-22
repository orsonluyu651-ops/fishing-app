/**
 * Leaderboard Screen — Simplified global angler rankings via the
 * `leaderboard_ranks` materialized view (migration 0026).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { fetchTopAnglerRanks, type LeaderboardRow } from '../../src/lib/leaderboardEngine';

export default function LeaderboardScreen() {
  const [ranks, setRanks] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTopAnglerRanks(50).then((data) => {
      setRanks(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#0284c7" /></View>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Angler Leaderboards 🏆</Text>

      <FlatList
        data={ranks}
        keyExtractor={(item) => item.user_id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rankToken}>#{item.leaderboard_rank}</Text>
            <View style={styles.metaContainer}>
              <Text style={styles.username}>@{item.username}</Text>
              <Text style={styles.subtext}>
                Catches: {item.total_catches} | Heavy: {item.heaviest_catch_lbs} lbs
              </Text>
            </View>
            <Text style={styles.weightScore}>{item.total_weight_lbs.toFixed(1)} lbs</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 16, paddingTop: 16 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#1e293b', marginBottom: 16, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rankToken: { fontSize: 18, fontWeight: '900', color: '#0284c7', width: 45 },
  metaContainer: { flex: 1 },
  username: { fontSize: 16, fontWeight: 'bold', color: '#334155' },
  subtext: { fontSize: 12, color: '#64748b', marginTop: 2 },
  weightScore: { fontSize: 16, fontWeight: 'bold', color: '#10b981' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

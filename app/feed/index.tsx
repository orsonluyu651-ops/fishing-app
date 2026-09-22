/**
 * Social Feed Screen — paginated community catch timeline with lazy viewport
 * loading and pull-to-refresh.
 *
 * Queries the `catches` view joined to `profiles` via src/lib/socialFeedEngine
 * and renders each entry as a card with optional media.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { fetchCommunitySocialFeed, type SocialFeedItem } from '../../src/lib/socialFeedEngine';
import { CatchSearchControls, CatchSearchEmptyState } from '../../src/components/CatchSearchControls';

export default function SocialFeedScreen() {
  const [feedItems, setFeedItems] = useState<SocialFeedItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<SocialFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const loadFeedData = async (targetPage: number, clearOld = false) => {
    const records = await fetchCommunitySocialFeed(targetPage);
    setFeedItems((prev) => {
      const next = clearOld ? records : [...prev, ...records];
      setFilteredItems(next);
      return next;
    });
    setHasMore(records.length > 0);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    loadFeedData(0);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    setPage(0);
    loadFeedData(0, true);
  };

  const handleLoadMore = () => {
    if (!hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    loadFeedData(nextPage);
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#0284c7" /></View>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Angler Network Feed 🌊</Text>

      <CatchSearchControls
        catches={feedItems}
        onResultsChange={setFilteredItems}
      >
        {({ results, controls }) => (
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            ListHeaderComponent={controls}
            ListEmptyComponent={<CatchSearchEmptyState />}
            ListFooterComponent={
          !hasMore && filteredItems.length > 0 ? (
            <Text style={styles.endOfFeed}>You're all caught up 🎣</Text>
          ) : loading ? (
            <ActivityIndicator size="small" color="#0284c7" style={{ marginVertical: 16 }} />
          ) : null
        }
            renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.userBar}>
              <Text style={styles.username}>@{item.profiles?.username ?? 'angler'}</Text>
              <Text style={styles.timestamp}>{new Date(item.created_at).toLocaleDateString()}</Text>
            </View>

            {item.image_url && (
              <Image source={{ uri: item.image_url }} style={styles.cardImage} resizeMode="cover" />
            )}

            <View style={styles.detailsContainer}>
              <Text style={styles.speciesText}>{item.species}</Text>
              <Text style={styles.subtext}>
                Landed at {item.location_name}{' '}
                <Text style={styles.weightBadge}>{item.weight.toFixed(1)} lbs</Text>
              </Text>
            </View>
          </View>
            )}
          />
        )}
      </CatchSearchControls>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingTop: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 16,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  userBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  username: {
    fontWeight: 'bold',
    color: '#0284c7',
    fontSize: 14,
  },
  timestamp: {
    fontSize: 12,
    color: '#94a3b8',
  },
  cardImage: {
    width: '100%',
    height: 220,
    backgroundColor: '#e2e8f0',
  },
  detailsContainer: {
    padding: 12,
  },
  speciesText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#334155',
  },
  subtext: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  weightBadge: {
    color: '#10b981',
    fontWeight: 'bold',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endOfFeed: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 13,
    paddingVertical: 16,
  },
});

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';

// Read through the privacy view (migration 0005): latitude/longitude are
// NULL to anyone who isn't this spot's owner. region_bubble_name is the
// non-sensitive Gold Coast area string for non-owners.
interface Spot {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  privacy_level: string;
  user_id: string;
  region_bubble_name: string | null;
}

export default function SpotDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    fetchSpot();
  }, [id]);

  async function fetchSpot() {
    try {
      setLoading(true);

      const { data: { user } } = await supabase.auth.getUser();
      setIsOwner(!!user);

      const { data, error } = await supabase
        .from('fishing_spots_public')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      setSpot(data);

      // Ownership is decided against the row itself, not just the session.
      if (user && data) setIsOwner(user.id === data.user_id);
    } catch (error: any) {
      Alert.alert('Error', 'Could not load spot details');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!spot) {
    return (
      <View style={styles.centered}>
        <Text>Spot not found</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
        >
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Exact coordinates are only ever in the payload for the owner (the view
  // redacts them server-side for everyone else), so this is both a UI fix
  // and a guarantee about what was transmitted.
  const canSeeExactCoords = isOwner && spot.latitude != null && spot.longitude != null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{spot.name}</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.infoCard}>
          <Text style={styles.label}>Privacy Level</Text>
          <Text style={styles.value}>
            {spot.privacy_level.toUpperCase()}
            {isOwner ? ' · yours' : ''}
          </Text>
        </View>

        {canSeeExactCoords ? (
          <View style={styles.infoCard}>
            <Text style={styles.label}>Coordinates</Text>
            <Text style={styles.value}>
              {spot.latitude!.toFixed(4)}, {spot.longitude!.toFixed(4)}
            </Text>
          </View>
        ) : (
          <View style={styles.infoCard}>
            <Text style={styles.label}>Location</Text>
            <Text style={styles.value}>🔒 Exact coordinates kept private</Text>
            {spot.region_bubble_name ? (
              <Text style={styles.hint}>
                Spot is in the {spot.region_bubble_name} area. Regional activity
                is shown on the Explore map.
              </Text>
            ) : (
              <Text style={styles.hint}>
                Regional activity for this area is shown on the Explore map.
              </Text>
            )}
          </View>
        )}

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() =>
            router.push({
              pathname: '/(tabs)/add-catch',
              params: { spotId: spot.id },
            })
          }
        >
          <Text style={styles.actionButtonText}>Log a Catch Here</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  header: {
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    marginRight: 15,
  },
  backButtonText: {
    color: '#007AFF',
    fontSize: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
    marginRight: 60, // Offset back button to center text
  },
  content: {
    padding: 20,
  },
  infoCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#eee',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  label: {
    fontSize: 14,
    color: '#888',
    marginBottom: 5,
  },
  value: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  hint: {
    fontSize: 13,
    color: '#888',
    marginTop: 8,
    lineHeight: 19,
  },
  actionButton: {
    backgroundColor: '#007AFF',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 30,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    marginTop: 20,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
  },
});
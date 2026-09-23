/**
 * Waterway Map Screen
 *
 * Renders an interactive react-native-maps view centred on the Gold Coast
 * waterways region. Shows pinned fishing spots fetched from the saved_spots
 * table and accepts long-press drops to create new waypoints.
 *
 * Offline tile rendering falls back to the local cache template URL
 * (populated by src/lib/mapCacheEngine.ts).
 */
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert } from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';
import * as FileSystem from 'expo-file-system';
import {
  saveFishingSpotPin,
  fetchSavedFishingSpots,
  type SavedSpotMarker,
} from '../../src/lib/mapSpotEngine';
import { Paths } from 'expo-file-system';

export default function WaterwayMapScreen() {
  const currentUserId = 'CURRENT_AUTHENTICATED_USER_ID_PLACEHOLDER';
  const [spots, setSpots] = useState<SavedSpotMarker[]>([]);
  const cacheTemplateUrl = `${Paths.cache}map_tiles/{z}_{x}_{y}.png`;

  useEffect(() => {
    fetchSavedFishingSpots(currentUserId).then(setSpots);
  }, []);

  const handleMapLongPress = async (e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;

    Alert.prompt(
      'Save Waypoint',
      'Enter a recognizable title for this fishing spot:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save Spot',
          onPress: async (name: string | undefined) => {
            if (!name?.trim()) return;
            const newSpot: Omit<SavedSpotMarker, 'id'> = {
              user_id: currentUserId,
              name: name.trim(),
              latitude,
              longitude,
            };
            const success = await saveFishingSpotPin(newSpot);
            if (success) setSpots((prev) => [...prev, newSpot]);
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: -28.0167,
          longitude: 153.4000,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        onLongPress={handleMapLongPress}
      >
        {/* Offline Cache Overlay Layer — points to downloaded assets path fallback */}
        <UrlTile
          urlTemplate={cacheTemplateUrl}
          shouldReplaceMapContent={false}
          maximumZ={12}
        />

        {spots.map((spot, idx) => (
          <Marker
            key={spot.id ?? `spot-${idx}`}
            coordinate={{ latitude: spot.latitude, longitude: spot.longitude }}
            title={spot.name}
            description={`Lat: ${spot.latitude.toFixed(4)}, Lng: ${spot.longitude.toFixed(4)}`}
            pinColor="#0284c7"
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
});

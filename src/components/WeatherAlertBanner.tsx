import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { fetchSavedFishingSpots, type SavedSpotMarker } from '../lib/mapSpotEngine';
import { auditSpotSafetyConditions, type SpotWeatherAlert } from '../lib/weatherAlertEngine';

export function WeatherAlertBanner() {
  const currentUserId = 'CURRENT_AUTHENTICATED_USER_ID_PLACEHOLDER';
  const [activeAlerts, setActiveAlerts] = useState<SpotWeatherAlert[]>([]);

  useEffect(() => {
    async function scanAllUserSpots() {
      const userSpots: SavedSpotMarker[] = await fetchSavedFishingSpots(currentUserId);
      const warnings: SpotWeatherAlert[] = [];

      for (const spot of userSpots) {
        const audit = await auditSpotSafetyConditions(spot);
        if (audit.isSevere) warnings.push(audit);
      }
      setActiveAlerts(warnings);
    }
    scanAllUserSpots();
  }, []);

  if (activeAlerts.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Marine Safety Advisory ⚠️</Text>
      {activeAlerts.map((alert, idx) => (
        <Text key={idx} style={styles.messageText}>
          • {alert.warningMessage}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fef2f2',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fee2e2',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#991b1b',
    marginBottom: 4,
  },
  messageText: {
    fontSize: 12,
    color: '#b91c1c',
    marginTop: 3,
    lineHeight: 16,
  },
});

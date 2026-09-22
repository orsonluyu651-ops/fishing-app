import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { downloadOfflineMapRegion } from '../../src/lib/mapCacheEngine';

export default function OfflineMapScreen() {
  const [syncing, setSyncing] = useState(false);
  const [percentage, setPercentage] = useState(0);

  const handleStartDownload = async () => {
    setSyncing(true);
    setPercentage(0);

    const goldCoastRegion = { minLat: -28.05, maxLat: -27.95, minLng: 153.35, maxLng: 153.45, minZoom: 10, maxZoom: 12 };
    const saved = await downloadOfflineMapRegion(goldCoastRegion, (p) => setPercentage(Math.round(p * 100)));

    setSyncing(false);
    if (saved.length > 0) {
      // eslint-disable-next-line no-alert
      alert(`Success! ${saved.length} tiles downloaded for offline navigation.`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Offline Maps</Text>
      <Text style={styles.subtitle}>
        Download your base topological maps locally to navigate waterways smoothly even when cellular data is completely lost.
      </Text>

      {syncing ? (
        <View style={styles.progressContainer}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.progressText}>Downloading tiles: {percentage}%</Text>
        </View>
      ) : (
        <TouchableOpacity
          onPress={handleStartDownload}
          style={styles.downloadButton}
          activeOpacity={0.8}
        >
          <Text style={styles.downloadButtonText}>Download Local Catch Region (Gold Coast)</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#1e293b', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 32, textAlign: 'center', lineHeight: 20 },
  progressContainer: { alignItems: 'center' },
  progressText: { marginTop: 16, fontSize: 16, fontWeight: '600', color: '#0284c7' },
  downloadButton: { backgroundColor: '#0284c7', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  downloadButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});

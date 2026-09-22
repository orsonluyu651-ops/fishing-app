import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import {
  fetchMarineTelemetry,
  calculateSolunarWindows,
  type MarineForecastData,
  type SolunarActivity,
} from '../lib/solunarEngine';

interface TelemetryDashboardProps {
  lat: number;
  lng: number;
}

export function TelemetryDashboard({ lat, lng }: TelemetryDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [marine, setMarine] = useState<MarineForecastData | null>(null);
  const [solunar, setSolunar] = useState<SolunarActivity | null>(null);

  useEffect(() => {
    async function loadPremiumTelemetry() {
      const marineData = await fetchMarineTelemetry(lat, lng);
      const solunarData = calculateSolunarWindows(new Date(), lat, lng);

      setMarine(marineData);
      setSolunar(solunarData);
      setLoading(false);
    }
    loadPremiumTelemetry();
  }, [lat, lng]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color="#0284c7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Premium Marine Telemetry</Text>

      <View style={styles.row}>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Wave Height</Text>
          <Text style={styles.metricValue}>{marine?.waveHeight ?? '--'}</Text>
          <Text style={styles.metricUnit}>m</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Wave Period</Text>
          <Text style={styles.metricValue}>{marine?.wavePeriod ?? '--'}</Text>
          <Text style={styles.metricUnit}>s</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Water Temp</Text>
          <Text style={styles.metricValue}>{marine?.waterTemp ?? '--'}</Text>
          <Text style={styles.metricUnit}>°C</Text>
        </View>
      </View>

      <View style={styles.solunarPanel}>
        <Text style={styles.solunarTitle}>Solunar Fishing Activity Index</Text>
        <Text style={styles.solunarScore}>{solunar?.feedingScore ?? 0}%</Text>
        <Text style={styles.solunarTimes}>
          Major Feeding: {solunar?.majorStart} - {solunar?.majorEnd} | Minor: {solunar?.minorStart} - {solunar?.minorEnd}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginVertical: 10,
  },
  loadingContainer: {
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  divider: {
    width: 1,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 8,
  },
  metric: {
    alignItems: 'center',
    flex: 1,
  },
  metricLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  metricValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0284c7',
  },
  metricUnit: {
    fontSize: 12,
    color: '#64748b',
  },
  solunarPanel: {
    backgroundColor: '#f0f9ff',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  solunarTitle: {
    fontSize: 14,
    color: '#0369a1',
    fontWeight: '600',
  },
  solunarScore: {
    fontSize: 32,
    fontWeight: '900',
    color: '#0284c7',
    marginVertical: 4,
  },
  solunarTimes: {
    fontSize: 12,
    color: '#0c4a6e',
    textAlign: 'center',
  },
});

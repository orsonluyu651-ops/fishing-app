import React, { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, Dimensions, TouchableOpacity } from 'react-native';

interface WeatherSpot {
  id: string;
  name: string;
  tide: string;
  wind: string;
  swell: string;
  status: 'Excellent' | 'Good' | 'Fair' | 'Choppy';
}

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;

export const WeatherDashboard: React.FC = () => {
  const [activeSpot, setActiveSpot] = useState(0);

  const goldCoastSpots: WeatherSpot[] = [
    { id: '1', name: 'Southport Seaway', tide: 'High: 1.4m (08:15 AM)', wind: 'SE 12-15 knots', swell: '0.8m East Easing', status: 'Excellent' },
    { id: '2', name: 'Currumbin Creek Bar', tide: 'Low: 0.3m (02:40 PM)', wind: 'SE 15-20 knots', swell: '1.1m SE Peaky', status: 'Good' },
    { id: '3', name: 'Jumpinpin Channel', tide: 'High: 1.5m (09:00 AM)', wind: 'S 18-22 knots', swell: '1.4m South Heavy', status: 'Choppy' }
  ];

  const handleScroll = (event: any) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / (CARD_WIDTH + 20));
    if (index >= 0 && index < goldCoastSpots.length) {
      setActiveSpot(index);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Excellent': return '#10b981';
      case 'Good': return '#34d399';
      case 'Fair': return '#f59e0b';
      default: return '#ef4444';
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Gold Coast Marine Conditions</Text>
        <View style={styles.indicatorContainer}>
          {goldCoastSpots.map((_, idx) => (
            <View key={idx} style={[styles.indicator, activeSpot === idx && styles.activeIndicator]} />
          ))}
        </View>
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH + 20}
        snapToAlignment="start"
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scrollContainer}
      >
        {goldCoastSpots.map((spot) => (
          <View key={spot.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.spotName}>{spot.name}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(spot.status) + '20' }]}>
                <Text style={[styles.statusText, { color: getStatusColor(spot.status) }]}>{spot.status}</Text>
              </View>
            </View>

            <View style={styles.metricsGrid}>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>🌊 Tide Cycle</Text>
                <Text style={styles.metricValue}>{spot.tide}</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>💨 Wind Vector</Text>
                <Text style={styles.metricValue}>{spot.wind}</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>🏄 Swell Profile</Text>
                <Text style={styles.metricValue}>{spot.swell}</Text>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginVertical: 15, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#334155' },
  indicatorContainer: { flexDirection: 'row' },
  indicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#cbd5e1', marginLeft: 4 },
  activeIndicator: { backgroundColor: '#0284c7', width: 14 },
  scrollContainer: { paddingRight: 20 },
  card: { width: CARD_WIDTH, backgroundColor: '#ffffff', borderRadius: 16, padding: 20, marginRight: 20, borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  spotName: { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  statusBadge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  statusText: { fontSize: 12, fontWeight: '700' },
  metricsGrid: { gap: 10 },
  metricBox: { backgroundColor: '#f8fafc', padding: 12, borderRadius: 10 },
  metricLabel: { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 4 },
  metricValue: { fontSize: 14, fontWeight: '700', color: '#1e293b' }
});

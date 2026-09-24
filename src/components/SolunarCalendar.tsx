import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import {
  CalendarForecastEntry,
  getOrCreateCalendar,
  generate30DayForecast,
} from '../lib/solunarCalendarEngine';
import { Coordinates } from './SolunarForecaster';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DAY_CARD_WIDTH = 100;

export interface SolunarCalendarProps {
  coordinates?: Coordinates;
  initialDate?: Date;
  onDaySelect?: (entry: CalendarForecastEntry) => void;
}

function ratingText(rating: string): 'PEAK BITING WINDOW' | 'GOOD' | 'AVERAGE' | 'POOR' | undefined {
  if (rating.includes('PEAK')) return 'PEAK BITING WINDOW';
  if (rating === 'GOOD') return 'GOOD';
  if (rating === 'AVERAGE') return 'AVERAGE';
  return 'POOR';
}

export default function SolunarCalendar({
  coordinates,
  initialDate = new Date(),
  onDaySelect,
}: SolunarCalendarProps) {
  const [entries, setEntries] = useState<CalendarForecastEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(initialDate);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => initialDate.getMonth());

  const coords: Coordinates = coordinates || { latitude: -27.9625, longitude: 153.4264 };

  useEffect(() => {
    loadCalendar();
  }, [coords]);

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    try {
      const cached = await getOrCreateCalendar(coords);
      setEntries(cached);
    } catch (error) {
      console.error('[Solunar Calendar] Failed to load calendar:', error);
      const fresh = generate30DayForecast(coords);
      setEntries(fresh);
    } finally {
      setLoading(false);
    }
  }, [coords]);

  const handleDayPress = (entry: CalendarForecastEntry) => {
    const date = new Date(entry.date);
    setSelectedDate(date);
    setCurrentMonth(date.getMonth());
    onDaySelect?.(entry);
  };

  const goToMonth = (dir: -1 | 1) => {
    const newDate = new Date(selectedDate);
    newDate.setMonth(newDate.getMonth() + dir);
    setCurrentMonth(newDate.getMonth());
    setSelectedDate(newDate);
  };

  const selectedEntry = entries.find((e) => {
    const d = new Date(e.date);
    return d.toDateString() === selectedDate.toDateString();
  });

  return (
    <View style={styles.container}>
      {/* Month Header */}
      <View style={styles.monthHeader}>
        <TouchableOpacity onPress={() => goToMonth(-1)} style={styles.monthNavBtn}>
          <Text style={styles.monthNavText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthTitle}>
          {new Date(2025, currentMonth, 1).toLocaleDateString('en-AU', {
            month: 'long',
            year: 'numeric',
          })}
        </Text>
        <TouchableOpacity onPress={() => goToMonth(1)} style={styles.monthNavBtn}>
          <Text style={styles.monthNavText}>›</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading 30-day forecast…</Text>
        </View>
            ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dayGrid}
        >
          {entries.slice(0, 30).map((entry) => {
            const dayDate = new Date(entry.date);
            const dayNames = dayDate.toLocaleDateString('en-AU', { weekday: 'short' });
            const dayNum = dayDate.getDate();
            const monthName = dayDate.toLocaleDateString('en-AU', { month: 'short' });
            const isSelected = dayDate.toDateString() === selectedDate.toDateString();
            const ratingColors: Record<string, any> = {
              PEAK: styles.ratingPeak,
              GOOD: styles.ratingGood,
              AVERAGE: styles.ratingAvg,
              POOR: styles.ratingPoor,
            };

            return (
              <TouchableOpacity
                key={entry.isoDate}
                onPress={() => handleDayPress(entry)}
                style={[styles.dayCard, isSelected && styles.dayCardSelected]}
              >
                <Text style={styles.dayName}>{dayNames}</Text>
                <Text style={styles.dayNum}>{dayNum}</Text>
                <Text style={styles.monthLabel}>{monthName}</Text>
                <Text style={styles.moonIcon}>{entry.moonIcon}</Text>
                <View style={styles.activityBarContainer}>
                  <View
                    style={[
                      styles.activityBarFill,
                      { width: `${Math.round(entry.activityIndex)}%` } as any,
                      ratingColors[entry.rating.replace(' BITING WINDOW', '')] || styles.ratingPoor,
                    ]}
                  />
                </View>
                <Text style={styles.activityIndex}>{entry.activityIndex}%</Text>
                {entry.peakStartTime && <Text style={styles.peakTag}>PEAK</Text>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Detail View for Selected Day */}
      {selectedEntry && !loading && (
        <ScrollView style={styles.detailContainer} showsVerticalScrollIndicator={false}>
          <View style={styles.detailHeader}>
            <Text style={styles.detailDate}>
              {new Date(selectedEntry.date).toLocaleDateString('en-AU', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </Text>
            <Text style={styles.detailMoonIcon}>{selectedEntry.moonIcon}</Text>
          </View>

          <View style={styles.detailActivityRow}>
            <Text style={styles.detailActivityLabel}>Activity Index</Text>
            <Text
              style={[
                styles.detailActivityValue,
                selectedEntry.activityIndex >= 80 && styles.ratingPeak,
                selectedEntry.activityIndex >= 60 && selectedEntry.activityIndex < 80 && styles.ratingGood,
                selectedEntry.activityIndex >= 40 && selectedEntry.activityIndex < 60 && styles.ratingAvg,
                selectedEntry.activityIndex < 40 && styles.ratingPoor,
              ]}
            >
              {selectedEntry.activityIndex}%
            </Text>
          </View>

          <View style={styles.detailRatingContainer}>
            <Text
              style={[
                styles.detailRatingText,
                selectedEntry.activityIndex >= 80 && styles.ratingPeak,
                selectedEntry.activityIndex >= 60 && selectedEntry.activityIndex < 80 && styles.ratingGood,
                selectedEntry.activityIndex >= 40 && selectedEntry.activityIndex < 60 && styles.ratingAvg,
                selectedEntry.activityIndex < 40 && styles.ratingPoor,
              ]}
            >
              {selectedEntry.rating}
            </Text>
          </View>

          <View style={styles.windowsRow}>
            <View style={styles.windowStat}>
              <Text style={styles.windowStatValue}>⚡ {selectedEntry.majorWindowCount}</Text>
              <Text style={styles.windowStatLabel}>Major Windows</Text>
            </View>
            <View style={styles.windowStat}>
              <Text style={styles.windowStatValue}>🌙 {selectedEntry.minorWindowCount}</Text>
              <Text style={styles.windowStatLabel}>Minor Windows</Text>
            </View>
          </View>

          {selectedEntry.peakStartTime && (
            <View style={styles.peakTimeBox}>
              <Text style={styles.peakTimeLabel}>🔥 Peak Bite Window Starts</Text>
              <Text style={styles.peakTimeValue}>{selectedEntry.peakStartTime}</Text>
            </View>
          )}
        </ScrollView>
      )}
        </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    padding: 12,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  monthNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '600',
  },
  monthTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  dayGrid: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 12,
  },
  dayCard: {
    width: DAY_CARD_WIDTH,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 8,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  dayCardSelected: {
    borderWidth: 2,
    borderColor: '#38bdf8',
    backgroundColor: '#273449',
  },
  dayName: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  dayNum: {
    fontSize: 18,
    color: '#ffffff',
    fontWeight: '700',
  },
  monthLabel: {
    fontSize: 10,
    color: '#64748b',
  },
  moonIcon: {
    fontSize: 22,
  },
  activityBarContainer: {
    width: '100%',
    height: 4,
    backgroundColor: '#334155',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 2,
  },
  activityBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  activityIndex: {
    fontSize: 10,
    color: '#cbd5e1',
    fontWeight: '600',
  },
  peakTag: {
    fontSize: 9,
    color: '#fbbf24',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  loadingContainer: {
    padding: 24,
    alignItems: 'center',
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  detailContainer: {
    marginTop: 12,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  detailDate: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  detailMoonIcon: {
    fontSize: 32,
  },
  detailActivityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailActivityLabel: {
    color: '#94a3b8',
    fontSize: 14,
  },
  detailActivityValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  detailRatingContainer: {
    marginBottom: 16,
  },
  detailRatingText: {
    fontSize: 20,
    fontWeight: '700',
  },
  windowsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  windowStat: {
    alignItems: 'center',
    gap: 4,
  },
  windowStatValue: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
  },
  windowStatLabel: {
    fontSize: 11,
    color: '#94a3b8',
  },
  peakTimeBox: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  peakTimeLabel: {
    fontSize: 12,
    color: '#fbbf24',
    fontWeight: '600',
  },
  peakTimeValue: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '700',
  },
  ratingPeak: { color: '#10b981' },
  ratingGood: { color: '#38bdf8' },
  ratingAvg: { color: '#fbbf24' },
  ratingPoor: { color: '#ef4444' },
});

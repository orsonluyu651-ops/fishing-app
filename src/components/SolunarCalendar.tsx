import React, { useEffect, useState, useRef, useCallback, useMemo, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Animated,
  Easing,
} from 'react-native';
import {
  CalendarForecastEntry,
  getOrCreateCalendar,
  generate30DayForecast,
} from '../lib/solunarCalendarEngine';
import { Coordinates } from './SolunarForecaster';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DAY_CARD_WIDTH = 100;

const COLORS = {
  bg: '#0f172a',
  card: '#1e293b',
  border: '#334155',
  text: '#f1f5f9',
  muted: '#94a3b8',
  accent: '#38bdf8',
  peak: '#10b981',
  good: '#38bdf8',
  avg: '#fbbf24',
  poor: '#ef4444',
  brandSecondary: '#273449',
  textMutedDark: '#64748b',
  textMutedLight: '#cbd5e1',
} as const;

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

// ── ShimmerPlaceholder: continuous fade cycle for skeleton loading ─────
const ShimmerPlaceholder = memo(({ width, height, borderRadius }: { width: number; height: number; borderRadius?: number }) => {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
      { iterations: -1 },
    ).start();
  }, [shimmerAnim]);

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 0.6],
  });

  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: borderRadius ?? 4,
        backgroundColor: COLORS.border,
        opacity,
      }}
    />
  );
});
ShimmerPlaceholder.displayName = 'ShimmerPlaceholder';

// ── Memoized DayCard ─────────────────────────────────────────────────────
interface DayCardProps {
  entry: CalendarForecastEntry;
  isSelected: boolean;
  onPress: (entry: CalendarForecastEntry) => void;
}

const DayCard = memo(({ entry, isSelected, onPress }: DayCardProps) => {
  const dayDate = useMemo(() => new Date(entry.date), [entry.date]);
  const dayNames = dayDate.toLocaleDateString('en-AU', { weekday: 'short' });
  const dayNum = dayDate.getDate();
  const monthName = dayDate.toLocaleDateString('en-AU', { month: 'short' });

    const ratingKey = entry.rating.replace(' BITING WINDOW', '') as 'PEAK' | 'GOOD' | 'AVERAGE' | 'POOR';
  const ratingColorMap: Record<typeof ratingKey, string> = {
    PEAK: COLORS.peak,
    GOOD: COLORS.good,
    AVERAGE: COLORS.avg,
    POOR: COLORS.poor,
  };
  const ratingColor = ratingColorMap[ratingKey] || COLORS.poor;

  return (
    <TouchableOpacity
      style={[styles.dayCard, isSelected && styles.dayCardSelected]}
      onPress={() => onPress(entry)}
      activeOpacity={0.7}
    >
      <Text style={styles.dayName}>{dayNames}</Text>
      <Text style={styles.dayNum}>{dayNum}</Text>
      <Text style={styles.monthLabel}>{monthName}</Text>
      <Text style={styles.moonIcon}>{entry.moonIcon}</Text>
      <View style={styles.activityBarContainer}>
        <View style={[styles.activityBarFill, { width: `${Math.round(entry.activityIndex)}%`, backgroundColor: ratingColor }]} />
      </View>
      <Text style={styles.activityIndex}>{entry.activityIndex}%</Text>
      {entry.peakStartTime && <Text style={styles.peakTag}>PEAK</Text>}
    </TouchableOpacity>
  );
}, (prev, next) =>
  prev.entry.date === next.entry.date &&
  prev.entry.activityIndex === next.entry.activityIndex &&
  prev.entry.rating === next.entry.rating &&
  prev.isSelected === next.isSelected,
);
DayCard.displayName = 'DayCard';



export default function SolunarCalendar({
  coordinates,
  initialDate = new Date(),
  onDaySelect,
}: SolunarCalendarProps) {
    const [entries, setEntries] = useState<CalendarForecastEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(initialDate);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => initialDate.getMonth());

  // Accordion chevron rotation animation for detail view
  const chevronAnim = useRef(new Animated.Value(0)).current;

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

  const handleDayPress = useCallback((entry: CalendarForecastEntry) => {
    const date = new Date(entry.date);
    setSelectedDate(date);
    setCurrentMonth(date.getMonth());
    Animated.timing(chevronAnim, {
      toValue: 1,
      duration: 320,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start();
    onDaySelect?.(entry);
  }, [onDaySelect, chevronAnim]);

  const goToMonth = useCallback((dir: -1 | 1) => {
    const newDate = new Date(selectedDate);
    newDate.setMonth(newDate.getMonth() + dir);
    setCurrentMonth(newDate.getMonth());
    setSelectedDate(newDate);
    Animated.timing(chevronAnim, {
      toValue: 0,
      duration: 280,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [selectedDate, chevronAnim]);

  const selectedEntry = useMemo(
    () => entries.find((e) => {
      const d = new Date(e.date);
      return d.toDateString() === selectedDate.toDateString();
    }),
    [entries, selectedDate],
  );

  const monthTitle = useMemo(
    () => new Date(2025, currentMonth, 1).toLocaleDateString('en-AU', {
      month: 'long',
      year: 'numeric',
    }),
    [currentMonth],
  );

  const chevronRotate = chevronAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <View style={styles.container}>
      {/* Month Header */}
      <View style={styles.monthHeader}>
        <TouchableOpacity onPress={() => goToMonth(-1)} style={styles.monthNavBtn}>
          <Text style={styles.monthNavText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{monthTitle}</Text>
        <TouchableOpacity onPress={() => goToMonth(1)} style={styles.monthNavBtn}>
          <Text style={styles.monthNavText}>›</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <View style={styles.shimmerRow}>
            {[...Array(6)].map((_, i) => (
              <ShimmerPlaceholder key={i} width={80} height={100} borderRadius={12} />
            ))}
          </View>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dayGrid}
        >
          {entries.slice(0, 30).map((entry) => {
            const dayDate = new Date(entry.date);
            const isSelected = dayDate.toDateString() === selectedDate.toDateString();
            return (
              <DayCard
                key={entry.isoDate}
                entry={entry}
                isSelected={isSelected}
                onPress={handleDayPress}
              />
            );
          })}
        </ScrollView>
      )}

            {/* Detail View for Selected Day with accordion chevron rotation */}
      {selectedEntry && !loading && (
        <Animated.View
          style={[
            styles.detailContainer,
            { transform: [{ rotate: chevronRotate }] },
          ]}
        >
          <View style={styles.detailHeader}>
            <Text style={styles.detailDate}>
              {new Date(selectedEntry.date).toLocaleDateString('en-AU', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </Text>
            <Animated.Text style={{ fontSize: 32, transform: [{ rotate: chevronRotate }] }}>
              {selectedEntry.moonIcon}
            </Animated.Text>
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
        </Animated.View>
      )}
    </View>
    );
}

// ── Styles ──

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
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
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavText: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '600',
  },
  monthTitle: {
    color: COLORS.text,
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
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 8,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dayCardSelected: {
    borderWidth: 2,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.brandSecondary,
  },
  dayName: {
    fontSize: 12,
    color: COLORS.muted,
    fontWeight: '600',
  },
  dayNum: {
    fontSize: 18,
    color: COLORS.text,
    fontWeight: '700',
  },
  monthLabel: {
    fontSize: 10,
    color: COLORS.textMutedDark,
  },
  moonIcon: {
    fontSize: 22,
  },
  activityBarContainer: {
    width: '100%',
    height: 4,
    backgroundColor: COLORS.border,
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
    color: COLORS.textMutedLight,
    fontWeight: '600',
  },
  peakTag: {
    fontSize: 9,
    color: COLORS.avg,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
    loadingContainer: {
    padding: 24,
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.muted,
    fontSize: 14,
    marginBottom: 12,
  },
  shimmerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  detailContainer: {
    marginTop: 12,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderColor: COLORS.border,
    borderWidth: 1,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  detailDate: {
    color: COLORS.text,
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
    color: COLORS.muted,
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
    color: COLORS.text,
    fontWeight: '600',
  },
  windowStatLabel: {
    fontSize: 11,
    color: COLORS.muted,
  },
  peakTimeBox: {
    backgroundColor: COLORS.bg,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  peakTimeLabel: {
    fontSize: 12,
    color: COLORS.avg,
    fontWeight: '600',
  },
  peakTimeValue: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '700',
  },
  ratingPeak: { color: COLORS.peak },
  ratingGood: { color: COLORS.accent },
  ratingAvg: { color: COLORS.avg },
  ratingPoor: { color: COLORS.poor },
});

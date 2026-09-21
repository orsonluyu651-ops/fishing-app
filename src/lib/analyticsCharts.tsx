import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { MonthlyCatchData, CatchAnalytics } from './analyticsEngine';

const CHART_WIDTH_PADDING_LEFT = 40;
const CHART_WIDTH_PADDING_RIGHT = 20;
const CHART_HEIGHT_PADDING_TOP = 20;
const CHART_HEIGHT_PADDING_BOTTOM = 40;

const styles = StyleSheet.create({
  chartContainer: { alignItems: 'center' },
  chartPanel: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    marginBottom: 16,
  },
  chartTitle: { fontSize: 16, fontWeight: 'bold', color: '#0f172a', marginBottom: 4 },
  chartSubtitle: { fontSize: 13, color: '#64748b', marginBottom: 16 },
  chartLegend: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendColor: { width: 12, height: 12, borderRadius: 2 },
  legendText: { fontSize: 12, color: '#64748b' },
  yAxisContainer: {
    position: 'absolute',
    top: 0,
    left: CHART_WIDTH_PADDING_LEFT,
    bottom: CHART_HEIGHT_PADDING_BOTTOM,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  yAxisLabel: { width: 30, height: '100%', justifyContent: 'flex-end', alignItems: 'flex-end' },
  yAxisText: { fontSize: 10, color: '#94a3b8' },
  gridContainer: {
    position: 'absolute',
    top: 0,
    left: CHART_WIDTH_PADDING_LEFT,
    right: CHART_WIDTH_PADDING_RIGHT,
    bottom: CHART_HEIGHT_PADDING_BOTTOM,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gridLine: { flex: 1, height: '100%', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  barsContainer: {
    position: 'absolute',
    top: CHART_HEIGHT_PADDING_TOP,
    left: CHART_WIDTH_PADDING_LEFT,
    right: CHART_WIDTH_PADDING_RIGHT,
    bottom: CHART_HEIGHT_PADDING_BOTTOM,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
  },
  barWrapper: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '70%', minHeight: 2, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  barLabel: { fontSize: 10, color: '#64748b', marginTop: 4 },
  emptyStateContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 32,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyStateIcon: { fontSize: 48, marginBottom: 12 },
  emptyStateTitle: { fontSize: 16, fontWeight: 'bold', color: '#0f172a', marginBottom: 8, textAlign: 'center' },
  emptyStateMessage: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 20 },
  loadingContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 32,
    alignItems: 'center',
    marginBottom: 16,
  },
  loadingText: { fontSize: 14, color: '#64748b' },
});

export function MonthlyBarChart({ data, color = '#0284c7', height = 200, width }: { data: MonthlyCatchData[]; color?: string; height?: number; width?: number }) {
  const maxValue = Math.max(...data.map(d => d.count), 1);
  return (
    <View style={[styles.chartContainer, { height, width: width || '100%' }]}>
      <View style={styles.yAxisContainer}>
        {['25%', '50%', '75%', '100%'].map((_, i) => {
          const v = Math.round(maxValue * (i + 1) / 4);
          return <View key={i} style={styles.yAxisLabel}><Text style={styles.yAxisText}>{v}</Text></View>;
        })}
      </View>
      <View style={styles.gridContainer}>
        {[1,2,3,4].map(q => <View key={q} style={styles.gridLine} />)}
      </View>
      <View style={styles.barsContainer}>
        {data.map((item) => {
          const hp = maxValue > 0 ? (item.count / maxValue) * 100 : 0;
          return (
            <View key={item.month} style={styles.barWrapper}>
              <View style={[styles.bar, { height: `${Math.max(hp, item.count > 0 ? 4 : 0)}%`, backgroundColor: item.count > 0 ? color : '#e2e8f0' }]} />
              <Text style={styles.barLabel}>{item.monthLabel}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function AnalyticsEmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.emptyStateContainer}>
      <Text style={styles.emptyStateIcon}>📊</Text>
      <Text style={styles.emptyStateTitle}>{title}</Text>
      <Text style={styles.emptyStateMessage}>{message}</Text>
    </View>
  );
}

export function AnalyticsChartPanel({ analytics, isLoading = false }: { analytics: CatchAnalytics; isLoading?: boolean }) {
  if (isLoading) {
    return <View style={styles.loadingContainer}><Text style={styles.loadingText}>Loading analytics...</Text></View>;
  }
  if (analytics.totalCatches === 0) {
    return <AnalyticsEmptyState title="No catches logged yet" message="Pack your gear and hit the water!" />;
  }
  return (
    <View style={styles.chartPanel}>
      <Text style={styles.chartTitle}>Monthly Catch Yields</Text>
      <Text style={styles.chartSubtitle}>{analytics.totalCatches} catches logged • Avg length: {analytics.averageLength?.toFixed(1) || 'N/A'} cm</Text>
      <View style={styles.chartContainer}><MonthlyBarChart data={analytics.monthlyCatchVelocity} color="#0284c7" /></View>
      <View style={styles.chartLegend}>
        <View style={styles.legendItem}><View style={[styles.legendColor, { backgroundColor: '#0284c7' }]} /><Text style={styles.legendText}>Active months</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendColor, { backgroundColor: '#e2e8f0' }]} /><Text style={styles.legendText}>No catches</Text></View>
      </View>
    </View>
  );
}
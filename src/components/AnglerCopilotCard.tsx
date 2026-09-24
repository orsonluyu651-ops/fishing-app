/**
 * AnglerCopilotCard — Interactive AI Fishing Advisor dashboard card.
 *
 * Ties together the offline-first advisor pipeline:
 *   1. `compileSpotTelemetry` -> 1–100 bite-probability score + solunar/tidal snapshot
 *   2. `fetchAITactics`         -> AI-generated FishingTacticsBreakdown (SQLite-cached)
 *
 * Surface:
 *   • Header   : AI "brain" icon + generalized location text
 *   • Score    : smooth color-coded Bite Probability bar
 *                 (POOR -> Yellow, FAIR -> Amber, GOOD -> Cyan, EXCELLENT -> Green)
 *   • Badges   : inline Tide height/direction + Moon phase markers
 *   • Accordion: collapsible AI Tactics breakdown (lures, baits, spots, summary)
 *
 * Lifecycle: loading (skeleton + spinner) -> live card (progressive: telemetry
 * first, then tactics) -> offline-fallback (telemetry shown, tactics deferred)
 * -> defensive telemetry-error state. All logs prefixed "[Copilot UI]".
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import {
  compileSpotTelemetry,
  fetchAITactics,
  type AITacticsResult,
  type SpotTelemetry,
} from '../lib/fishingAdvisorEngine';

/**
 * Props for the Angler Copilot advisory card.
 *
 * NOTE: The spec listed `locationName: number`; a location *name* is inherently
 * human-readable text rendered in the header, so it is typed as `string`
 * (falling back to a coordinate generalization when absent). If a numeric spot
 * identifier was actually intended, widen the type and resolve it upstream.
 */
export interface AnglerCopilotCardProps {
  latitude: number;
  longitude: number;
  locationName?: string;
}

// ── Domain-derived presentation types ─────────────────────────────────────

type Grade = SpotTelemetry['biteProbabilityScore']['grade'];
type Direction = SpotTelemetry['tide']['direction'];
type NextTurn = SpotTelemetry['tide']['nextTurn'];

const SCORE_MIN = 1;
const SCORE_MAX = 100;

/** Map a bite-probability grade to its meter colour. */
function gradeColor(grade: Grade): string {
  switch (grade) {
    case 'POOR':
      return '#fbbf24'; // Yellow
    case 'FAIR':
      return '#f59e0b'; // Amber
    case 'GOOD':
      return '#38bdf8'; // Cyan
    case 'EXCELLENT':
      return '#10b981'; // Green
    default:
      return '#94a3b8'; // Slate fallback
  }
}

/** Human-readable tide direction label. */
function directionLabel(direction: Direction): string {
  switch (direction) {
    case 'incoming':
      return 'Rising';
    case 'outgoing':
      return 'Falling';
    case 'slack':
      return 'Slack';
    default:
      return 'Unknown';
  }
}

/** Format the next tidal turning point for display. */
function formatNextTurn(nextTurn: NextTurn): string {
  if (!nextTurn) {
    return 'No turn scheduled';
  }
  const time = new Date(nextTurn.time).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const label = nextTurn.type === 'high' ? 'High' : 'Low';
  return `Next ${label} @ ${time}`;
}

/** Generalize a coordinate into a readable location fallback. */
function generalizedLocation(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'Unknown location';
  }
  return `Near ${lat.toFixed(1)}°, ${lng.toFixed(1)}°`;
}

// ── Sub-components ────────────────────────────────────────────────────────

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function TacticsBreakdown({ tactics }: { tactics: AITacticsResult }) {
  return (
    <View>
      {tactics.bestSuitedSpots.length > 0 && (
        <View style={styles.tacticGroup}>
          <Text style={styles.tacticGroupTitle}>Best suited spots</Text>
          {tactics.bestSuitedSpots.map((spot) => (
            <Bullet key={`spot-${spot}`} text={spot} />
          ))}
        </View>
      )}

      <View style={styles.tacticGroup}>
        <Text style={styles.tacticGroupTitle}>Recommended lures</Text>
        {tactics.recommendedLures.map((lure) => (
          <Bullet key={`lure-${lure}`} text={lure} />
        ))}
      </View>

      <View style={styles.tacticGroup}>
        <Text style={styles.tacticGroupTitle}>Ideal baits</Text>
        {tactics.idealBaits.map((bait) => (
          <Bullet key={`bait-${bait}`} text={bait} />
        ))}
      </View>

      <View style={styles.tacticGroup}>
        <Text style={styles.tacticGroupTitle}>Technique summary</Text>
        <View style={styles.bulletRow}>
          <View style={styles.bulletDot} />
          <Text style={styles.bulletText}>{tactics.techniqueSummary}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────

export function AnglerCopilotCard({
  latitude,
  longitude,
  locationName,
}: AnglerCopilotCardProps) {
  const [telemetry, setTelemetry] = useState<SpotTelemetry | null>(null);
  const [tactics, setTactics] = useState<AITacticsResult | null>(null);
  const [loadingTelemetry, setLoadingTelemetry] = useState<boolean>(true);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [tacticsStatus, setTacticsStatus] = useState<
    'loading' | 'ready' | 'offline'
  >('loading');
  const [expanded, setExpanded] = useState<boolean>(true);

  useEffect(() => {
    let active = true;

    const loadAdvisor = async (): Promise<void> => {
      setLoadingTelemetry(true);
      setTelemetry(null);
      setTactics(null);
      setTacticsStatus('loading');
      setTelemetryError(null);

      try {
        const compiled = await compileSpotTelemetry(
          latitude,
          longitude,
          Date.now(),
          {
            tzOffsetMinutes: -new Date().getTimezoneOffset(),
          },
        );

        if (!active) return;
        setTelemetry(compiled);
        setLoadingTelemetry(false);

        try {
          const ai = await fetchAITactics(compiled);
          if (!active) return;
          setTactics(ai);
          setTacticsStatus('ready');
        } catch (tacticsError) {
          if (!active) return;
          console.warn(
            '[Copilot UI] AI tactics unavailable — operating in offline fallback.',
            tacticsError,
          );
          setTacticsStatus('offline');
        }
      } catch (error) {
        if (!active) return;
        console.error('[Copilot UI] Telemetry compilation failed:', error);
        setTelemetryError(
          'Unable to compile local fishing telemetry for this spot.',
        );
        setLoadingTelemetry(false);
      }
    };

    loadAdvisor();
    return () => {
      active = false;
    };
  }, [latitude, longitude]);

  // ── Defensive: telemetry could not be compiled at all ──
  if (telemetryError) {
    return (
      <View style={styles.card}>
        <View style={styles.errorState}>
          <Ionicons name="alert-circle" size={24} color="#f87171" />
          <Text style={styles.errorText}>{telemetryError}</Text>
        </View>
      </View>
    );
  }

  // ── Telemetry still compiling (skeleton) ──
  if (loadingTelemetry || !telemetry) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.skeletonTitle} />
          <ActivityIndicator size="small" color="#38bdf8" />
        </View>
        <View style={styles.skeletonScore} />
        <View style={styles.skeletonBadges}>
          <View style={styles.skeletonBadge} />
          <View style={styles.skeletonBadge} />
        </View>
      </View>
    );
  }

  // ── Loaded: render the full advisory surface ──
  const { biteProbabilityScore, solunar, tide, cached } = telemetry;
  const score = Math.round(biteProbabilityScore.score);
  const grade: Grade = biteProbabilityScore.grade;
  const meterColor = gradeColor(grade);
  const progressPercent = Math.max(SCORE_MIN, Math.min(SCORE_MAX, score));
  const locationText =
    locationName ?? generalizedLocation(latitude, longitude);

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialCommunityIcons name="brain" size={22} color="#0284c7" />
          <Text style={styles.title}>Angler Copilot</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.location} numberOfLines={1}>
            {locationText}
          </Text>
          <View
            style={[
              styles.cacheChip,
              cached ? styles.cacheChipCached : styles.cacheChipLive,
            ]}
          >
            <View
              style={[
                styles.cacheDot,
                cached ? styles.cacheDotCached : styles.cacheDotLive,
              ]}
            />
            <Text style={styles.cacheLabel}>
              {cached ? 'Cached' : 'Live'}
            </Text>
          </View>
        </View>
      </View>

      {/* Score Meter */}
      <View style={styles.scoreMeter}>
        <View style={styles.scoreMeta}>
          <Text style={styles.scoreCaption}>Bite Probability</Text>
          <Text style={[styles.scoreGrade, { color: meterColor }]}>
            {grade}
          </Text>
        </View>
        <View style={styles.scoreTrack}>
          <View
            style={[
              styles.scoreFill,
              {
                width: `${progressPercent}%`,
                backgroundColor: meterColor,
              },
            ]}
          />
        </View>
        <View style={styles.scoreMeta}>
          <Text style={styles.scoreValue}>{score}/100</Text>
          <Text style={styles.scoreHint}>
            {cached
              ? 'Telemetry served from local cache'
              : 'Telemetry freshly scored'}
          </Text>
        </View>
      </View>

      {/* Telemetry Badges */}
      <View style={styles.badges}>
        <View style={styles.badge}>
          <Ionicons name="water" size={14} color="#0284c7" />
          <Text style={styles.badgeText}>
            {tide.heightAtInstant.toFixed(1)} m ·{' '}
            {directionLabel(tide.direction)} ·{' '}
            {formatNextTurn(tide.nextTurn)}
          </Text>
        </View>
        <View style={styles.badge}>
          <Ionicons name="moon" size={14} color="#94a3b8" />
          <Text style={styles.badgeText}>
            {solunar.moonPhase} · {solunar.illumination}% illuminated
          </Text>
        </View>
      </View>

      {/* Tactical Accordion */}
      <View style={styles.tacticsSection}>
        <TouchableOpacity
          style={styles.tacticsHeader}
          activeOpacity={0.7}
          onPress={() => setExpanded((value) => !value)}
        >
          <View style={styles.tacticsTitleRow}>
            <Ionicons name="bulb" size={16} color="#38bdf8" />
            <Text style={styles.tacticsTitle}>AI Tactics Guide</Text>
            {tactics ? (
              <View
                style={[
                  styles.sourceChip,
                  tactics.source === 'cache'
                    ? styles.sourceChipCached
                    : styles.sourceChipLive,
                ]}
              >
                <Text style={styles.sourceLabel}>
                  {tactics.source === 'cache' ? 'Cached' : 'AI-Generated'}
                </Text>
              </View>
            ) : null}
          </View>
          <Ionicons
            name="chevron-down"
            size={18}
            color="#94a3b8"
            style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
          />
        </TouchableOpacity>

        {expanded && (
          <View style={styles.tacticsBody}>
            {tacticsStatus === 'loading' ? (
              <View style={styles.tacticsLoading}>
                <ActivityIndicator size="small" color="#38bdf8" />
                <Text style={styles.tacticsLoadingText}>
                  Generating AI tactics…
                </Text>
              </View>
            ) : tacticsStatus === 'offline' || !tactics ? (
              <View style={styles.offlineNotice}>
                <Ionicons name="cloud-offline" size={18} color="#94a3b8" />
                <Text style={styles.offlineText}>
                  The AI Tactics guide will load once internet access returns.
                  Your local scoring telemetry is shown above.
                </Text>
              </View>
            ) : (
              <TacticsBreakdown tactics={tactics} />
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 16,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  location: {
    fontSize: 13,
    color: '#94a3b8',
    maxWidth: 180,
  },
  cacheChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  cacheChipCached: { backgroundColor: 'rgba(16,185,129,0.15)' },
  cacheChipLive: { backgroundColor: 'rgba(56,189,248,0.15)' },
  cacheDot: { width: 6, height: 6, borderRadius: 999 },
  cacheDotCached: { backgroundColor: '#10b981' },
  cacheDotLive: { backgroundColor: '#38bdf8' },
  cacheLabel: { fontSize: 11, fontWeight: '700', color: '#cbd5e1' },

  // Score meter
  scoreMeter: { marginBottom: 16 },
  scoreMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  scoreCaption: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  scoreGrade: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  scoreTrack: {
    height: 12,
    backgroundColor: '#1e293b',
    borderRadius: 6,
    overflow: 'hidden',
  },
  scoreFill: {
    height: '100%',
    borderRadius: 6,
  },
  scoreValue: { fontSize: 22, fontWeight: '800', color: '#f1f5f9' },
  scoreHint: { fontSize: 11, color: '#64748b' },

  // Badges
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flex: 1,
    minWidth: 140,
  },
  badgeText: { fontSize: 12, color: '#cbd5e1', flexShrink: 1 },

  // Tactics accordion
  tacticsSection: {
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  tacticsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  tacticsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  tacticsTitle: { fontSize: 14, fontWeight: '700', color: '#f1f5f9' },
  sourceChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    marginLeft: 'auto',
  },
  sourceChipCached: { backgroundColor: 'rgba(149,163,177,0.2)' },
  sourceChipLive: { backgroundColor: 'rgba(56,189,248,0.15)' },
  sourceLabel: { fontSize: 10, fontWeight: '700', color: '#94a3b8' },
  tacticsBody: { paddingVertical: 8 },
  tacticsLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  tacticsLoadingText: { fontSize: 13, color: '#94a3b8' },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 8,
  },
  offlineText: {
    flex: 1,
    fontSize: 13,
    color: '#cbd5e1',
    lineHeight: 18,
  },

  // Bullets
  tacticGroup: { marginBottom: 10 },
  tacticGroupTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#38bdf8',
    marginTop: 8,
  },
  bulletText: { fontSize: 13, color: '#e2e8f0', lineHeight: 18, flexShrink: 1 },

  // Skeleton
  skeletonTitle: {
    width: 120,
    height: 18,
    backgroundColor: '#1e293b',
    borderRadius: 4,
  },
  skeletonScore: {
    height: 12,
    backgroundColor: '#1e293b',
    borderRadius: 6,
    marginBottom: 16,
    opacity: 0.6,
  },
  skeletonBadges: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  skeletonBadge: {
    flex: 1,
    height: 28,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    opacity: 0.6,
  },

  // Error state
  errorState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#f87171',
    lineHeight: 18,
  },
});




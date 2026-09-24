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

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import {
  compileSpotTelemetry,
  fetchAITactics,
  buildAIPrompt,
  simulateAITacticsResponse,
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

    // ── Device location streaming ───────────────────────────────────────────
  const [useDeviceLocation, setUseDeviceLocation] = useState<boolean>(false);
  const [deviceCoords, setDeviceCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  // ── Suburb search ────────────────────────────────────────────────────────
  const [suburbQuery, setSuburbQuery] = useState<string>('');

  /** Hardcoded suburb-to-coordinate lookup for Gold Coast area hotspots. */
  const SUBURB_COORDS: Record<string, { latitude: number; longitude: number }> = {
        oxenford: { latitude: -27.421, longitude: 153.411 },       // Oxenford → Coomera River
    paradise: { latitude: -27.9116, longitude: 153.4216 },  // Paradise Point → Lions Park / Pier
  };

  /**
   * Resolve a suburb search query to coordinates.
   * Returns null if no match — the caller falls back to a custom label.
   */
  const resolveSuburbCoords = (query: string): { latitude: number; longitude: number } | null => {
    const key = query.toLowerCase().trim();
    if (SUBURB_COORDS[key]) {
      console.log('[Copilot Layout Complete] Suburb resolved:', key, SUBURB_COORDS[key]);
      return SUBURB_COORDS[key];
    }
    console.log('[Copilot Layout Complete] No coordinate match for suburb:', query);
        return null;
  };

  // ── Suburb-resolved coordinates override ─────────────────────────────────
  const [suburbCoords, setSuburbCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [suburbLabel, setSuburbLabel] = useState<string | null>(null);

  // ── Conversational chat ─────────────────────────────────────────────────
  interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    isStreaming?: boolean;
  }
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const scrollRef = useRef<ScrollView>(null);

  /**
   * Request foreground location permission and fetch the current position.
   * On success, overrides the incoming props with the device's exact coords.
   */
  const requestDeviceLocation = async (): Promise<void> => {
    console.log('[Copilot Chat] Requesting device location permission...');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('[Copilot Chat] Location permission denied by user.');
        setUseDeviceLocation(false);
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setDeviceCoords(coords);
      setUseDeviceLocation(true);
      console.log('[Copilot Chat] Device location acquired:', coords);
    } catch (error) {
      console.error('[Copilot Chat] Failed to acquire device location:', error);
      setUseDeviceLocation(false);
    }
  };

  /**
   * Returns the coordinates the engine should use: device coords if the
   * location switch is ON, otherwise the parent-provided hotspot props.
   */
  const effectiveCoords = (): { latitude: number; longitude: number } => {
    if (useDeviceLocation && deviceCoords) {
      return deviceCoords;
    }
    if (suburbCoords) {
      return suburbCoords;
    }
    return { latitude, longitude };
  };

  /**
   * Handle suburb search submission.
   * Resolves known suburbs to coordinates or falls back to a label override.
   */
  const handleSuburbSubmit = (): void => {
    const trimmed = suburbQuery.trim();
    if (!trimmed) return;

    const coords = resolveSuburbCoords(trimmed);
    if (coords) {
      setSuburbCoords(coords);
      setSuburbLabel(null);
      console.log('[Copilot Layout Complete] Suburb search resolved to coords:', coords);
    } else {
      // No coordinate match — use as a custom header override label
      setSuburbCoords(null);
      setSuburbLabel(trimmed);
      console.log('[Copilot Layout Complete] Using custom suburb label:', trimmed);
    }
  };

  /**
   * Append a message to the chat history.
   */
  const appendMessage = (role: 'user' | 'assistant', text: string): string => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const msg: ChatMessage = { id, role, text };
    setMessages((prev) => [...prev, msg]);
    return id;
  };

  /**
   * Simulate a streamed AI response by progressively revealing characters
   * of a deterministic tactics breakdown response.
   */
  const simulateStreamedResponse = async (
    question: string,
    telemetryPayload: SpotTelemetry,
  ): Promise<void> => {
    const prompt = buildAIPrompt(telemetryPayload);
    const breakdown = simulateAITacticsResponse(telemetryPayload, prompt);
    const simulatedText =
      `Based on your question: "${question}"\n\n` +
      `With a bite probability of ${telemetryPayload.biteProbabilityScore.score}/100 ` +
      `(${telemetryPayload.biteProbabilityScore.grade}) and ${telemetryPayload.tide.direction} tide:\n\n` +
      `**Recommended Lure:** ${breakdown.recommendedLures.join(', ')}\n` +
      `**Ideal Bait:** ${breakdown.idealBaits.join(', ')}\n` +
      `**Technique:** ${breakdown.techniqueSummary}\n\n` +
      `Tip: Cast near structure during the next ${telemetryPayload.tide.nextTurn ? `${telemetryPayload.tide.nextTurn.type} turn` : 'tide turn'} for best results.`;

    const msgId = appendMessage('assistant', '');

    const fullText = simulatedText;
    let revealed = '';
    const charDelay = 12; // ms per character for typing animation
    setIsResponding(true);

    for (let i = 0; i < fullText.length; i++) {
      revealed += fullText[i];
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, text: revealed } : m)),
      );
      await new Promise((r) => setTimeout(r, charDelay));
    }

    setIsResponding(false);
    scrollRef.current?.scrollToEnd({ animated: true });
  };

  /**
   * Send the user's chat message and trigger a streamed AI response.
   */
  const sendChatMessage = async (): Promise<void> => {
    const trimmed = chatInput.trim();
    if (!trimmed || isResponding) return;
    if (!telemetry) {
      appendMessage('assistant', 'Please wait while telemetry loads…');
      return;
    }

    console.log('[Copilot Chat] User asked:', trimmed);
    appendMessage('user', trimmed);
    setChatInput('');
    setIsResponding(true);
    scrollRef.current?.scrollToEnd({ animated: true });

    await simulateStreamedResponse(trimmed, telemetry);
  };

    // ── React to coordinate changes (telemetry + device location) ────────────
  useEffect(() => {
    let active = true;

    const loadAdvisor = async (): Promise<void> => {
      const { latitude: effLat, longitude: effLng } = effectiveCoords();
      setLoadingTelemetry(true);
      setTelemetry(null);
      setTactics(null);
      setTacticsStatus('loading');
      setTelemetryError(null);

      try {
        const compiled = await compileSpotTelemetry(
          effLat,
          effLng,
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
      }, [latitude, longitude, useDeviceLocation, deviceCoords, suburbCoords]);

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
          <View style={styles.headerLeft}>
            <MaterialCommunityIcons name="brain" size={22} color="#0284c7" />
            <View style={styles.skeletonTitle} />
          </View>
          {/* Skeleton location toggle pill */}
          <View style={[styles.locationTogglePill, { opacity: 0.3 }]}>
            <Ionicons name="location" size={12} color="#94a3b8" />
            <Text style={styles.locationToggleText}>📍 Current Location</Text>
          </View>
          {/* Skeleton location controls row (GPS toggle + search bar) */}
          <View style={styles.locationControlsRow}>
            <View style={[styles.locationTogglePill, { opacity: 0.25, flex: 1 }]}>
              <View style={{ width: 100, height: 12, backgroundColor: '#1e293b', borderRadius: 4 }} />
            </View>
            <View style={[styles.suburbSearchInput, { opacity: 0.3, backgroundColor: '#1e293b' }]} />
          </View>
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
  const displayLocationText = useDeviceLocation
    ? deviceCoords
      ? `📍 ${deviceCoords.latitude.toFixed(4)}°, ${deviceCoords.longitude.toFixed(4)}°`
      : 'Locating…'
    : suburbLabel
    ? `🔍 ${suburbLabel}`
    : locationText;

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
            {displayLocationText}
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
          {/* 📍 Current Location toggle pill */}
          <TouchableOpacity
            style={[
              styles.locationTogglePill,
              useDeviceLocation && styles.locationTogglePillActive,
            ]}
            activeOpacity={0.7}
            onPress={async () => {
              if (useDeviceLocation) {
                setUseDeviceLocation(false);
                console.log('[Copilot Chat] Location switch turned OFF — using hotspot coords.');
              } else {
                await requestDeviceLocation();
              }
            }}
          >
            <Ionicons
              name={useDeviceLocation ? 'location' : 'location-outline'}
              size={12}
              color={useDeviceLocation ? '#38bdf8' : '#94a3b8'}
            />
            <Text
              style={[
                styles.locationToggleText,
                useDeviceLocation && styles.locationToggleTextActive,
              ]}
            >
              📍 Current Location
            </Text>
          </TouchableOpacity>

          {/* 📍 Live GPS Tracking toggle pill + Suburb search row */}
          <View style={styles.locationControlsRow}>
            <TouchableOpacity
              style={[
                styles.locationTogglePill,
                useDeviceLocation && styles.locationTogglePillActive,
              ]}
              activeOpacity={0.7}
              onPress={async () => {
                if (useDeviceLocation) {
                  setUseDeviceLocation(false);
                  console.log('[Copilot Layout Complete] Live GPS toggle turned OFF.');
                } else {
                  await requestDeviceLocation();
                }
              }}
            >
              <Ionicons
                name={useDeviceLocation ? 'location' : 'location-outline'}
                size={12}
                color={useDeviceLocation ? '#38bdf8' : '#94a3b8'}
              />
              <Text
                style={[
                  styles.locationToggleText,
                  useDeviceLocation && styles.locationToggleTextActive,
                ]}
              >
                📍 Live GPS Tracking
              </Text>
            </TouchableOpacity>

            <TextInput
              style={styles.suburbSearchInput}
              value={suburbQuery}
              onChangeText={setSuburbQuery}
              placeholder="🔍 Search suburb (e.g., Oxenford, Paradise Point)..."
              placeholderTextColor="#94a3b8"
              onSubmitEditing={handleSuburbSubmit}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
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

      {/* ── Conversational divider ── */}
      <View style={styles.chatDivider} />

      {/* ── Chat Message History ── */}
      <View style={styles.chatContainer}>
        <ScrollView
          ref={scrollRef}
          style={styles.chatMessages}
          contentContainerStyle={styles.chatMessagesContent}
          scrollEnabled={messages.length > 0}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((msg) => (
            <View
              key={msg.id}
              style={[
                styles.chatBubble,
                msg.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant,
              ]}
            >
              <Text style={styles.chatBubbleText}>{msg.text}</Text>
              {msg.isStreaming && (
                <Ionicons name="ellipsis-horizontal" size={14} color="#94a3b8" />
              )}
            </View>
          ))}
          {messages.length === 0 && (
            <Text style={styles.chatPlaceholder}>
              Ask the Copilot anything about tactics, lures, or best spots…
            </Text>
          )}
        </ScrollView>

        {/* ── Chat Input Area ── */}
        <View style={styles.chatInputContainer}>
          <TextInput
            style={styles.chatInput}
            value={chatInput}
            onChangeText={setChatInput}
            placeholder="Ask the Copilot anything…"
            placeholderTextColor="#94a3b8"
            onSubmitEditing={sendChatMessage}
            returnKeyType="send"
            editable={!isResponding}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!chatInput.trim() || isResponding) && styles.sendButtonDisabled,
            ]}
            activeOpacity={0.7}
            onPress={sendChatMessage}
            disabled={!chatInput.trim() || isResponding}
          >
            {isResponding ? (
              <ActivityIndicator size="small" color="#0f172a" />
            ) : (
              <Ionicons name="send" size={18} color="#0f172a" />
            )}
          </TouchableOpacity>
        </View>
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

  // Location toggle pill
  locationTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(148,163,184,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.3)',
  },
  locationTogglePillActive: {
    backgroundColor: 'rgba(56,189,248,0.2)',
    borderColor: '#38bdf8',
  },
  locationToggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
  locationToggleTextActive: {
    color: '#38bdf8',
  },

  // Location controls row (GPS toggle + suburb search)
  locationControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  suburbSearchInput: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    color: '#e2e8f0',
    borderWidth: 1,
    borderColor: '#1e293b',
    minHeight: 32,
    maxHeight: 36,
    textAlignVertical: 'center',
  },

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

  // ── Chat UI ───────────────────────────────────────────────────────────
  chatDivider: {
    height: 1,
    backgroundColor: '#1e293b',
    marginHorizontal: 4,
    marginTop: 12,
    marginBottom: 8,
  },
  chatContainer: {
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingBottom: 8,
  },
  chatMessages: {
    maxHeight: 160,
    paddingHorizontal: 12,
  },
  chatMessagesContent: {
    paddingBottom: 4,
  },
  chatBubble: {
    maxWidth: '85%',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    marginBottom: 6,
    fontSize: 13,
    lineHeight: 18,
  },
  chatBubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#0284c7',
    color: '#f1f5f9',
    borderBottomRightRadius: 6,
  },
  chatBubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: '#1e293b',
    color: '#cbd5e1',
    borderBottomLeftRadius: 6,
  },
  chatBubbleText: {
    fontSize: 13,
    lineHeight: 18,
  },
  chatPlaceholder: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: '#e2e8f0',
    borderWidth: 1,
    borderColor: '#1e293b',
    minHeight: 40,
    maxHeight: 80,
    textAlignVertical: 'center',
  },
  sendButton: {
    backgroundColor: '#38bdf8',
    borderRadius: 20,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
});




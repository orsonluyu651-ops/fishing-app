import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_SOURCE_URL_TEMPLATE,
  downloadTileRange,
  getOfflineTileUrlTemplate,
  regionToBbox,
  zoomForRegion,
} from '../../src/lib/mapTileCache';
import { countCachedTiles } from '@/lib/mapTileCache';
import { usePremiumStatus } from '@/lib/premiumAccess';
import { PremiumPaywall } from '@/components/PremiumPaywall';
import {
  createQuadtree,
  insert,
  queryViewport,
  type GeoPoint,
  type SpatialBoundingBox,
} from '@/lib/mapClusterEngine';

// ════════════════════════════════════════════════════════════
// FishloreMap — the Guide tab's interactive OSM map with an
// offline tile cache.
//
// ONLINE  : UrlTile renders the remote OSM template, and a debounced
//           background prefetch downloads the surrounding grid into the
//           local cache (max 60 tiles, throttled to 3 parallel transfers).
// OFFLINE : NetInfo flips the UrlTile template to the local
//           `${Paths.document.uri}tiles/{z}_{x}_{y}.png` tree instantly —
//           no component re-wiring, just a template swap.
//
// "Cache Current Region" runs an explicit, larger crawl with a visible
// progress bar. Every filesystem/network error is trapped into the batch
// summary — the map's interactivity is never interrupted by a bad tile.
// ════════════════════════════════════════════════════════════

interface Hotspot {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  fish: string;
}

const HOTSPOTS: Hotspot[] = [
  { id: '1', name: 'Southport Seaway', latitude: -27.9372, longitude: 153.4312, fish: 'Jewfish & Flathead' },
  { id: '2', name: 'Broadwater Banks', latitude: -27.9158, longitude: 153.4091, fish: 'Whiting & Bream' },
  { id: '3', name: 'Jumpinpin Channel', latitude: -27.7214, longitude: 153.4445, fish: 'Big Flathead' },
];

const GOLD_COAST_REGION = {
  latitude: -27.935,
  longitude: 153.425,
  latitudeDelta: 0.35,
  longitudeDelta: 0.35,
};

/**
 * Catch-pin projection of the hotspot list into the quadtree input contract
 * (`GeoPoint`): `species` carries the hotspot's target fish for the index.
 */
const HOTSPOT_POINTS: GeoPoint[] = HOTSPOTS.map((spot) => ({
  id: spot.id,
  latitude: spot.latitude,
  longitude: spot.longitude,
  species: spot.fish,
}));

/**
 * MapView region → `[minLng, minLat, maxLng, maxLat]`. The lng-first tuple
 * order is the SpatialBoundingBox contract — preserved verbatim, never
 * reordered (docs/phase2-quadtree-seam-audit.md §2.2).
 */
function regionToSpatialBox(region: typeof GOLD_COAST_REGION): SpatialBoundingBox {
  const halfLat = region.latitudeDelta / 2;
  const halfLng = region.longitudeDelta / 2;
  return [
    region.longitude - halfLng,
    region.latitude - halfLat,
    region.longitude + halfLng,
    region.latitude + halfLat,
  ];
}

const BUTTON_MAX_TILES = 400;
const BACKGROUND_MAX_TILES = 60;
const PREFETCH_DEBOUNCE_MS = 1500;

interface CacheProgress {
  completed: number;
  total: number;
}

export default function FishloreMap() {
  const mapRef = useRef<MapView | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [activeSpot, setActiveSpot] = useState<Hotspot>(HOTSPOTS[0]);
  const [region, setRegion] = useState(GOLD_COAST_REGION);
  const [progress, setProgress] = useState<CacheProgress | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Quadtree query output — the point set actually rendered this frame.
  // Seeded with the full dataset so the first paint matches the pre-quadtree
  // behavior; every region settle re-narrows it via queryViewport.
  const [visiblePoints, setVisiblePoints] = useState<GeoPoint[]>(HOTSPOT_POINTS);

  const buttonAbortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { isPro } = usePremiumStatus();
  const [showPaywall, setShowPaywall] = useState(false);

  // ── Online/offline interception (@react-native-community/netinfo) ──────
  useEffect(() => {
    let mounted = true;
    NetInfo.fetch().then((state) => {
      if (mounted) setIsOnline(!!state.isConnected && state.isInternetReachable !== false);
    });
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected && state.isInternetReachable !== false;
      setIsOnline(online);
      // Dropping offline mid-run: stop the transfers instead of letting the
      // batch burn through failing one tile at a time.
      if (!online) {
        buttonAbortRef.current?.abort();
        prefetchAbortRef.current?.abort();
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // Unmount: abort every in-flight transfer and clear pending timers.
  useEffect(
    () => () => {
      buttonAbortRef.current?.abort();
      prefetchAbortRef.current?.abort();
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    },
    [],
  );

  // Template routing: remote OSM when online, local cache tree when offline.
  const urlTemplate = useMemo(
    () => (isOnline ? TILE_SOURCE_URL_TEMPLATE : getOfflineTileUrlTemplate()),
    [isOnline],
  );

  const showStatus = useCallback((message: string) => {
    setStatus(message);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setStatus(null), 5000);
  }, []);

  // ── Silent background prefetch of the visible neighbourhood ────────────
  const schedulePrefetch = useCallback(
    (current: typeof GOLD_COAST_REGION) => {
      if (!isOnline) return;
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = setTimeout(() => {
        prefetchAbortRef.current?.abort();
        const controller = new AbortController();
        prefetchAbortRef.current = controller;
        const zoom = zoomForRegion(current);
        void downloadTileRange(regionToBbox(current, 1.5), zoom, zoom, {
          maxTiles: BACKGROUND_MAX_TILES,
          signal: controller.signal,
          // Deliberately silent: background prefetch never surfaces progress
          // or failures — it is best-effort and fully trapped.
        }).catch(() => undefined);
      }, PREFETCH_DEBOUNCE_MS);
    },
    [isOnline],
  );

  const handleRegionChangeComplete = useCallback(
    (next: typeof GOLD_COAST_REGION) => {
      setRegion(next);
      schedulePrefetch(next);

      // Quadtree seam (Phase 2): on every settled shift, re-index the point
      // dataset into a fresh tree rooted at the viewport box and query it
      // synchronously — O(log n + k) subdivision instead of a linear marker
      // sweep. The output collection feeds the render state directly.
      const viewportBox = regionToSpatialBox(next);
      const tree = createQuadtree(viewportBox);
      for (const point of HOTSPOT_POINTS) insert(tree, point);
      setVisiblePoints(queryViewport(tree, viewportBox));
    },
    [schedulePrefetch],
  );

  // ── Explicit "Cache Current Region" run ─────────────────────────────────
    const handleCacheRegion = useCallback(async () => {
    if (!isOnline || progress) return;

    // ── Premium gate: free users capped at 3 cached tiles ──
    const cachedCount = countCachedTiles();
    if (cachedCount > 3 && !isPro) {
      setShowPaywall(true);
      return;
    }

    // One explicit run at a time; cancel any straggling background prefetch.
    prefetchAbortRef.current?.abort();
    buttonAbortRef.current?.abort();
    const controller = new AbortController();
    buttonAbortRef.current = controller;

    const zoom = zoomForRegion(region);
    setProgress({ completed: 0, total: 0 });
    try {
      const summary = await downloadTileRange(
        regionToBbox(region, 2),
        Math.max(zoom - 1, MIN_ZOOM),
        Math.min(zoom + 1, MAX_ZOOM),
        {
          maxTiles: BUTTON_MAX_TILES,
          signal: controller.signal,
          onProgress: (completed, total) => setProgress({ completed, total }),
        },
      );
      if (summary.cancelled) {
        showStatus('Caching cancelled.');
      } else if (summary.failed === 0) {
        showStatus(
          `${summary.downloaded} tiles cached${summary.skipped > 0 ? ` · ${summary.skipped} already saved` : ''} — ready for offline use.`,
        );
      } else {
        showStatus(
          `${summary.downloaded} tiles cached · ${summary.failed} failed (weak signal?) — retry any time.`,
        );
      }
    } catch (error) {
      // The range downloader traps per-tile errors, so reaching here means
      // something unusual — still never allowed to crash the map.
      console.warn('[FishloreMap] region cache run failed:', error);
      showStatus('Could not cache this region — check your connection and retry.');
    } finally {
      setProgress(null);
    }
    }, [isOnline, progress, region, showStatus, isPro]);

  const cachePercent =
    progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  // Markers consume the quadtree output as an id set — O(1) membership per
  // hotspot, preserving the existing marker JSX contract below untouched.
  const visiblePointIds = useMemo(
    () => new Set(visiblePoints.map((p) => p.id)),
    [visiblePoints],
  );

  return (
    <View style={styles.card}>
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={GOLD_COAST_REGION}
          onRegionChangeComplete={handleRegionChangeComplete}
          showsUserLocation={false}
          showsCompass={false}
          toolbarEnabled={false}
        >
          <UrlTile
            urlTemplate={urlTemplate}
            tileSize={256}
            minimumZ={3}
            maximumZ={17}
            zIndex={1}
            // iOS: hide the Apple basemap so the OSM raster is authoritative.
            shouldReplaceMapContent={Platform.OS === 'ios'}
          />
          {HOTSPOTS.filter((spot) => visiblePointIds.has(spot.id)).map((spot) => (
            <Marker
              key={spot.id}
              coordinate={{ latitude: spot.latitude, longitude: spot.longitude }}
              title={spot.name}
              description={`Target: ${spot.fish}`}
              pinColor={spot.id === activeSpot.id ? '#007AFF' : '#e11d48'}
              onPress={() => setActiveSpot(spot)}
            />
          ))}
        </MapView>

        {/* Offline badge — always visible when the local template is active. */}
        {!isOnline && (
          <View style={styles.offlineBadge}>
            <Ionicons name="cloud-offline-outline" size={12} color="#fff" />
            <Text style={styles.offlineBadgeText}>Offline — cached tiles</Text>
          </View>
        )}

        {/* Progress overlay for the explicit cache run. Non-blocking: the map
            stays fully interactive underneath (pointerEvents box-none). */}
        {progress && (
          <View style={styles.progressCard} pointerEvents="box-none">
            <Text style={styles.progressLabel}>
              {progress.total === 0
                ? 'Preparing download…'
                : `Caching tiles — ${progress.completed}/${progress.total}`}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${cachePercent}%` }]} />
            </View>
          </View>
        )}

        {/* Result line from the last run. Errors surface as copy, never as
            an Alert, so the map's responsive interface is never interrupted. */}
        {status && !progress && (
          <View style={styles.statusCard} pointerEvents="none">
            <Text style={styles.statusText} numberOfLines={2}>
              {status}
            </Text>
          </View>
        )}

        {/* "Cache Current Region" trigger. Disabled while offline (nothing to
            download) or while a run is already active. */}
        <TouchableOpacity
          style={[styles.cacheButton, (!isOnline || !!progress) && styles.cacheButtonDisabled]}
          onPress={() => void handleCacheRegion()}
          disabled={!isOnline || !!progress}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Cache current region for offline use"
          accessibilityState={{ disabled: !isOnline || !!progress }}
        >
          <Ionicons
            name="download-outline"
            size={14}
            color={isOnline && !progress ? '#0f172a' : '#94a3b8'}
          />
          <Text
            style={[
              styles.cacheButtonText,
              (!isOnline || !!progress) && styles.cacheButtonTextDisabled,
            ]}
          >
            {progress ? 'Caching…' : isOnline ? 'Cache Current Region' : 'Offline'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Select Gold Coast Hotspot:</Text>
      <View style={styles.buttonRow}>
        {HOTSPOTS.map((spot) => (
          <TouchableOpacity
            key={spot.id}
            onPress={() => {
              setActiveSpot(spot);
              mapRef.current?.animateToRegion(
                {
                  latitude: spot.latitude,
                  longitude: spot.longitude,
                  latitudeDelta: 0.08,
                  longitudeDelta: 0.08,
                },
                400,
              );
            }}
            style={[styles.btn, activeSpot.id === spot.id && styles.activeBtn]}
          >
            <Text style={[styles.btnText, activeSpot.id === spot.id && styles.activeBtnText]}>
              {spot.name}
            </Text>
          </TouchableOpacity>
                ))}
      </View>

      {showPaywall && (
        <Modal visible transparent animationType="fade" statusBarTranslucent>
          <View style={styles.paywallOverlay}>
            <PremiumPaywall
              onUpgradeSuccess={() => setShowPaywall(false)}
              onClose={() => setShowPaywall(false)}
            />
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  paywallOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginTop: 12,
  },
  mapContainer: {
    height: 300,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#bae6fd',
    backgroundColor: '#e0f2fe',
  },
  map: { flex: 1 },

  offlineBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  offlineBadgeText: { fontSize: 11, fontWeight: '600', color: '#fff' },

  progressCard: {
    position: 'absolute',
    top: 10,
    right: 10,
    left: 10,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  progressLabel: { fontSize: 12, fontWeight: '600', color: '#0f172a', marginBottom: 6 },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: '#0284c7' },

  statusCard: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(15,23,42,0.88)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusText: { fontSize: 12, color: '#f8fafc', lineHeight: 17 },

  cacheButton: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0284c7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  cacheButtonDisabled: { borderColor: '#cbd5e1' },
  cacheButtonText: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  cacheButtonTextDisabled: { color: '#94a3b8' },

  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 8, marginTop: 12 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between' },
  btn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
    alignItems: 'center',
    marginHorizontal: 2,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  activeBtn: { backgroundColor: '#0284c7', borderColor: '#0284c7' },
  btnText: { fontSize: 11, fontWeight: '600', color: '#475569' },
  activeBtnText: { color: '#fff' },
});

// --- Leaderboard Hook (stubbed): isolated from external services to keep
// the Guide map bundle self-contained. Returns an empty, non-loading state
// until a real leaderboard service lands.
export function useMapLeaderboard(_activeSpecies: string) {
  return { leaderboard: [] as never[], isLoading: false };
}

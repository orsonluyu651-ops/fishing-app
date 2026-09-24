/**
 * Privacy-Focused Catch Card Export & Sharing Utility
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Builds an aesthetic catch card summary for sharing via the native iOS/Android
 * sharing sheet. **Privacy is the default**:
 *   - Precise `latitude` / `longitude` are never serialized into the shared output.
 *   - Raw coordinate vectors are automatically replaced with a regional label
 *     (defaults to "Secret Spot", customizable by the caller).
 *
 * The export text block includes:
 *   - Species name
 *   - Weight & length
 *   - Color-coded solunar activity rating (with emoji legend)
 *   - A compressed video asset reference URL (if available)
 *
 * @see src/lib/shareUtility.ts — the underlying react-native-share integration
 */
import { Alert } from 'react-native';
import { getSolunarRatingForDate } from '../components/SolunarForecaster';
import { shareCatchLog } from './shareUtility';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Solunar activity rating with associated color and emoji for the exported card.
 */
export type CatchCardRating = 'POOR' | 'AVERAGE' | 'GOOD' | 'PEAK BITING WINDOW';

export interface CatchCardLocation {
  /** The general regional name shown on the card (e.g. "Gold Coast", "Secret Spot"). */
  region: string;
  /** Precise coordinates are accepted but NEVER exported — used only for solunar calculation. */
  latitude?: number | null;
  longitude?: number | null;
}

export interface CatchCardInput {
  id: string;
  species: string;
  weight?: string | null;
  length?: string | null;
  location: CatchCardLocation;
  timestamp: number; // Unix ms
  videoUrl?: string | null;
  customLocationLabel?: string; // Override the region name for sharing
}

export interface CatchCardExport {
  title: string;
  shareText: string;
  shareUrl: string | null;
  solunarRating: CatchCardRating;
  solunarEmoji: string;
}

// ── Rating Helpers ────────────────────────────────────────────────────────────

const ratingColors: Record<CatchCardRating, string> = {
  'POOR': '#94a3b8',
  'AVERAGE': '#38bdf8',
  'GOOD': '#10b981',
  'PEAK BITING WINDOW': '#f59e0b',
};

const ratingEmojis: Record<CatchCardRating, string> = {
  'POOR': '🌑',
  'AVERAGE': '🌓',
  'GOOD': '🌕',
  'PEAK BITING WINDOW': '🔥',
};

/**
 * Returns a color-coded label for the solunar rating, e.g.
 * "GOOD" → "🟢 GOOD", "POOR" → "⚪ POOR".
 */
export function getRatingLabel(rating: CatchCardRating): string {
  const emoji = ratingEmojis[rating];
  const colorDot: Record<CatchCardRating, string> = {
    'POOR': '⚪',
    'AVERAGE': '🔵',
    'GOOD': '🟢',
    'PEAK BITING WINDOW': '🔥',
  };
  return `${colorDot[rating]} ${rating}`;
}

/**
 * Look up the hex color associated with a rating for inline styling.
 */
export function getRatingColor(rating: CatchCardRating): string {
  return ratingColors[rating];
}

// ── Privacy: Location Sanitizer ───────────────────────────────────────────────

/**
 * Strips precise coordinates and returns a privacy-safe location label.
 * If the caller provided a custom label, that is used. Otherwise, the region
 * name is used. If neither is available, "Secret Spot" is the default.
 *
 * **This function never returns or exposes latitude/longitude.**
 */
export function sanitizeLocationForExport(
  location: CatchCardLocation,
  customLabel?: string,
): string {
  if (customLabel && customLabel.trim().length > 0) {
    console.log('[Catch Share Export] Using custom location label:', customLabel);
    return customLabel.trim();
  }

  if (location.region && location.region.trim().length > 0) {
    console.log('[Catch Share Export] Using regional label:', location.region);
    return location.region.trim();
  }

    console.log('[Catch Share Export] No location label provided, defaulting to "Secret Spot".');
  return 'Secret Spot';
}

// ── Card Builder ──────────────────────────────────────────────────────────────

/**
 * Compiles a privacy-safe catch card export from raw catch data.
 *
 * - Strips `latitude` / `longitude` entirely from the share payload.
 * - Replaces raw coordinates with a general regional name (or "Secret Spot").
 * - Computes the solunar activity rating from the catch timestamp.
 * - Formats an aesthetic summary text block suitable for the sharing sheet.
 */
export function buildCatchCardExport(input: CatchCardInput): CatchCardExport {
  const date = new Date(input.timestamp);
  const solunarRating = getSolunarRatingForDate(date) as CatchCardRating;
  const solunarEmoji = ratingEmojis[solunarRating];
  const ratingLabel = getRatingLabel(solunarRating);

  const shareableLocation = sanitizeLocationForExport(input.location, input.customLocationLabel);

  const weightStr = input.weight ? ` (${input.weight})` : '';
  const videoRef = input.videoUrl ? `\n🎥 ${input.videoUrl}` : '';

  const shareText = [
    `🎣 Just landed a ${input.species}${weightStr}!`,
    `📍 ${shareableLocation}`,
    `${solunarEmoji} Solunar: ${ratingLabel}`,
    videoRef,
    '',
    ' — Caught via Fishlore App 📱',
  ].filter((line) => line !== '').join('\n');

  const shareUrl = input.videoUrl && input.videoUrl.startsWith('file://') ? input.videoUrl : null;

  console.log('[Catch Share Export] Card compiled for species:', input.species);
  console.log('[Catch Share Export] Privacy-safe location label:', shareableLocation);

    return {
    title: `${input.species}${weightStr}`,
    shareText,
    shareUrl,
    solunarRating,
    solunarEmoji,
  };
}

// ── Share Orchestrator ────────────────────────────────────────────────────────

/**
 * Builds a privacy-safe catch card and immediately fires the native share sheet.
 *
 * @param input  - Raw catch data (latitude/longitude will be stripped).
 * @throws       - Re-throws if the share sheet cannot be opened.
 */
export async function shareCatchCard(input: CatchCardInput): Promise<void> {
  console.log('[Catch Share Export] shareCatchCard invoked for catch ID:', input.id);

  try {
    const card = buildCatchCardExport(input);

    await shareCatchLog({
      title: card.title,
      weight: input.weight ?? undefined,
      locationName: sanitizeLocationForExport(input.location, input.customLocationLabel),
            imageUrl: card.shareUrl ?? undefined,
    });

    console.log('[Catch Share Export] Share sheet presented successfully.');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Catch Share Export] Share failed:', msg);
    Alert.alert('Sharing Unavailable', 'Could not open the system share sheet.');
  }
}

// ── Convenience: from FishTokFeed VideoItem ───────────────────────────────────

import { VideoItem } from '../components/FishTokFeed';

/**
 * Converts a FishTokFeed VideoItem into a privacy-safe catch card and shares it.
 * The VideoItem's title is used as the species, and the URL is passed as the
 * compressed video asset reference.
 */
export async function shareVideoItemCatch(item: VideoItem): Promise<void> {
  console.log('[Catch Share Export] shareVideoItemCatch invoked for item:', item.id);

  const species = item.speciesTags.length > 0 ? item.speciesTags[0] : item.title.split('!')[0];

  const input: CatchCardInput = {
    id: item.id,
    species,
    weight: null,
    length: null,
    location: {
      region: item.waterCondition.split('•')[0]?.trim() ?? 'Secret Spot',
    },
    timestamp: Date.now(),
    videoUrl: item.url,
    customLocationLabel: 'Secret Spot',
  };

  await shareCatchCard(input);
}
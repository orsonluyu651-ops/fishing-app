/**
 * Offline catch search & indexing engine.
 * In-memory, dependency-free client-side filtering for cached catches.
 */

/**
 * Optional filters accepted by {@link filterLocalCatches}.
 * Text tokens and tags are combined with logical AND; numeric boundaries are inclusive.
 */
export interface CatchSearchQueryOptions {
  /** Free-text query matched fuzzily against species / titles / notes. */
  text?: string | null;
  /** Required custom labels — a catch must contain EVERY entry (AND). */
  tags?: string[] | null;
  /** Inclusive lower bound for weight (same unit as the stored record). */
  minWeight?: number | null;
  /** Inclusive upper bound for weight. */
  maxWeight?: number | null;
  /** Inclusive lower bound for length (same unit as the stored record). */
  minLength?: number | null;
  /** Inclusive upper bound for length. */
  maxLength?: number | null;
}

/** Minimal normalized/read-compatible shape for a locally cached catch. */
export interface FilterableCatch {
  id: string;
  species?: string | null;
  title?: string | null;
  notes?: string | null;
  location_name?: string | null;
  locationName?: string | null;
  lure?: string | null;
  bait?: string | null;
  tags?: Array<string | null | undefined> | null;
  labels?: Array<string | null | undefined> | null;
  weight?: number | null;
  length?: number | null;
}

/** Debounce interval, in milliseconds, used by UI controls to avoid filtering on every keystroke. */
export const CATCH_SEARCH_DEBOUNCE_MS = 250;

/**
 * Canonicalize a potentially missing search value.
 * @param value Value to normalize.
 * @returns Lower-cased, trimmed text with internal whitespace collapsed. Never throws.
 * @complexity O(n), where n is the string length.
 */
export function normalizeSearchText(value: unknown): string {
  return String(value ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Test a normalized token as a direct or ordered-subsequence match.
 * @param haystack Normalized searchable text.
 * @param token Normalized token to locate.
 * @returns `true` for an empty token or a direct/fuzzy subsequence match.
 * @complexity O(n), where n is the haystack length.
 */
export function fuzzyTokenMatches(haystack: string, token: string): boolean {
  if (!token) return true;
  if (!haystack) return false;
  if (haystack.includes(token)) return true;
  let cursor = 0;
  for (const ch of token) {
    cursor = haystack.indexOf(ch, cursor);
    if (cursor === -1) return false;
    cursor += 1;
  }
  return true;
}

/**
 * Build the normalized full-text index for a catch.
 * @param catchItem Local catch to index.
 * @returns Searchable species, title, note, location, lure, and bait text.
 * @complexity O(k + n), where k is the number of fields and n is their combined length.
 */
export function buildCatchHaystack(catchItem: FilterableCatch): string {
  const parts = [
    catchItem.species,
    catchItem.title,
    catchItem.notes,
    catchItem.location_name,
    catchItem.locationName,
    catchItem.lure,
    catchItem.bait,
  ];
  return normalizeSearchText(parts.filter((p) => p != null).join(' '));
}

/**
 * Collect the normalized tag and label union for a catch.
 * @param catchItem Local catch to inspect.
 * @returns A new tag list; empty and null entries are omitted.
 * @complexity O(t), where t is the number of tag and label values.
 */
export function extractCatchTags(catchItem: FilterableCatch): string[] {
  const raw = [...(catchItem.tags ?? []), ...(catchItem.labels ?? [])];
  const out: string[] = [];
  for (const tag of raw) {
    const normalized = normalizeSearchText(tag);
    if (normalized) out.push(normalized);
  }
  return out;
}

function isFiniteBound(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Check a measurement against optional inclusive numeric boundaries.
 * @param value Candidate stored measurement.
 * @param min Optional lower boundary.
 * @param max Optional upper boundary.
 * @returns `true` when no valid bounds exist or the finite value is in range.
 * @complexity O(1).
 */
export function matchesNumericScope(
  value: unknown,
  min: number | null | undefined,
  max: number | null | undefined,
): boolean {
  const hasMin = isFiniteBound(min);
  const hasMax = isFiniteBound(max);
  if (!hasMin && !hasMax) return true;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return false;
  if (hasMin && numeric < (min as number)) return false;
  if (hasMax && numeric > (max as number)) return false;
  return true;
}

/**
 * Filters cached catches fully on-device.
 * Fuzzy-text AND tags AND inclusive weight/length scopes.
 * Pure (no I/O, no mutation); safe to call on every debounced keystroke.
 * @param catches Cached catch records to examine; nullish input produces an empty result.
 * @param queryOptions Optional fuzzy, tag, weight, and length filters.
 * @returns A new array retaining the original catch object references in input order.
 * @complexity O(n × (q + t)), where n is catches, q is text-token work, and t is tag work.
 */
export async function filterLocalCatches<T extends { id: string }>(
  catches: readonly T[] | null | undefined,
  queryOptions: CatchSearchQueryOptions | null | undefined = {},
): Promise<T[]> {
  const safeCatches = Array.isArray(catches) ? catches : [];
  const options = queryOptions ?? {};
  const tokens = normalizeSearchText(options.text).split(' ').filter(Boolean);
  const requiredTags = Array.isArray(options.tags)
    ? options.tags.map(normalizeSearchText).filter(Boolean)
    : [];
  const minWeight = isFiniteBound(options.minWeight) ? options.minWeight : null;
  const maxWeight = isFiniteBound(options.maxWeight) ? options.maxWeight : null;
  const minLength = isFiniteBound(options.minLength) ? options.minLength : null;
  const maxLength = isFiniteBound(options.maxLength) ? options.maxLength : null;

  const results: T[] = [];
  for (const catchItem of safeCatches) {
    if (!catchItem || typeof catchItem !== 'object') continue;
    const view = catchItem as T & FilterableCatch;
    if (tokens.length > 0) {
      const haystack = buildCatchHaystack(view);
      let allMatch = true;
      for (const token of tokens) {
        if (!fuzzyTokenMatches(haystack, token)) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) continue;
    }
    if (requiredTags.length > 0) {
      const available = new Set(extractCatchTags(view));
      let allTagsPresent = true;
      for (const tag of requiredTags) {
        if (!available.has(tag)) {
          allTagsPresent = false;
          break;
        }
      }
      if (!allTagsPresent) continue;
    }
    if (!matchesNumericScope(view.weight, minWeight, maxWeight)) continue;
    if (!matchesNumericScope(view.length, minLength, maxLength)) continue;
    results.push(catchItem);
  }
  return results;
}

export default filterLocalCatches;

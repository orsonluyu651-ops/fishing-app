import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CATCH_SEARCH_DEBOUNCE_MS, filterLocalCatches } from '../lib/catchSearchEngine';
import type { CatchSearchQueryOptions } from '../lib/catchSearchEngine';

/** Default accessible empty-state message shown when no local catch matches. */
export const EMPTY_CATCH_SEARCH_MESSAGE =
  'No catches match your current filter parameters. Try expanding your search queries!';

/** Default tag chips offered before tags are discovered from cached catches. */
export const DEFAULT_CATCH_TAG_SUGGESTIONS = [
  'Topwater', 'Estuary', 'Night Bite', 'Deep Reef', 'Live Bait', 'Catch & Release',
];

/** Controlled filter values managed by {@link CatchSearchControls}. */
export interface CatchSearchControlValues {
  text: string;
  tags: string[];
  minWeight: number | null;
  maxWeight: number | null;
  minLength: number | null;
  maxLength: number | null;
}

/** Immutable-by-convention baseline used when clearing all local filters. */
export const EMPTY_CATCH_SEARCH_VALUES: CatchSearchControlValues = {
  text: '', tags: [], minWeight: null, maxWeight: null, minLength: null, maxLength: null,
};

interface CatchSearchControlsProps<T extends { id: string }> {
  catches: readonly T[];
  tagSuggestions?: string[];
  onResultsChange?: (results: T[]) => void;
  children?: (args: { results: T[]; searching: boolean; controls: React.ReactElement }) => React.ReactNode;
}

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatOptionalNumber(value: number | null): string {
  return value == null ? '' : String(value);
}
/**
 * Render debounced local-search controls and publish matching cached catches.
 * The effect clears its previous timeout and identifies each request so stale
 * asynchronous filter completions cannot replace newer results.
 * @param props Cached catches, optional tag suggestions, result callback, and optional render prop.
 * @returns Search controls or the caller's render-prop output.
 */
export function CatchSearchControls<T extends { id: string }>({
  catches,
  tagSuggestions = DEFAULT_CATCH_TAG_SUGGESTIONS,
  onResultsChange,
  children,
}: CatchSearchControlsProps<T>): React.JSX.Element {
  const [values, setValues] = useState<CatchSearchControlValues>(EMPTY_CATCH_SEARCH_VALUES);
  const [results, setResults] = useState<T[]>([...catches]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const onResultsRef = useRef(onResultsChange);
  onResultsRef.current = onResultsChange;

  const availableTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of tagSuggestions) {
      const key = s.trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, s.trim());
    }
    for (const c of catches) {
      const view = c as T & { tags?: unknown; labels?: unknown };
      const tags = Array.isArray(view.tags) ? view.tags : [];
      const labels = Array.isArray(view.labels) ? view.labels : [];
      const pool = [...tags, ...labels];
      for (const t of pool) {
        const label = String(t ?? '').trim();
        const key = label.toLowerCase();
        if (label && !seen.has(key)) seen.set(key, label);
      }
    }
    return [...seen.values()];
  }, [catches, tagSuggestions]);

  useEffect(() => {
    setSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const requestId = (requestRef.current += 1);
    debounceRef.current = setTimeout(() => {
      const query: CatchSearchQueryOptions = {
        text: values.text, tags: values.tags,
        minWeight: values.minWeight, maxWeight: values.maxWeight,
        minLength: values.minLength, maxLength: values.maxLength,
      };
      filterLocalCatches([...catches], query).then((filtered) => {
        if (requestRef.current !== requestId) return;
        setResults(filtered);
        setSearching(false);
        onResultsRef.current?.(filtered);
      });
    }, CATCH_SEARCH_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [catches, values]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const toggleTag = (tag: string) => {
    const key = tag.trim().toLowerCase();
    setValues((prev) => {
      const has = prev.tags.some((t) => t.toLowerCase() === key);
      return {
        ...prev,
        tags: has
          ? prev.tags.filter((t) => t.toLowerCase() !== key)
          : [...prev.tags, tag.trim()],
      };
    });
  };
  const clearAll = () => setValues({ ...EMPTY_CATCH_SEARCH_VALUES, tags: [] });

  const controls = (
    <View style={styles.deck}>
      <TextInput
        style={styles.searchInput}
        value={values.text}
        onChangeText={(text) => setValues((p) => ({ ...p, text }))}
        placeholder="Search species, lures, notes…"
        placeholderTextColor="#94a3b8"
        accessibilityRole="search"
        accessibilityLabel="Search cached catches"
        accessibilityHint="Filters catches by species, lure, or notes"
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        accessibilityRole="list"
        accessibilityLabel="Filter by tags"
      >
        {availableTags.map((tag) => {
          const active = values.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
          return (
            <TouchableOpacity
              key={tag}
              onPress={() => toggleTag(tag)}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityLabel={`Filter by tag ${tag}`}
              accessibilityHint="Toggles this tag in the catch filter"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {active ? `✓ ${tag}` : tag}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={styles.scopeRow}>
        <View style={styles.scopeField}>
          <Text style={styles.scopeLabel}>Min wt</Text>
          <TextInput
            style={styles.scopeInput}
            value={formatOptionalNumber(values.minWeight)}
            onChangeText={(raw) => setValues((p) => ({ ...p, minWeight: parseOptionalNumber(raw) }))}
            placeholder="—"
            keyboardType="decimal-pad"
            accessibilityLabel="Minimum weight filter"
          />
        </View>
        <View style={styles.scopeField}>
          <Text style={styles.scopeLabel}>Max wt</Text>
          <TextInput
            style={styles.scopeInput}
            value={formatOptionalNumber(values.maxWeight)}
            onChangeText={(raw) => setValues((p) => ({ ...p, maxWeight: parseOptionalNumber(raw) }))}
            placeholder="—"
            keyboardType="decimal-pad"
            accessibilityLabel="Maximum weight filter"
          />
        </View>
        <View style={styles.scopeField}>
          <Text style={styles.scopeLabel}>Min len</Text>
          <TextInput
            style={styles.scopeInput}
            value={formatOptionalNumber(values.minLength)}
            onChangeText={(raw) => setValues((p) => ({ ...p, minLength: parseOptionalNumber(raw) }))}
            placeholder="—"
            keyboardType="decimal-pad"
            accessibilityLabel="Minimum length filter"
          />
        </View>
        <View style={styles.scopeField}>
          <Text style={styles.scopeLabel}>Max len</Text>
          <TextInput
            style={styles.scopeInput}
            value={formatOptionalNumber(values.maxLength)}
            onChangeText={(raw) => setValues((p) => ({ ...p, maxLength: parseOptionalNumber(raw) }))}
            placeholder="—"
            keyboardType="decimal-pad"
            accessibilityLabel="Maximum length filter"
          />
        </View>
        <TouchableOpacity
          onPress={clearAll}
          style={styles.clearButton}
          accessibilityRole="button"
          accessibilityLabel="Clear all search filters"
          accessibilityHint="Resets text, tags, and measurement filters"
        >
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (children) return <>{children({ results, searching, controls })}</>;
  return <>{controls}</>;
}

/**
 * Render the search empty state with a screen-reader label.
 * @param props Optional replacement display message.
 * @returns Centered empty-state content.
 */
export function CatchSearchEmptyState({ message = EMPTY_CATCH_SEARCH_MESSAGE }: { message?: string }) {
  return (
    <View style={styles.emptyWrap} accessibilityRole="text" accessibilityLabel="No catches match filters">
      <Text style={styles.emptyIcon}>🎣</Text>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  deck: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  searchInput: { backgroundColor: '#f1f5f9', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: '#0f172a' },
  chipRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#f8fafc', paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
  chipActive: { backgroundColor: '#0284c7', borderColor: '#0284c7' },
  chipText: { fontSize: 13, color: '#475569', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  scopeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  scopeField: { flex: 1 },
  scopeLabel: { fontSize: 11, color: '#64748b', marginBottom: 3 },
  scopeInput: { backgroundColor: '#f8fafc', borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 8, paddingVertical: 6, fontSize: 14, color: '#0f172a', textAlign: 'center' },
  clearButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  clearText: { color: '#0284c7', fontWeight: '700', fontSize: 13 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyText: { textAlign: 'center', color: '#64748b', fontSize: 14 },
});

export default CatchSearchControls;
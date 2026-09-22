import { supabase } from './supabase';

// ────────────────────────────────────────────────────────────────
// Live regulatory lookup (Phase 4 — regional regulatory rules)
// ────────────────────────────────────────────────────────────────
// Single source of truth for QLD legality. Hook into public.species /
// public.jurisdictions / public.fishing_rules (public-read via migrations
// 0001 & 0002) and resolve the DPI rule that is CURRENTLY effective
// (effective_to IS NULL) for the entered species in Queensland.
//
// Shared by:
//   * Add Catch  — evaluates whether a measured length is keepable.
//   * Ask Fishlore — renders a rule card from the same live values, so the
//     assistant can never state a size/bag that differs from what Add Catch
//     enforces.
//
// Always render min/max/bag from THIS resolver. Do not hand-encode
// regulatory numbers in app code.
// ────────────────────────────────────────────────────────────────

export interface InstalledRule {
  speciesName: string;
  minLength: number | null;
  maxLength: number | null;
  noTake: boolean;
  possessionLimit: number | null;
  combinedLimitName: string | null;
  sourceName: string;
  sourceUrl: string | null;
}

export async function lookupQldRule(speciesInput: string): Promise<InstalledRule | null> {
  const cleaned = speciesInput.trim();
  if (!cleaned) return null;

  // (1) Resolve the free-text species string to a species row. Primary:
  //     case-insensitive common_name; fallback: alternate_names array.
  const { data: byName } = await supabase
    .from('species')
    .select('id, common_name, alternate_names')
    .ilike('common_name', cleaned);
  let row = byName?.[0] ?? null;
  if (!row) {
    const { data: byAlt } = await supabase
      .from('species')
      .select('id, common_name, alternate_names')
      .contains('alternate_names', [cleaned]);
    row = byAlt?.[0] ?? null;
  }
  if (!row) return null; // unknown species → no rule to enforce

  // (2) The regulating jurisdiction for the Gold Coast.
  const { data: jur } = await supabase
    .from('jurisdictions')
    .select('id')
    .eq('name', 'Queensland')
    .single();
  if (!jur) return null;

  // (3) The currently-effective DPI rule for that species + jurisdiction.
  const { data: rule } = await supabase
    .from('fishing_rules')
    .select(
      'min_length_cm, max_length_cm, no_take, possession_limit, combined_limit_group_id, source_name, source_url',
    )
    .eq('species_id', row.id)
    .eq('jurisdiction_id', jur.id)
    .is('effective_to', null)
    .maybeSingle();
  if (!rule) return null;

  // (4) Combined limit groups (bream/whiting/trevally) carry the shared bag.
  let combinedLimitName: string | null = null;
  let possessionLimit: number | null =
    rule.possession_limit != null ? Number(rule.possession_limit) : null;
  if (rule.combined_limit_group_id) {
    const { data: group } = await supabase
      .from('combined_limit_groups')
      .select('name, possession_limit')
      .eq('id', rule.combined_limit_group_id)
      .maybeSingle();
    if (group) {
      combinedLimitName = group.name;
      if (!possessionLimit && group.possession_limit != null) {
        possessionLimit = Number(group.possession_limit);
      }
    }
  }

  return {
    speciesName: row.common_name,
    minLength: rule.min_length_cm != null ? Number(rule.min_length_cm) : null,
    maxLength: rule.max_length_cm != null ? Number(rule.max_length_cm) : null,
    noTake: rule.no_take,
    possessionLimit,
    combinedLimitName,
    sourceName: rule.source_name,
    sourceUrl: rule.source_url ?? null,
  };
}

export type LengthVerdict =
  | { kind: 'ok' }
  | { kind: 'no_take' }
  | { kind: 'undersized'; legal: string }
  | { kind: 'oversized'; legal: string };

export function evaluateRule(rule: InstalledRule, lengthCm: number): LengthVerdict {
  if (rule.noTake) return { kind: 'no_take' };
  if (rule.minLength != null && lengthCm < rule.minLength)
    return { kind: 'undersized', legal: `${rule.minLength} cm minimum` };
  if (rule.maxLength != null && lengthCm > rule.maxLength)
    return { kind: 'oversized', legal: `${rule.minLength ?? ''}–${rule.maxLength} cm slot` };
  return { kind: 'ok' };
}
/**
 * Leaderboard Engine
 *
 * Fetches and transforms community catch data into ranked angler lists
 * for the global leaderboard. Uses the shared Supabase client so all
 * auth state and Row Level Security behave identically to other screens.
 *
 * Two rankings are compiled per timeframe:
 *   1. Top Angler Rankings — cumulative catch weight totals (heaviest wins)
 *   2. Species Variety Mastery — most distinct species caught
 */

import { supabase } from '@/lib/supabase';

export type LeaderboardTimeframe = 'weekly' | 'monthly' | 'all-time';

export interface AnglerRankEntry {
  user_id: string;
  username: string;
  display_name: string | null;
  is_pro: boolean;
  total_weight: number;
  catch_count: number;
  species_count: number;
  rank: number;
}

export interface SpeciesVarietyEntry {
  user_id: string;
  username: string;
  display_name: string | null;
  is_pro: boolean;
  species_count: number;
  total_weight: number;
  rank: number;
}

export interface LeaderboardMetrics {
  weightRankings: AnglerRankEntry[];
  speciesRankings: SpeciesVarietyEntry[];
  timeframe: LeaderboardTimeframe;
  generatedAt: string;
}

/**
 * Builds a Postgres date filter clause for the requested timeframe.
 * `weekly` = last 7 days from now, `monthly` = last 30 days, `all-time` = no filter.
 */
function buildDateFilter(timeframe: LeaderboardTimeframe): { gte?: string; column: string } {
  const now = new Date();
  switch (timeframe) {
    case 'weekly':
      return { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), column: 'captured_at' };
    case 'monthly':
      return { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), column: 'captured_at' };
    case 'all-time':
    default:
      return { column: 'captured_at' };
  }
}

/**
 * Fetches leaderboard metrics from the catches + profiles tables.
 *
 * The query:
 *   1. Filters catches by timeframe (captured_at >= threshold)
 *   2. Filters to leaderboard_eligible = true catches only
 *   3. Joins to profiles for username/display_name/is_pro
 *   4. Aggregates by user: SUM(weight), COUNT(*), COUNT(DISTINCT species)
 *   5. Returns sorted result sets for both weight and species rankings
 *
 * @param timeframe - 'weekly' | 'monthly' | 'all-time'
 * @returns LeaderboardMetrics with top-25 rankings for each dimension
 */
export async function fetchLeaderboardMetrics(
  timeframe: LeaderboardTimeframe,
): Promise<LeaderboardMetrics> {
      const { gte, column } = buildDateFilter(timeframe);

  // ── Weight-based ranking (heaviest cumulative catch weight) ─────────────
  // Single query joining catches to profiles for display data.
  interface CatchesJoinProfile {
    user_id: string;
    weight: number | null;
    species: string;
    profiles: {
      username: string;
      display_name: string | null;
      is_pro: boolean;
    } | null;
  }

    const weightQuery = supabase
    .from('catches')
    .select(`user_id,weight,species,profiles!inner(username,display_name,is_pro)`)
    .eq('leaderboard_eligible', true);

  if (gte) {
    weightQuery.gte(column, gte);
  }

  const { data: weightRaw, error: weightError } = await weightQuery;

  if (weightError) {
    throw new Error(`Failed to fetch weight rankings: ${weightError.message}`);
  }

  // Aggregate into per-user totals
  const weightMap = new Map<string, {
    totalWeight: number;
    catchCount: number;
    speciesSet: Set<string>;
    profile: { username: string; display_name: string | null; is_pro: boolean };
  }>();

    // Pass through unknown to smoothly suppress structural type system contention
  const rows = (weightRaw as unknown) as CatchesJoinProfile[] | null;

  for (const row of rows || []) {
    const uid = row.user_id;
    const existing = weightMap.get(uid);
    if (existing) {
      existing.totalWeight += Number(row.weight) || 0;
      existing.catchCount += 1;
      existing.speciesSet.add(row.species);
    } else {
      weightMap.set(uid, {
        totalWeight: Number(row.weight) || 0,
        catchCount: 1,
        speciesSet: new Set([row.species]),
        profile: {
          username: row.profiles?.username ?? '',
          display_name: row.profiles?.display_name ?? null,
          is_pro: row.profiles?.is_pro ?? false,
        },
      });
    }
  }

  // Convert to sorted array (heaviest first), assign ranks, cap at 25
  const weightRankings: AnglerRankEntry[] = Array.from(weightMap.entries())
    .map(([uid, data]) => ({
      user_id: uid,
      username: data.profile.username,
      display_name: data.profile.display_name,
      is_pro: data.profile.is_pro,
      total_weight: data.totalWeight,
      catch_count: data.catchCount,
      species_count: data.speciesSet.size,
      rank: 0,
    }))
    .sort((a, b) => b.total_weight - a.total_weight)
    .slice(0, 25)
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

  // ── Species variety ranking (most distinct species caught) ───────────────
  const speciesRankings: SpeciesVarietyEntry[] = weightRankings
    .sort((a, b) => b.species_count - a.species_count)
    .slice(0, 25)
    .map((entry, idx) => ({
      user_id: entry.user_id,
      username: entry.username,
      display_name: entry.display_name,
      is_pro: entry.is_pro,
      species_count: entry.species_count,
      total_weight: entry.total_weight,
      rank: idx + 1,
    }));

  return {
    weightRankings,
    speciesRankings,
    timeframe,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Convenience: fetches just the current user's position in the weight leaderboard.
 */
export async function fetchUserWeightRank(
  userId: string,
  timeframe: LeaderboardTimeframe = 'all-time',
): Promise<number | null> {
  try {
    const metrics = await fetchLeaderboardMetrics(timeframe);
    const entry = metrics.weightRankings.find((r) => r.user_id === userId);
    return entry ? entry.rank : null;
  } catch {
    return null;
  }
}
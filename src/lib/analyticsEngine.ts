/**
 * Analytics Metric Transformer
 *
 * Aggregates catch histories into visual data points for the performance
 * analytics charts. Computes species breakdowns, moon phase distributions,
 * and monthly catch velocity curves.
 */

import { getSynodicMoonState } from './solunarEngine';

/**
 * Raw catch record from the database.
 */
export interface RawCatchRecord {
  id: string;
  species: string;
  length: number | null;
  weight: number | null;
  captured_at: string;
  user_id: string;
  spot_id: string | null;
  environmental?: Record<string, any>;
}

/**
 * Moon phase enumeration for catch analytics.
 */
export type MoonPhase = 'new_moon' | 'waxing_crescent' | 'first_quarter' | 'waxing_gibbous' | 'full_moon' | 'waning_gibbous' | 'last_quarter' | 'waning_crescent';

/**
 * Aggregated species breakdown for chart rendering.
 */
export interface SpeciesBreakdown {
  species: string;
  count: number;
  percentage: number;
  totalLength?: number;
  avgLength?: number;
}

const MOON_PHASE_LABELS: Record<MoonPhase, string> = {
  new_moon: 'New Moon',
  waxing_crescent: 'Waxing Crescent',
  first_quarter: 'First Quarter',
  waxing_gibbous: 'Waxing Gibbous',
  full_moon: 'Full Moon',
  waning_gibbous: 'Waning Gibbous',
  last_quarter: 'Last Quarter',
  waning_crescent: 'Waning Crescent',
};

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/** Maps solunar tracker phase names onto the analytics phase enumeration. */
const SOLUNAR_PHASE_TO_ENUM: Record<string, MoonPhase> = {
  'New Moon': 'new_moon',
  'Waxing Crescent': 'waxing_crescent',
  'First Quarter': 'first_quarter',
  'Waxing Gibbous': 'waxing_gibbous',
  'Full Moon': 'full_moon',
  'Waning Gibbous': 'waning_gibbous',
  'Last Quarter': 'last_quarter',
  'Waning Crescent': 'waning_crescent',
};

/**
 * Calculate the moon phase for a given date.
 * Delegates to the Phase 3 solunar synodic tracker (J2000-anchored, mean
 * synodic month 29.530588853 d) and maps the qualitative phase name onto
 * the analytics `MoonPhase` enumeration.
 */
function getMoonPhase(date: Date): MoonPhase {
  const state = getSynodicMoonState(date);
  return SOLUNAR_PHASE_TO_ENUM[state.phaseName] ?? 'new_moon';
}

/**
 * Compile catch analytics from an array of raw catch records.
 *
 * Computes:
 * - Top-performing target species breakdown arrays
 * - Catch frequency distributions mapped across Moon Phase segments
 * - Seasonal monthly bite-rate velocity curves
 *
 * @param catches - Array of raw catch records to analyze
 * @returns Complete analytics compilation result
 */
export function compileCatchAnalytics(catches: RawCatchRecord[]): CatchAnalytics {
  if (catches.length === 0) {
    return {
      totalCatches: 0,
      speciesBreakdown: [],
      moonPhaseDistribution: [],
      monthlyCatchVelocity: [],
      averageLength: null,
      topSpecies: '',
      catchDateRange: { startDate: null, endDate: null },
    };
  }

  // --- Species Breakdown ---
  const speciesCounts = new Map<string, { count: number; totalLength: number; lengthCount: number }>();

  for (const catchRecord of catches) {
    const existing = speciesCounts.get(catchRecord.species) || { count: 0, totalLength: 0, lengthCount: 0 };
    existing.count++;
    if (catchRecord.length !== null) {
      existing.totalLength += catchRecord.length;
      existing.lengthCount++;
    }
    speciesCounts.set(catchRecord.species, existing);
  }

  const speciesBreakdown: SpeciesBreakdown[] = Array.from(speciesCounts.entries())
    .map(([species, data]) => ({
      species,
      count: data.count,
      percentage: 0,
      totalLength: data.totalLength,
      avgLength: data.lengthCount > 0 ? data.totalLength / data.lengthCount : undefined,
    }))
    .sort((a, b) => b.count - a.count);

  const totalCount = speciesBreakdown.reduce((sum, s) => sum + s.count, 0);
  speciesBreakdown.forEach(s => {
    s.percentage = totalCount > 0 ? (s.count / totalCount) * 100 : 0;
  });

  // --- Moon Phase Distribution ---
  const moonPhaseCounts = new Map<MoonPhase, number>();
  for (const phase of Object.values(MOON_PHASE_LABELS)) {
    moonPhaseCounts.set(phase as MoonPhase, 0);
  }

  let totalLengthSum = 0;
  let lengthCount = 0;

  for (const catchRecord of catches) {
    const date = new Date(catchRecord.captured_at);
    const phase = getMoonPhase(date);
    moonPhaseCounts.set(phase, (moonPhaseCounts.get(phase) || 0) + 1);

    if (catchRecord.length !== null) {
      totalLengthSum += catchRecord.length;
      lengthCount++;
    }
  }

  const moonPhaseDistribution: MoonPhaseData[] = Array.from(moonPhaseCounts.entries())
    .map(([phase, count]) => ({
      phase,
      phaseLabel: MOON_PHASE_LABELS[phase],
      count,
      percentage: totalCount > 0 ? (count / totalCount) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // --- Monthly Catch Velocity ---
  const monthlyCounts = new Array(12).fill(0);
  const monthlyLengths = new Array(12).fill(0);
  const monthlyLengthCounts = new Array(12).fill(0);

  for (const catchRecord of catches) {
    const date = new Date(catchRecord.captured_at);
    const month = date.getMonth();
    monthlyCounts[month]++;

    if (catchRecord.length !== null) {
      monthlyLengths[month] += catchRecord.length;
      monthlyLengthCounts[month]++;
    }
  }

  const monthlyCatchVelocity: MonthlyCatchData[] = monthlyCounts.map((count, monthIndex) => ({
    month: monthIndex + 1,
    monthLabel: MONTH_LABELS[monthIndex],
    count,
    avgLength: monthlyLengthCounts[monthIndex] > 0
      ? monthlyLengths[monthIndex] / monthlyLengthCounts[monthIndex]
      : undefined,
  }));

  // --- Date Range ---
  const dates = catches
    .map(c => new Date(c.captured_at))
    .sort((a, b) => a.getTime() - b.getTime());

  const catchDateRange = {
    startDate: dates[0]?.toISOString() || null,
    endDate: dates[dates.length - 1]?.toISOString() || null,
  };

  const topSpecies = speciesBreakdown.length > 0 ? speciesBreakdown[0].species : '';
  const averageLength = lengthCount > 0 ? totalLengthSum / lengthCount : null;

  return {
    totalCatches: catches.length,
    speciesBreakdown,
    moonPhaseDistribution,
    monthlyCatchVelocity,
    averageLength,
    topSpecies,
    catchDateRange,
  };
}

// ── Catch history analytics (weight-frequency + spatial aggregation) ──────────

import { CatchRecord } from './exportEngine';

export interface SpeciesMetric {
  species: string;
  count: number;
  totalWeight: number;
  averageWeight: number;
}

export interface MonthlyTrendMetric {
  monthYear: string; // Format "MM/YYYY"
  count: number;
}

export interface AnglerProfileAnalytics {
  totalCatchesCount: number;
  allTimeWeightLbs: number;
  favoriteLocation: string;
  speciesDistribution: SpeciesMetric[];
  monthlyTrends: MonthlyTrendMetric[];
}

/**
 * Iterates through raw history rows to compile aggregated spatial and volumetric analytics.
 */
export function processAnglerCatchAnalytics(records: CatchRecord[]): AnglerProfileAnalytics {
  if (!records || records.length === 0) {
    return { totalCatchesCount: 0, allTimeWeightLbs: 0, favoriteLocation: 'None', speciesDistribution: [], monthlyTrends: [] };
  }

  let allTimeWeightLbs = 0;
  const locationCounts: Record<string, number> = {};
  const speciesMap: Record<string, { count: number; weight: number }> = {};
  const monthlyMap: Record<string, number> = {};

  records.forEach((record) => {
    allTimeWeightLbs += record.weight;

    // Aggregate geographical preference indexes
    locationCounts[record.location_name] = (locationCounts[record.location_name] || 0) + 1;

    // Aggregate biological group metrics
    if (!speciesMap[record.species]) {
      speciesMap[record.species] = { count: 0, weight: 0 };
    }
    speciesMap[record.species].count += 1;
    speciesMap[record.species].weight += record.weight;

    // Aggregate chronological monthly trends
    const date = new Date(record.created_at);
    const monthYear = `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
    monthlyMap[monthYear] = (monthlyMap[monthYear] || 0) + 1;
  });

  // Calculate favorite waterway signature
  let favoriteLocation = 'None';
  let maxLocationCount = 0;
  Object.entries(locationCounts).forEach(([loc, cnt]) => {
    if (cnt > maxLocationCount) {
      maxLocationCount = cnt;
      favoriteLocation = loc;
    }
  });

  // Map species arrays
  const speciesDistribution: SpeciesMetric[] = Object.entries(speciesMap)
    .map(([species, data]) => ({
      species,
      count: data.count,
      totalWeight: data.weight,
      averageWeight: data.weight / data.count,
    }))
    .sort((a, b) => b.count - a.count);

  // Map chronology trends sorted descending by calendar order
  const monthlyTrends: MonthlyTrendMetric[] = Object.entries(monthlyMap)
    .map(([monthYear, count]) => ({
      monthYear,
      count,
    }))
    .sort((a, b) => {
      const [aM, aY] = a.monthYear.split('/').map(Number);
      const [bM, bY] = b.monthYear.split('/').map(Number);
      return bY !== aY ? bY - aY : bM - aM;
    });

  return {
    totalCatchesCount: records.length,
    allTimeWeightLbs,
    favoriteLocation,
    speciesDistribution,
    monthlyTrends,
  };
}
/**
 * Moon phase distribution data point.
 */
export interface MoonPhaseData {
  phase: MoonPhase;
  phaseLabel: string;
  count: number;
  percentage: number;
}

/**
 * Monthly catch velocity data point.
 */
export interface MonthlyCatchData {
  month: number;
  monthLabel: string;
  count: number;
  avgLength?: number;
}

/**
 * Complete analytics compilation result.
 */
export interface CatchAnalytics {
  totalCatches: number;
  speciesBreakdown: SpeciesBreakdown[];
  moonPhaseDistribution: MoonPhaseData[];
  monthlyCatchVelocity: MonthlyCatchData[];
  averageLength: number | null;
  topSpecies: string;
  catchDateRange: {
    startDate: string | null;
    endDate: string | null;
  };
}

/**
 * One structured row of the solunar-bound feeding index matrix.
 */
export interface FeedingIndexEntry {
  phase: MoonPhase;
  phaseLabel: string;
  catchCount: number;
  /** Share of the dataset bound to this phase, 0–100 (rounded). */
  percentage: number;
  /** Catch concentration relative to the strongest phase, 0–100 (rounded). */
  feedingIndex: number;
}

/**
 * Binds an environmental catch dataset to the calculated lunar phases
 * synchronously: every record's `captured_at` instant is resolved through
 * the Phase 3 solunar synodic tracker (J2000-anchored), bucketed into the
 * eight-phase matrix, and reduced to structured feeding indices.
 *
 * @param catches - Raw catch records; malformed rows are skipped.
 * @returns Eight matrix rows (one per phase, fixed order), O(n) over the dataset.
 */
export function generateFeedingIndex(catches: RawCatchRecord[]): FeedingIndexEntry[] {
  const phases = Object.keys(MOON_PHASE_LABELS) as MoonPhase[];
  const counts = new Map<MoonPhase, number>(phases.map((phase) => [phase, 0]));
  let total = 0;

  if (Array.isArray(catches)) {
    for (const record of catches) {
      if (!record || typeof record.captured_at !== 'string') continue;
      const instant = new Date(record.captured_at);
      if (Number.isNaN(instant.getTime())) continue;
      const phase = getMoonPhase(instant);
      counts.set(phase, (counts.get(phase) ?? 0) + 1);
      total += 1;
    }
  }

  const maxCount = Math.max(0, ...counts.values());
  return phases.map((phase) => {
    const count = counts.get(phase) ?? 0;
    const concentration = maxCount > 0 ? (count / maxCount) * 100 : 0;
    return {
      phase,
      phaseLabel: MOON_PHASE_LABELS[phase],
      catchCount: count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      feedingIndex: Math.round(concentration),
    };
  });
}

/**
 * Historical analytics compilation extended with the solunar feeding matrix.
 */
export interface HistoricalAnalytics extends CatchAnalytics {
  feedingIndexMatrix: FeedingIndexEntry[];
  /** Phase holding the highest feeding index, or `null` for empty datasets. */
  peakFeedingPhase: MoonPhase | null;
}

/**
 * Core historical analytics pipeline with the solunar engine integrated:
 * returns the standard {@link CatchAnalytics} compilation plus the
 * solunar-bound {@link generateFeedingIndex} matrix and its peak phase.
 *
 * @param catches - Raw catch records; null/undefined degrade to the empty compilation.
 * @returns Synchronous, deterministic aggregation — O(n) over the dataset.
 */
export function getHistoricalAnalytics(catches: RawCatchRecord[]): HistoricalAnalytics {
  const base = compileCatchAnalytics(Array.isArray(catches) ? catches : []);
  const feedingIndexMatrix = generateFeedingIndex(catches);

  const peak = feedingIndexMatrix.reduce<FeedingIndexEntry | null>(
    (best, entry) =>
      entry.catchCount > 0 && (best === null || entry.feedingIndex > best.feedingIndex)
        ? entry
        : best,
    null,
  );

  return {
    ...base,
    feedingIndexMatrix,
    peakFeedingPhase: peak ? peak.phase : null,
  };
}
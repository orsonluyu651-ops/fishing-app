/**
 * Analytics Metric Transformer
 *
 * Aggregates catch histories into visual data points for the performance
 * analytics charts. Computes species breakdowns, moon phase distributions,
 * and monthly catch velocity curves.
 */

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

/**
 * Calculate the moon phase for a given date.
 * Uses a simplified algorithm based on the lunar cycle (~29.53 days).
 */
function getMoonPhase(date: Date): MoonPhase {
  const knownNewMoon = new Date('2024-01-01T00:00:00Z').getTime();
  const lunarCycle = 29.53 * 24 * 60 * 60 * 1000;
  const daysSinceReference = (date.getTime() - knownNewMoon) / (24 * 60 * 60 * 1000);
  const lunarDay = ((daysSinceReference % 29.53) + 29.53) % 29.53;
  const phaseProgress = lunarDay / 29.53;

  if (phaseProgress < 0.052 || phaseProgress >= 0.948) return 'new_moon';
  if (phaseProgress < 0.181) return 'waxing_crescent';
  if (phaseProgress < 0.310) return 'first_quarter';
  if (phaseProgress < 0.439) return 'waxing_gibbous';
  if (phaseProgress < 0.561) return 'full_moon';
  if (phaseProgress < 0.690) return 'waning_gibbous';
  if (phaseProgress < 0.819) return 'last_quarter';
  return 'waning_crescent';
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
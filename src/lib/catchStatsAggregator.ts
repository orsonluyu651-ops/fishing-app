import { CatchRecord } from './exportEngine';

export interface AnglerStatsSummary {
  totalCatches: number;
  maxWeightLbs: number;
  primarySpecies: string;
  recentCatchesCount: number; // Tailored to the trailing 30-day window
}

/**
 * Aggregates an angler's history log to compile performance summaries and milestones.
 */
export function aggregateAnglerCatchStats(records: CatchRecord[]): AnglerStatsSummary {
  const safeRecords = records || [];
  if (safeRecords.length === 0) {
    return { totalCatches: 0, maxWeightLbs: 0, primarySpecies: 'None', recentCatchesCount: 0 };
  }

  let maxWeight = 0;
  const speciesFrequencyMap: Record<string, number> = {};
  let recentCount = 0;

  // Track operational boundary calculations
  const now = new Date().getTime();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  for (const record of safeRecords) {
    // 1. Calculate maximum weight threshold
    if (record.weight > maxWeight) {
      maxWeight = record.weight;
    }

    // 2. Track species frequency distributions
    const cleanSpecies = record.species?.trim() || 'Unknown';
    speciesFrequencyMap[cleanSpecies] = (speciesFrequencyMap[cleanSpecies] || 0) + 1;

    // 3. Count matching items inside the 30-day operational horizon
    if (record.created_at) {
      const recordAge = now - new Date(record.created_at).getTime();
      if (recordAge >= 0 && recordAge <= thirtyDaysMs) {
        recentCount++;
      }
    }
  }

  // Find the single dominant targeted species
  let dominantSpecies = 'Unknown';
  let highestCount = 0;

  for (const [species, count] of Object.entries(speciesFrequencyMap)) {
    if (count > highestCount) {
      highestCount = count;
      dominantSpecies = species;
    }
  }

  return {
    totalCatches: safeRecords.length,
    maxWeightLbs: parseFloat(maxWeight.toFixed(2)),
    primarySpecies: dominantSpecies,
    recentCatchesCount: recentCount,
  };
}

import { CatchRecord } from './exportEngine';

export interface AnglerMilestone {
  id: string;
  title: string;
  description: string;
  targetCount: number;
  currentCount: number;
  progressPercent: number;
  isUnlocked: boolean;
}

/**
 * Sweeps user history lines to calculate active percentage accomplishments against target metrics.
 */
export function calculateAnglerMilestoneProgress(records: CatchRecord[]): AnglerMilestone[] {
  const safeRecords = records || [];

  // Define core seasonal milestones and species boundaries
  const benchmarks = [
    { id: 'first_blood', title: 'First Cast', description: 'Log your first catch entry into the system', species: 'ANY', target: 1 },
    { id: 'bream_master', title: 'Bream Collector', description: 'Land 5 Bream across any fishing spot', species: 'Bream', target: 5 },
    { id: 'heavy_weight', title: 'Heavy Haul', description: 'Catch a single fish weighing over 15 lbs', species: 'WEIGHT_THRESHOLD', target: 15 },
  ];

  return benchmarks.map((bench) => {
    let currentCount = 0;

    if (bench.species === 'ANY') {
      currentCount = safeRecords.length;
    } else if (bench.species === 'WEIGHT_THRESHOLD') {
      currentCount = safeRecords.some((r) => r.weight >= bench.target) ? bench.target : 0;
    } else {
      currentCount = safeRecords.filter(
        (r) => r.species.trim().toLowerCase() === bench.species.toLowerCase()
      ).length;
    }

    const progressPercent = Math.min(100, Math.round((currentCount / bench.target) * 100)) || 0;
    const isUnlocked = progressPercent >= 100;

    return {
      id: bench.id,
      title: bench.title,
      description: bench.description,
      targetCount: bench.target,
      currentCount,
      progressPercent,
      isUnlocked,
    };
  });
}

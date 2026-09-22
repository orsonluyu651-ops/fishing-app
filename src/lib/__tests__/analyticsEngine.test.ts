import {
  generateFeedingIndex,
  getHistoricalAnalytics,
  processAnglerCatchAnalytics,
  type RawCatchRecord,
} from '../analyticsEngine';
import { CatchRecord } from '../exportEngine';

describe('Angler Profile Performance Analytics Engine', () => {
  const mockDataset: CatchRecord[] = [
    { id: '1', weight: 10.5, species: 'Snapper', location_name: 'Mud Island', created_at: '2026-03-15T10:00:00Z' },
    { id: '2', weight: 12.0, species: 'Snapper', location_name: 'Mud Island', created_at: '2026-03-20T12:00:00Z' },
    { id: '3', weight: 4.5, species: 'Flathead', location_name: 'Nerang River', created_at: '2026-02-10T14:00:00Z' },
  ];

  it('correctly compiles global sums and identifies primary capture locations', () => {
    const analysis = processAnglerCatchAnalytics(mockDataset);
    expect(analysis.totalCatchesCount).toBe(3);
    expect(analysis.allTimeWeightLbs).toBe(27.0);
    expect(analysis.favoriteLocation).toBe('Mud Island');
  });

  it('correctly handles averaging and counts across biological divisions', () => {
    const analysis = processAnglerCatchAnalytics(mockDataset);
    const snapper = analysis.speciesDistribution.find((s) => s.species === 'Snapper');

    expect(snapper).toBeDefined();
    expect(snapper!.count).toBe(2);
    expect(snapper!.averageWeight).toBe(11.25);
    expect(snapper!.totalWeight).toBe(22.5);
  });

  it('gracefully outputs fallback structures when empty histories are supplied', () => {
    const analysis = processAnglerCatchAnalytics([]);
    expect(analysis.totalCatchesCount).toBe(0);
    expect(analysis.allTimeWeightLbs).toBe(0);
    expect(analysis.favoriteLocation).toBe('None');
    expect(analysis.speciesDistribution).toEqual([]);
    expect(analysis.monthlyTrends).toEqual([]);
  });

  it('returns null-safe fallback when records are null or undefined', () => {
    const analysis = processAnglerCatchAnalytics(null as unknown as CatchRecord[]);
    expect(analysis.totalCatchesCount).toBe(0);
    expect(analysis.favoriteLocation).toBe('None');
  });

  it('sorts species distribution by descending catch count', () => {
    const data: CatchRecord[] = [
      { id: 'a', weight: 5, species: 'Bream', location_name: 'A', created_at: '2026-01-01T00:00:00Z' },
      { id: 'b', weight: 3, species: 'Bream', location_name: 'B', created_at: '2026-01-02T00:00:00Z' },
      { id: 'c', weight: 8, species: 'Snapper', location_name: 'C', created_at: '2026-01-03T00:00:00Z' },
    ];
    const analysis = processAnglerCatchAnalytics(data);
    expect(analysis.speciesDistribution[0]!.species).toBe('Bream');
    expect(analysis.speciesDistribution[1]!.species).toBe('Snapper');
  });

  it('orders monthly trends from most recent to oldest', () => {
    const data: CatchRecord[] = [
      { id: 'x', weight: 5, species: 'Snapper', location_name: 'A', created_at: '2025-06-15T00:00:00Z' },
      { id: 'y', weight: 3, species: 'Snapper', location_name: 'A', created_at: '2026-01-10T00:00:00Z' },
      { id: 'z', weight: 4, species: 'Snapper', location_name: 'A', created_at: '2026-03-01T00:00:00Z' },
    ];
    const analysis = processAnglerCatchAnalytics(data);
    expect(analysis.monthlyTrends[0]!.monthYear).toBe('03/2026');
    expect(analysis.monthlyTrends[1]!.monthYear).toBe('01/2026');
    expect(analysis.monthlyTrends[2]!.monthYear).toBe('06/2025');
  });

  it('identifies the most frequent location when counts tie alphabetically is irrelevant', () => {
    const data: CatchRecord[] = [
      { id: '1', weight: 5, species: 'Snapper', location_name: 'River A', created_at: '2026-01-01T00:00:00Z' },
      { id: '2', weight: 3, species: 'Bream', location_name: 'River B', created_at: '2026-01-02T00:00:00Z' },
    ];
    const analysis = processAnglerCatchAnalytics(data);
    // Tie — whichever iterates first wins; assert it is one of the two
    expect(['River A', 'River B']).toContain(analysis.favoriteLocation);
  });
});

describe('Solunar-bound feeding index matrix (Phase 3)', () => {
  const phaseDataset: RawCatchRecord[] = [
    { id: 'a', species: 'Bream', length: null, weight: null, captured_at: '2024-01-11T12:00:00Z', user_id: 'u1', spot_id: null },
    { id: 'b', species: 'Bream', length: null, weight: null, captured_at: '2024-01-25T12:00:00Z', user_id: 'u1', spot_id: null },
    { id: 'c', species: 'Flathead', length: null, weight: null, captured_at: '2024-01-25T18:00:00Z', user_id: 'u1', spot_id: null },
  ];

  it('binds catches to the correct solunar lunar phases synchronously', () => {
    const matrix = generateFeedingIndex(phaseDataset);
    expect(matrix).toHaveLength(8);
    const newMoon = matrix.find((row) => row.phase === 'new_moon')!;
    const fullMoon = matrix.find((row) => row.phase === 'full_moon')!;
    expect(newMoon.catchCount).toBe(1);
    expect(newMoon.feedingIndex).toBe(50);
    expect(fullMoon.catchCount).toBe(2);
    expect(fullMoon.feedingIndex).toBe(100);
    expect(fullMoon.phaseLabel).toBe('Full Moon');
    expect(matrix.reduce((sum, row) => sum + row.catchCount, 0)).toBe(3);
  });

  it('degrades to a zeroed eight-row matrix for empty or null datasets', () => {
    const empty = generateFeedingIndex([]);
    expect(empty).toHaveLength(8);
    expect(empty.every((row) => row.catchCount === 0 && row.feedingIndex === 0 && row.percentage === 0)).toBe(true);
    expect(generateFeedingIndex(null as unknown as RawCatchRecord[])).toHaveLength(8);
    expect(generateFeedingIndex(undefined as unknown as RawCatchRecord[])).toHaveLength(8);
  });

  it('extends the historical pipeline with the solunar feeding matrix', () => {
    const analytics = getHistoricalAnalytics(phaseDataset);
    expect(analytics.totalCatches).toBe(3);
    expect(analytics.feedingIndexMatrix).toHaveLength(8);
    expect(analytics.peakFeedingPhase).toBe('full_moon');
    expect(analytics.speciesBreakdown.length).toBeGreaterThan(0);
    expect(analytics.moonPhaseDistribution.length).toBeGreaterThan(0);
  });

  it('returns a null-peak empty compilation for invalid datasets', () => {
    const analytics = getHistoricalAnalytics(null as unknown as RawCatchRecord[]);
    expect(analytics.totalCatches).toBe(0);
    expect(analytics.feedingIndexMatrix).toHaveLength(8);
    expect(analytics.peakFeedingPhase).toBeNull();
  });
});

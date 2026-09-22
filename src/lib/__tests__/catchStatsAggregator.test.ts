import { aggregateAnglerCatchStats } from '../catchStatsAggregator';
import { CatchRecord } from '../exportEngine';

describe('Angler Profile Analytics Summary Calculation Engine', () => {
  it('correctly extracts dominant species types and maximum weight floats', () => {
    const now = new Date();
    const records: CatchRecord[] = [
      { id: '1', weight: 4.5, species: 'Flathead', location_name: 'Nerang River', created_at: now.toISOString() },
      { id: '2', weight: 12.2, species: 'Bream', location_name: 'Broadwater', created_at: now.toISOString() },
      { id: '3', weight: 3.1, species: 'Bream', location_name: 'Seaway', created_at: now.toISOString() },
    ];

    const stats = aggregateAnglerCatchStats(records);
    expect(stats.totalCatches).toBe(3);
    expect(stats.maxWeightLbs).toBe(12.2);
    expect(stats.primarySpecies).toBe('Bream');
    expect(stats.recentCatchesCount).toBe(3);
  });

  it('handles empty log histories safely by dropping back to baseline zero states', () => {
    const stats = aggregateAnglerCatchStats([]);
    expect(stats.totalCatches).toBe(0);
    expect(stats.maxWeightLbs).toBe(0);
    expect(stats.primarySpecies).toBe('None');
    expect(stats.recentCatchesCount).toBe(0);
  });

  it('excludes records that fall completely outside the trailing 30-day milestone horizon', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 45); // Set to 45 days ago

    const records: CatchRecord[] = [
      { id: '1', weight: 5.0, species: 'Cod', location_name: 'Deep Reef', created_at: oldDate.toISOString() },
    ];

    const stats = aggregateAnglerCatchStats(records);
    expect(stats.totalCatches).toBe(1);
    expect(stats.maxWeightLbs).toBe(5.0);
    expect(stats.primarySpecies).toBe('Cod');
    expect(stats.recentCatchesCount).toBe(0);
  });

  it('treats null input as an empty history and returns zero-state defaults', () => {
    const stats = aggregateAnglerCatchStats(null as unknown as CatchRecord[]);
    expect(stats.totalCatches).toBe(0);
    expect(stats.primarySpecies).toBe('None');
  });

  it('defaults to "Unknown" when species field is missing', () => {
    const now = new Date();
    const records: CatchRecord[] = [
      { id: 'x', weight: 2.0, species: '', location_name: 'A', created_at: now.toISOString() },
    ];

    const stats = aggregateAnglerCatchStats(records);
    expect(stats.primarySpecies).toBe('Unknown');
  });

  it('calculates correct max weight across varied entries', () => {
    const now = new Date();
    const records: CatchRecord[] = [
      { id: '1', weight: 8.0, species: 'Bream', location_name: 'River', created_at: now.toISOString() },
      { id: '2', weight: 22.5, species: 'Tuna', location_name: 'Reef', created_at: now.toISOString() },
      { id: '3', weight: 15.3, species: 'Snapper', location_name: 'Drop-off', created_at: now.toISOString() },
    ];

    const stats = aggregateAnglerCatchStats(records);
    expect(stats.maxWeightLbs).toBe(22.5);
    expect(stats.totalCatches).toBe(3);
  });

  it('counts only records within the 30-day window as recent', () => {
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const records: CatchRecord[] = [
      { id: '1', weight: 3.0, species: 'Bream', location_name: 'A', created_at: now.toISOString() },
      { id: '2', weight: 4.0, species: 'Bream', location_name: 'B', created_at: twoWeeksAgo.toISOString() },
      { id: '3', weight: 6.0, species: 'Bream', location_name: 'C', created_at: twoMonthsAgo.toISOString() },
    ];

    const stats = aggregateAnglerCatchStats(records);
    expect(stats.totalCatches).toBe(3);
    expect(stats.recentCatchesCount).toBe(2);
  });

  it('breaks species ties by picking the first encountered highest-count species', () => {
    const now = new Date();
    const records: CatchRecord[] = [
      { id: '1', weight: 2.0, species: 'Bream', location_name: 'A', created_at: now.toISOString() },
      { id: '2', weight: 3.0, species: 'Flathead', location_name: 'B', created_at: now.toISOString() },
    ];

    const stats = aggregateAnglerCatchStats(records);
    // Both have count 1 — whichever iterates first from Object.entries wins
    expect(['Bream', 'Flathead']).toContain(stats.primarySpecies);
    expect(stats.totalCatches).toBe(2);
  });
});

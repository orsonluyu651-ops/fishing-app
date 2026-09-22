import { calculateAnglerMilestoneProgress } from '../milestoneTrackerEngine';
import { CatchRecord } from '../exportEngine';

describe('Angler Profile Achievement Milestone Engine', () => {
  it('correctly awards base unlocking tokens when the log count passes zero', () => {
    const records: CatchRecord[] = [
      { id: '1', weight: 4.2, species: 'Bream', location_name: 'Nerang River', created_at: '2026-03-20T10:00:00Z' },
    ];

    const milestones = calculateAnglerMilestoneProgress(records);
    const firstCast = milestones.find((m) => m.id === 'first_blood');

    expect(firstCast?.isUnlocked).toBe(true);
    expect(firstCast?.progressPercent).toBe(100);
  });

  it('correctly tracks partial percentage growth values for species totals', () => {
    const records: CatchRecord[] = [
      { id: '1', weight: 3.0, species: 'Bream', location_name: 'Broadwater', created_at: '2026-03-21T11:00:00Z' },
    ];

    const milestones = calculateAnglerMilestoneProgress(records);
    const breamCount = milestones.find((m) => m.id === 'bream_master');

    expect(breamCount?.isUnlocked).toBe(false);
    expect(breamCount?.progressPercent).toBe(20); // 1 out of 5 targets -> 20%
  });

  it('gracefully outputs zeroed arrays when empty history lines are submitted', () => {
    const milestones = calculateAnglerMilestoneProgress([]);
    expect(milestones.every((m) => m.progressPercent === 0)).toBe(true);
    expect(milestones.every((m) => !m.isUnlocked)).toBe(true);
  });

  it('unlocks heavy haul when a single catch exceeds the weight threshold', () => {
    const records: CatchRecord[] = [
      { id: 'h1', weight: 18.5, species: 'Tuna', location_name: 'Coral Sea', created_at: '2026-01-01T08:00:00Z' },
    ];

    const milestones = calculateAnglerMilestoneProgress(records);
    const heavy = milestones.find((m) => m.id === 'heavy_weight');
    expect(heavy?.isUnlocked).toBe(true);
    expect(heavy?.progressPercent).toBe(100);
  });

  it('does not unlock heavy haul when no catch meets the weight threshold', () => {
    const records: CatchRecord[] = [
      { id: 'l1', weight: 12.0, species: 'Bream', location_name: 'River', created_at: '2026-01-01T08:00:00Z' },
      { id: 'l2', weight: 14.9, species: 'Snapper', location_name: 'Reef', created_at: '2026-01-01T09:00:00Z' },
    ];

    const milestones = calculateAnglerMilestoneProgress(records);
    const heavy = milestones.find((m) => m.id === 'heavy_weight');
    expect(heavy?.isUnlocked).toBe(false);
    expect(heavy?.currentCount).toBe(0);
  });

  it('returns all three milestone entries with stable IDs', () => {
    const milestones = calculateAnglerMilestoneProgress([]);
    const ids = milestones.map((m) => m.id);
    expect(ids).toContain('first_blood');
    expect(ids).toContain('bream_master');
    expect(ids).toContain('heavy_weight');
  });

  it('progresses toward bream master when 5+ bream are logged', () => {
    const records: CatchRecord[] = Array.from({ length: 5 }, (_, i) => ({
      id: `b${i}`,
      weight: 2 + i,
      species: 'Bream',
      location_name: 'River',
      created_at: new Date(Date.now() + i * 86400000).toISOString(),
    }));

    const milestones = calculateAnglerMilestoneProgress(records);
    const bream = milestones.find((m) => m.id === 'bream_master');
    expect(bream?.isUnlocked).toBe(true);
    expect(bream?.progressPercent).toBe(100);
    expect(bream?.currentCount).toBe(5);
  });

  it('handles null input without throwing', () => {
    const milestones = calculateAnglerMilestoneProgress(null as unknown as CatchRecord[]);
    expect(milestones).toHaveLength(3);
    expect(milestones[0]!.progressPercent).toBe(0);
  });
});

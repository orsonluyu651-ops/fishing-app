import { getStyleMetadataForCategory, WaypointCategory } from '../waypointCategoryEngine';

describe('Waypoint Category Structural Icon Projector', () => {
  it('correctly maps predefined categories to their targeted colors', () => {
    const rampMeta = getStyleMetadataForCategory('boat_ramp');
    expect(rampMeta.color).toBe('#0ea5e9');
    expect(rampMeta.label).toContain('Boat Ramp');
  });

  it('safely falls back to structure settings when unexpected values occur', () => {
    const fallbackMeta = getStyleMetadataForCategory('invalid_token' as WaypointCategory);
    expect(fallbackMeta.color).toBe('#f59e0b');
    expect(fallbackMeta.label).toBe('🪵 Structure');
  });

  it('returns the correct color and label for every valid category', () => {
    const structure = getStyleMetadataForCategory('structure');
    expect(structure.color).toBe('#f59e0b');
    expect(structure.label).toBe('🪵 Structure');

    const weedLine = getStyleMetadataForCategory('weed_line');
    expect(weedLine.color).toBe('#22c55e');
    expect(weedLine.label).toBe('🌿 Weed Line');

    const deepHole = getStyleMetadataForCategory('deep_hole');
    expect(deepHole.color).toBe('#6366f1');
    expect(deepHole.label).toBe('🕳️ Deep Hole');

    const reef = getStyleMetadataForCategory('reef');
    expect(reef.color).toBe('#f43f5e');
    expect(reef.label).toBe('🪸 Coral Reef');
  });

  it('returns distinct colors for distinct categories', () => {
    const categories: WaypointCategory[] = ['structure', 'boat_ramp', 'weed_line', 'deep_hole', 'reef'];
    const colors = categories.map((c) => getStyleMetadataForCategory(c).color);
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(categories.length);
  });
});

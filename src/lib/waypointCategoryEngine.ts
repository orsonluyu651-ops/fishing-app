export type WaypointCategory = 'structure' | 'boat_ramp' | 'weed_line' | 'deep_hole' | 'reef';

export interface CategoryIconMapping {
  color: string;
  label: string;
}

/**
 * Resolves static category string flags to clean visual marker styles.
 */
export function getStyleMetadataForCategory(category: WaypointCategory): CategoryIconMapping {
  switch (category) {
    case 'boat_ramp':
      return { color: '#0ea5e9', label: '⚓ Boat Ramp' };
    case 'weed_line':
      return { color: '#22c55e', label: '🌿 Weed Line' };
    case 'deep_hole':
      return { color: '#6366f1', label: '🕳️ Deep Hole' };
    case 'reef':
      return { color: '#f43f5e', label: '🪸 Coral Reef' };
    case 'structure':
    default:
      return { color: '#f59e0b', label: '🪵 Structure' };
  }
}

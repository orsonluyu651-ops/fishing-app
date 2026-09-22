import { supabase } from './supabase';

export interface SavedSpotMarker {
  id?: string;
  user_id: string;
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * Saves dropped waypoint coordinates straight to remote profile storage records.
 */
export async function saveFishingSpotPin(spot: Omit<SavedSpotMarker, 'id'>): Promise<boolean> {
  try {
    const { error } = await supabase.from('saved_spots').insert([spot]);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Geospatial insertion fault:', err);
    return false;
  }
}

/**
 * Fetches all saved waypoints matching the authenticated account user ID.
 */
export async function fetchSavedFishingSpots(userId: string): Promise<SavedSpotMarker[]> {
  try {
    const { data, error } = await supabase
      .from('saved_spots')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return (data as SavedSpotMarker[]) || [];
  } catch (err) {
    console.error('Geospatial query pipeline failed:', err);
    return [];
  }
}

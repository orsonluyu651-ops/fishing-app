import { supabase } from './supabase';

export interface SocialFeedItem {
  id: string;
  weight: number;
  species: string;
  location_name: string;
  image_url: string | null;
  created_at: string;
  profiles: {
    username: string;
    push_token: string | null;
  };
}

/**
 * Executes a relational cross-table query joining catch entries to creator profiles.
 */
export async function fetchCommunitySocialFeed(page = 0, pageSize = 15): Promise<SocialFeedItem[]> {
  try {
    const fromIndex = page * pageSize;
    const toIndex = fromIndex + pageSize - 1;

    const { data, error } = await supabase
      .from('catches')
      .select('id, weight, species, location_name, image_url, created_at, profiles(username, push_token)')
      .order('created_at', { ascending: false })
      .range(fromIndex, toIndex);

    if (error) throw error;
    return (data as unknown as SocialFeedItem[]) || [];
  } catch (err) {
    console.error('Social feed tracking pipeline failure:', err);
    return [];
  }
}

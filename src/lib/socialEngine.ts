import { supabase } from './supabase';

export interface FollowRelationship {
  follower_id: string;
  following_id: string;
}

/**
 * Executes a secure database row creation to link a follower relation.
 */
export async function followUser(followerId: string, targetUserId: string): Promise<{ error: any }> {
  const { error } = await supabase
    .from('follows')
    .insert([{ follower_id: followerId, following_id: targetUserId }]);
  return { error };
}

/**
 * Removes a follow association row matching composite primary keys.
 */
export async function unfollowUser(followerId: string, targetUserId: string): Promise<{ error: any }> {
  const { error } = await supabase
    .from('follows')
    .delete()
    .match({ follower_id: followerId, following_id: targetUserId });
  return { error };
}

/**
 * Fetches an array of user IDs that the current user is following.
 */
export async function fetchFollowingIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId);
    
  if (error || !data) return [];
  return data.map((row: any) => row.following_id);
}

/**
 * Fetches windowed catch feeds isolated solely to the following network subset matrix.
 */
export async function fetchFollowingCatchesRange(
  followingIds: string[],
  start: number,
  end: number
): Promise<{ data: any[] | null; error: any }> {
  if (followingIds.length === 0) return { data: [], error: null };
  
  return await supabase
    .from('catches')
    .select('*, profiles(username, is_pro)')
    .in('user_id', followingIds)
    .order('created_at', { ascending: false })
    .range(start, end);
}
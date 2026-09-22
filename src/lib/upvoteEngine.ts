import { supabase } from './supabase';

/**
 * Toggles a user endorsement state on an entry, deleting or inserting items atomically.
 */
export async function toggleCatchUpvote(catchId: string, userId: string, hasUpvoted: boolean): Promise<boolean> {
  try {
    if (hasUpvoted) {
      // Remove upvote row
      const { error } = await supabase
        .from('catch_upvotes')
        .delete()
        .eq('catch_id', catchId)
        .eq('user_id', userId);

      if (error) throw error;
    } else {
      // Add upvote row
      const { error } = await supabase
        .from('catch_upvotes')
        .insert([{ catch_id: catchId, user_id: userId }]);

      if (error) throw error;
    }
    return true;
  } catch (err) {
    console.error('Upvote interaction matrix failure:', err);
    return false;
  }
}

/**
 * Pulls total numerical upvote aggregate numbers for a designated catch list.
 */
export async function fetchCatchUpvoteCount(
  catchId: string,
  currentUserId?: string,
): Promise<{ count: number; userHasUpvoted: boolean }> {
  try {
    const { data, error, count } = await supabase
      .from('catch_upvotes')
      .select('user_id', { count: 'exact' })
      .eq('catch_id', catchId);

    if (error) throw error;

    const userHasUpvoted = currentUserId
      ? (data as { user_id: string }[] | null)?.some((row) => row.user_id === currentUserId) ?? false
      : false;
    return { count: count ?? 0, userHasUpvoted };
  } catch (err) {
    console.error('Upvote collection query failed:', err);
    return { count: 0, userHasUpvoted: false };
  }
}

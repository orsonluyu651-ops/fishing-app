import { supabase } from './supabase';

export interface CatchCommentItem {
  id: string;
  catch_id: string;
  user_id: string;
  comment_text: string;
  created_at: string;
  profiles: {
    username: string;
  };
}

/**
 * Dispatches an atomic comment record insertion string payload.
 */
export async function submitCatchComment(catchId: string, userId: string, text: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('catch_comments')
      .insert([{ catch_id: catchId, user_id: userId, comment_text: text.trim() }]);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Comment insertion sequence error:', err);
    return false;
  }
}

/**
 * Pulls a chronologically sorted array list of discussion items matching a specific catch ID.
 */
export async function fetchCatchThreadComments(catchId: string): Promise<CatchCommentItem[]> {
  try {
    const { data, error } = await supabase
      .from('catch_comments')
      .select('id, catch_id, user_id, comment_text, created_at, profiles(username)')
      .eq('catch_id', catchId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as unknown as CatchCommentItem[]) || [];
  } catch (err) {
    console.error('Thread retrieval failure:', err);
    return [];
  }
}

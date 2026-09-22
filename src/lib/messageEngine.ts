import { supabase } from './supabase';

export interface DirectMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  text_content: string;
  created_at: string;
}

/**
 * Dispatches an atomic direct message payload to the tables database.
 */
export async function sendDirectMessage(senderId: string, receiverId: string, text: string): Promise<{ error: any }> {
  const { error } = await supabase
    .from('messages')
    .insert([{ sender_id: senderId, receiver_id: receiverId, text_content: text }]);
  return { error };
}

/**
 * Fetches historic direct messaging records between two isolated profiles.
 */
export async function fetchMessageHistory(currentUserId: string, targetUserId: string, limit = 40): Promise<DirectMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},receiver_id.eq.${currentUserId})`)
    .order('created_at', { ascending: false })
    .limit(limit);
    
  if (error || !data) return [];
  return data as DirectMessage[];
}

/**
 * Subscribes to a real-time table broadcast stream for incoming chat records.
 */
export function subscribeToMessages(currentUserId: string, targetUserId: string, onNewMessage: (message: DirectMessage) => void) {
  return supabase
    .channel(`dm_${currentUserId}_${targetUserId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `receiver_id=eq.${currentUserId}`,
      },
      (payload) => {
        const msg = payload.new as DirectMessage;
        if (msg.sender_id === targetUserId) {
          onNewMessage(msg);
        }
      }
    )
    .subscribe();
}
import { supabase } from './supabase';

export interface GroupMessage {
  id: string;
  group_id: string;
  sender_id: string;
  text_content: string;
  image_url?: string | null;
  created_at: string;
  profiles?: { username: string };
}

/**
 * Uploads a local binary media file blob directly into the public chat attachments storage bucket.
 */
export async function uploadChatImage(groupId: string, fileUri: string): Promise<string | null> {
  try {
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const fileExt = fileUri.split('.').pop() || 'jpg';
    const fileName = `${groupId}/${Math.random().toString(36).substring(2)}.${fileExt}`;
    
    const { error } = await supabase.storage
      .from('chat-attachments')
      .upload(fileName, blob, { contentType: `image/${fileExt}`, cacheControl: '3600' });
      
    if (error) throw error;
    
    const { data } = supabase.storage.from('chat-attachments').getPublicUrl(fileName);
    return data.publicUrl;
  } catch (err) {
    console.error("Storage upload failure:", err);
    return null;
  }
}

/**
 * Dispatches an atomic group message payload containing an optional verified public image attachment pointer reference string.
 */
export async function sendGroupMessage(groupId: string, senderId: string, text: string, imageUrl: string | null = null): Promise<{ error: any }> {
  return await supabase
    .from('group_messages')
    .insert([{ group_id: groupId, sender_id: senderId, text_content: text, image_url: imageUrl }]);
}

export async function fetchGroupMessageHistory(groupId: string, limit = 40): Promise<GroupMessage[]> {
  const { data, error } = await supabase
    .from('group_messages')
    .select('*, profiles(username)')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(limit);
    
  if (error || !data) return [];
  return data as GroupMessage[];
}

export function subscribeToGroupMessages(groupId: string, onNewMessage: (message: GroupMessage) => void) {
  return supabase
    .channel(`group_${groupId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'group_messages',
        filter: `group_id=eq.${groupId}`,
      },
      async (payload) => {
        const msg = payload.new as GroupMessage;
        // Lazily fetch sender profile name for real-time appends
        const { data } = await supabase.from('profiles').select('username').eq('id', msg.sender_id).single();
        if (data) msg.profiles = { username: data.username };
        onNewMessage(msg);
      }
    )
    .subscribe();
}
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { uploadChatImage } from './groupEngine';

export interface QueuedCatch {
  id: string;
  user_id: string;
  weight: number;
  species: string;
  location_name: string;
  local_image_uri: string | null;
  timestamp: string;
}

const CACHE_QUEUE_KEY = '@catch_sync_queue';

/**
 * Persists a catch payload locally into AsyncStorage when remote network mutations fail.
 */
export async function queueOfflineCatch(record: Omit<QueuedCatch, 'id' | 'timestamp'>): Promise<void> {
  try {
    const rawQueue = await AsyncStorage.getItem(CACHE_QUEUE_KEY);
    const queue: QueuedCatch[] = rawQueue ? JSON.parse(rawQueue) : [];

    const newRecord: QueuedCatch = {
      ...record,
      id: Math.random().toString(36).substring(2),
      timestamp: new Date().toISOString(),
    };

    queue.push(newRecord);
    await AsyncStorage.setItem(CACHE_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('AsyncStorage serialization fault:', err);
  }
}

/**
 * Attempts to empty out the backlog queue, pushing items to Supabase tables.
 */
export async function synchronizeCatchQueue(): Promise<boolean> {
  try {
    const rawQueue = await AsyncStorage.getItem(CACHE_QUEUE_KEY);
    if (!rawQueue) return true;

    let queue: QueuedCatch[] = JSON.parse(rawQueue);
    if (queue.length === 0) return true;

    const failedToSync: QueuedCatch[] = [];

    for (const item of queue) {
      try {
        let remoteImageUrl: string | null = null;

        // If an image asset exists in the local queue row, upload it to the cloud bucket first
        if (item.local_image_uri) {
          remoteImageUrl = await uploadChatImage(item.user_id, item.local_image_uri);
        }

        const { error } = await supabase.from('catches').insert([{
          user_id: item.user_id,
          weight: item.weight,
          species: item.species,
          location_name: item.location_name,
          image_url: remoteImageUrl,
          created_at: item.timestamp,
        }]);

        if (error) throw error;
      } catch (itemErr) {
        console.warn(`Individual log row item sync failed: ${item.id}`, itemErr);
        failedToSync.push(item);
      }
    }

    await AsyncStorage.setItem(CACHE_QUEUE_KEY, JSON.stringify(failedToSync));
    return failedToSync.length === 0;
  } catch (err) {
    console.error('Global queue processing failure:', err);
    return false;
  }
}

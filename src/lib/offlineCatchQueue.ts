import { File, Directory, Paths } from 'expo-file-system';
import { supabase } from './supabase';

// Offline catch queue: when a log submission fails with a network error out
// on the water, the payload (+ persistent photo copy) is saved and synced
// automatically on reconnect, oldest first.
//
// Storage note (Expo Go): standalone '@react-native-async-storage/async-storage'
// throws "Native module is null" inside standard Expo Go, which red-screens the
// app at import/first-call time. We therefore load it lazily and fall back to
// an in-memory queue (session-scoped) so Expo Go testing never crashes. On a
// dev-client / native build the real AsyncStorage is used and the queue
// persists across restarts.

export interface QueuedCatch {
  id: string;
  userId: string;
  species: string;
  length: number | null;
  latitude: number | null;
  longitude: number | null;
  photoUri: string | null;
  createdAt: string;
  attempts: number;
}

const QUEUE_KEY = '@tidewire:pending_catches:v1';
const PHOTO_DIR_NAME = 'pending-catch-photos';

// ── Expo Go-safe storage ────────────────────────────────────────────
// Lazily require AsyncStorage so a missing/broken native module never throws
// at import time. If the native module is null (standard Expo Go), every call
// degrades to an in-memory queue instead of red-screening.
type StorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

let asyncStorage: StorageLike | null = null;
let asyncStorageFailed = false;
const memoryFallback: Record<string, string> = {};

function getStorage(): StorageLike {
  if (asyncStorage) return asyncStorage;
  if (!asyncStorageFailed) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@react-native-async-storage/async-storage');
      const candidate: StorageLike | undefined = mod?.default ?? mod;
      if (candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function') {
        asyncStorage = candidate;
        return asyncStorage;
      }
    } catch {
      // fall through to memory fallback below
    }
    asyncStorageFailed = true;
    console.warn(
      '[offlineCatchQueue] AsyncStorage native module unavailable (Expo Go?) — using in-memory queue for this session.'
    );
  }
  return {
    getItem: async (key: string) => memoryFallback[key] ?? null,
    setItem: async (key: string, value: string) => {
      memoryFallback[key] = value;
    },
  };
}

export async function loadQueue(): Promise<QueuedCatch[]> {
  try {
    const raw = await getStorage().getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedCatch[]) : [];
  } catch (error) {
    console.error('Error loading offline catch queue:', error);
    return [];
  }
}

async function saveQueue(queue: QueuedCatch[]): Promise<void> {
  try {
    await getStorage().setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('Error saving offline catch queue (non-blocking):', error);
  }
}

export async function persistQueuedPhoto(sourceUri: string | null, queueId: string): Promise<string | null> {
  if (!sourceUri) return null;
  try {
    const extension = sourceUri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
    const dir = new Directory(Paths.document, PHOTO_DIR_NAME);
    if (!dir.exists) dir.create();
    const dest = new File(dir, `${queueId}.${extension}`);
    const src = new File(sourceUri);
    src.copy(dest);
    return dest.uri;
  } catch (error) {
    console.error('Error persisting queued photo:', error);
    return sourceUri;
  }
}

function deleteQueuedPhoto(photoUri: string | null): void {
  if (!photoUri) return;
  try {
    const file = new File(photoUri);
    if (file.exists) file.delete();
  } catch (error) {
    console.error('Error deleting queued photo:', error);
  }
}


export async function enqueueCatch(entry: Omit<QueuedCatch, 'id' | 'attempts' | 'createdAt'>): Promise<QueuedCatch> {
  const queue = await loadQueue();
  const queued: QueuedCatch = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  queued.photoUri = await persistQueuedPhoto(entry.photoUri, queued.id);
  queue.push(queued);
  await saveQueue(queue);
  return queued;
}

async function removeFromQueue(id: string): Promise<void> {
  const queue = await loadQueue();
  await saveQueue(queue.filter((item) => item.id !== id));
}

async function bumpAttempts(id: string): Promise<void> {
  const queue = await loadQueue();
  await saveQueue(queue.map((item) => (item.id === id ? { ...item, attempts: item.attempts + 1 } : item)));
}

export async function uploadQueuedCatch(entry: QueuedCatch): Promise<string> {
  let mediaPath: string | null = null;
  if (entry.photoUri) {
    const extension = entry.photoUri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
    const filePath = `${entry.userId}/${entry.id}.${extension}`;
    const file = new File(entry.photoUri);
    const bytes = await file.bytes();
    const contentType =
      extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
    const { error: uploadError } = await supabase.storage
      .from('catch-media')
      .upload(filePath, bytes, { contentType, upsert: false });
    if (uploadError) throw uploadError;
    mediaPath = filePath;
  }

  const { data, error } = await supabase
    .from('catches')
    .insert({
      user_id: entry.userId,
      species: entry.species,
      length: entry.length,
      media_path: mediaPath,
      environmental:
        entry.latitude !== null && entry.longitude !== null
          ? { latitude: entry.latitude, longitude: entry.longitude }
          : {},
      captured_at: entry.createdAt,
    })
    .select('id')
    .single();
  if (error) throw error;

  deleteQueuedPhoto(entry.photoUri);
  await removeFromQueue(entry.id);
  return data.id as string;
}

export interface SyncResult {
  synced: number;
  failed: number;
}

export async function syncQueue(): Promise<SyncResult> {
  const queue = await loadQueue();
  let synced = 0;
  let failed = 0;
  for (const entry of queue) {
    try {
      await uploadQueuedCatch(entry);
      synced += 1;
    } catch (error) {
      console.error(`Error syncing queued catch ${entry.id}:`, error);
      await bumpAttempts(entry.id);
      failed += 1;
    }
  }
  return { synced, failed };
}

export function isNetworkError(error: any): boolean {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return (
    message.includes('network request failed') ||
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnaborted') ||
    message.includes('enotfound') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('network error') ||
    message.includes('no internet') ||
    message.includes('offline') ||
    message.includes('failed to fetch') ||
    message.includes('load failed')
  );
}

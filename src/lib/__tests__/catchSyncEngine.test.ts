import AsyncStorage from '@react-native-async-storage/async-storage';
import { queueOfflineCatch, synchronizeCatchQueue, type QueuedCatch } from '../catchSyncEngine';
import { supabase } from '../supabase';

// Response holders the jest.mock factory reads at call time.
const mockInsertResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn(() => Promise.resolve(mockInsertResponse)),
    })),
  },
}));

jest.mock('../groupEngine', () => ({
  uploadChatImage: jest.fn(async () => 'https://example.com/remote-image.png'),
}));

describe('Offline Catch Sync Engine Verification', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockInsertResponse.data = null;
    mockInsertResponse.error = null;
  });

  it('correctly appends catch log metadata into native cache rows', async () => {
    const sample = { user_id: 'u1', weight: 4.5, species: 'Bream', location_name: 'Nerang River', local_image_uri: null };
    await queueOfflineCatch(sample);
    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });

  it('processes backlogged rows completely when network routes pass', async () => {
    const mockItem: QueuedCatch = {
      id: '1',
      user_id: 'u1',
      weight: 4.5,
      species: 'Bream',
      location_name: 'Nerang River',
      local_image_uri: null,
      timestamp: new Date().toISOString(),
    };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify([mockItem]));

    const status = await synchronizeCatchQueue();
    expect(status).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@catch_sync_queue', '[]');
  });

  it('leaves failed items in the queue on insert error', async () => {
    const mockItem: QueuedCatch = {
      id: '2',
      user_id: 'u2',
      weight: 3.2,
      species: 'Tarpon',
      location_name: 'Broadbeach',
      local_image_uri: null,
      timestamp: new Date().toISOString(),
    };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify([mockItem]));
    mockInsertResponse.error = new Error('network timeout');

    const status = await synchronizeCatchQueue();
    expect(status).toBe(false);

    const remaining = await AsyncStorage.getItem('@catch_sync_queue');
    const remainingQueue: QueuedCatch[] = remaining ? JSON.parse(remaining) : [];
    expect(remainingQueue).toHaveLength(1);
    expect(remainingQueue[0]!.id).toBe('2');
  });

  it('uploads image when local_image_uri is present', async () => {
    const { uploadChatImage } = require('../groupEngine');
    const mockItem: QueuedCatch = {
      id: '3',
      user_id: 'u3',
      weight: 5.0,
      species: 'Snapper',
      location_name: 'Surfer Paradise',
      local_image_uri: 'file:///local-photo.jpg',
      timestamp: new Date().toISOString(),
    };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify([mockItem]));

    await synchronizeCatchQueue();
    expect(uploadChatImage).toHaveBeenCalledWith('u3', 'file:///local-photo.jpg');
  });

  it('handles an empty queue gracefully', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify([]));

    const status = await synchronizeCatchQueue();
    expect(status).toBe(true);
  });

  it('handles null queue storage', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

    const status = await synchronizeCatchQueue();
    expect(status).toBe(true);
  });
});

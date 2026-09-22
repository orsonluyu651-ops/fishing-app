import { saveFishingSpotPin, fetchSavedFishingSpots } from '../mapSpotEngine';
import { supabase } from '../supabase';

const mockInsertResponse: { data: unknown; error: unknown } = { data: null, error: null };
const mockSelectResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn(() => Promise.resolve(mockInsertResponse)),
      select: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve(mockSelectResponse)),
      })),
    })),
  },
}));

describe('Geospatial Spot Mapping Infrastructure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsertResponse.data = null;
    mockInsertResponse.error = null;
    mockSelectResponse.data = null;
    mockSelectResponse.error = null;
  });

  it('correctly dispatches saved coordinates to the database backend', async () => {
    mockInsertResponse.error = null;
    const success = await saveFishingSpotPin({ user_id: 'u1', name: 'Secret Snag', latitude: -28.0, longitude: 153.4 });
    expect(success).toBe(true);
  });

  it('returns false when the insert call errors out', async () => {
    mockInsertResponse.error = new Error('permission denied');
    const success = await saveFishingSpotPin({ user_id: 'u1', name: 'Secret Snag', latitude: -28.0, longitude: 153.4 });
    expect(success).toBe(false);
  });

  it('pulls geolocated pin records cleanly from query arrays', async () => {
    mockSelectResponse.data = [
      { user_id: 'u1', name: 'Secret Snag', latitude: -28.0, longitude: 153.4 },
    ];
    mockSelectResponse.error = null;

    const results = await fetchSavedFishingSpots('u1');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Secret Snag');
  });

  it('returns an empty array when no spots exist for the user', async () => {
    mockSelectResponse.data = [];
    mockSelectResponse.error = null;

    const results = await fetchSavedFishingSpots('unknown-user');
    expect(results).toEqual([]);
  });

  it('returns an empty array when the query errors out', async () => {
    mockSelectResponse.data = null;
    mockSelectResponse.error = new Error('table not found');

    const results = await fetchSavedFishingSpots('u1');
    expect(results).toEqual([]);
  });
});

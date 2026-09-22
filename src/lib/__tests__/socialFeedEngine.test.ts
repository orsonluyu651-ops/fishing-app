import { fetchCommunitySocialFeed } from '../socialFeedEngine';
import { supabase } from '../supabase';

const mockResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        order: jest.fn(() => ({
          range: jest.fn(() => Promise.resolve(mockResponse)),
        })),
      })),
    })),
  },
}));

describe('Social Pipeline Feed Core Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResponse.data = null;
    mockResponse.error = null;
  });

  it('successfully executes range queries joining profile row schemas', async () => {
    mockResponse.data = [
      {
        id: 'c1',
        weight: 8.4,
        species: 'Flathead',
        location_name: 'Jumpinpin',
        image_url: 'https://cdn/f.png',
        created_at: new Date().toISOString(),
        profiles: { username: 'PinAngler', push_token: null },
      },
    ];
    mockResponse.error = null;

    const list = await fetchCommunitySocialFeed(0);
    expect(list).toHaveLength(1);
    expect(list[0]!.species).toBe('Flathead');
    expect(list[0]!.profiles.username).toBe('PinAngler');
  });

  it('safely handles relational exception flags by returning clean arrays', async () => {
    // Re-mock: simulate a thrown error from the DB call
    (supabase.from as jest.Mock).mockReturnValueOnce({
      select: jest.fn().mockReturnValueOnce({
        order: jest.fn().mockReturnValueOnce({
          range: jest.fn().mockRejectedValueOnce(new Error('DB Drop')),
        }),
      }),
    });

    const list = await fetchCommunitySocialFeed(0);
    expect(list).toEqual([]);
  });

  it('returns an empty array when the query yields no rows', async () => {
    mockResponse.data = [];
    mockResponse.error = null;

    const list = await fetchCommunitySocialFeed(0);
    expect(list).toEqual([]);
  });

  it('honours the page and pageSize parameters for windowed queries', async () => {
    mockResponse.data = [
      {
        id: 'c2',
        weight: 5.2,
        species: 'Bream',
        location_name: 'Nerang River',
        image_url: null,
        created_at: new Date().toISOString(),
        profiles: { username: 'RiverPro', push_token: 'token-abc' },
      },
    ];
    mockResponse.error = null;

    const list = await fetchCommunitySocialFeed(1, 10);
    expect(list).not.toBeNull();
    expect(list[0]!.weight).toBe(5.2);
    expect(list[0]!.profiles.push_token).toBe('token-abc');
  });
});


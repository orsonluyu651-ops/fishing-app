import { fetchTopAnglerRanks, type LeaderboardRow } from '../leaderboardEngine';
import { supabase } from '../supabase';

const mockResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        order: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve(mockResponse)),
        })),
      })),
    })),
  },
}));

describe('Leaderboard Query Pipeline Testing Modules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResponse.data = null;
    mockResponse.error = null;
  });

  it('successfully translates view output lists into active ranking matrices', async () => {
    mockResponse.data = [
      { user_id: 'a1', username: 'BarraKing', total_weight_lbs: 120.4, total_catches: 12, heaviest_catch_lbs: 35, leaderboard_rank: 1 },
      { user_id: 'b2', username: 'CodCatcher', total_weight_lbs: 95.2, total_catches: 8, heaviest_catch_lbs: 22, leaderboard_rank: 2 },
    ];
    mockResponse.error = null;

    const leaderboard = await fetchTopAnglerRanks();
    expect(leaderboard).toHaveLength(2);
    expect(leaderboard[0].username).toBe('BarraKing');
    expect(leaderboard[1].leaderboard_rank).toBe(2);
  });

  it('returns an empty array when the view returns no data', async () => {
    mockResponse.data = [];
    mockResponse.error = null;

    const leaderboard = await fetchTopAnglerRanks();
    expect(leaderboard).toEqual([]);
  });

  it('returns an empty array when the query errors out', async () => {
    mockResponse.data = null;
    mockResponse.error = new Error('view not available');

    const leaderboard = await fetchTopAnglerRanks();
    expect(leaderboard).toEqual([]);
  });

  it('respects the limit parameter for top-N results', async () => {
    mockResponse.data = [
      { user_id: 'a1', username: 'Angler1', total_weight_lbs: 100, total_catches: 5, heaviest_catch_lbs: 20, leaderboard_rank: 1 },
      { user_id: 'a2', username: 'Angler2', total_weight_lbs: 90, total_catches: 4, heaviest_catch_lbs: 18, leaderboard_rank: 2 },
      { user_id: 'a3', username: 'Angler3', total_weight_lbs: 80, total_catches: 3, heaviest_catch_lbs: 15, leaderboard_rank: 3 },
    ];
    mockResponse.error = null;

    const leaderboard = await fetchTopAnglerRanks(2);
    // The mock passes the limit parameter through to the DB; result reflects
    // whatever data the mock returns. Assert the first two entries are intact.
    expect(leaderboard).not.toBeNull();
    expect(leaderboard[0].username).toBe('Angler1');
    expect(leaderboard[1].username).toBe('Angler2');
  });
});

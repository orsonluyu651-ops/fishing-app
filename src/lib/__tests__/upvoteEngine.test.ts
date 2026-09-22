import { toggleCatchUpvote, fetchCatchUpvoteCount } from '../upvoteEngine';
import { supabase } from '../supabase';

const mockInsertResponse: { data: unknown; error: unknown } = { data: null, error: null };
const mockDeleteResponse: { data: unknown; error: unknown } = { data: null, error: null };
const mockSelectResponse: { data: unknown; count: number; error: unknown } = {
  data: null,
  count: 0,
  error: null,
};

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn(() => Promise.resolve(mockInsertResponse)),
      delete: jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve(mockDeleteResponse)),
        })),
      })),
      select: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve(mockSelectResponse)),
      })),
    })),
  },
}));

describe('Social Endorsement Upvote Interaction Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsertResponse.data = null;
    mockInsertResponse.error = null;
    mockDeleteResponse.data = null;
    mockDeleteResponse.error = null;
    mockSelectResponse.data = null;
    mockSelectResponse.count = 0;
    mockSelectResponse.error = null;
  });

  it('correctly fires an insert sequence when enabling an upvote state', async () => {
    mockInsertResponse.error = null;
    const success = await toggleCatchUpvote('c99', 'u1', false);
    expect(success).toBe(true);
  });

  it('correctly requests a deletion branch when peeling back upvotes', async () => {
    mockDeleteResponse.error = null;
    const success = await toggleCatchUpvote('c99', 'u1', true);
    expect(success).toBe(true);
  });

  it('returns false when insert fails on upvote toggle', async () => {
    mockInsertResponse.error = new Error('duplicate key');
    const success = await toggleCatchUpvote('c99', 'u1', false);
    expect(success).toBe(false);
  });

  it('returns false when delete fails on upvote removal', async () => {
    mockDeleteResponse.error = new Error('permission denied');
    const success = await toggleCatchUpvote('c99', 'u1', true);
    expect(success).toBe(false);
  });

  it('accurately summarizes active upvote aggregates and account markers', async () => {
    mockSelectResponse.data = [{ user_id: 'cus_1' }];
    mockSelectResponse.count = 1;
    mockSelectResponse.error = null;

    const summary = await fetchCatchUpvoteCount('c99', 'current-user');
    expect(summary.count).toBe(1);
  });

  it('returns zero count and false when no upvotes exist', async () => {
    mockSelectResponse.data = [];
    mockSelectResponse.count = 0;
    mockSelectResponse.error = null;

    const summary = await fetchCatchUpvoteCount('c99', 'u1');
    expect(summary.count).toBe(0);
    expect(summary.userHasUpvoted).toBe(false);
  });

  it('flags userHasUpvoted true when the current user is in the results', async () => {
    mockSelectResponse.data = [
      { user_id: 'other-user' },
      { user_id: 'current-user' },
    ];
    mockSelectResponse.count = 2;
    mockSelectResponse.error = null;

    const summary = await fetchCatchUpvoteCount('c99', 'current-user');
    expect(summary.userHasUpvoted).toBe(true);
    expect(summary.count).toBe(2);
  });

  it('returns safe defaults when the upvote query errors out', async () => {
    mockSelectResponse.data = null;
    mockSelectResponse.count = 0;
    mockSelectResponse.error = new Error('relation does not exist');

    const summary = await fetchCatchUpvoteCount('c99');
    expect(summary.count).toBe(0);
    expect(summary.userHasUpvoted).toBe(false);
  });
});

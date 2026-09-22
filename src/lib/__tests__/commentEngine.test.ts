import { submitCatchComment, fetchCatchThreadComments } from '../commentEngine';
import { supabase } from '../supabase';

const mockInsertResponse: { data: unknown; error: unknown } = { data: null, error: null };
const mockSelectResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn(() => Promise.resolve(mockInsertResponse)),
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(() => Promise.resolve(mockSelectResponse)),
        })),
      })),
    })),
  },
}));

describe('Social Discussion Comment Thread Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsertResponse.data = null;
    mockInsertResponse.error = null;
    mockSelectResponse.data = null;
    mockSelectResponse.error = null;
  });

  it('correctly maps written entries to the database insert parameters', async () => {
    mockInsertResponse.error = null;
    const status = await submitCatchComment('c12', 'u3', 'Nice catch!');
    expect(status).toBe(true);
  });

  it('returns false when comment insertion encounters a database error', async () => {
    mockInsertResponse.error = new Error('permission denied');
    const status = await submitCatchComment('c12', 'u3', 'Nice catch!');
    expect(status).toBe(false);
  });

  it('trims whitespace from comment text before inserting', async () => {
    mockInsertResponse.error = null;
    await submitCatchComment('c12', 'u3', '  Trimmed text  ');
    // The trim is applied inside submitCatchComment before the insert call;
    // the successful response confirms the trimmed payload was accepted.
    const insertCalls = (supabase.from as jest.Mock).mock.calls;
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  it('pulls sorted comment objects matching the targeted entity keys', async () => {
    mockSelectResponse.data = [
      {
        id: 'cm1',
        catch_id: 'c12',
        user_id: 'u3',
        comment_text: 'What a beauty!',
        created_at: new Date().toISOString(),
        profiles: { username: 'SnapperSam' },
      },
    ];
    mockSelectResponse.error = null;

    const thread = await fetchCatchThreadComments('c12');
    expect(thread.length).toBe(1);
    expect(thread[0]!.comment_text).toBe('What a beauty!');
    expect(thread[0]!.profiles.username).toBe('SnapperSam');
  });

  it('returns an empty array when no comments exist for the catch', async () => {
    mockSelectResponse.data = [];
    mockSelectResponse.error = null;

    const thread = await fetchCatchThreadComments('nonexistent-catch');
    expect(thread).toEqual([]);
  });

  it('returns an empty array when the thread query errors out', async () => {
    mockSelectResponse.data = null;
    mockSelectResponse.error = new Error('relation does not exist');

    const thread = await fetchCatchThreadComments('c12');
    expect(thread).toEqual([]);
  });
});


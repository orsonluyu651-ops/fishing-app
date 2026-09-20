import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const TEST_USER_ID = '171fddc2-219f-499a-87c5-223801710835';

function loadEnv() {
  const values = Object.create(null);
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator > 0) {
      values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
    }
  }
  return values;
}

const env = loadEnv();
const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const testEmail = process.env.TIDEWIRE_TEST_EMAIL;
const testPassword = process.env.TIDEWIRE_TEST_PASSWORD;

if (!supabaseUrl || !publishableKey || !testEmail || !testPassword) {
  throw new Error(
    'Missing Supabase environment variables or test credentials. ' +
      'Set TIDEWIRE_TEST_EMAIL and TIDEWIRE_TEST_PASSWORD in the shell.',
  );
}

const supabase = createClient(supabaseUrl, publishableKey);

const spots = [
  { id: '21000000-0000-0000-0000-000000000001', name: 'Southport Test Broadwater', latitude: -27.962, longitude: 153.405 },
  { id: '21000000-0000-0000-0000-000000000002', name: 'Surfers Test Jetty', latitude: -28.001, longitude: 153.431 },
  { id: '21000000-0000-0000-0000-000000000003', name: 'Broadbeach Test Spit', latitude: -28.028, longitude: 153.434 },
  { id: '21000000-0000-0000-0000-000000000004', name: 'Burleigh Test Headland', latitude: -28.092, longitude: 153.457 },
  { id: '21000000-0000-0000-0000-000000000005', name: 'Currumbin Test Alley', latitude: -28.131, longitude: 153.476 },
  { id: '21000000-0000-0000-0000-000000000006', name: 'Coolangatta Test Point', latitude: -28.17, longitude: 153.508 },
];

const catches = [
  { id: '22000000-0000-0000-0000-000000000001', spot_id: spots[0].id, species: 'Dusky Flathead', weight: 1.8, length: 52, captured_at: '2026-09-14T08:00:00Z' },
  { id: '22000000-0000-0000-0000-000000000002', spot_id: spots[1].id, species: 'Sand Whiting', weight: 0.5, length: 26, captured_at: '2026-09-15T08:00:00Z' },
  { id: '22000000-0000-0000-0000-000000000003', spot_id: spots[3].id, species: 'Tailor', weight: 2.0, length: 38, captured_at: '2026-09-16T08:00:00Z' },
];

const posts = [
  { id: '23000000-0000-0000-0000-000000000001', text: 'Testing the Gold Coast catch feed with a fresh session.' },
  { id: '23000000-0000-0000-0000-000000000002', text: 'The demo map and leaderboard are ready for a test run.' },
];

async function ensureRow(table, row) {
  const { data: existing, error: lookupError } = await supabase
    .from(table)
    .select('id')
    .eq('id', row.id)
    .maybeSingle();
  if (lookupError) throw new Error(`${table} lookup failed: ${lookupError.message}`);
  if (existing) return false;

  const { error: insertError } = await supabase.from(table).insert(row);
  if (insertError) throw new Error(`${table} insert failed: ${insertError.message}`);
  return true;
}

async function main() {
  const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (signInError) throw new Error(`Test-user sign-in failed: ${signInError.message}`);
  if (authData.user?.id !== TEST_USER_ID) {
    throw new Error(`Signed-in user ID does not match expected test user: ${authData.user?.id}`);
  }

  for (const spot of spots) {
    await ensureRow('fishing_spots', {
      ...spot,
      user_id: TEST_USER_ID,
      privacy_level: 'public',
    });
  }

  for (const catchRecord of catches) {
    await ensureRow('catches', {
      ...catchRecord,
      user_id: TEST_USER_ID,
      verification_status: 'verified',
      verification_score: 0.95,
      leaderboard_eligible: true,
    });
  }

  for (const post of posts) {
    await ensureRow('posts', { ...post, user_id: TEST_USER_ID, catch_id: null });
  }

  const checks = await Promise.all([
    supabase.from('regional_activity_metrics').select('id, name, catch_count_30d, activity_tier'),
    supabase.from('catch_leaderboard_rows').select('id, species, length, keep_status, rank_length'),
    supabase.from('feed_posts').select('id, user_id, caption, species'),
  ]);
  for (const [index, result] of checks.entries()) {
    if (result.error) throw new Error(`Verification ${index + 1} failed: ${result.error.message}`);
  }

  console.log(JSON.stringify({
    spots_created_or_present: spots.length,
    catches_created_or_present: catches.length,
    standalone_posts_created_or_present: posts.length,
    map_regions_visible: checks[0].data?.length ?? 0,
    leaderboard_rows_visible: checks[1].data?.length ?? 0,
    feed_rows_visible: checks[2].data?.length ?? 0,
    leaderboard: checks[1].data,
  }, null, 2));

  await supabase.auth.signOut();
}

main().catch(async (error) => {
  console.error(error.message);
  await supabase.auth.signOut();
  process.exitCode = 1;
});

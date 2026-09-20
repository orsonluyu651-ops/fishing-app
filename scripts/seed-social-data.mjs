import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'TIDEWIRE_SEED_PASSWORD'];
const USER_DEFINITIONS = [
  { key: 'goldcoast', username: 'GoldCoastAngler', email: 'tidewire.seed.goldcoast@gmail.com' },
  { key: 'barra', username: 'BarraBoss', email: 'tidewire.seed.barra@gmail.com' },
  { key: 'reef', username: 'ReefRider', email: 'tidewire.seed.reef@gmail.com' },
  { key: 'flathead', username: 'FlatheadFan', email: 'tidewire.seed.flathead@gmail.com' },
];

const CATCHES = [
  { key: 'flathead-1', owner: 'goldcoast', species: 'Dusky Flathead', length: 68, weight: 3.4, bait: 'Live yabby', lure: 'Soft plastic prawn', weather: 'Sunny', water_temperature: 24, wind: '12 km/h NE', tide_state: 'Incoming' },
  { key: 'flathead-2', owner: 'flathead', species: 'Dusky Flathead', length: 61, weight: 2.5, bait: 'Prawns', lure: '3 inch paddle tail', weather: 'Partly cloudy', water_temperature: 23, wind: '8 km/h E', tide_state: 'Outgoing' },
  { key: 'flathead-3', owner: 'barra', species: 'Dusky Flathead', length: 54, weight: 1.8, bait: 'Pilchard', lure: 'Soft plastic minnow', weather: 'Overcast', water_temperature: 22, wind: '15 km/h SE', tide_state: 'High' },
  { key: 'tailor-1', owner: 'reef', species: 'Tailor', length: 49, weight: 2.2, bait: 'Pilchard', lure: 'Metal slug', weather: 'Windy', water_temperature: 21, wind: '20 km/h S', tide_state: 'Incoming' },
  { key: 'whiting-1', owner: 'goldcoast', species: 'Sand Whiting', length: 31, weight: 0.7, bait: 'Fresh worms', lure: '', weather: 'Sunny', water_temperature: 25, wind: '6 km/h N', tide_state: 'Outgoing' },
  { key: 'barramundi-1', owner: 'barra', species: 'Barramundi', length: 82, weight: 6.1, bait: 'Live mullet', lure: 'Swimbait', weather: 'Overcast', water_temperature: 26, wind: '10 km/h NW', tide_state: 'Incoming' },
  { key: 'snapper-1', owner: 'reef', species: 'Snapper', length: 58, weight: 3.9, bait: 'Squid', lure: 'Jig', weather: 'Raining', water_temperature: 22, wind: '14 km/h E', tide_state: 'Low' },
];

function loadEnv() {
  const values = Object.create(null);
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const separator = value.indexOf('=');
    if (separator > 0) values[value.slice(0, separator).trim()] = value.slice(separator + 1).trim();
  }
  return values;
}

const env = loadEnv();
for (const key of REQUIRED_ENV) {
  if (!env[key] && !process.env[key]) throw new Error(`Missing ${key}.`);
}
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const password = process.env.TIDEWIRE_SEED_PASSWORD;
const clients = new Map();
const users = new Map();

function clientFor(email) {
  const client = createClient(url, key);
  clients.set(email, client);
  return client;
}

async function authenticateUser(definition) {
  const client = clientFor(definition.email);
  let result = await client.auth.signInWithPassword({ email: definition.email, password });
  if (result.error) {
    result = await client.auth.signUp({
      email: definition.email,
      password,
      options: { data: { username: definition.username } },
    });
  }
  if (result.error) throw new Error(`${definition.username} authentication failed: ${result.error.message}`);
  if (!result.data.user || !result.data.session) {
    throw new Error(`${definition.username} needs email confirmation. Disable Confirm email for this test project and rerun.`);
  }

  const userId = result.data.user.id;
  const profile = await client.from('profiles').select('id, username').eq('id', userId).maybeSingle();
  if (profile.error) throw new Error(`${definition.username} profile lookup failed: ${profile.error.message}`);
  if (!profile.data) {
    const insert = await client.from('profiles').insert({ id: userId, username: definition.username }).select('id, username').single();
    if (insert.error) throw new Error(`${definition.username} profile creation failed: ${insert.error.message}`);
  }
  users.set(definition.key, { ...definition, id: userId, client });
}

async function ensureCatch(catchData) {
  const owner = users.get(catchData.owner);
  const seedMarker = `[seed:social:${catchData.key}]`;
  const existing = await owner.client
    .from('catches')
    .select('id')
    .eq('user_id', owner.id)
    .eq('report_text', seedMarker)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const inserted = await owner.client.from('catches').insert({
    user_id: owner.id,
    species: catchData.species,
    length: catchData.length,
    weight: catchData.weight,
    bait: catchData.bait,
    lure: catchData.lure || null,
    environmental: {
      weather: catchData.weather,
      water_temperature: catchData.water_temperature,
      wind: catchData.wind,
      tide_state: catchData.tide_state,
    },
    verification_status: 'verified',
    report_text: seedMarker,
    verification_score: 0.94,
    verification_analysis: {
      metrics: { species_confidence: 0.96, measurement_confidence: 0.92, image_manipulation_score: 0.04, duplicate_score: 0.02 },
      flags: [],
      model_version: 'seed-fixture-1.0.0',
    },
    leaderboard_eligible: true,
    captured_at: new Date(Date.now() - Math.floor(Math.random() * 14) * 86400000).toISOString(),
  }).select('id').single();
  if (inserted.error) throw new Error(`Catch ${catchData.key} insert failed: ${inserted.error.message}`);
  return inserted.data;
}

async function ensurePost(catchRow, owner) {
  const client = users.get(owner).client;
  const existing = await client.from('posts').select('id, catch_id').eq('catch_id', catchRow.id).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return resolvePersistedPost(owner, catchRow.id, existing.data);
  const created = await client
    .from('posts')
    .insert({ user_id: users.get(owner).id, catch_id: catchRow.id, text: 'Seeded community catch' })
    .select('id, catch_id')
    .single();
  if (created.error) throw new Error(`Post for ${catchRow.id} failed: ${created.error.message}`);
  return resolvePersistedPost(owner, catchRow.id, created.data);
}

function isResolvedPost(row, catchId) {
  return Boolean(
    row
      && typeof row.id === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id)
      && row.catch_id === catchId,
  );
}

async function resolvePersistedPost(owner, catchId, candidate = null) {
  if (isResolvedPost(candidate, catchId)) return candidate;
  const client = users.get(owner).client;
  const lookup = await client.from('posts').select('id, catch_id').eq('catch_id', catchId).maybeSingle();
  if (lookup.error) throw new Error(`Post lookup for ${catchId} failed: ${lookup.error.message}`);
  if (!isResolvedPost(lookup.data, catchId)) return null;
  return lookup.data;
}

async function ensureLike(actor, postId) {
  if (!postId) return false;
  const client = users.get(actor).client;
  const { error } = await client.from('post_likes').upsert({ user_id: users.get(actor).id, post_id: postId }, { onConflict: 'post_id,user_id', ignoreDuplicates: true });
  if (error) throw new Error(`Like seed failed: ${error.message}`);
  return true;
}

async function ensureComment(actor, postId, text) {
  if (!postId) return false;
  const client = users.get(actor).client;
  const existing = await client.from('post_comments').select('id').eq('post_id', postId).eq('user_id', users.get(actor).id).eq('text', text).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;
  const { error } = await client.from('post_comments').insert({ user_id: users.get(actor).id, post_id: postId, text });
  if (error) throw new Error(`Comment seed failed: ${error.message}`);
  return true;
}

async function ensureFollow(actor, target) {
  const client = users.get(actor).client;
  const { error } = await client.from('user_follows').upsert({ follower_id: users.get(actor).id, following_id: users.get(target).id }, { onConflict: 'follower_id,following_id', ignoreDuplicates: true });
  if (error) throw new Error(`Follow seed failed: ${error.message}`);
}

async function main() {
  for (const definition of USER_DEFINITIONS) await authenticateUser(definition);

  const catchRows = new Map();
  const postRows = new Map();
  for (const catchData of CATCHES) {
    const catchRow = await ensureCatch(catchData);
    const postRow = await ensurePost(catchRow, catchData.owner);
    catchRows.set(catchData.key, catchRow);
    postRows.set(catchData.key, postRow);
  }

  const resolveInteractionPostId = async (key) => {
    const catchData = CATCHES.find((item) => item.key === key);
    const cached = postRows.get(key);
    const owner = catchData?.owner;
    const catchRow = catchRows.get(key);
    if (!catchData || !owner || !catchRow?.id) {
      console.warn(`[SEED_SKIPPED] Missing persisted catch for ${key}.`);
      return null;
    }
    const resolved = await resolvePersistedPost(owner, catchRow.id, cached);
    if (!resolved?.id) {
      console.warn(`[SEED_SKIPPED] No persisted post found for ${key}.`);
      return null;
    }
    postRows.set(key, resolved);
    return resolved.id;
  };

  const interactions = [
    ['like', 'flathead', 'flathead-1'],
    ['like', 'reef', 'flathead-1'],
    ['like', 'goldcoast', 'tailor-1'],
    ['comment', 'barra', 'flathead-1', 'That is a beautiful fish.'],
    ['comment', 'reef', 'flathead-1', 'Great work on the incoming tide.'],
    ['comment', 'goldcoast', 'tailor-1', 'The lure choice looks spot on.'],
  ];
  for (const [type, actor, key, text] of interactions) {
    const activePostId = await resolveInteractionPostId(key);
    if (type === 'like') await ensureLike(actor, activePostId);
    else await ensureComment(actor, activePostId, text);
  }

  await ensureFollow('goldcoast', 'barra');
  await ensureFollow('barra', 'reef');
  await ensureFollow('reef', 'goldcoast');
  await ensureFollow('flathead', 'goldcoast');

  const notificationCounts = {};
  for (const definition of USER_DEFINITIONS) {
    const user = users.get(definition.key);
    const result = await user.client.from('activity_notifications').select('id, type, is_read').eq('receiver_id', user.id);
    if (result.error) throw new Error(`Notification verification failed for ${definition.username}: ${result.error.message}`);
    notificationCounts[definition.username] = result.data.length;
  }

  console.log(JSON.stringify({
    users: USER_DEFINITIONS.map((definition) => ({ username: definition.username, id: users.get(definition.key).id })),
    catches: catchRows.size,
    posts: postRows.size,
    notificationCounts,
    note: 'Rerunning this script is idempotent for seeded catches, posts, likes, comments, and follows.',
  }, null, 2));

  for (const client of clients.values()) await client.auth.signOut();
}

main().catch(async (error) => {
  console.error(`[SEED_FAILED] ${error.message}`);
  for (const client of clients.values()) await client.auth.signOut().catch(() => {});
  process.exitCode = 1;
});

-- ════════════════════════════════════════════════════════════════════════
-- TIDEWIRE — launch cleanup, STEP 1 OF 2: INVENTORY
--
-- This block DELETES NOTHING. It just lists every account, spot, and catch
-- currently in the database. Because all 12 demo catches belong to the same
-- account as any real test catches you've logged, we look before we delete.
--
-- HOW TO USE
--   1. Select ALL (Cmd+A / Ctrl+A) and copy.
--   2. Paste into the Supabase SQL editor and Run.
--   3. You'll get four result tables (A, B, C, D). Copy those results
--      back to me and I'll send STEP 2 — the exact delete block.
-- ════════════════════════════════════════════════════════════════════════

-- ── A) Every account in the app ──────────────────────────────────────────
-- Your real account (the one you sign into) vs any throwaway test accounts.
-- The 'catches' column tells us where the 12 demo catches actually live.
select
  au.id,
  au.email,
  au.created_at::date as signed_up,
  p.username,
  (select count(*) from public.catches c where c.user_id = au.id) as catches,
  (select count(*) from public.posts po where po.user_id = au.id)   as posts,
  (select count(*) from public.follows f where f.follower_id = au.id)  as following,
  (select count(*) from public.follows f where f.following_id = au.id) as followers
from auth.users au
left join public.profiles p on p.id = au.id
order by au.created_at;

-- ── B) Every spot ────────────────────────────────────────────────────────
-- The six 'demo' spots use fixed UUIDs starting 10000000-...
select id, name, user_id,
  round(latitude::numeric, 3)  as lat,
  round(longitude::numeric, 3) as lng,
  privacy_level
from public.fishing_spots
order by name;

-- ── C) Every catch ───────────────────────────────────────────────────────
-- 'verification_status' = verified means a photo was attached (real test
-- catch); unverified = the seeded demo rows. caught_on/logged_on show the
-- age of each.
select
  p.username,
  c.species,
  round(c.length::numeric, 1)  as length_cm,
  round(c.weight::numeric, 2)  as weight_kg,
  c.verification_status,
  c.captured_at::date as caught_on,
  c.created_at::date  as logged_on,
  s.name as spot
from public.catches c
left join public.profiles p on p.id = c.user_id
left join public.fishing_spots s on s.id = c.spot_id
order by c.captured_at desc;

-- ── D) Wrapper counts (feed/social objects that would cascade) ───────────
select
  (select count(*) from public.posts)            as total_posts,
  (select count(*) from public.likes)            as total_likes,
  (select count(*) from public.comments)         as total_comments,
  (select count(*) from public.follows)          as total_follows,
  (select count(*) from public.content_reports)  as total_reports;
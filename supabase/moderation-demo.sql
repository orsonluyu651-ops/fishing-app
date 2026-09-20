-- moderation-demo.sql — seed a synthetic moderation queue (no second account needed)
--
-- What works in the Supabase SQL editor: it runs as the `postgres` role (RLS
-- bypassed) but auth.uid() is NULL there, so everything below uses the real
-- angler_228a67b0 UUID as the reporter AND as the author of the demo targets.
-- The editor chokes on dollar-quoted PL/pgSQL and on 3+ statement batches, so
-- paste ONE statement at a time, in order, ignoring the "No rows returned"
-- responses (INSERTs always say that; the row is still created).
--
--   admin UUID: 228a67b0-8e42-4013-b58c-b4777bd71509  (angler_228a67b0)
--
-- SECTION A seeds 3 reports. SECTION B wipes them once you've finished testing.

-- ════════════════════════════════════════════════════════════════════
-- SECTION A — seed 3 demo reports
-- ════════════════════════════════════════════════════════════════════

-- A1) TARGET: a spam post
insert into public.posts (id, user_id, text, created_at)
values (
  '20000000-0000-0000-0000-000000000001',
  '228a67b0-8e42-4013-b58c-b4777bd71509',
  'Buy cheap fishing gear at totally-legit-store.biz!!! Best prices guaranteed!!!',
  now() - interval '2 hours'
)
on conflict (id) do nothing;

-- A2) TARGET: an abusive comment (stands alone; posts.comment links are nullable)
insert into public.comments (id, user_id, text, created_at)
values (
  '20000000-0000-0000-0000-000000000002',
  '228a67b0-8e42-4013-b58c-b4777bd71509',
  'You are the worst fisherman ever, quit posting here you idiot',
  now() - interval '1 hour'
)
on conflict (id) do nothing;

-- A3) TARGET: an over-slot catch. NOTE: catches has NO photo_url column — the
--     Phase 5 AFTER-INSERT trigger auto-posts the catch (catch_id set on the post),
--     and this insert fires it.
insert into public.catches (id, user_id, species, length, verification_status, captured_at, created_at)
values (
  '20000000-0000-0000-0000-000000000003',
  '228a67b0-8e42-4013-b58c-b4777bd71509',
  'Mud Crab',
  28.5,
  'verified',
  current_date - interval '1 day',
  now() - interval '30 minutes'
)
on conflict (id) do nothing;

-- A4) REPORTS — one per target_type (reporter = admin, same as the target author,
--     which is fine: the moderation screen only needs targets it can resolve)
insert into public.content_reports (id, reporter_user_id, target_type, target_id, reason, details, status, created_at)
values (
  '30000000-0000-0000-0000-000000000001',
  '228a67b0-8e42-4013-b58c-b4777bd71509',
  'post',
  '20000000-0000-0000-0000-000000000001',
  'spam',
  'obvious spam — external link, all-caps',
  'open',
  now() - interval '2 hours'
)
on conflict (id) do nothing;

insert into public.content_reports (id, reporter_user_id, target_type, target_id, reason, details, status, created_at)
values (
  '30000000-0000-0000-0000-000000000002',
  '228a67b0-8e42-4013-b58c-b4777bd71509',
  'comment',
  '20000000-0000-0000-0000-000000000002',
  'abuse',
  'personal attack on another angler',
  'open',
  now() - interval '1 hour'
)
on conflict (id) do nothing;

insert into public.content_reports (id, reporter_user_id, target_type, target_id, reason, details, status, created_at)
values (
  '30000000-0000-0000-0000-000000000003',
  '228a67b0-8e42-4013-b58c-b4777bd71509',
  'catch',
  '20000000-0000-0000-0000-000000000003',
  'misinformation',
  'Mud Crab is 28.5 cm — well over the 15 cm minimum, likely illegal take',
  'open',
  now() - interval '30 minutes'
)
on conflict (id) do nothing;

-- A5) VERIFY (this one runs as one SELECT, safe to paste as-is)
select
  (select count(*) from public.content_reports where status = 'open') as open_reports,
  (select count(*) from public.content_reports where id::text like '30000000%') as demo_reports;

-- ════════════════════════════════════════════════════════════════════
-- SECTION B — clean up demo seed data (run after testing; one at a time)
-- ════════════════════════════════════════════════════════════════════

-- B1) Reports first (they reference the targets)
delete from public.content_reports
  where id in (
    '30000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000003'
  );

-- B2) Comment target
delete from public.comments
  where id = '20000000-0000-0000-0000-000000000002';

-- B3) Posts: the spam post + whichever post carries the crab catch_id
delete from public.posts
  where id = '20000000-0000-0000-0000-000000000001'
     or catch_id = '20000000-0000-0000-0000-000000000003';

-- B4) Catch target
delete from public.catches
  where id = '20000000-0000-0000-0000-000000000003';

-- B5) VERIFY clean
select
  (select count(*) from public.content_reports) as reports,
  (select count(*) from public.posts where id = '20000000-0000-0000-0000-000000000001') as spam_post,
  (select count(*) from public.comments where id = '20000000-0000-0000-0000-000000000002') as demo_comment,
  (select count(*) from public.catches where id = '20000000-0000-0000-0000-000000000003') as demo_catch;
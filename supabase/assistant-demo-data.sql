-- assistant-demo-data.sql — optional: restore Gold Coast demo spots + a few
-- recent demo catches so the Guide's "where to fish" / "what's biting" answers
-- (and the Explore heat map) have live data to show.
--
-- The original 0004 seed was cleaned out during moderation testing, which left
-- fishing_spots and the 30-day activity view empty. This re-seeds the same 6
-- spots (fixed UUIDs, idempotent) plus a small set of demo catches spread over
-- the last 3 weeks.
--
-- Supabase SQL editor runs as `postgres` (RLS bypassed) — the auth.users lookup
-- below is only for the spots' user_id FK and works fine there. Paste each
-- section separately; ignore "No rows returned" on INSERTs.

-- ── 1) Restore the 6 demo spots ─────────────────────────────────────
insert into public.fishing_spots (id, user_id, name, latitude, longitude, privacy_level)
values
  ('10000000-0000-0000-0000-000000000001', (select id from auth.users limit 1), 'Southport Broadwater', -27.9620, 153.4050, 'public'),
  ('10000000-0000-0000-0000-000000000002', (select id from auth.users limit 1), 'Surfers Jetty', -28.0010, 153.4310, 'public'),
  ('10000000-0000-0000-0000-000000000003', (select id from auth.users limit 1), 'Broadbeach Spit', -28.0280, 153.4340, 'public'),
  ('10000000-0000-0000-0000-000000000004', (select id from auth.users limit 1), 'Burleigh Headland', -28.0920, 153.4570, 'public'),
  ('10000000-0000-0000-0000-000000000005', (select id from auth.users limit 1), 'Currumbin Alley', -28.1310, 153.4760, 'public'),
  ('10000000-0000-0000-0000-000000000006', (select id from auth.users limit 1), 'Greenmount Point', -28.1700, 153.5080, 'public')
on conflict (id) do nothing;

-- ── 2) A few recent demo catches (spread over 3 weeks, all on-spot) ──
insert into public.catches (user_id, spot_id, species, weight, length, captured_at, verification_status)
values
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000001', 'Dusky Flathead', 1.8, 52, now() - interval '3 days',  'verified'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000002', 'Sand Whiting', 0.5, 26, now() - interval '1 day',   'verified'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000003', 'Tailor', 2.0, 38, now() - interval '2 days',    'verified'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000004', 'Mulloway', 4.5, 78, now() - interval '14 days',  'verified'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000005', 'Tailor', 1.7, 36, now() - interval '5 days',    'verified'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000006', 'Yellowfin Bream', 0.8, 28, now() - interval '7 days', 'verified')
on conflict do nothing;

-- ── 3) Verify ────────────────────────────────────────────────────────
select
  (select count(*) from public.fishing_spots) as spots,
  (select count(*) from public.catches where captured_at >= now() - interval '30 days') as catches_30d;
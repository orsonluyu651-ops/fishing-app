-- Migration 0004: Tidewire regional activity map
--
-- Privacy-preserving activity layer: replaces precise spot markers with
-- generalized regional heat bubbles. The activity_regions table defines
-- bounding circles around Gold Coast sub-regions; the
-- regional_activity_metrics view aggregates live catch counts and outputs
-- only generalized tier strings (no coordinates leak).
--
-- NOTE: uses a pure-SQL Haversine distance calculation (no PostGIS
-- required). st_makepoint/st_distsphere fail on projects where the
-- postgis extension isn't enabled, so we avoid the dependency entirely.
--
-- Depends on: 0001 (regions, set_updated_at), 0003 (catches), and the
-- fishing_spots table created live in session.

-- ============================================================
-- 1. activity_regions: bounding circles for the map
--    (dropped/recreated so re-running this migration is idempotent)
-- ============================================================
drop table if exists public.activity_regions cascade;

create table public.activity_regions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  center_lat numeric not null,
  center_lng numeric not null,
  radius_km numeric not null default 3,
  created_at timestamptz not null default now()
);

grant select on public.activity_regions to anon, authenticated;

-- ============================================================
-- 2. regional_activity_metrics: live aggregate view
-- ============================================================
-- Counts catches within each region's bounding circle over the last
-- 30 days and outputs a generalized activity tier string. No precise
-- spot coordinates are exposed — only region name, center, radius,
-- count, and tier.
--
-- The distance predicate is a Haversine great-circle check (km) between a
-- catch's spot location and each region center:
--   6371 km * acos(cos(lat1)cos(lat2)cos(Δlng) + sin(lat1)sin(lat2))

create or replace view public.regional_activity_metrics as
select
  ar.id,
  ar.name,
  ar.center_lat,
  ar.center_lng,
  ar.radius_km,
  count(c.id)::int as catch_count_30d,
  case
    when count(c.id) >= 10 then '🔥 HIGH'
    when count(c.id) >= 5  then '🟠 GOOD'
    when count(c.id) >= 1  then '🟡 MODERATE'
    else null
  end as activity_tier
from public.activity_regions ar
left join public.catches c
  on c.captured_at >= now() - interval '30 days'
left join public.fishing_spots fs
  on fs.id = c.spot_id
where c.spot_id is not null
  and 6371 * acos(
    least(1,
      cos(radians(ar.center_lat::float8)) * cos(radians(fs.latitude::float8)) *
      cos(radians(fs.longitude::float8 - ar.center_lng::float8)) +
      sin(radians(ar.center_lat::float8)) * sin(radians(fs.latitude::float8))
    )
  ) <= ar.radius_km
group by ar.id, ar.name, ar.center_lat, ar.center_lng, ar.radius_km;

grant select on public.regional_activity_metrics to anon, authenticated;

-- ============================================================
-- 3. Seed: Gold Coast sub-regions (6 bounding circles)
-- ============================================================
insert into public.activity_regions (name, center_lat, center_lng, radius_km) values
  ('Southport',        -27.9672, 153.4000, 3),
  ('Surfers Paradise', -28.0024, 153.4296, 2),
  ('Broadbeach',       -28.0314, 153.4316, 2),
  ('Burleigh Heads',   -28.0896, 153.4534, 2),
  ('Currumbin',        -28.1289, 153.4728, 2),
  ('Coolangatta',      -28.1646, 153.5046, 3);

-- ============================================================
-- 4. Seed: demo fishing spots (one per region)
-- ============================================================
-- Uses fixed UUIDs so the demo catches FK references below work.
-- on conflict (id) do nothing keeps re-runs clean.

insert into public.fishing_spots (id, user_id, name, latitude, longitude, privacy_level) values
  ('10000000-0000-0000-0000-000000000001', (select id from auth.users limit 1), 'Southport Broadwater', -27.9620, 153.4050, 'public'),
  ('10000000-0000-0000-0000-000000000002', (select id from auth.users limit 1), 'Surfers Jetty', -28.0010, 153.4310, 'public'),
  ('10000000-0000-0000-0000-000000000003', (select id from auth.users limit 1), 'Broadbeach Spit', -28.0280, 153.4340, 'public'),
  ('10000000-0000-0000-0000-000000000004', (select id from auth.users limit 1), 'Burleigh Headland', -28.0920, 153.4570, 'public'),
  ('10000000-0000-0000-0000-000000000005', (select id from auth.users limit 1), 'Currumbin Alley', -28.1310, 153.4760, 'public'),
  ('10000000-0000-0000-0000-000000000006', (select id from auth.users limit 1), 'Greenmount Point', -28.1700, 153.5080, 'public')
on conflict (id) do nothing;

-- ============================================================
-- 5. Seed: demo catches (spread over last 30 days)
-- ============================================================
-- Attached to the first available auth user so the regional tier view
-- has data to aggregate on load (region activity = heat map).

insert into public.catches (user_id, spot_id, species, weight, length, captured_at) values
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000001', 'Mangrove Jack', 3.2, 45, now() - interval '2 days'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000001', 'Dusky Flathead', 1.8, 52, now() - interval '5 days'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000002', 'Bream', 0.9, 28, now() - interval '3 days'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000002', 'Tailor', 2.1, 38, now() - interval '7 days'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000003', 'Whiting', 0.6, 25, now() - interval '1 day'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000003', 'Mulloway', 4.5, 78, now() - interval '10 days'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000004', 'Dusky Flathead', 2.3, 61, now() - interval '4 days'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000004', 'Bream', 1.1, 30, now() - interval '6 days'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000005', 'Tailor', 1.8, 36, now() - interval '2 days'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000005', 'Whiting', 0.5, 24, now() - interval '8 days'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000006', 'Mangrove Jack', 2.8, 42, now() - interval '1 day'),
  ((select id from auth.users limit 1), '10000000-0000-0000-0000-000000000006', 'Mulloway', 5.1, 82, now() - interval '12 days');
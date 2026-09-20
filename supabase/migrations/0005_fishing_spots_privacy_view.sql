-- Migration 0005: fishing_spots_public — owner-only exact coordinates
--
-- Phase 5 (location protection): closes the exact-coordinate leak left by the
-- move to regional activity bubbles in Migration 0004. Design doc 05 requires
-- "exact coordinates must be protected by database policies"; Postgres RLS
-- cannot redact columns on a row-by-row basis, so we expose reads through a
-- view instead of the base table.
--
-- public.fishing_spots_public:
--   * security_invoker = true  → the caller's privileges/RLS on fishing_spots
--     apply (the base table keeps its existing read config).
--   * latitude / longitude are returned as the real values ONLY when
--     auth.uid() = user_id (the spot's owner). Every other viewer — signed
--     out, or signed in but not the owner — receives NULL, so coordinates
--     never leave the server for them.
--   * region_bubble_name = the Gold Coast activity region whose bounding
--     circle contains the spot (same concept the map draws), so a non-owner
--     still gets useful, non-sensitive context ("this spot is in the Surfers
--     Paradise area") instead of a bare hidden pin.
--
-- Writes are NOT routed through this view: Add Spot (explore.tsx) inserts
-- into public.fishing_spots directly; the owner's own coordinates are their
-- data, stored on the base table and never redacted for an authenticated
-- owner read.
--
-- Depends on: Migration 0004 (activity_regions) and the live fishing_spots
-- table created during the interactive session.

create or replace view public.fishing_spots_public
with (security_invoker = true)
as
select
  fs.id,
  fs.user_id,
  fs.name,
  fs.privacy_level,
  fs.created_at,
  fs.updated_at,
  case
    when auth.uid() = fs.user_id then fs.latitude
    else null
  end as latitude,
  case
    when auth.uid() = fs.user_id then fs.longitude
    else null
  end as longitude,
  bub.name as region_bubble_name
from public.fishing_spots fs
left join lateral (
  -- Smallest activity-region circle that contains the spot (planar
  -- approximation scaled for latitude; good enough for Gold-Coast-sized
  -- bounds). Region/tier data is already public from Migration 0004, so
  -- the bubble name is safe to expose to every viewer.
  select ar.name
  from public.activity_regions ar
  where (
    ((ar.center_lng - fs.longitude) * cos(radians(fs.latitude))) ^ 2
    + (ar.center_lat - fs.latitude) ^ 2
  ) <= ((ar.radius_km) / 111.32) ^ 2
  order by ar.radius_km asc
  limit 1
) bub on true;

-- Let the client read through the view (there is nothing to write through
-- it: coordinates are server-redacted, and spot creation stays on the base
-- table).
grant select on public.fishing_spots_public to anon, authenticated;
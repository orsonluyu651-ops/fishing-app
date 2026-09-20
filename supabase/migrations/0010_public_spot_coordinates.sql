-- Migration 0010: expose exact coordinates for public spots only
--
-- Public spots can appear as exact map pins. Approximate/private spots retain
-- server-side coordinate redaction; owners can still see their own coordinates.

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
    when fs.privacy_level = 'public' or auth.uid() = fs.user_id then fs.latitude
    else null
  end as latitude,
  case
    when fs.privacy_level = 'public' or auth.uid() = fs.user_id then fs.longitude
    else null
  end as longitude,
  bub.name as region_bubble_name
from public.fishing_spots fs
left join lateral (
  select ar.name
  from public.activity_regions ar
  where (
    ((ar.center_lng - fs.longitude) * cos(radians(fs.latitude))) ^ 2
    + (ar.center_lat - fs.latitude) ^ 2
  ) <= ((ar.radius_km) / 111.32) ^ 2
  order by ar.radius_km asc
  limit 1
) bub on true;

grant select on public.fishing_spots_public to anon, authenticated;

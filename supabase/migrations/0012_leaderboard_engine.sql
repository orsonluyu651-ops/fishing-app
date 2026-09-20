-- Migration 0012: species-grouped leaderboard engine
--
-- The view is the single read model for ranked catches. It performs legal
-- keep-limit enforcement and absolute per-species ranking in PostgreSQL so
-- clients cannot reorder or promote ineligible rows.

create or replace view public.get_species_leaderboard
with (security_invoker = true)
as
with resolved_catches as (
  select
    c.id,
    c.user_id,
    p.username,
    coalesce(s.common_name, c.species) as species,
    c.length,
    c.weight,
    c.captured_at,
    c.verification_status,
    c.verification_score,
    r.min_length_cm,
    r.max_length_cm,
    r.no_take,
    r.source_name,
    ar.name as region_name
  from public.catches c
  join public.profiles p on p.id = c.user_id
  left join public.species s
    on s.id = c.species_id
    or (c.species_id is null and lower(s.common_name) = lower(btrim(c.species)))
    or (c.species_id is null and lower(btrim(c.species)) = any(select lower(x) from unnest(s.alternate_names) x))
  left join public.fishing_rules r
    on r.species_id = s.id
    and r.jurisdiction_id = (select id from public.jurisdictions where name = 'Queensland')
    and r.effective_to is null
  left join public.fishing_spots fs on fs.id = c.spot_id
  left join lateral (
    select activity.name
    from public.activity_regions activity
    where fs.latitude is not null
      and fs.longitude is not null
      and (((activity.center_lng - fs.longitude) * cos(radians(fs.latitude))) ^ 2
        + (activity.center_lat - fs.latitude) ^ 2)
        <= ((activity.radius_km) / 111.32) ^ 2
    order by activity.radius_km asc
    limit 1
  ) ar on true
  where c.verification_status = 'verified'
    and c.leaderboard_eligible = true
    and c.length is not null
    and c.length > 0
    and r.no_take is not true
    and (r.min_length_cm is null or c.length >= r.min_length_cm)
    and (r.max_length_cm is null or c.length <= r.max_length_cm)
)
select
  id as catch_id,
  user_id,
  username,
  species,
  length,
  weight,
  captured_at,
  verification_status,
  verification_score,
  region_name,
  rank() over (partition by species order by length desc, captured_at asc, id asc)::int as absolute_rank,
  source_name
from resolved_catches;

grant select on public.get_species_leaderboard to authenticated;

create index if not exists catches_verified_leaderboard_idx
  on public.catches (species, length desc, captured_at)
  where verification_status = 'verified' and leaderboard_eligible = true;

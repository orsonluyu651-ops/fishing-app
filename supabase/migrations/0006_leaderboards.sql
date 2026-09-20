-- Migration 0006: species leaderboards + personal bests
--
-- Phase 4 — Leaderboards. Ranks verified catches by their LEGAL KEEPABLE
-- size, so an out-of-slot fish (e.g. a 90 cm Dusky Flathead, nice fish but
-- over the 75 cm slot max) is celebrated as a "catch & release" but NEVER
-- ranks — the spec's explicit rule: "A fish over 75cm must be released and
-- cannot be a leaderboard entry despite being larger."
--
-- Single source of truth: public.catch_leaderboard_rows
--   * joins catches → species (by species_id, falling back to common_name
--     OR alternate_names — matching how Add Catch's lookupQldRule() resolves
--     free text — so a catch logged as "Whiting" lands on the Sand Whiting
--     slot and the 23 cm rule applies) → the currently-effective QLD
--     regulation →
--     profiles.username (public — profiles are anon-readable).
--   * scoped to boards marked 'active' in public.leaderboard_species
--     (seeded in 0002: Dusky Flathead, Yellowfin Bream, Sand Whiting,
--     Tailor, Mulloway — Golden Trevally stays a 'candidate'). A species
--     with no active board never ranks, which boxes out the wider "no rule
--     on record → ranks unregulated" hole entirely.
--     NOTE: leaderboard_species has NO id column — its PK is the composite
--     (region_id, species_id, metric) — so "board matched" is tested via
--     ls.species_id is not null.
--   * species is displayed as the RESOLVED common name (so a catch typed
--     "Whiting" shows and groups as "Sand Whiting", not two chips).
--   * keep_status  : 'keepable' | 'undersized_released' | 'over_slot_released'
--                    | 'no_take_released' | 'no_measure'
--   * rank_length  : the length ONLY when the catch is legally keepable,
--                    else NULL (never ranked).
--   * Eligibility : c.leaderboard_eligible is not false (Add Catch writes
--                    false when a user saves an out-of-slot fish) AND
--                    verification_status is distinct from 'unverified'
--                    (add a photo → verified ranks; unverified never ranks).
--
-- The app groups these rows client-side by species, takes the top 10 per
-- board, and derives each angler's personal best — no background job needed
-- at MVP scale; the view is always live over public.catches.
--
-- Depends on: 0001 (profiles, jurisdictions), 0002 (species, fishing_rules),
-- 0003 (catches with verification columns), 0004 (seed catches). The RLS
-- policies on catches and profiles are already anon/authenticated-read.

create or replace view public.catch_leaderboard_rows
with (security_invoker = true)
as
select
  c.id,
  c.user_id,
  p.username,
  coalesce(s.common_name, c.species) as species,
  c.species_id,
  c.length,
  c.weight,
  c.verification_status,
  c.verification_score,
  c.captured_at,
  r.min_length_cm,
  r.max_length_cm,
  r.no_take,
  r.source_name,
  case
    when r.no_take then 'no_take_released'
    when c.length is null then 'no_measure'
    when r.min_length_cm is not null and c.length < r.min_length_cm then 'undersized_released'
    when r.max_length_cm is not null and c.length > r.max_length_cm then 'over_slot_released'
    else 'keepable'
  end as keep_status,
  case
    when c.length is not null
      and r.no_take is not true
      and (r.min_length_cm is null or c.length >= r.min_length_cm)
      and (r.max_length_cm is null or c.length <= r.max_length_cm)
    then c.length
    else null
  end as rank_length
from public.catches c
left join public.species s
  on s.id = c.species_id
  or (c.species_id is null and lower(s.common_name) = lower(btrim(c.species)))
  or (c.species_id is null and lower(btrim(c.species)) = any(select lower(x) from unnest(s.alternate_names) x))
left join public.leaderboard_species ls
  on ls.species_id = s.id
  and ls.status = 'active'
left join public.fishing_rules r
  on r.species_id = s.id
  and r.jurisdiction_id = (select id from public.jurisdictions where name = 'Queensland')
  and r.effective_to is null
left join public.profiles p
  on p.id = c.user_id
where c.leaderboard_eligible is not false
  and c.verification_status is distinct from 'unverified'
  and ls.species_id is not null;

grant select on public.catch_leaderboard_rows to anon, authenticated;

-- ────────────────────────────────────────────────────────────────
-- Sand Whiting alias (Phase 4 — confirmed species for the "Whiting"
-- leaderboard slot).
--
-- The catches table stores a FREE-TEXT `species` string (the app never
-- writes species_id), and both the app's lookupQldRule() and the
-- catch_leaderboard_rows view resolve it by common_name first, then by
-- alternate_names. Without an alias, a catch logged simply as "Whiting"
-- matches NO species row → NO rule → it would rank unregulated at any
-- size. Seeding the alias closes that exact gap, and it mirrors how
-- profiles seed usernames (the app already resolves whiting via this
-- table in migration 0002).
--
-- Exact-token match only (mirrors the app's .contains() semantics), so a
-- "Goldenline Whiting" / "Northern Whiting" catch can never false-match.
update public.species
set alternate_names = '{"Whiting"}'::text[]
where id = '00000000-0000-0000-0000-000000000205'   -- Sand Whiting
  and not (alternate_names = '{"Whiting"}'::text[]);
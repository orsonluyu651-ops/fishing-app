-- Migration 0003: catches
--
-- Depends on Migration 0001 (profiles table, set_updated_at() trigger
-- function) and Migration 0002 (species reference table). Also depends on
-- the fishing_spots table, which was created live during the interactive
-- session via the dashboard SQL editor rather than as a numbered migration.
--
-- Column choices:
--   * species stays a REQUIRED free-text column because add-catch.tsx
--     currently writes a typed species string. species_id is the optional
--     FK to species (Migration 0002), ready for the day the free-text
--     input becomes a picker; it is nullable so both paths coexist.
--   * weight / length are nullable per design doc 05 (estimate-only
--     catches are allowed). The app always sends both, so its inserts
--     are unaffected; the CHECKs keep any present value positive.
--   * user_id -> profiles.id is NOT NULL with cascade: a catch belongs to
--     exactly one angler, and deleting the profile removes its catches.
--   * spot_id -> fishing_spots.id is nullable with SET NULL: a catch may
--     be "secret spot" (no location), and a spot can be deleted without
--     destroying the catches logged against it.

create table public.catches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  spot_id uuid references public.fishing_spots(id) on delete set null,
  species text not null,
  species_id uuid references public.species(id) on delete set null,
  weight numeric check (weight is null or weight > 0),
  length numeric check (length is null or length > 0),
  captured_at timestamptz not null default now(),
  verification_status text not null default 'unverified',
  verification_score numeric not null default 0
    check (verification_score >= 0 and verification_score <= 1),
  leaderboard_eligible boolean not null default true,
  report_text text,
  bait text,
  lure text,
  environmental jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The feed screen orders by created_at desc; the spot detail screen will
-- load by spot_id, and analytics by user_id.
create index catches_feed on public.catches (created_at desc);
create index catches_user on public.catches (user_id);
create index catches_spot on public.catches (spot_id);

alter table public.catches enable row level security;

-- The community feed renders every catch, so all reads are public.
create policy "catches are publicly readable"
  on public.catches for select
  using (true);

-- A signed-in user may only log a catch whose user_id is their own.
create policy "users can log their own catch"
  on public.catches for insert
  with check (auth.uid() = user_id);

create policy "users can update their own catch"
  on public.catches for update
  using (auth.uid() = user_id);

create policy "users can delete their own catch"
  on public.catches for delete
  using (auth.uid() = user_id);

-- Explicit grants alongside the policies: RLS policies alone leave the
-- table invisible to the client API. Select is public (anon) because the
-- feed is public; writes are authenticated-only, same as Migration 0001.
grant select on public.catches to anon, authenticated;
grant insert, update, delete on public.catches to authenticated;

-- Reuse the set_updated_at() trigger function created in Migration 0001.
create trigger set_catches_updated_at
  before update on public.catches
  for each row execute procedure public.set_updated_at();
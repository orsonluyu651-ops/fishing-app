-- ════════════════════════════════════════════════════════════════════════
-- TIDEWIRE — combined apply for migrations 0006 + 0007
--
-- HOW TO USE
--   1. Open this file in any text editor.
--   2. Select ALL (Cmd+A / Ctrl+A) and copy.
--   3. Paste into the Supabase SQL editor and Run.
--   4. The LAST query must return three names (leaderboard_view,
--      feed_view, posts) — NOT NULL. That means it worked.
--
-- This script is safe to run more than once (it drops any half-applied
-- state first). It is a manual apply helper, NOT a numbered migration —
-- Supabase's migration tooling will not mistake it for one.
-- ════════════════════════════════════════════════════════════════════════

-- ── 0) Clear any half-applied state from earlier attempts ───────────────
drop view if exists public.feed_posts;
drop function if exists public.create_feed_post_on_catch();
drop table if exists public.content_reports cascade;
drop table if exists public.comments cascade;
drop table if exists public.likes cascade;
drop table if exists public.posts cascade;
drop table if exists public.follows cascade;
drop view if exists public.catch_leaderboard_rows;

-- ════════════════════════════════════════════════════════════════════════
-- 1) Migration 0006 — species leaderboards + personal bests
-- ════════════════════════════════════════════════════════════════════════
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

update public.species
set alternate_names = '{"Whiting"}'::text[]
where id = '00000000-0000-0000-0000-000000000205'   -- Sand Whiting
  and not (alternate_names = '{"Whiting"}'::text[]);

-- ════════════════════════════════════════════════════════════════════════
-- 2) Migration 0007 — basic social: follows, feed, comments, reports
-- ════════════════════════════════════════════════════════════════════════
create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index follows_following on public.follows (following_id);
alter table public.follows enable row level security;
create policy "follows are publicly readable" on public.follows for select using (true);
create policy "users can follow others" on public.follows for insert with check (auth.uid() = follower_id);
create policy "users can unfollow" on public.follows for delete using (auth.uid() = follower_id);
grant select on public.follows to anon, authenticated;
grant insert, delete on public.follows to authenticated;

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  catch_id uuid unique references public.catches(id) on delete set null,
  text text,
  created_at timestamptz not null default now()
);
create index posts_feed on public.posts (created_at desc);
create index posts_user on public.posts (user_id);
alter table public.posts enable row level security;
create policy "posts are publicly readable" on public.posts for select using (true);
create policy "users can create their own post" on public.posts for insert with check (auth.uid() = user_id);
create policy "users can edit their own post" on public.posts for update using (auth.uid() = user_id);
create policy "users can delete their own post" on public.posts for delete using (auth.uid() = user_id);
grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;

create table public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index likes_post on public.likes (post_id);
alter table public.likes enable row level security;
create policy "likes are publicly readable" on public.likes for select using (true);
create policy "users can like a post" on public.likes for insert with check (auth.uid() = user_id);
create policy "users can unlike" on public.likes for delete using (auth.uid() = user_id);
grant select on public.likes to anon, authenticated;
grant insert, delete on public.likes to authenticated;

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index comments_post on public.comments (post_id);
alter table public.comments enable row level security;
create policy "comments are publicly readable" on public.comments for select using (true);
create policy "users can comment on a post" on public.comments for insert with check (auth.uid() = user_id);
create policy "users can delete their own comment" on public.comments for delete using (auth.uid() = user_id);
grant select on public.comments to anon, authenticated;
grant insert, delete on public.comments to authenticated;

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'catch')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'abuse', 'inappropriate', 'misinformation', 'other')),
  details text,
  status text not null default 'open' check (status in ('open', 'under_review', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);
create index content_reports_target on public.content_reports (target_type, target_id);
create index content_reports_reporter on public.content_reports (reporter_user_id);
alter table public.content_reports enable row level security;
create policy "content reports are private to the reporter" on public.content_reports for select using (auth.uid() = reporter_user_id);
create policy "users can file a content report" on public.content_reports for insert with check (auth.uid() = reporter_user_id);
grant select, insert on public.content_reports to authenticated;

create function public.create_feed_post_on_catch() returns trigger
language plpgsql
as $$
begin
  insert into public.posts (user_id, catch_id, text)
  values (
    new.user_id,
    new.id,
    case
      when new.length is not null then new.species || ' — ' || new.length::text || ' cm'
      else new.species
    end
  );
  return new;
end;
$$;
create trigger create_feed_post_on_catch
  after insert on public.catches
  for each row execute procedure public.create_feed_post_on_catch();

create or replace view public.feed_posts
with (security_invoker = true)
as
select
  p.id,
  p.user_id,
  pr.username,
  p.catch_id,
  p.text as caption,
  p.created_at,
  c.species,
  c.length,
  c.weight,
  c.verification_status,
  c.verification_score,
  c.captured_at,
  c.verification_status = 'verified' as is_verified,
  (select count(*) from public.likes l where l.post_id = p.id) as like_count,
  (select count(*) from public.comments cm where cm.post_id = p.id) as comment_count
from public.posts p
left join public.profiles pr on pr.id = p.user_id
left join public.catches c on c.id = p.catch_id;
grant select on public.feed_posts to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 3) Verify — the last query MUST return three names, not NULL
-- ════════════════════════════════════════════════════════════════════════
select
  to_regclass('public.catch_leaderboard_rows') as leaderboard_view,
  to_regclass('public.feed_posts') as feed_view,
  to_regclass('public.posts') as posts;
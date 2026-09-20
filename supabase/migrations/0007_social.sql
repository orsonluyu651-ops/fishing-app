-- Migration 0007: basic social — follows, feed, comments, content reports
--
-- Phase 5 — Basic social (roadmap: "follows, feed, comments, content
-- reports"). Adds the four pillars:
--   * follows           one-way edge between anglers (follower -> following)
--   * posts + feed      every logged catch auto-creates a post (see the
--                        trigger at the bottom), so the community feed has
--                        content without a separate share step. feed_posts
--                        is the read model the app queries.
--   * likes / comments  minimal engagement on a post; a signed-in angler may
--                        remove their own like or comment.
--   * content_reports   a flag/moderation trail targeting a post, comment,
--                        or catch (polymorphic target_id). Private to the
--                        reporter at MVP — a moderation surface arrives with
--                        an admin role later.
--
-- Conventions mirroring 0001-0006:
--   * id uuid primary key default gen_random_uuid()
--   * user_id -> profiles.id NOT NULL / CASCADE — a post, like, comment,
--     follow, and report all belong to exactly one angler; deleting the
--     profile takes its social footprint with it.
--   * posts.catch_id -> catches.id UNIQUE + SET NULL — a catch yields AT
--     MOST ONE post, and deleting the catch keeps the post (and its
--     comments/likes) rather than cascading the conversation away.
--   * RLS on every table, with named policies and explicit grants beside
--     them (a policy alone leaves the table invisible to PostgREST).
--   * The feed read model is a security_invoker view, so PostgreSQL applies
--     the same RLS the base tables carry — an anonymous visitor sees rows
--     exactly like the tables would hand them.
--
-- Depends on: 0001 (profiles), 0003 (catches — the trigger + feed join).

-- ════════════════════════════════════════════════════════════════════════
-- follows
-- ════════════════════════════════════════════════════════════════════════
create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

-- Counts query followers; the feed's "following only" filter scans by
-- following_id.
create index follows_following on public.follows (following_id);

alter table public.follows enable row level security;

-- Edges are public so follower counts and "do I follow this angler?" work
-- for everyone — consistent with profiles being anonymous-readable.
create policy "follows are publicly readable"
  on public.follows for select
  using (true);

create policy "users can follow others"
  on public.follows for insert
  with check (auth.uid() = follower_id);

create policy "users can unfollow"
  on public.follows for delete
  using (auth.uid() = follower_id);

grant select on public.follows to anon, authenticated;
grant insert, delete on public.follows to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- posts
-- ════════════════════════════════════════════════════════════════════════
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

create policy "posts are publicly readable"
  on public.posts for select
  using (true);

create policy "users can create their own post"
  on public.posts for insert
  with check (auth.uid() = user_id);

create policy "users can edit their own post"
  on public.posts for update
  using (auth.uid() = user_id);

create policy "users can delete their own post"
  on public.posts for delete
  using (auth.uid() = user_id);

grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- likes
-- ════════════════════════════════════════════════════════════════════════
create table public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- The feed counts likes per post.
create index likes_post on public.likes (post_id);

alter table public.likes enable row level security;

create policy "likes are publicly readable"
  on public.likes for select
  using (true);

create policy "users can like a post"
  on public.likes for insert
  with check (auth.uid() = user_id);

create policy "users can unlike"
  on public.likes for delete
  using (auth.uid() = user_id);

grant select on public.likes to anon, authenticated;
grant insert, delete on public.likes to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- comments
-- ════════════════════════════════════════════════════════════════════════
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index comments_post on public.comments (post_id);

alter table public.comments enable row level security;

create policy "comments are publicly readable"
  on public.comments for select
  using (true);

create policy "users can comment on a post"
  on public.comments for insert
  with check (auth.uid() = user_id);

create policy "users can delete their own comment"
  on public.comments for delete
  using (auth.uid() = user_id);

grant select on public.comments to anon, authenticated;
grant insert, delete on public.comments to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- content_reports
-- ════════════════════════════════════════════════════════════════════════
-- target_type + target_id is a polymorphic reference: no single FK, by
-- design (a report may point at a post, a comment, or a catch). Integrity
-- is soft: a dangling target_id is a report on nothing, which the
-- moderation surface can safely ignore.
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

-- Reports are private to whoever filed them until a moderation surface
-- exists. No anon read, no blanket staff read yet.
create policy "content reports are private to the reporter"
  on public.content_reports for select
  using (auth.uid() = reporter_user_id);

create policy "users can file a content report"
  on public.content_reports for insert
  with check (auth.uid() = reporter_user_id);

grant select, insert on public.content_reports to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- Every logged catch becomes a feed post
-- ════════════════════════════════════════════════════════════════════════
-- Runs as the invoking user (security invoker, the default), so RLS on
-- posts still applies: the insert carries the catch owner's user_id, which
-- is auth.uid() at catch time — the "users can create their own post"
-- check passes. Anonymous can never insert a catch, so this can't fire
-- outside a signed-in session.
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

-- ════════════════════════════════════════════════════════════════════════
-- feed_posts — the read model the app queries
-- ════════════════════════════════════════════════════════════════════════
-- Joins posts → profiles (username) → catches (species / size / verified).
-- Spot names are deliberately NOT surfaced here: the map + leaderboard are
-- the place for location; the feed stays location-free by design.
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
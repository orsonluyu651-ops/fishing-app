-- Migration 0013: canonical social interaction tables and feed aggregates
--
-- The older likes/comments/follows tables remain for backward compatibility;
-- these tables are the canonical API for the current client.

create table public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index post_likes_user_idx on public.post_likes (user_id);
create index post_likes_post_idx on public.post_likes (post_id);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index post_comments_post_created_idx on public.post_comments (post_id, created_at);
create index post_comments_user_idx on public.post_comments (user_id);

create table public.user_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index user_follows_following_idx on public.user_follows (following_id);

alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.user_follows enable row level security;

create policy "Authenticated users can read post likes"
  on public.post_likes for select to authenticated using (true);
create policy "Users can create their own post likes"
  on public.post_likes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own post likes"
  on public.post_likes for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Authenticated users can read post comments"
  on public.post_comments for select to authenticated using (true);
create policy "Users can create their own post comments"
  on public.post_comments for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own post comments"
  on public.post_comments for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Authenticated users can read user follows"
  on public.user_follows for select to authenticated using (true);
create policy "Users can create their own follows"
  on public.user_follows for insert to authenticated
  with check ((select auth.uid()) = follower_id);
create policy "Users can delete their own follows"
  on public.user_follows for delete to authenticated
  using ((select auth.uid()) = follower_id);

grant select on public.post_likes, public.post_comments, public.user_follows to authenticated;
grant insert, delete on public.post_likes, public.user_follows to authenticated;
grant insert, delete on public.post_comments to authenticated;

drop view if exists public.feed_posts;
create view public.feed_posts
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
  (select count(*)::int from public.post_likes pl where pl.post_id = p.id) as likes_count,
  (select count(*)::int from public.post_comments pc where pc.post_id = p.id) as comments_count,
  exists (
    select 1 from public.post_likes me
    where me.post_id = p.id and me.user_id = (select auth.uid())
  ) as is_liked_by_me
from public.posts p
left join public.profiles pr on pr.id = p.user_id
left join public.catches c on c.id = p.catch_id;

grant select on public.feed_posts to authenticated;

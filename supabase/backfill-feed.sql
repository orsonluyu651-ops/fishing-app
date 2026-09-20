-- Backfill existing catches into the feed.
-- The create_feed_post_on_catch trigger only fires for NEW catches, so any
-- catches logged before migration 0007 have no post yet. This inserts one
-- per existing catch. Safe to run more than once (catch_id is unique).
insert into public.posts (user_id, catch_id, text)
select
  c.user_id,
  c.id,
  case when c.length is not null then c.species || ' — ' || c.length::text || ' cm' else c.species end
from public.catches c
on conflict (catch_id) do nothing;

-- Counts to confirm everything is wired up.
select count(*) as feed_rows from public.feed_posts;
select count(*) as board_rows from public.catch_leaderboard_rows;
select count(*) as catches from public.catches;
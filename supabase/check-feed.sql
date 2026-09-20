-- One-row status check: run this and tell me the four numbers.
select
  (select count(*) from public.catches)                as catches,
  (select count(*) from public.posts)                  as posts,
  (select count(*) from public.feed_posts)             as feed_rows,
  (select count(*) from public.catch_leaderboard_rows) as board_rows;

-- Peek at what the feed will actually show (most recent first).
select username, species, length, is_verified, created_at
from public.feed_posts
order by created_at desc
limit 5;
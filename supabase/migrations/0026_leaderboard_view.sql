-- 0026_leaderboard_view.sql

-- Construct a high-performance read view that aggregates user catch log records
CREATE OR REPLACE VIEW public.leaderboard_ranks AS
SELECT 
    p.id AS user_id,
    p.username,
    COALESCE(SUM(c.weight), 0) AS total_weight_lbs,
    COUNT(c.id) AS total_catches,
    COALESCE(MAX(c.weight), 0) AS heaviest_catch_lbs,
    RANK() OVER (ORDER BY COALESCE(SUM(c.weight), 0) DESC, COUNT(c.id) DESC) AS leaderboard_rank
FROM public.profiles p
INNER JOIN public.catches c ON p.id = c.user_id
GROUP BY p.id, p.username;

-- Grant broad read metrics access layers to public callers
ALTER VIEW public.leaderboard_ranks OWNER TO postgres;
GRANT SELECT ON public.leaderboard_ranks TO authenticated;
GRANT SELECT ON public.leaderboard_ranks TO anon;

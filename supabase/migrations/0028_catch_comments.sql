-- 0028_catch_comments.sql
CREATE TABLE public.catch_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    catch_id UUID REFERENCES public.catches(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    comment_text TEXT NOT NULL CONSTRAINT max_comment_len CHECK (char_length(comment_text) <= 500),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Optimize chronologically sorted thread retrievals
CREATE INDEX catch_comments_lookup_idx ON public.catch_comments(catch_id, created_at ASC);

ALTER TABLE public.catch_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can see catch comments" ON public.catch_comments FOR SELECT USING (true);
CREATE POLICY "Authenticated users can leave comments" ON public.catch_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can remove own comments" ON public.catch_comments FOR DELETE USING (auth.uid() = user_id);

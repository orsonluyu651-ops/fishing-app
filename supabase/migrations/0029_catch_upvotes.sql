-- 0029_catch_upvotes.sql
CREATE TABLE public.catch_upvotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    catch_id UUID REFERENCES public.catches(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT catch_user_unique_upvote UNIQUE (catch_id, user_id)
);

-- Optimize unique target count aggregates
CREATE INDEX catch_upvotes_lookup_idx ON public.catch_upvotes(catch_id);

ALTER TABLE public.catch_upvotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can check catch upvotes" ON public.catch_upvotes FOR SELECT USING (true);
CREATE POLICY "Authenticated users can toggle upvotes" ON public.catch_upvotes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can retract own upvotes" ON public.catch_upvotes FOR DELETE USING (auth.uid() = user_id);

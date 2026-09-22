-- 0027_map_markers.sql
CREATE TABLE public.saved_spots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Optimize geographical range lookup indexations
CREATE INDEX saved_spots_geo_lookup_idx ON public.saved_spots(latitude, longitude);

ALTER TABLE public.saved_spots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own pins" ON public.saved_spots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can add own pins" ON public.saved_spots FOR INSERT WITH CHECK (auth.uid() = user_id);

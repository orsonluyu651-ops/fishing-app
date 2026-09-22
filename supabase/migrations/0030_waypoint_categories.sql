-- 0030_waypoint_categories.sql

-- Append category classification indicator to saved spots schemas
ALTER TABLE public.saved_spots ADD COLUMN category TEXT DEFAULT 'structure' NOT NULL;

-- Enforce standard string value groupings boundaries
ALTER TABLE public.saved_spots ADD CONSTRAINT waypoint_category_check
    CHECK (category IN ('structure', 'boat_ramp', 'weed_line', 'deep_hole', 'reef'));

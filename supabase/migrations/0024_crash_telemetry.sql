-- 0024_crash_telemetry.sql
CREATE TABLE public.crash_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    error_message TEXT NOT NULL,
    error_stack TEXT,
    device_platform TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Optimize queries for tracking chronologically descending issue clusters
CREATE INDEX crash_logs_chronological_idx ON public.crash_logs(created_at DESC);

-- Enable Security
ALTER TABLE public.crash_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can write diagnostic crash records anonymized" ON public.crash_logs 
    FOR INSERT WITH CHECK (true);

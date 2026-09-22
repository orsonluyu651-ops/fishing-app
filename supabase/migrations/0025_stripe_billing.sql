-- 0025_stripe_billing.sql

-- Append billing state tracking entities to core profile models
ALTER TABLE public.profiles ADD COLUMN stripe_customer_id TEXT DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN is_premium BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN subscription_status TEXT DEFAULT 'inactive';

-- Enable row read constraints to guard premium views
CREATE POLICY "Premium features access rule" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

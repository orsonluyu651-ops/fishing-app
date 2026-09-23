-- 0025_stripe_billing.sql
--
-- NOTE (reconciled with 0017 by 0031): this file previously used bare
-- `ADD COLUMN` and an unguarded `CREATE POLICY`, so it aborted with
-- SQLSTATE 42701 the moment 0017 had already added `stripe_customer_id`.
-- Every statement is now idempotent, making the migration order-insensitive.

-- Append billing state tracking entities to core profile models
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';

-- Enable row read constraints to guard premium views.
-- Guarded: an unguarded CREATE POLICY fails on re-run with 42710.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'profiles'
       AND policyname = 'Premium features access rule'
  ) THEN
    CREATE POLICY "Premium features access rule" ON public.profiles
        FOR SELECT USING (auth.uid() = id);
  END IF;
END $$;

-- 0017 — premium subscription flags
--
-- Adds premium subscription tracking to the profiles table.
-- The is_pro flag is toggled by the stripe-webhook Edge Function
-- (supabase/functions/stripe-webhook) when Stripe sends subscription
-- or invoice payment events.
--
-- The stripe_customer_id is stored for webhook lookups and future
-- subscription management.

-- Add premium status flag
alter table public.profiles
  add column if not exists is_pro boolean not null default false;

comment on column public.profiles.is_pro is
  'Premium subscription status. Set to true by stripe-webhook on subscription creation/renewal, false on cancellation.';

-- Add Stripe customer ID for webhook lookups
alter table public.profiles
  add column if not exists stripe_customer_id text;

comment on column public.profiles.stripe_customer_id is
  'Stripe customer ID (cus_...) used by the stripe-webhook to match incoming events to user profiles.';

-- Add stripe subscription ID for subscription management
alter table public.profiles
  add column if not exists stripe_subscription_id text;

comment on column public.profiles.stripe_subscription_id is
  'Stripe subscription ID (sub_...) for the active subscription, if any.';

-- Add subscription end date for tracking trial/expiration
alter table public.profiles
  add column if not exists stripe_subscription_end_at timestamptz;

comment on column public.profiles.stripe_subscription_end_at is
  'When the current subscription period ends (or trial ends). Used for grace period handling.';

-- Create an index for efficient webhook lookups by Stripe customer ID
create index if not exists profiles_stripe_customer_id_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- Policy: Users can read their own premium status
create policy "users can view own premium status"
  on public.profiles for select
  using (auth.uid() = id);

-- Note: The stripe-webhook Edge Function uses the service role key
-- to update these columns, bypassing RLS.

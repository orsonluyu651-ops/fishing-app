-- 0031 — subscription flag reconciliation (is_pro / is_premium drift fix)
--
-- WHY THIS EXISTS
-- The client and the billing backend disagree about the subscription column
-- name, and neither column exists on the live cluster:
--
--   * src/lib/premiumAccess.ts        reads  profiles.is_pro
--   * src/lib/stripeEngine.ts         reads  profiles.is_premium
--   * supabase/functions/stripe-webhook  WRITES BOTH flags in parallel
--
-- 0017_premium_subscriptions.sql introduces `is_pro` (idempotent).
-- 0025_stripe_billing.sql introduces `is_premium` and a SECOND
-- `stripe_customer_id` (both WITHOUT `if not exists`), so the two files
-- cannot both run in sequence — 0025 aborts with SQLSTATE 42701
-- ("column already exists") once 0017 has applied. That is the source of
-- the live `42703: column profiles.is_pro does not exist` error: 0017 was
-- never applied, and 0025 cannot be applied after it.
--
-- THIS MIGRATION
-- Forward-only and fully idempotent. It converges the schema onto the union
-- of what the code actually reads and writes, and is safe to re-run.
-- Apply it in the Supabase SQL Editor, or via `supabase db push` once the
-- project is linked.

-- ── 1. Subscription flags ────────────────────────────────────────────────
alter table public.profiles
  add column if not exists is_pro boolean not null default false;

alter table public.profiles
  add column if not exists is_premium boolean not null default false;

comment on column public.profiles.is_pro is
  'Premium subscription status. Read by src/lib/premiumAccess.ts (paywall gates, map tile cache limit). Written by stripe-webhook.';

comment on column public.profiles.is_premium is
  'Premium subscription status. Read by src/lib/stripeEngine.ts. Written by stripe-webhook alongside is_pro — kept in sync, never authoritative on its own.';

-- ── 2. Billing / Stripe linkage columns ──────────────────────────────────
alter table public.profiles
  add column if not exists stripe_customer_id text;

alter table public.profiles
  add column if not exists stripe_subscription_id text;

alter table public.profiles
  add column if not exists stripe_subscription_end_at timestamptz;

alter table public.profiles
  add column if not exists subscription_status text default 'inactive';

comment on column public.profiles.stripe_customer_id is
  'Stripe customer ID (cus_...) used by stripe-webhook to match incoming events to user profiles.';

comment on column public.profiles.stripe_subscription_id is
  'Stripe subscription ID (sub_...) for the active subscription, if any.';

comment on column public.profiles.stripe_subscription_end_at is
  'When the current subscription period (or trial) ends. Used for grace-period handling.';

comment on column public.profiles.subscription_status is
  'Mirror of the Stripe subscription state (active | canceled | inactive). Read by stripeEngine.';

-- ── 3. Webhook lookup index ──────────────────────────────────────────────
create index if not exists profiles_stripe_customer_id_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- ── 4. One-way backfill: is_premium -> is_pro ────────────────────────────
-- Only ever promotes to true. Never demotes: a user who is genuinely pro
-- must not be downgraded by a stale duplicate flag.
update public.profiles
   set is_pro = true
 where is_premium = true
   and is_pro = false;

-- ── 5. RLS: the owner may read their own profile row ─────────────────────
-- Guarded so re-running is a no-op instead of a duplicate-name error.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'profiles'
       and policyname = 'users can view own premium status'
  ) then
    create policy "users can view own premium status"
      on public.profiles for select
      using (auth.uid() = id);
  end if;
end $$;

-- NOTE: writes to these columns are performed by the stripe-webhook Edge
-- Function using the service-role key, which bypasses RLS by design.

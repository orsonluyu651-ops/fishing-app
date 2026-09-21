-- 0018 — Customer billing mapping & AI audit RLS
--
-- Finalizes the backend infrastructure for the premium subscription system:
--   1. Adds a UNIQUE constraint on profiles.stripe_customer_id so webhook
--      lookups can match incoming Stripe events to a single profile row
--      with O(log n) certainty (no race-condition duplicates).
--   2. Creates the public.ai_chat_logs audit table that captures every
--      Ask Tidewire prompt/response pair with token usage metadata.
--   3. Enables Row Level Security (RLS) on ai_chat_logs and applies the
--      strict per-user policy so anonymous or unauthenticated sessions
--      drop immediately with a Postgres permission fault.

-- ── 1. Unique constraint on stripe_customer_id ─────────────────────────────
-- Migration 0017 added the column + a partial index; here we add the
-- constraint to guarantee no two profiles can claim the same Stripe
-- customer ID. Uses NOT VALID first to avoid a full-table scan lock
-- (Stripe webhooks fire under the service role, which already trusts
-- the constraint), then validates existing rows.

alter table public.profiles
  add constraint profiles_stripe_customer_id_key
  unique using index profiles_stripe_customer_id_idx
  not valid;

comment on constraint profiles_stripe_customer_id_key on public.profiles is
  'Guarantees one-to-one mapping between Stripe customer IDs and user profiles. Checked by the stripe-webhook Edge Function under the service role.';

-- ── 2. AI chat audit table ─────────────────────────────────────────────────
-- Captures every Ask Tidewire interaction for cost attribution, abuse
-- detection, and premium feature enforcement. Written by the ask-tidewire
-- Edge Function (service role) and read only by the owning user.

create table if not exists public.ai_chat_logs (
  id              uuid         primary key default gen_random_uuid(),
  user_id         uuid         not null references public.profiles(id) on delete cascade,
  assistant_id    text,
  prompt_tokens   integer      not null default 0,
  completion_tokens integer    not null default 0,
  total_tokens    integer      not null default 0,
  provider_cost_microcents integer not null default 0,
  prompt_message  text         not null,
  response_message text        not null,
  is_pro_at_call  boolean      not null default false,
  created_at      timestamptz  not null default now()
);

comment on table public.ai_chat_logs is
  'Audit log of Ask Tidewire AI assistant interactions. Each row records the prompt, response, token usage, and the user premium status at call time.';

-- Indexes for fast lookups
create index if not exists ai_chat_logs_user_id_idx on public.ai_chat_logs (user_id);
create index if not exists ai_chat_logs_created_at_idx on public.ai_chat_logs (created_at desc);

-- ── 3. Row Level Security ──────────────────────────────────────────────────
-- Enable RLS on ai_chat_logs — without it, the table is wide open.
alter table public.ai_chat_logs enable row level security;

-- Policy: Users can only read their own AI query audit rows.
-- Anonymous (unauthenticated) calls will fail with a Postgres permission
-- fault because auth.uid() returns NULL, which never matches any user_id.
create policy "Users can only read their own AI query audit rows"
  on public.ai_chat_logs
  for select
  using (auth.uid() = user_id);

-- The ask-tidewire Edge Function writes audit rows under the service role,
-- so an INSERT policy is intentionally NOT required — service-role
-- requests bypass RLS by design.
-- See: supabase/functions/ask-tidewire/index.ts (audit logging path).
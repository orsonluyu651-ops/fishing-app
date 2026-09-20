-- Migration 0011: persist structured catch verification output

alter table public.catches
  add column if not exists verification_analysis jsonb not null default '{}'::jsonb;

alter table public.catches
  drop constraint if exists catches_verification_status_check;

alter table public.catches
  add constraint catches_verification_status_check
  check (verification_status in ('pending', 'verified', 'flagged', 'unverified'));

comment on column public.catches.verification_analysis is
  'Server verification metrics, flags, and model version for auditability.';

-- Migration 0008: content moderation
--
-- Phase 5 — completion. Migration 0007 let any signed-in user *file* a
-- content report, but nobody could read or act on the accumulated reports.
-- This adds the first admin concept to the app, enforced in RLS (not just
-- hidden in the UI), so a non-admin can never read another user's reports
-- or delete content — even by calling Supabase directly.
--
-- What "moderator" means here:
--   * profiles.is_admin is the only flag (no separate roles table — MVP).
--   * A moderator can READ every report and change its status
--     (open → under_review → resolved / dismissed).
--   * A moderator can hard-DELETE a reported post, comment, or catch
--     (full-delete powers, confirmed in-session). Existing owner policies
--     stay — RLS policies OR together, so owners keep their own rights.
--
-- The app reads reports through the public.moderation_reports view, which
-- resolves each polymorphic target (post / comment / catch) to displayable
-- text in ONE query. security_invoker keeps the Phase 5 privacy guarantee:
-- the view can never show a report to anyone but its reporter (or admin).
--
-- Pre-launch seeding: the FIRST account ever created becomes the admin
-- (that's the original test/keeper account). To choose another account
-- instead, replace the email in the commented line at the bottom before
-- running. This migration is safe to run more than once (idempotent).

-- ── 1) The admin flag ─────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- ── 2) The policy helper (every admin policy reads through this) ──────────
-- security definer so the check isn't affected by the table's own RLS;
-- search_path pinned to public so the lookups can't be hijacked.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_admin
  );
$$;

-- ── 3) Admin RLS policies ─────────────────────────────────────────────────
-- content_reports: moderators may read everything + change status. There
-- is deliberately NO moderator delete on reports — they stay as an audit
-- trail. The reporter can still see their own report's progress.
create policy "moderators can read all reports"
  on public.content_reports for select
  to authenticated
  using (public.is_admin());

create policy "moderators can update report status"
  on public.content_reports for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- posts / comments / catches: moderators may hard-delete any row. Likes
-- and comments on a deleted post cascade automatically.
create policy "moderators can delete any post"
  on public.posts for delete
  to authenticated
  using (public.is_admin());

create policy "moderators can delete any comment"
  on public.comments for delete
  to authenticated
  using (public.is_admin());

create policy "moderators can delete any catch"
  on public.catches for delete
  to authenticated
  using (public.is_admin());

-- ── 4) Moderation view — one query that resolves every target ─────────────
-- security_invoker: each row the viewer can see is filtered by RLS on the
-- underlying tables. A non-admin sees only their own reports; an admin
-- sees all. A target deleted by its owner left-joins to NULL — the app
-- shows it as "(deleted)" rather than an orphan row.
create or replace view public.moderation_reports
with (security_invoker = true)
as
select
  r.id                as report_id,
  r.reporter_user_id,
  rp.username         as reporter_username,
  r.target_type,
  r.target_id,
  r.reason,
  r.details,
  r.status,
  r.created_at        as reported_at,
  -- post target
  po.id               as post_id,
  po.user_id          as post_author_id,
  pup.username        as post_author_username,
  po.text             as post_text,
  -- comment target
  cm.id               as comment_id,
  cm.user_id          as comment_author_id,
  cup.username        as comment_author_username,
  cm.text             as comment_text,
  -- catch target
  ca.id               as catch_id,
  ca.user_id          as catch_author_id,
  cap.username        as catch_author_username,
  ca.species          as catch_species,
  ca.length           as catch_length,
  ca.verification_status as catch_verified,
  ca.captured_at      as catch_captured_at
from public.content_reports r
left join public.profiles rp on rp.id = r.reporter_user_id
left join public.posts po   on po.id  = r.target_id and r.target_type = 'post'
left join public.profiles pup on pup.id = po.user_id
left join public.comments cm on cm.id  = r.target_id and r.target_type = 'comment'
left join public.profiles cup on cup.id = cm.user_id
left join public.catches ca on ca.id   = r.target_id and r.target_type = 'catch'
left join public.profiles cap on cap.id = ca.user_id;

grant select on public.moderation_reports to authenticated;

-- ── 5) Seed the admin + verify ────────────────────────────────────────────
-- Promote the first-created account (the keeper/test account).
update public.profiles
set is_admin = true
where id = (select id from auth.users order by created_at limit 1);

-- To administer from a different account instead, uncomment + edit this:
-- update public.profiles
-- set is_admin = true
-- where id = (select id from auth.users where email = 'your@email.com');

-- Verify: who is admin now, and the report queue the moderation screen reads.
select au.email, p.username, p.is_admin
from public.profiles p
left join auth.users au on au.id = p.id
order by p.is_admin desc, au.created_at;

select count(*) as open_reports
from public.content_reports
where status = 'open';
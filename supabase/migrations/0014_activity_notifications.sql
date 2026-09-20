-- Migration 0014: activity notification engine

create schema if not exists private;

create table public.activity_notifications (
  id uuid primary key default gen_random_uuid(),
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('like', 'comment', 'follow')),
  post_id uuid references public.posts(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index activity_notifications_receiver_created_idx
  on public.activity_notifications (receiver_id, created_at desc);
create index activity_notifications_unread_idx
  on public.activity_notifications (receiver_id, is_read)
  where is_read = false;

alter table public.activity_notifications enable row level security;

create policy "Users can read their own activity notifications"
  on public.activity_notifications for select
  to authenticated
  using ((select auth.uid()) = receiver_id);

create policy "Users can mark their own notifications read"
  on public.activity_notifications for update
  to authenticated
  using ((select auth.uid()) = receiver_id)
  with check ((select auth.uid()) = receiver_id and is_read = true);

grant select, update on public.activity_notifications to authenticated;

-- Trigger functions are internal-only. SECURITY DEFINER is required because
-- the actor inserts a notification addressed to another user, while RLS
-- intentionally allows clients to update/read only their own notifications.
create or replace function private.create_like_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  select p.user_id into owner_id from public.posts p where p.id = new.post_id;
  if owner_id is not null and owner_id <> new.user_id then
    insert into public.activity_notifications (receiver_id, sender_id, type, post_id)
    values (owner_id, new.user_id, 'like', new.post_id);
  end if;
  return new;
end;
$$;

create or replace function private.create_comment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  select p.user_id into owner_id from public.posts p where p.id = new.post_id;
  if owner_id is not null and owner_id <> new.user_id then
    insert into public.activity_notifications (receiver_id, sender_id, type, post_id)
    values (owner_id, new.user_id, 'comment', new.post_id);
  end if;
  return new;
end;
$$;

create or replace function private.create_follow_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.follower_id <> new.following_id then
    insert into public.activity_notifications (receiver_id, sender_id, type)
    values (new.following_id, new.follower_id, 'follow');
  end if;
  return new;
end;
$$;

create trigger post_likes_activity_notification
  after insert on public.post_likes
  for each row execute function private.create_like_notification();

create trigger post_comments_activity_notification
  after insert on public.post_comments
  for each row execute function private.create_comment_notification();

create trigger user_follows_activity_notification
  after insert on public.user_follows
  for each row execute function private.create_follow_notification();

create or replace view public.activity_notifications_feed
with (security_invoker = true)
as
select
  n.id,
  n.receiver_id,
  n.sender_id,
  sender.username as sender_username,
  n.type,
  n.post_id,
  n.is_read,
  n.created_at
from public.activity_notifications n
left join public.profiles sender on sender.id = n.sender_id;

grant select on public.activity_notifications_feed to authenticated;

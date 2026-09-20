-- Migration 0015: idempotent offline catch replay
--
-- Why this exists
-- ---------------
-- src/lib/offlineCatchQueue.ts queues a catch when the device is offline and
-- replays it on reconnect. The hard case is an *ambiguous* failure: the insert
-- actually committed but the response was lost on the way back. The old code
-- retried and inserted a second catch, which also minted a second feed post via
-- the create_feed_post_on_catch trigger.
--
-- client_queue_id is the queue entry's own UUID, generated on the device before
-- the first attempt. It gives the retry a stable dedupe key, so replaying the
-- same entry can be made a no-op instead of a duplicate. It is nullable because
-- catches created before this migration (and any direct in-app submit, which
-- does not go through the queue) legitimately have no client key. Postgres
-- treats NULLs as distinct in a unique index, so those rows never collide.
--
-- This is deliberately a *client* key rather than a natural key on
-- (user_id, species, captured_at): two genuinely separate catches of the same
-- species at the same moment are legal and must both survive.

alter table public.catches
  add column if not exists client_queue_id uuid;

comment on column public.catches.client_queue_id is
  'Device-generated UUID for an offline queue entry; unique so a replayed '
  'catch is deduplicated instead of inserted twice. NULL for non-queued catches.';

-- The dedupe guarantee itself. A plain (non-partial) unique index already
-- permits any number of NULLs, matching the nullable contract above.
create unique index if not exists catches_client_queue_id_key
  on public.catches (client_queue_id);

-- ── Trigger analysis: does a skipped insert double-fire the feed post? ───────
--
-- create_feed_post_on_catch is an AFTER INSERT ... FOR EACH ROW trigger. The
-- client replays with `INSERT ... ON CONFLICT (client_queue_id) DO NOTHING`
-- (supabase-js: .upsert(..., { onConflict: 'client_queue_id',
-- ignoreDuplicates: true })). When Postgres skips a conflicting row it never
-- inserts it, so the AFTER INSERT trigger does not fire for that row at all.
-- A replayed entry therefore cannot produce a second feed post. That is the
-- property being relied on, so it is worth stating explicitly rather than
-- leaving it implicit.
--
-- Belt and braces: posts.catch_id is already UNIQUE (migration 0007), so even
-- if this trigger were later redefined to fire on UPDATE, or invoked again by
-- some other path, the insert below can no longer create a duplicate post. The
-- ON CONFLICT clause makes the trigger idempotent on its own terms.
--
-- Note: ON CONFLICT DO NOTHING also means the client receives zero returned
-- rows for a deduplicated retry. uploadQueuedCatchUnlocked treats that as a
-- successful sync and recovers the existing catch id by client_queue_id.
create or replace function public.create_feed_post_on_catch() returns trigger
language plpgsql
as $$
begin
  insert into public.posts (user_id, catch_id, text)
  values (
    new.user_id,
    new.id,
    case
      when new.length is not null then new.species || ' — ' || new.length::text || ' cm'
      else new.species
    end
  )
  on conflict (catch_id) do nothing;
  return new;
end;
$$;

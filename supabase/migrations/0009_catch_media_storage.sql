-- Migration 0009: private catch photo storage
--
-- Creates the private catch-media bucket and stores the object path on catches.
-- Photos are scoped to a user's folder and are not publicly readable.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catch-media',
  'catch-media',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.catches
  add column if not exists media_path text;

-- A client may upload only into its own user-id folder.
create policy "Users can upload their own catch media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'catch-media'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- Allow the owner to retrieve their private photos later for profile/catch views.
create policy "Users can read their own catch media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'catch-media'
  and owner_id = (select auth.uid())
);

create policy "Users can delete their own catch media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'catch-media'
  and owner_id = (select auth.uid())
);

grant select, insert, update, delete on public.catches to authenticated;

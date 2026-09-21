-- 0016 — expo push token binding
--
-- src/lib/notifications.ts binds the device's ExpoPushToken to the
-- signed-in user's profile row. The tide-alerts Edge Function
-- (supabase/functions/tide-alerts) reads this column with the service role
-- and fans weather/tide/social alerts out through the Expo Push API.

alter table public.profiles
  add column if not exists expo_push_token text;

comment on column public.profiles.expo_push_token is
  'Expo push token (ExponentPushToken[...]) written by src/lib/notifications.ts after the OS permission grant. Read with the service role by the tide-alerts function.';

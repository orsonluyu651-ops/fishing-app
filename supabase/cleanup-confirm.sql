-- ════════════════════════════════════════════════════════════════════════
-- TIDEWIRE — cleanup, FINAL LOOK before STEP 2 (still deletes nothing)
--
-- Two small queries. Copy both result tables back to me and I'll fire the
-- exact delete block in the same reply.
-- ════════════════════════════════════════════════════════════════════════

-- 1) The accounts (who is real vs throwaway — nothing here is deleted)
select
  au.email,
  p.username,
  (select count(*) from public.catches c where c.user_id = au.id) as catches
from auth.users au
left join public.profiles p on p.id = au.id
order by au.created_at;

-- 2) Every catch, with the discriminator that matters for deletion:
--    'verification_status' = verified -> a photo was attached (a REAL
--    catch you logged), unverified -> a seed row.
select
  p.username,
  c.species,
  round(c.length::numeric, 1) as cm,
  round(c.weight::numeric, 2) as kg,
  c.verification_status as verif,
  c.captured_at::date as caught,
  c.created_at::date     as logged
from public.catches c
left join public.profiles p on p.id = c.user_id
order by c.captured_at desc;
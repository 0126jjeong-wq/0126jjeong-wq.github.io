-- The web client does not need to learn the staff allowlist: the trigger applies
-- the administrator exception during the profile write itself.
drop function if exists public.current_user_can_use_staff_nickname();
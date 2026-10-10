create or replace function public.is_reserved_member_nickname(candidate text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $function$
  select regexp_replace(
    lower(normalize(coalesce(candidate, ''), NFKC)),
    '[^a-z0-9가-힣]',
    '',
    'g'
  ) ~ '(admin|administrator|master|moderator|staff|superuser|root|support|official|operator|운영|관리|공식|매니저)';
$function$;

do $block$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.member_profiles'::regclass
      and conname = 'member_profiles_nickname_not_reserved'
  ) then
    alter table public.member_profiles
      add constraint member_profiles_nickname_not_reserved
      check (not public.is_reserved_member_nickname(nickname))
      not valid;
  end if;
end
$block$;

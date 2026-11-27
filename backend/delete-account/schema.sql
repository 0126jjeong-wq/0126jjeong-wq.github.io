create table if not exists public.account_deletion_audit (
 id bigint generated always as identity primary key,
 identity_hash text not null,
 blocked_until timestamptz not null,
 created_at timestamptz not null default now()
);
revoke all on public.account_deletion_audit from anon, authenticated;
grant all on public.account_deletion_audit to service_role;
create index if not exists account_deletion_audit_expiry_idx on public.account_deletion_audit(blocked_until);

-- Keep the account data erased while preventing the same email from completing
-- the member profile flow during the 30-day cooling-off period.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create or replace function private.block_recently_deleted_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_email text;
  account_hash text;
begin
  if auth.uid() is null or auth.uid() <> new.user_id then
    raise exception 'Not authorized to create this member profile.' using errcode = '42501';
  end if;
  select lower(trim(u.email)) into account_email
  from auth.users u where u.id = new.user_id;
  if account_email is null or account_email = '' then
    return new;
  end if;
  account_hash := encode(extensions.digest(convert_to(account_email, 'UTF8'), 'sha256'), 'hex');
  if exists (
    select 1 from public.account_deletion_audit a
    where a.identity_hash = account_hash and a.blocked_until > now()
  ) then
    raise exception 'This account cannot register again yet.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.block_recently_deleted_member() from public, anon, authenticated;
drop trigger if exists block_recently_deleted_member on public.member_profiles;
create trigger block_recently_deleted_member
before insert or update of user_id on public.member_profiles
for each row execute function private.block_recently_deleted_member();

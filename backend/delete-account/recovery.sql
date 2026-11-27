-- 30-day account recovery: retain the auth user and account-owned rows during
-- the grace period, hide them from the app, then purge them on a later login.
alter table public.account_deletion_audit
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists deleted_at timestamptz,
  add column if not exists restored_at timestamptz;

create unique index if not exists account_deletion_audit_user_id_idx
  on public.account_deletion_audit(user_id);
create index if not exists account_deletion_audit_pending_idx
  on public.account_deletion_audit(user_id, blocked_until)
  where user_id is not null and restored_at is null;

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
  select lower(trim(u.email)) into account_email from auth.users u where u.id = new.user_id;
  if account_email is null or account_email = '' then return new; end if;
  account_hash := encode(extensions.digest(convert_to(account_email, 'UTF8'), 'sha256'), 'hex');
  if exists (
    select 1 from public.account_deletion_audit a
    where a.identity_hash = account_hash and a.blocked_until > now()
      and a.restored_at is null and a.user_id is distinct from new.user_id
  ) then
    raise exception 'This account cannot register again yet.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.block_recently_deleted_member() from public, anon, authenticated;

create or replace function private.is_account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and not exists (
    select 1 from public.account_deletion_audit a
    where a.user_id = auth.uid() and a.restored_at is null
  );
$$;
revoke all on function private.is_account_active() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_account_active() to authenticated;

-- These restrictive policies combine with existing ownership policies.
drop policy if exists account_must_be_active on public.member_profiles;
create policy account_must_be_active on public.member_profiles as restrictive
  for all to authenticated using (private.is_account_active())
  with check (private.is_account_active());
drop policy if exists account_must_be_active on public.user_reel_library;
create policy account_must_be_active on public.user_reel_library as restrictive
  for all to authenticated using (private.is_account_active())
  with check (private.is_account_active());
drop policy if exists account_must_be_active on public.user_saved_restaurants;
create policy account_must_be_active on public.user_saved_restaurants as restrictive
  for all to authenticated using (private.is_account_active())
  with check (private.is_account_active());
drop policy if exists account_must_be_active on public.user_reels;
create policy account_must_be_active on public.user_reels as restrictive
  for all to authenticated using (private.is_account_active())
  with check (private.is_account_active());
drop policy if exists account_must_be_active on public.user_reels_preferences;
create policy account_must_be_active on public.user_reels_preferences as restrictive
  for all to authenticated using (private.is_account_active())
  with check (private.is_account_active());

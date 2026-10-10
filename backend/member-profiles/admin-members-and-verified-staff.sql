-- Keep staff impersonation protection for ordinary members while preserving
-- verified administrator-owned nicknames such as the owner's "운영자".
alter table public.member_profiles
  add column if not exists visit_tracking_consent boolean not null default false,
  add column if not exists visit_tracking_consented_at timestamptz;

alter table public.engagement_events
  add column if not exists member_user_id uuid references auth.users(id) on delete set null;

alter table public.member_profiles drop constraint if exists member_profiles_nickname_not_reserved;

create or replace function public.current_user_can_use_staff_nickname()
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1 from auth.users u
    join public.admin_users a on lower(a.email) = lower(u.email)
    where u.id = (select auth.uid()) and a.enabled = true
  );
$function$;
revoke all on function public.current_user_can_use_staff_nickname() from public, anon;
grant execute on function public.current_user_can_use_staff_nickname() to authenticated;

create or replace function public.enforce_member_nickname_policy()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if public.is_reserved_member_nickname(new.nickname)
     and not exists (
       select 1 from auth.users u
       join public.admin_users a on lower(a.email) = lower(u.email)
       where u.id = new.user_id and a.enabled = true
     ) then
    raise exception 'This nickname is reserved for verified staff accounts' using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function public.enforce_member_nickname_policy() from public, anon, authenticated;
drop trigger if exists enforce_member_nickname_policy on public.member_profiles;
create trigger enforce_member_nickname_policy
before insert or update of nickname, user_id on public.member_profiles
for each row execute function public.enforce_member_nickname_policy();

create index if not exists engagement_events_member_visit_idx
  on public.engagement_events (member_user_id, created_at desc)
  where event_type = 'visit' and member_user_id is not null;

create or replace function public.get_admin_member_management(
  p_from_date date default null,
  p_to_date date default null,
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_search text := left(coalesce(p_search, ''), 100);
  v_total bigint;
  v_members jsonb;
begin
  if (p_from_date is null) <> (p_to_date is null) then raise exception 'Both date bounds must be provided together'; end if;
  if p_from_date is not null and p_from_date > p_to_date then raise exception 'Start date must not be after end date'; end if;
  if p_from_date is not null then
    v_from := (p_from_date::timestamp at time zone 'Asia/Seoul');
    v_to := ((p_to_date + 1)::timestamp at time zone 'Asia/Seoul');
  end if;
  select count(*) into v_total from public.member_profiles mp
    join auth.users u on u.id = mp.user_id
    where v_search = '' or concat_ws(' ', mp.full_name, mp.phone_number, mp.nickname) ilike '%' || v_search || '%';
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_members
  from (
    select mp.user_id, mp.full_name, mp.birth_date, mp.phone_number, mp.nickname,
      u.created_at, mp.visit_tracking_consent, count(e.id)::bigint as visit_count
    from public.member_profiles mp join auth.users u on u.id = mp.user_id
    left join public.engagement_events e on e.member_user_id = mp.user_id and e.event_type = 'visit'
      and (v_from is null or (e.created_at >= v_from and e.created_at < v_to))
    where v_search = '' or concat_ws(' ', mp.full_name, mp.phone_number, mp.nickname) ilike '%' || v_search || '%'
    group by mp.user_id, mp.full_name, mp.birth_date, mp.phone_number, mp.nickname,
      u.created_at, mp.visit_tracking_consent
    order by u.created_at desc limit v_page_size offset (v_page - 1) * v_page_size
  ) r;
  return jsonb_build_object('total', v_total, 'page', v_page, 'page_size', v_page_size, 'members', v_members);
end;
$function$;
revoke all on function public.get_admin_member_management(date, date, text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_admin_member_management(date, date, text, integer, integer) to service_role;
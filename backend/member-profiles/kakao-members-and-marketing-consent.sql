-- The KakaoTalk marketing choice is independent of membership and visit analytics.
-- Existing members remain opted out. Timestamps are set by the database, not clients.
alter table public.member_profiles
  add column if not exists kakao_marketing_consent boolean not null default false,
  add column if not exists kakao_marketing_consented_at timestamptz,
  add column if not exists kakao_marketing_withdrawn_at timestamptz;

create or replace function public.stamp_kakao_marketing_consent()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.kakao_marketing_consented_at := null;
    new.kakao_marketing_withdrawn_at := null;
  end if;
  if new.kakao_marketing_consent and
      (tg_op = 'INSERT' or not old.kakao_marketing_consent) then
    if not exists (
      select 1 from auth.identities i
      where i.user_id = new.user_id and i.provider = 'kakao'
    ) then
      raise exception 'Kakao login is required for KakaoTalk marketing consent'
        using errcode = '23514';
    end if;
    new.kakao_marketing_consented_at := pg_catalog.now();
    new.kakao_marketing_withdrawn_at := null;
  elsif not new.kakao_marketing_consent and
      tg_op = 'UPDATE' and old.kakao_marketing_consent then
    new.kakao_marketing_consented_at := null;
    new.kakao_marketing_withdrawn_at := pg_catalog.now();
  elsif tg_op = 'UPDATE' then
    new.kakao_marketing_consented_at := old.kakao_marketing_consented_at;
    new.kakao_marketing_withdrawn_at := old.kakao_marketing_withdrawn_at;
  end if;
  return new;
end;
$function$;
revoke all on function public.stamp_kakao_marketing_consent() from public, anon, authenticated;
drop trigger if exists stamp_kakao_marketing_consent on public.member_profiles;
create trigger stamp_kakao_marketing_consent
before insert or update of kakao_marketing_consent, kakao_marketing_consented_at,
  kakao_marketing_withdrawn_at on public.member_profiles
for each row execute function public.stamp_kakao_marketing_consent();

-- Replace the existing admin-only RPC so its pagination and totals use the
-- same server-side provider filter. A member belongs to their first provider.
drop function if exists public.get_admin_member_management(date, date, text, integer, integer);
create function public.get_admin_member_management(
  p_from_date date default null,
  p_to_date date default null,
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 50,
  p_provider text default 'all'
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_search text := left(coalesce(p_search, ''), 100);
  v_provider text := coalesce(p_provider, 'all');
  v_total bigint;
  v_members jsonb;
begin
  if v_provider not in ('all', 'google', 'kakao') then raise exception 'Invalid provider'; end if;
  if (p_from_date is null) <> (p_to_date is null) then raise exception 'Both date bounds must be provided together'; end if;
  if p_from_date is not null and p_from_date > p_to_date then raise exception 'Start date must not be after end date'; end if;
  if p_from_date is not null then
    v_from := (p_from_date::timestamp at time zone 'Asia/Seoul');
    v_to := ((p_to_date + 1)::timestamp at time zone 'Asia/Seoul');
  end if;
  select count(*) into v_total from public.member_profiles mp
    left join lateral (
      select i.provider from auth.identities i
      where i.user_id = mp.user_id order by i.created_at, i.id limit 1
    ) first_identity on true
    where (v_provider = 'all' or first_identity.provider = v_provider)
      and (v_search = '' or pg_catalog.concat_ws(' ', mp.full_name, mp.phone_number, mp.nickname) ilike '%' || v_search || '%');
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_members
  from (
    select mp.user_id, mp.full_name, mp.birth_date, mp.phone_number, mp.nickname,
      u.created_at, first_identity.provider as login_provider,
      mp.visit_tracking_consent, mp.kakao_marketing_consent,
      mp.kakao_marketing_consented_at, count(e.id)::bigint as visit_count
    from public.member_profiles mp join auth.users u on u.id = mp.user_id
    left join lateral (
      select i.provider from auth.identities i
      where i.user_id = mp.user_id order by i.created_at, i.id limit 1
    ) first_identity on true
    left join public.engagement_events e on e.member_user_id = mp.user_id and e.event_type = 'visit'
      and (v_from is null or (e.created_at >= v_from and e.created_at < v_to))
    where (v_provider = 'all' or first_identity.provider = v_provider)
      and (v_search = '' or pg_catalog.concat_ws(' ', mp.full_name, mp.phone_number, mp.nickname) ilike '%' || v_search || '%')
    group by mp.user_id, mp.full_name, mp.birth_date, mp.phone_number, mp.nickname,
      u.created_at, first_identity.provider, mp.visit_tracking_consent,
      mp.kakao_marketing_consent, mp.kakao_marketing_consented_at
    order by u.created_at desc limit v_page_size offset (v_page - 1) * v_page_size
  ) r;
  return jsonb_build_object('total', v_total, 'page', v_page, 'page_size', v_page_size, 'members', v_members);
end;
$function$;
revoke all on function public.get_admin_member_management(date, date, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.get_admin_member_management(date, date, text, integer, integer, text) to service_role;

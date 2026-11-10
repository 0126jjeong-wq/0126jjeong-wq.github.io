-- Older rows have no reliable client attribution.
alter table public.member_profiles
  add column signup_source text not null default 'unknown'
  check (signup_source in ('app','web','unknown'));

alter table public.engagement_events
  add column source text not null default 'unknown'
  check (source in ('app','web','unknown'));

create function public.preserve_member_signup_source()
returns trigger language plpgsql set search_path = ''
as $function$
declare
  origin text := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'origin';
begin
  if TG_OP = 'UPDATE' then
    new.signup_source := old.signup_source;
  elsif origin = 'capacitor://localhost' then
    new.signup_source := 'app';
  elsif origin in ('https://myreelsmap.com', 'https://www.myreelsmap.com', 'https://0126jjeong-wq.github.io') then
    new.signup_source := 'web';
  end if;
  return new;
end;
$function$;

revoke all on function public.preserve_member_signup_source() from public, anon, authenticated;
create trigger preserve_member_signup_source
before insert or update of signup_source on public.member_profiles
for each row execute function public.preserve_member_signup_source();

CREATE OR REPLACE FUNCTION public.record_engagement_event_with_member(p_restaurant_id uuid, p_event_type text, p_visitor_hash text, p_member_user_id uuid, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cooldown interval;
  v_inserted_id uuid;
  v_lock_key bigint;
  v_member_user_id uuid;
begin
  if p_visitor_hash is null or length(p_visitor_hash) <> 64 then
    return jsonb_build_object('accepted', false, 'reason', 'invalid_visitor');
  end if;
  if p_event_type not in ('visit','restaurant','reel','route') then
    return jsonb_build_object('accepted', false, 'reason', 'invalid_event');
  end if;
  if (p_event_type = 'visit' and p_restaurant_id is not null)
     or (p_event_type <> 'visit' and p_restaurant_id is null) then
    return jsonb_build_object('accepted', false, 'reason', 'invalid_target');
  end if;
  v_member_user_id := case when p_event_type = 'visit' then p_member_user_id else null end;
  v_cooldown := case p_event_type
    when 'visit' then interval '30 minutes'
    when 'restaurant' then interval '10 minutes'
    when 'reel' then interval '30 minutes'
    when 'route' then interval '24 hours'
  end;
  v_lock_key := pg_catalog.hashtextextended(
    p_visitor_hash || '|' || p_event_type || '|' || coalesce(p_restaurant_id::text, 'site'),0
  );
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);
  if (select count(*) from public.engagement_events
      where visitor_hash = p_visitor_hash
        and created_at >= pg_catalog.now() - interval '1 day') >= 120 then
    return jsonb_build_object('accepted', false, 'reason', 'daily_limit');
  end if;
  if exists (select 1 from public.engagement_events
      where visitor_hash = p_visitor_hash
        and event_type = p_event_type
        and restaurant_id is not distinct from p_restaurant_id
        and created_at >= pg_catalog.now() - v_cooldown) then
    return jsonb_build_object('accepted', false, 'reason', 'duplicate');
  end if;
  insert into public.engagement_events(restaurant_id,event_type,visitor_hash,member_user_id,source)
  values(p_restaurant_id,p_event_type,p_visitor_hash,v_member_user_id,case when p_source in ('app','web') then p_source else 'unknown' end)
  returning id into v_inserted_id;
  return jsonb_build_object('accepted',true,'event_id',v_inserted_id);
end;
$function$;
revoke all on function public.record_engagement_event_with_member(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_engagement_event_with_member(uuid, text, text, uuid, text) to service_role;

CREATE OR REPLACE FUNCTION public.get_admin_member_management_by_source(p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_search text DEFAULT ''::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_provider text DEFAULT 'all'::text, p_signup_source text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_signup_source is null or p_signup_source not in ('all', 'app', 'web', 'unknown') then raise exception 'Invalid signup source'; end if;
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
      where i.user_id = mp.user_id order by case when i.provider in ('google', 'kakao') then 0 else 1 end, i.created_at, i.id limit 1
    ) first_identity on true
    where (p_signup_source = 'all' or mp.signup_source = p_signup_source)
      and (v_provider = 'all' or first_identity.provider = v_provider)
      and (v_search = '' or pg_catalog.concat_ws(' ', mp.full_name, mp.phone_number, mp.nickname) ilike '%' || v_search || '%');
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.user_id), '[]'::jsonb) into v_members
  from (
    select mp.user_id, mp.full_name, mp.birth_date, mp.phone_number, mp.nickname,
      u.created_at, first_identity.provider as login_provider, mp.signup_source,
      mp.visit_tracking_consent, mp.kakao_marketing_consent,
      mp.kakao_marketing_consented_at, count(e.id)::bigint as visit_count
    from public.member_profiles mp join auth.users u on u.id = mp.user_id
    left join lateral (
      select i.provider from auth.identities i
      where i.user_id = mp.user_id order by case when i.provider in ('google', 'kakao') then 0 else 1 end, i.created_at, i.id limit 1
    ) first_identity on true
    left join public.engagement_events e on e.member_user_id = mp.user_id and e.event_type = 'visit'
      and (v_from is null or (e.created_at >= v_from and e.created_at < v_to))
    where (p_signup_source = 'all' or mp.signup_source = p_signup_source)
      and (v_provider = 'all' or first_identity.provider = v_provider)
      and (v_search = '' or pg_catalog.concat_ws(' ', mp.full_name, mp.phone_number, mp.nickname) ilike '%' || v_search || '%')
    group by mp.user_id, mp.full_name, mp.birth_date, mp.phone_number, mp.nickname,
      u.created_at, first_identity.provider, mp.signup_source, mp.visit_tracking_consent,
      mp.kakao_marketing_consent, mp.kakao_marketing_consented_at
    order by u.created_at desc, mp.user_id limit v_page_size offset (v_page - 1) * v_page_size
  ) r;
  return jsonb_build_object('total', v_total, 'page', v_page, 'page_size', v_page_size, 'members', v_members);
end;
$function$;
revoke all on function public.get_admin_member_management_by_source(date, date, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.get_admin_member_management_by_source(date, date, text, integer, integer, text, text) to service_role;

create function public.get_engagement_source_counts(p_start_at timestamptz, p_end_at timestamptz)
returns jsonb language sql stable set search_path = ''
as $function$
  select coalesce(jsonb_object_agg(source, jsonb_build_object(
    'visitors', visitors,
    'restaurant_clicks', restaurant_clicks,
    'reel_clicks', reel_clicks,
    'route_clicks', route_clicks
  )), '{}'::jsonb)
  from (
    select e.source, count(distinct e.visitor_hash) as visitors,
      count(*) filter (where e.event_type = 'restaurant') as restaurant_clicks,
      count(*) filter (where e.event_type = 'reel') as reel_clicks,
      count(*) filter (where e.event_type = 'route') as route_clicks
    from public.engagement_events e
    where (p_start_at is null or e.created_at >= p_start_at)
      and (p_end_at is null or e.created_at < p_end_at)
    group by e.source
  ) counts;
$function$;
revoke all on function public.get_engagement_source_counts(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_engagement_source_counts(timestamptz, timestamptz) to service_role;

CREATE OR REPLACE FUNCTION public.get_admin_engagement_analytics()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with periods(key, label, start_at, sort_order) as (
  values
    ('day'::text, '오늘'::text, timezone('Asia/Seoul', date_trunc('day', timezone('Asia/Seoul', now()))), 1),
    ('week'::text, '최근 7일'::text, timezone('Asia/Seoul', date_trunc('day', timezone('Asia/Seoul', now())) - interval '6 days'), 2),
    ('month'::text, '최근 30일'::text, timezone('Asia/Seoul', date_trunc('day', timezone('Asia/Seoul', now())) - interval '29 days'), 3),
    ('all'::text, '전체'::text, null::timestamptz, 4)
)
select coalesce(
  jsonb_object_agg(
    p.key,
    jsonb_build_object(
      'label', p.label,
      'by_source', public.get_engagement_source_counts(p.start_at, null),
      'visitors', (
        select count(distinct e.visitor_hash)
        from public.engagement_events e
        where (p.start_at is null or e.created_at >= p.start_at)
          and e.visitor_hash is not null
      ),
      'restaurant', jsonb_build_object(
        'people', (
          select count(distinct e.visitor_hash)
          from public.engagement_events e
          where e.event_type='restaurant'
            and (p.start_at is null or e.created_at >= p.start_at)
            and e.visitor_hash is not null
        ),
        'clicks', (
          select count(*)
          from public.engagement_events e
          where e.event_type='restaurant'
            and (p.start_at is null or e.created_at >= p.start_at)
        )
      ),
      'reel', jsonb_build_object(
        'people', (
          select count(distinct e.visitor_hash)
          from public.engagement_events e
          where e.event_type='reel'
            and (p.start_at is null or e.created_at >= p.start_at)
            and e.visitor_hash is not null
        ),
        'clicks', (
          select count(*)
          from public.engagement_events e
          where e.event_type='reel'
            and (p.start_at is null or e.created_at >= p.start_at)
        )
      ),
      'route', jsonb_build_object(
        'people', (
          select count(distinct e.visitor_hash)
          from public.engagement_events e
          where e.event_type='route'
            and (p.start_at is null or e.created_at >= p.start_at)
            and e.visitor_hash is not null
        ),
        'clicks', (
          select count(*)
          from public.engagement_events e
          where e.event_type='route'
            and (p.start_at is null or e.created_at >= p.start_at)
        )
      ),
      'ranking', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'restaurant_id', ranked.restaurant_id,
            'name', ranked.name,
            'restaurant_clicks', ranked.restaurant_clicks,
            'reel_clicks', ranked.reel_clicks,
            'route_clicks', ranked.route_clicks,
            'total_clicks', ranked.total_clicks,
            'people', ranked.people
          )
          order by ranked.total_clicks desc, ranked.route_clicks desc, ranked.name
        ), '[]'::jsonb)
        from (
          select
            r.id as restaurant_id,
            r.name,
            count(*) filter (where e.event_type='restaurant')::bigint as restaurant_clicks,
            count(*) filter (where e.event_type='reel')::bigint as reel_clicks,
            count(*) filter (where e.event_type='route')::bigint as route_clicks,
            count(*)::bigint as total_clicks,
            count(distinct e.visitor_hash)::bigint as people
          from public.engagement_events e
          join public.restaurants r on r.id=e.restaurant_id
          where e.event_type in ('restaurant','reel','route')
            and (p.start_at is null or e.created_at >= p.start_at)
          group by r.id, r.name
          order by total_clicks desc, route_clicks desc, r.name
          limit 50
        ) ranked
      )
    )
    order by p.sort_order
  ),
  '{}'::jsonb
)
from periods p
$function$;
CREATE OR REPLACE FUNCTION public.get_admin_engagement_analytics_for_date(p_selected_date date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with bounds as (
  select
    (p_selected_date::timestamp at time zone 'Asia/Seoul') as start_at,
    ((p_selected_date + 1)::timestamp at time zone 'Asia/Seoul') as end_at
),
filtered as materialized (
  select e.*
  from public.engagement_events e
  cross join bounds b
  where e.created_at >= b.start_at
    and e.created_at < b.end_at
),
ranked as (
  select
    r.id as restaurant_id,
    r.name,
    count(*) filter (where e.event_type='restaurant')::bigint as restaurant_clicks,
    count(*) filter (where e.event_type='reel')::bigint as reel_clicks,
    count(*) filter (where e.event_type='route')::bigint as route_clicks,
    count(*)::bigint as total_clicks,
    count(distinct e.visitor_hash)::bigint as people
  from filtered e
  join public.restaurants r on r.id=e.restaurant_id
  where e.event_type in ('restaurant','reel','route')
  group by r.id, r.name
  order by total_clicks desc, route_clicks desc, r.name
  limit 50
)
select jsonb_build_object(
  'label', concat(extract(year from p_selected_date)::int, '년 ', extract(month from p_selected_date)::int, '월 ', extract(day from p_selected_date)::int, '일'),
  'date', p_selected_date::text,
  'by_source', (select public.get_engagement_source_counts(start_at, end_at) from bounds),
  'visitors', (select count(distinct visitor_hash) from filtered where visitor_hash is not null),
  'restaurant', jsonb_build_object(
    'people', (select count(distinct visitor_hash) from filtered where event_type='restaurant' and visitor_hash is not null),
    'clicks', (select count(*) from filtered where event_type='restaurant')
  ),
  'reel', jsonb_build_object(
    'people', (select count(distinct visitor_hash) from filtered where event_type='reel' and visitor_hash is not null),
    'clicks', (select count(*) from filtered where event_type='reel')
  ),
  'route', jsonb_build_object(
    'people', (select count(distinct visitor_hash) from filtered where event_type='route' and visitor_hash is not null),
    'clicks', (select count(*) from filtered where event_type='route')
  ),
  'ranking', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'restaurant_id', restaurant_id,
        'name', name,
        'restaurant_clicks', restaurant_clicks,
        'reel_clicks', reel_clicks,
        'route_clicks', route_clicks,
        'total_clicks', total_clicks,
        'people', people
      )
      order by total_clicks desc, route_clicks desc, name
    )
    from ranked
  ), '[]'::jsonb)
)
$function$;

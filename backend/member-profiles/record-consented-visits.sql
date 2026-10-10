create or replace function public.record_engagement_event_with_member(
  p_restaurant_id uuid, p_event_type text, p_visitor_hash text, p_member_user_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_cooldown interval;
  v_inserted_id uuid;
  v_lock_key bigint;
  v_member_user_id uuid;
begin
  if p_visitor_hash is null or length(p_visitor_hash) <> 64 then return jsonb_build_object('accepted', false, 'reason', 'invalid_visitor'); end if;
  if p_event_type not in ('visit','restaurant','reel','route') then return jsonb_build_object('accepted', false, 'reason', 'invalid_event'); end if;
  if (p_event_type = 'visit' and p_restaurant_id is not null) or (p_event_type <> 'visit' and p_restaurant_id is null) then return jsonb_build_object('accepted', false, 'reason', 'invalid_target'); end if;
  v_member_user_id := case when p_event_type = 'visit' then p_member_user_id else null end;
  v_cooldown := case p_event_type when 'visit' then interval '30 minutes' when 'restaurant' then interval '10 minutes' when 'reel' then interval '30 minutes' when 'route' then interval '24 hours' end;
  v_lock_key := pg_catalog.hashtextextended(p_visitor_hash || '|' || p_event_type || '|' || coalesce(p_restaurant_id::text, 'site'), 0);
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);
  if (select count(*) from public.engagement_events where visitor_hash = p_visitor_hash and created_at >= pg_catalog.now() - interval '1 day') >= 120 then return jsonb_build_object('accepted', false, 'reason', 'daily_limit'); end if;
  if exists (select 1 from public.engagement_events where visitor_hash = p_visitor_hash and event_type = p_event_type and restaurant_id is not distinct from p_restaurant_id and created_at >= pg_catalog.now() - v_cooldown) then return jsonb_build_object('accepted', false, 'reason', 'duplicate'); end if;
  insert into public.engagement_events(restaurant_id, event_type, visitor_hash, member_user_id) values (p_restaurant_id, p_event_type, p_visitor_hash, v_member_user_id) returning id into v_inserted_id;
  return jsonb_build_object('accepted', true, 'event_id', v_inserted_id);
end;
$function$;
revoke all on function public.record_engagement_event_with_member(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_engagement_event_with_member(uuid, text, text, uuid) to service_role;
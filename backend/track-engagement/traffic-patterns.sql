-- Read-only diagnostics. Keep accepted engagement counts and rate limits intact.
create or replace function public.get_admin_traffic_patterns(
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns jsonb
language sql stable
security invoker
set search_path = ''
as $function$
  with events as materialized (
    select id, created_at, visitor_hash, source, event_type, restaurant_id
    from public.engagement_events
    where visitor_hash is not null
      and (p_start_at is null or created_at >= p_start_at)
      and (p_end_at is null or created_at < p_end_at)
  ),
  burst_windows as (
    select visitor_hash, source, created_at,
      count(*) over burst as event_count,
      min(created_at) over burst as start_at
    from events
    window burst as (
      partition by visitor_hash, source order by created_at
      range between interval '10 seconds' preceding and current row
    )
  ),
  intervals as (
    select visitor_hash, source, created_at, event_type, restaurant_id, id,
      lag(created_at, 3) over same_action as start_at,
      extract(epoch from created_at - lag(created_at) over same_action) as gap
    from events
    window same_action as (
      partition by visitor_hash, source, event_type, restaurant_id order by created_at, id
    )
  ),
  regular_windows as (
    select visitor_hash, source, created_at, start_at, event_type,
      count(gap) over three_gaps as gap_count,
      min(gap) over three_gaps as min_gap,
      max(gap) over three_gaps as max_gap,
      round(avg(gap) over three_gaps) as interval_seconds
    from intervals
    window three_gaps as (
      partition by visitor_hash, source, event_type, restaurant_id
      order by created_at, id rows between 2 preceding and current row
    )
  ),
  signals as (
    select visitor_hash, source, 'burst'::text as kind, start_at,
      created_at as end_at, event_count, null::text as event_type,
      null::numeric as interval_seconds
    from burst_windows where event_count >= 5
    union all
    select visitor_hash, source, 'regular', start_at,
      created_at, 4, event_type, interval_seconds
    from regular_windows
    where gap_count = 3 and min_gap >= 10 and max_gap <= 7200
      and max_gap - min_gap <= greatest(2, min_gap * 0.10)
  ),
  latest_by_id as materialized (
    select distinct on (visitor_hash, source, kind)
      visitor_hash, source, kind, start_at, end_at, event_count, event_type, interval_seconds
    from signals
    order by visitor_hash, source, kind, end_at desc, start_at desc, event_count desc, event_type
  )
  select jsonb_build_object(
    'flagged', (select count(distinct visitor_hash) from latest_by_id),
    'burst', (select count(distinct visitor_hash) from latest_by_id where kind = 'burst'),
    'regular', (select count(distinct visitor_hash) from latest_by_id where kind = 'regular'),
    'recent', coalesce((
      select jsonb_agg(to_jsonb(recent) order by end_at desc, kind, source)
      from (
        select source, kind, start_at, end_at, event_count, event_type, interval_seconds
        from latest_by_id order by end_at desc, kind, source, visitor_hash limit 20
      ) recent
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.get_admin_traffic_patterns(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_admin_traffic_patterns(timestamptz, timestamptz) to service_role;

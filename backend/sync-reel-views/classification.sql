create or replace view public.reel_media_categories
with (security_invoker=true)
as
select
 m.media_id,m.creator_handle,m.permalink,m.media_type,m.posted_at,m.observed_at,m.view_count,m.view_delta,m.views_per_hour,m.measurement_status,
 case when m.posted_at>now() then 'time_unverified'
      when m.posted_at>now()-interval '72 hours' then 'first_3_days'
      when m.posted_at>now()-interval '120 hours' then 'days_4_to_5'
      else 'older' end as post_age_group,
 (m.view_count>=1000000) as million_reached,
 case when m.measurement_status='measured' and m.observed_at>=now()-interval '6 hours' and m.views_per_hour>=416.66666667
           and m.view_delta>0 and m.view_count>0 and (m.views_per_hour*24 / m.view_count)>=0.1
      then true else false end as rapid_growth,
 case when m.views_per_hour is not null and m.views_per_hour>=0 and m.observed_at>=now()-interval '6 hours'
      then round((m.views_per_hour*24)::numeric) else null end as projected_24h_delta
from public.reel_media_stats m
where m.permalink ~ '^https://(www\.)?instagram\.com/reel/';
revoke all on public.reel_media_categories from anon,authenticated;
grant select on public.reel_media_categories to service_role;

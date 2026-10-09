create or replace view public.registered_reel_categories
with (security_invoker=true)
as
select distinct on (m.media_id) m.*
from public.reel_media_categories m
join public.restaurants r
  on substring(m.permalink from 'instagram[.]com/(?:reel|reels|p)/([A-Za-z0-9_-]+)')
   = substring(r.instagram_url from 'instagram[.]com/(?:reel|reels|p)/([A-Za-z0-9_-]+)')
where r.status='published'
order by m.media_id;
revoke all on public.registered_reel_categories from anon, authenticated;
grant select on public.registered_reel_categories to service_role;

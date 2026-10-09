alter table public.reel_sync_creators add column if not exists last_attempt_at timestamptz;
insert into public.reel_sync_creators(handle)
select distinct lower(creator_handle) from public.restaurants
where creator_handle ~ '^[A-Za-z0-9._]{1,30}$'
on conflict(handle) do nothing;

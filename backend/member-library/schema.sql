-- Account-owned Reel inbox; NULL place means awaiting a restaurant connection.
create table public.user_reel_library (
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null check (url ~ '^https://www[.]instagram[.]com/(reel|p)/[A-Za-z0-9_-]+/$'),
  place jsonb check (place is null or (jsonb_typeof(place)='object' and place ?& array['id','name','latitude','longitude'])),
  created_at timestamptz not null default now(),
  primary key (user_id,url)
);
alter table public.user_reel_library enable row level security;
revoke all on public.user_reel_library from anon, authenticated;
grant select,insert,update,delete on public.user_reel_library to authenticated;
create policy member_owns_reels on public.user_reel_library for all to authenticated
  using ((select auth.uid())=user_id and exists(select 1 from public.member_profiles p where p.user_id=(select auth.uid())))
  with check ((select auth.uid())=user_id and exists(select 1 from public.member_profiles p where p.user_id=(select auth.uid())));
-- Existing ownership policies remain in place; membership is required in addition.
create policy completed_member_saves on public.user_saved_restaurants as restrictive for all to authenticated
  using (exists(select 1 from public.member_profiles p where p.user_id=(select auth.uid())))
  with check (exists(select 1 from public.member_profiles p where p.user_id=(select auth.uid())));

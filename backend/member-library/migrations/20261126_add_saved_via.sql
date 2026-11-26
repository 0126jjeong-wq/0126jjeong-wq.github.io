alter table public.user_reel_library
  add column if not exists saved_via text not null default 'unknown'
  check (saved_via in ('app', 'web', 'unknown'));

comment on column public.user_reel_library.saved_via is
  'Client-reported first-save origin: app or web; unknown for records created before origin tracking.';

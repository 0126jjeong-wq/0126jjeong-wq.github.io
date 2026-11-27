create table if not exists public.one_to_one_inquiries (
 id bigint generated always as identity primary key,
 category text not null check(category in ('system','copyright','account','other')),
 email text not null check(length(email)<=254),
 message text not null check(length(message) between 5 and 5000),
 user_id uuid references auth.users(id) on delete set null,
 status text not null default 'pending' check(status in ('pending','answered','closed')),
 admin_reply text,
 replied_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.one_to_one_inquiries enable row level security;
revoke all on public.one_to_one_inquiries from anon, authenticated;
grant all on public.one_to_one_inquiries to service_role;
create index if not exists one_to_one_inquiries_created_idx on public.one_to_one_inquiries(created_at desc);

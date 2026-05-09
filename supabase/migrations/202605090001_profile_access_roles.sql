alter table public.profiles
add column if not exists email text,
add column if not exists access_role text not null default 'public',
add column if not exists feature_flags jsonb not null default '{}'::jsonb;

alter table public.profiles
drop constraint if exists profiles_access_role_check;

alter table public.profiles
add constraint profiles_access_role_check
check (access_role in ('public', 'vip', 'admin'));

update public.profiles
set email = auth.users.email
from auth.users
where public.profiles.user_id = auth.users.id
  and public.profiles.email is null;

drop policy if exists "profiles_owner_only" on public.profiles;
drop policy if exists "profiles_username_lookup" on public.profiles;
drop policy if exists "profiles_owner_select" on public.profiles;
drop policy if exists "profiles_owner_insert_public" on public.profiles;

create policy "profiles_owner_select"
on public.profiles
for select
using (auth.uid() = user_id);

create policy "profiles_owner_insert_public"
on public.profiles
for insert
with check (
  auth.uid() = user_id
  and access_role = 'public'
  and feature_flags = '{}'::jsonb
);

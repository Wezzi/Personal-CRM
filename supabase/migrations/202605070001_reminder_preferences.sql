create table if not exists public.reminder_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email_digest_enabled boolean not null default false,
  last_digest_sent_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reminder_preferences enable row level security;

drop policy if exists "reminder_preferences_owner_only" on public.reminder_preferences;
create policy "reminder_preferences_owner_only"
on public.reminder_preferences
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.touch_reminder_preferences_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reminder_preferences_touch_updated_at on public.reminder_preferences;
create trigger reminder_preferences_touch_updated_at
before update on public.reminder_preferences
for each row
execute function public.touch_reminder_preferences_updated_at();

alter table public.persons
  add column if not exists next_follow_up_at date;

alter table public.events
  add column if not exists ended_at timestamptz;

create index if not exists persons_user_next_follow_up_at_idx
  on public.persons (user_id, next_follow_up_at);

create index if not exists events_user_ended_at_idx
  on public.events (user_id, ended_at);

-- Willrot v1 schema
-- Paste into Supabase Dashboard → SQL Editor → Run (or `supabase db push`).
-- Safe to re-run: everything is guarded with IF NOT EXISTS / DROP ... IF EXISTS.

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 200),
  description    text,
  timeframe_type text not null default 'custom' check (timeframe_type in ('yearly','quarterly','custom')),
  start_date     date,
  end_date       date,
  status         text not null default 'active' check (status in ('active','completed','archived')),
  created_at     timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists goals_user_idx on public.goals(user_id);

create table if not exists public.goal_metrics (
  id           uuid primary key default gen_random_uuid(),
  goal_id      uuid not null references public.goals(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  unit         text,
  direction    text not null default 'increase' check (direction in ('increase','decrease')),
  start_value  numeric,
  target_value numeric,
  created_at   timestamptz not null default now()
);
create index if not exists goal_metrics_goal_idx on public.goal_metrics(goal_id);

create table if not exists public.goal_metric_logs (
  id             uuid primary key default gen_random_uuid(),
  goal_metric_id uuid not null references public.goal_metrics(id) on delete cascade,
  value          numeric not null,
  logged_at      timestamptz not null default now()
);
create index if not exists goal_metric_logs_metric_idx on public.goal_metric_logs(goal_metric_id, logged_at);

create table if not exists public.habits (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 120),
  type           text not null default 'boolean' check (type in ('boolean','quantity')),
  target_value   numeric,
  unit           text,
  cadence_type   text not null default 'daily' check (cadence_type in ('daily','every_n_days','specific_weekdays','n_per_week')),
  cadence_config jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  archived       boolean not null default false,
  check (type = 'boolean' or target_value is not null)
);
create index if not exists habits_user_idx on public.habits(user_id);

create table if not exists public.habit_goals (
  habit_id uuid not null references public.habits(id) on delete cascade,
  goal_id  uuid not null references public.goals(id) on delete cascade,
  primary key (habit_id, goal_id)
);
create index if not exists habit_goals_goal_idx on public.habit_goals(goal_id);

create table if not exists public.habit_logs (
  id        uuid primary key default gen_random_uuid(),
  habit_id  uuid not null references public.habits(id) on delete cascade,
  date      date not null,
  completed boolean not null default false,
  value     numeric,
  logged_at timestamptz not null default now(),
  unique (habit_id, date)
);
create index if not exists habit_logs_habit_date_idx on public.habit_logs(habit_id, date);

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  timezone     text not null default 'UTC',
  remind_hour  smallint not null default 20 check (remind_hour between 0 and 23),
  last_sent_on date,
  user_agent   text,
  created_at   timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

-- ============================================================
-- Row Level Security — every row reachable only by its owner
-- ============================================================

alter table public.goals              enable row level security;
alter table public.goal_metrics       enable row level security;
alter table public.goal_metric_logs   enable row level security;
alter table public.habits             enable row level security;
alter table public.habit_goals        enable row level security;
alter table public.habit_logs         enable row level security;
alter table public.push_subscriptions enable row level security;

-- Tables that carry user_id directly
drop policy if exists "own goals" on public.goals;
create policy "own goals" on public.goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own habits" on public.habits;
create policy "own habits" on public.habits for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Child tables: ownership derived through the parent row
drop policy if exists "own goal metrics" on public.goal_metrics;
create policy "own goal metrics" on public.goal_metrics for all to authenticated
  using (exists (select 1 from public.goals g where g.id = goal_id and g.user_id = (select auth.uid())))
  with check (exists (select 1 from public.goals g where g.id = goal_id and g.user_id = (select auth.uid())));

drop policy if exists "own goal metric logs" on public.goal_metric_logs;
create policy "own goal metric logs" on public.goal_metric_logs for all to authenticated
  using (exists (select 1 from public.goal_metrics m join public.goals g on g.id = m.goal_id
                 where m.id = goal_metric_id and g.user_id = (select auth.uid())))
  with check (exists (select 1 from public.goal_metrics m join public.goals g on g.id = m.goal_id
                 where m.id = goal_metric_id and g.user_id = (select auth.uid())));

drop policy if exists "own habit goals" on public.habit_goals;
create policy "own habit goals" on public.habit_goals for all to authenticated
  using (exists (select 1 from public.habits h where h.id = habit_id and h.user_id = (select auth.uid()))
     and exists (select 1 from public.goals g where g.id = goal_id and g.user_id = (select auth.uid())))
  with check (exists (select 1 from public.habits h where h.id = habit_id and h.user_id = (select auth.uid()))
     and exists (select 1 from public.goals g where g.id = goal_id and g.user_id = (select auth.uid())));

drop policy if exists "own habit logs" on public.habit_logs;
create policy "own habit logs" on public.habit_logs for all to authenticated
  using (exists (select 1 from public.habits h where h.id = habit_id and h.user_id = (select auth.uid())))
  with check (exists (select 1 from public.habits h where h.id = habit_id and h.user_id = (select auth.uid())));

-- anon gets nothing (no policies for the anon role), authenticated gets CRUD via the policies above.
revoke all on public.goals, public.goal_metrics, public.goal_metric_logs, public.habits,
              public.habit_goals, public.habit_logs, public.push_subscriptions from anon;
grant select, insert, update, delete on public.goals, public.goal_metrics, public.goal_metric_logs,
              public.habits, public.habit_goals, public.habit_logs, public.push_subscriptions to authenticated;

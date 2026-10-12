-- v1.1: optional habit end date, "missed" goal outcome

alter table public.habits add column if not exists end_date date;

alter table public.goals drop constraint if exists goals_status_check;
alter table public.goals add constraint goals_status_check
  check (status in ('active','completed','missed','archived'));

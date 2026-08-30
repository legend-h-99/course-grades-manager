-- ─── Audit Log ────────────────────────────────────────────────────────────────
-- Records every INSERT / UPDATE / DELETE on sensitive tables.
-- Only accessible via service role (no RLS SELECT for regular users).

create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  user_id      uuid references auth.users(id) on delete set null,
  action       text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name   text not null,
  record_id    text,
  old_data     jsonb,
  new_data     jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_log_user_id_idx   on public.audit_log (user_id);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_table_name_idx on public.audit_log (table_name);

-- Block direct access from any authenticated role; only service role can read.
alter table public.audit_log enable row level security;
create policy "no_direct_rls_access" on public.audit_log for all using (false);

-- ─── Trigger function ─────────────────────────────────────────────────────────

create or replace function public.fn_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (user_id, action, table_name, record_id, old_data, new_data)
  values (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    case
      when TG_OP = 'DELETE' then row_to_json(OLD) ->> 'id'
      else row_to_json(NEW) ->> 'id'
    end,
    case when TG_OP in ('UPDATE', 'DELETE') then row_to_json(OLD)::jsonb else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then row_to_json(NEW)::jsonb else null end
  );
  return coalesce(NEW, OLD);
end;
$$;

-- ─── Attach triggers ──────────────────────────────────────────────────────────

create or replace trigger audit_trainees
  after insert or update or delete on public.trainees
  for each row execute function public.fn_audit_log();

create or replace trigger audit_assessments
  after insert or update or delete on public.assessments
  for each row execute function public.fn_audit_log();

create or replace trigger audit_grades
  after insert or update or delete on public.grades
  for each row execute function public.fn_audit_log();

create or replace trigger audit_courses
  after insert or update or delete on public.courses
  for each row execute function public.fn_audit_log();

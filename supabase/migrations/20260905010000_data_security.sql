-- Prevent self-enrolment through direct REST writes; invitations use the
-- authenticated SECURITY DEFINER join_course_by_code RPC.
alter policy course_trainers_insert_self on public.course_trainers to authenticated
with check (user_id = (select auth.uid()) and (
  public.is_course_trainer(course_id) or exists (
    select 1 from public.courses c where c.id = course_id and c.created_by = (select auth.uid())
  )
));
alter policy course_trainers_update_self on public.course_trainers to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()) and public.is_course_trainer(course_id));

-- Preserve the original audience and expressions, while evaluating auth.uid()
-- once per statement instead of once per row.
do $$ declare p record; q text; c text; begin
  for p in select * from pg_policies where schemaname='public'
    and (coalesce(qual,'') like '%auth.uid()%' or coalesce(with_check,'') like '%auth.uid()%')
    and policyname not in ('course_trainers_insert_self','course_trainers_update_self')
  loop
    q := replace(p.qual, 'auth.uid()', '(select auth.uid())');
    c := replace(p.with_check, 'auth.uid()', '(select auth.uid())');
    execute format('alter policy %I on public.%I to authenticated%s%s',
      p.policyname,p.tablename,
      case when q is null then '' else ' using ('||q||')' end,
      case when c is null then '' else ' with check ('||c||')' end);
  end loop;
end $$;

-- Members may edit grades; only the owner may change course ownership/metadata.
alter policy courses_update_members on public.courses
using (created_by = (select auth.uid()))
with check (created_by = (select auth.uid()));

-- Shared saves advance the revision without granting metadata/ownership writes.
create or replace function public.touch_course_revision(p_course_id uuid, p_expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path=public as $$
declare v_updated timestamptz;
begin
  if auth.uid() is null or not public.is_course_trainer(p_course_id) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  update public.courses set updated_at=clock_timestamp()
    where id=p_course_id and updated_at=p_expected_updated_at returning updated_at into v_updated;
  if v_updated is null then raise exception 'course revision conflict' using errcode='40001'; end if;
  return v_updated;
end $$;
revoke all on function public.touch_course_revision(uuid,timestamptz) from public,anon;
grant execute on function public.touch_course_revision(uuid,timestamptz) to authenticated;

alter table public.course_invite_attempts add column if not exists id bigint generated always as identity;
alter table public.course_invite_attempts add constraint course_invite_attempts_pkey primary key(id);
create policy no_direct_rls_access on public.course_invite_attempts for all using(false) with check(false);
revoke all on public.course_invite_attempts from anon,authenticated;

-- No application table needs an anonymous data API grant.
revoke all on public.profiles, public.courses, public.course_trainers,
  public.course_invites, public.trainees, public.assessments, public.grades from anon;
revoke truncate, references, trigger on public.profiles, public.courses,
  public.course_trainers, public.course_invites, public.trainees,
  public.assessments, public.grades from authenticated;

-- Record actions, never row contents, names, grades, tokens or passwords.
create table public.security_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  table_name text not null,
  created_at timestamptz not null default now()
);
alter table public.security_audit_log enable row level security;
create policy no_client_access on public.security_audit_log for all using(false) with check(false);
revoke all on public.security_audit_log from public,anon,authenticated;
create index security_audit_log_created_at_idx on public.security_audit_log(created_at);
create or replace function public.record_security_event() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.security_audit_log(actor_id,action,table_name)
    values(auth.uid(),TG_OP,TG_TABLE_NAME);
  return coalesce(new,old);
end $$;
revoke all on function public.record_security_event() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['profiles','courses','course_trainers','course_invites','trainees','assessments','grades'] loop
    execute format('create trigger security_audit after insert or update or delete on public.%I for each row execute function public.record_security_event()',t);
  end loop;
end $$;

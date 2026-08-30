-- ─── Performance: RLS policy optimisation ────────────────────────────────────
-- Using (select fn()) instead of fn() prevents per-row function evaluation
-- in RLS. Postgres evaluates (select fn()) once per statement, not per row.

-- courses: select
drop policy if exists courses_members_select on public.courses;
create policy courses_members_select on public.courses
  for select to authenticated
  using (
    created_by = auth.uid()
    or (select public.can_access_course(courses.id))
  );

-- course_trainers: select
drop policy if exists course_trainers_members_select on public.course_trainers;
create policy course_trainers_members_select on public.course_trainers
  for select to authenticated
  using (
    user_id = auth.uid()
    or (select public.can_access_course(course_trainers.course_id))
  );

-- trainees
drop policy if exists trainees_course_members on public.trainees;
create policy trainees_course_members on public.trainees
  for all to authenticated
  using ((select public.can_access_course(trainees.course_id)))
  with check ((select public.can_access_course(trainees.course_id)));

-- assessments
drop policy if exists assessments_course_members on public.assessments;
create policy assessments_course_members on public.assessments
  for all to authenticated
  using ((select public.can_access_course(assessments.course_id)))
  with check ((select public.can_access_course(assessments.course_id)));

-- grades: the join is unavoidable but we can still guard with (select ...)
drop policy if exists grades_course_members on public.grades;
create policy grades_course_members on public.grades
  for all to authenticated
  using (
    exists (
      select 1
      from public.trainees t
      where t.id = grades.trainee_id
        and (select public.can_access_course(t.course_id))
    )
  )
  with check (
    exists (
      select 1
      from public.trainees t
      where t.id = grades.trainee_id
        and (select public.can_access_course(t.course_id))
    )
  );

-- ─── Missing indexes for RLS column lookups ───────────────────────────────────

-- courses.created_by is the first column checked in every course RLS policy
create index if not exists courses_created_by_idx
  on public.courses (created_by);

-- grades.assessment_id FK is not covered by the PK (trainee_id, assessment_id)
-- when deleting an assessment (cascade) or joining from assessments side
create index if not exists grades_assessment_id_idx
  on public.grades (assessment_id);

-- composite index for audit_log queries on (table_name + time range)
create index if not exists audit_log_table_created_idx
  on public.audit_log (table_name, created_at desc);

-- ─── Primary key for course_invite_attempts ───────────────────────────────────
-- The table had no PK; append-only log with identity is cleanest.

alter table public.course_invite_attempts
  add column if not exists id bigint generated always as identity;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'course_invite_attempts_pkey'
      and conrelid = 'public.course_invite_attempts'::regclass
  ) then
    alter table public.course_invite_attempts add primary key (id);
  end if;
end $$;

-- ─── CHECK constraints on score columns ───────────────────────────────────────

alter table public.assessments
  add constraint if not exists assessments_max_score_nonneg  check (max_score  >= 0),
  add constraint if not exists assessments_weight_nonneg     check (weight     >= 0);

alter table public.grades
  add constraint if not exists grades_score_nonneg           check (score      >= 0);

-- Check every new or changed grade even when clients bypass the web interface.
create or replace function public.validate_grade_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  trainee_course uuid;
  assessment_course uuid;
  maximum numeric;
begin
  select course_id into trainee_course from public.trainees where id = new.trainee_id;
  select course_id, max_score into assessment_course, maximum
    from public.assessments where id = new.assessment_id;
  if trainee_course is null or assessment_course is null or trainee_course <> assessment_course then
    raise exception 'Grade must reference a trainee and assessment from the same course' using errcode = '23514';
  end if;
  if new.score < 0 or new.score > maximum or new.score >= 'Infinity'::numeric then
    raise exception 'Grade must be between zero and the assessment maximum' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_grade_integrity on public.grades;
create trigger validate_grade_integrity
before insert or update on public.grades
for each row execute function public.validate_grade_integrity();

-- A maximum cannot be lowered below already recorded scores.
create or replace function public.validate_assessment_maximum()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.max_score <= 0 or new.max_score >= 'Infinity'::numeric
     or new.weight < 0 or new.weight > 100 or new.weight >= 'Infinity'::numeric then
    raise exception 'Invalid assessment maximum or weight' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and exists (
    select 1 from public.grades where assessment_id = new.id and score > new.max_score
  ) then
    raise exception 'Assessment maximum is below an existing grade' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists validate_assessment_maximum on public.assessments;
create trigger validate_assessment_maximum
before insert or update on public.assessments
for each row execute function public.validate_assessment_maximum();

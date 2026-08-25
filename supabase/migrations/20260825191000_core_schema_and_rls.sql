create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  college_name text not null default '',
  department_name text not null default '',
  major_name text not null default '',
  trainer_name text not null default '',
  employee_number text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  kind text not null check (kind in ('theory', 'practical')),
  section_number text not null default '',
  saved_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_trainers (
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  trainer_name text not null default '',
  employee_number text not null default '',
  joined_at timestamptz not null default now(),
  primary key (course_id, user_id)
);

create table if not exists public.course_invites (
  course_id uuid primary key references public.courses(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null default (now() + interval '30 days'),
  requires_approval boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.course_invite_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('lookup', 'join')),
  attempted_at timestamptz not null default now()
);

create table if not exists public.trainees (
  id uuid primary key,
  course_id uuid not null references public.courses(id) on delete cascade,
  training_number text not null default '',
  name text not null default '',
  theory_section text not null default '',
  practical_section text not null default ''
);

create table if not exists public.assessments (
  id uuid primary key,
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null default '',
  kind text not null check (kind in ('theory', 'practical')),
  max_score numeric not null default 0,
  date date not null,
  weight numeric not null default 0
);

create table if not exists public.grades (
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  score numeric not null default 0,
  primary key (trainee_id, assessment_id)
);

create index if not exists courses_code_idx on public.courses (code);
create index if not exists course_trainers_user_id_idx on public.course_trainers (user_id);
create index if not exists course_invites_token_idx on public.course_invites (token);
create index if not exists course_invite_attempts_user_action_time_idx on public.course_invite_attempts (user_id, action, attempted_at);
create index if not exists trainees_course_id_idx on public.trainees (course_id);
create index if not exists assessments_course_id_idx on public.assessments (course_id);

create or replace function public.generate_invite_token()
returns text
language plpgsql
set search_path = public
as $$
declare
  v_token text;
begin
  loop
    v_token := upper(encode(gen_random_bytes(6), 'hex'));
    exit when not exists (
      select 1 from public.course_invites ci where ci.token = v_token
    );
  end loop;
  return v_token;
end;
$$;

revoke execute on function public.generate_invite_token() from public;

create or replace function public.ensure_course_invite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.course_invites (course_id, token)
  values (new.id, public.generate_invite_token())
  on conflict (course_id) do nothing;
  return new;
end;
$$;

drop trigger if exists ensure_course_invite_trigger on public.courses;
create trigger ensure_course_invite_trigger
after insert on public.courses
for each row execute function public.ensure_course_invite();

create or replace function public.ensure_grade_course_match()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.trainees t
    join public.assessments a on a.course_id = t.course_id
    where t.id = new.trainee_id
      and a.id = new.assessment_id
  ) then
    raise exception 'grade trainee and assessment must belong to the same course';
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_grade_course_match_trigger on public.grades;
create trigger ensure_grade_course_match_trigger
before insert or update on public.grades
for each row execute function public.ensure_grade_course_match();

create or replace function public.prevent_trainee_course_change_with_grades()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.course_id is distinct from new.course_id and exists (
    select 1 from public.grades g where g.trainee_id = old.id
  ) then
    raise exception 'cannot move trainee to another course while grades exist';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_trainee_course_change_with_grades_trigger on public.trainees;
create trigger prevent_trainee_course_change_with_grades_trigger
before update of course_id on public.trainees
for each row execute function public.prevent_trainee_course_change_with_grades();

create or replace function public.prevent_assessment_course_change_with_grades()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.course_id is distinct from new.course_id and exists (
    select 1 from public.grades g where g.assessment_id = old.id
  ) then
    raise exception 'cannot move assessment to another course while grades exist';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_assessment_course_change_with_grades_trigger on public.assessments;
create trigger prevent_assessment_course_change_with_grades_trigger
before update of course_id on public.assessments
for each row execute function public.prevent_assessment_course_change_with_grades();

create or replace function public.prevent_course_trainer_key_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.course_id is distinct from new.course_id or old.user_id is distinct from new.user_id then
    raise exception 'course trainer membership keys are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_course_trainer_key_change_trigger on public.course_trainers;
create trigger prevent_course_trainer_key_change_trigger
before update of course_id, user_id on public.course_trainers
for each row execute function public.prevent_course_trainer_key_change();

create or replace function public.is_course_member(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.course_trainers ct
    where ct.course_id = p_course_id
      and ct.user_id = auth.uid()
  );
$$;

grant execute on function public.is_course_member(uuid) to authenticated;
revoke execute on function public.is_course_member(uuid) from public;

create or replace function public.can_access_course(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.courses c
    where c.id = p_course_id
      and c.created_by = auth.uid()
  )
  or public.is_course_member(p_course_id);
$$;

grant execute on function public.can_access_course(uuid) to authenticated;
revoke execute on function public.can_access_course(uuid) from public;

create or replace function public.touch_course_revision(
  p_course_id uuid,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_at timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.courses c
  set updated_at = v_updated_at
  where c.id = p_course_id
    and c.updated_at = p_expected_updated_at
    and public.can_access_course(c.id);

  if not found then
    raise exception 'stale course revision';
  end if;

  return v_updated_at;
end;
$$;

grant execute on function public.touch_course_revision(uuid, timestamptz) to authenticated;
revoke execute on function public.touch_course_revision(uuid, timestamptz) from public;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.course_trainers enable row level security;
alter table public.course_invites enable row level security;
alter table public.course_invite_attempts enable row level security;
alter table public.trainees enable row level security;
alter table public.assessments enable row level security;
alter table public.grades enable row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles
for all to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists courses_members_select on public.courses;
create policy courses_members_select on public.courses
for select to authenticated
using (
  created_by = auth.uid()
  or public.can_access_course(courses.id)
);

drop policy if exists courses_members_write on public.courses;
drop policy if exists courses_owner_insert on public.courses;
create policy courses_owner_insert on public.courses
for insert to authenticated
with check (created_by = auth.uid());

drop policy if exists courses_owner_update on public.courses;
create policy courses_owner_update on public.courses
for update to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists courses_owner_delete on public.courses;
create policy courses_owner_delete on public.courses
for delete to authenticated
using (created_by = auth.uid());

drop policy if exists course_trainers_members_select on public.course_trainers;
create policy course_trainers_members_select on public.course_trainers
for select to authenticated
using (
  user_id = auth.uid()
  or public.can_access_course(course_trainers.course_id)
);

drop policy if exists course_trainers_self_join on public.course_trainers;
create policy course_trainers_self_join on public.course_trainers
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.courses c
    where c.id = course_trainers.course_id
      and c.created_by = auth.uid()
  )
);

drop policy if exists course_trainers_self_update on public.course_trainers;
create policy course_trainers_self_update on public.course_trainers
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists course_trainers_self_delete on public.course_trainers;
create policy course_trainers_self_delete on public.course_trainers
for delete to authenticated
using (user_id = auth.uid());

drop policy if exists course_invites_owner on public.course_invites;
create policy course_invites_owner on public.course_invites
for all to authenticated
using (
  exists (
    select 1
    from public.courses c
    where c.id = course_invites.course_id
      and c.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.courses c
    where c.id = course_invites.course_id
      and c.created_by = auth.uid()
  )
);

drop policy if exists trainees_course_members on public.trainees;
create policy trainees_course_members on public.trainees
for all to authenticated
using (
  public.can_access_course(trainees.course_id)
)
with check (
  public.can_access_course(trainees.course_id)
);

drop policy if exists assessments_course_members on public.assessments;
create policy assessments_course_members on public.assessments
for all to authenticated
using (
  public.can_access_course(assessments.course_id)
)
with check (
  public.can_access_course(assessments.course_id)
);

drop policy if exists grades_course_members on public.grades;
create policy grades_course_members on public.grades
for all to authenticated
using (
  exists (
    select 1
    from public.trainees t
    join public.assessments a on a.course_id = t.course_id
    where t.id = grades.trainee_id
      and a.id = grades.assessment_id
      and public.can_access_course(t.course_id)
  )
)
with check (
  exists (
    select 1
    from public.trainees t
    join public.assessments a on a.course_id = t.course_id
    where t.id = grades.trainee_id
      and a.id = grades.assessment_id
      and public.can_access_course(t.course_id)
  )
);

create or replace function public.check_invite_rate_limit(p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_recent_attempts integer;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  delete from public.course_invite_attempts
  where user_id = v_user_id
    and attempted_at < now() - interval '10 minutes';

  select count(*) into v_recent_attempts
  from public.course_invite_attempts
  where user_id = v_user_id
    and action = p_action
    and attempted_at >= now() - interval '10 minutes';

  if v_recent_attempts >= 20 then
    raise exception 'too many invite attempts';
  end if;

  insert into public.course_invite_attempts (user_id, action)
  values (v_user_id, p_action);
end;
$$;

grant execute on function public.check_invite_rate_limit(text) to authenticated;
revoke execute on function public.check_invite_rate_limit(text) from public;

create or replace function public.find_course_invite_by_code(p_code text)
returns table (
  code text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_invite_rate_limit('lookup');

  return query
  select ci.token
  from public.course_invites ci
  where ci.token = upper(regexp_replace(p_code, '[^a-zA-Z0-9]', '', 'g'))
    and ci.expires_at > now()
    and ci.requires_approval = false
  limit 1;
end;
$$;

grant execute on function public.find_course_invite_by_code(text) to authenticated;
revoke execute on function public.find_course_invite_by_code(text) from public;

create or replace function public.join_course_by_code(
  p_code text,
  p_trainer_name text,
  p_employee_number text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  perform public.check_invite_rate_limit('join');

  select ci.course_id into v_course_id
  from public.course_invites ci
  where ci.token = upper(regexp_replace(p_code, '[^a-zA-Z0-9]', '', 'g'))
    and ci.expires_at > now()
    and ci.requires_approval = false;

  if v_course_id is null then
    raise exception 'course not found';
  end if;

  insert into public.course_trainers (course_id, user_id, trainer_name, employee_number)
  values (v_course_id, auth.uid(), coalesce(p_trainer_name, ''), coalesce(p_employee_number, ''))
  on conflict (course_id, user_id)
  do update set
    trainer_name = excluded.trainer_name,
    employee_number = excluded.employee_number;
end;
$$;

grant execute on function public.join_course_by_code(text, text, text) to authenticated;
revoke execute on function public.join_course_by_code(text, text, text) from public;

create or replace function public.find_course_by_code(p_code text)
returns table (
  id uuid,
  code text,
  name text,
  kind text,
  "sectionNumber" text,
  "savedAt" timestamptz,
  trainers jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    c.id,
    c.code,
    c.name,
    c.kind,
    c.section_number as "sectionNumber",
    c.saved_at as "savedAt",
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'userId', ct.user_id,
          'name', ct.trainer_name,
          'employeeNumber', ct.employee_number,
          'joinedAt', ct.joined_at
        )
        order by ct.joined_at
      ) filter (where ct.user_id is not null),
      '[]'::jsonb
    ) as trainers
  from public.courses c
  left join public.course_trainers ct on ct.course_id = c.id
  where c.code = upper(regexp_replace(p_code, '[^a-zA-Z0-9]', '', 'g'))
    and (
      c.created_by = auth.uid()
      or public.can_access_course(c.id)
    )
  group by c.id;
$$;

grant execute on function public.find_course_by_code(text) to authenticated;
revoke execute on function public.find_course_by_code(text) from public;

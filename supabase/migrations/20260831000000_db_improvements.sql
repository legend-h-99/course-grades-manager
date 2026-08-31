-- ─── DB Improvements ─────────────────────────────────────────────────────────
-- Addresses issues found during database review:
--   1. Add gen_random_uuid() defaults to trainees.id and assessments.id
--   2. Fix course_invites_owner RLS: wrap subquery in (select ...) for per-stmt eval
--   3. Add explicit DENY policy on course_invite_attempts for documentation clarity
--   4. Add auto-update trigger for profiles.updated_at
--   5. Add audit_log_cleanup() helper for retention management
--   6. Fix race condition in check_invite_rate_limit via advisory lock


-- ─── 1. UUID defaults on trainees and assessments ─────────────────────────────
-- Without a default the INSERT fails if the client forgets to supply an id.
-- gen_random_uuid() is idempotent and does not affect existing rows.

alter table public.trainees
  alter column id set default gen_random_uuid();

alter table public.assessments
  alter column id set default gen_random_uuid();


-- ─── 2. course_invites_owner RLS performance ──────────────────────────────────
-- Original policy re-evaluates the subquery for every row in the scan.
-- Wrapping in (select ...) turns it into a single per-statement evaluation,
-- matching the optimisation already applied to courses/trainees/assessments.

drop policy if exists course_invites_owner on public.course_invites;
create policy course_invites_owner on public.course_invites
  for all to authenticated
  using (
    (select c.created_by = auth.uid()
     from public.courses c
     where c.id = course_invites.course_id)
  )
  with check (
    (select c.created_by = auth.uid()
     from public.courses c
     where c.id = course_invites.course_id)
  );


-- ─── 3. Explicit DENY policy on course_invite_attempts ───────────────────────
-- RLS is already enabled; Postgres denies by default when no policy matches.
-- Adding an explicit USING (false) makes the intent visible and matches the
-- same pattern used by audit_log.

drop policy if exists no_direct_rls_access on public.course_invite_attempts;
create policy no_direct_rls_access on public.course_invite_attempts
  for all
  using (false);


-- ─── 4. Auto-update profiles.updated_at ──────────────────────────────────────
-- The column exists but was never wired to a trigger, so it always held the
-- created_at value. This trigger keeps it accurate on every UPDATE.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- ─── 5. Audit log retention helper ───────────────────────────────────────────
-- Deletes audit rows older than the supplied interval (default 1 year).
-- Call manually or via pg_cron:
--   select cron.schedule('audit-cleanup', '0 3 * * 0',
--                        $$select public.audit_log_cleanup()$$);
--
-- Only service-role callers can execute this function (REVOKE from public).

create or replace function public.audit_log_cleanup(
  p_retention interval default interval '1 year'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  delete from public.audit_log
  where created_at < now() - p_retention;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.audit_log_cleanup(interval) from public;


-- ─── 6. Race-condition fix in check_invite_rate_limit ────────────────────────
-- Use pg_try_advisory_xact_lock keyed on the user_id to serialise concurrent
-- rate-limit checks for the same user. The lock is released automatically at
-- transaction end. Low-traffic educational app: lock contention is negligible.

create or replace function public.check_invite_rate_limit(p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid    := auth.uid();
  v_recent_attempts integer;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  -- Serialise concurrent rate-limit checks for this user.
  -- hashtext() maps the uuid string to an int4 suitable for advisory locks.
  perform pg_advisory_xact_lock(hashtext(v_user_id::text));

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

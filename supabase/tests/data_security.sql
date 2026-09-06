begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  course_id uuid := gen_random_uuid();
  invite text := upper(replace(gen_random_uuid()::text,'-',''));
  affected integer;
begin
  -- Synthetic fixtures exist only inside this rolled-back transaction.
  insert into auth.users(id) values(owner_id),(outsider_id);
  insert into public.courses(id,code,created_by) values(course_id,invite,owner_id);
  insert into public.course_invites(course_id,token) values(course_id,invite) on conflict on constraint course_invites_pkey do update set token=excluded.token;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  insert into public.course_trainers(course_id,user_id) values(course_id,owner_id) on conflict on constraint course_trainers_pkey do update set trainer_name=excluded.trainer_name;
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  if exists(select 1 from public.courses where id=course_id) then raise exception 'Outsider can read course'; end if;
  if exists(select 1 from public.profiles where id=owner_id) then raise exception 'Outsider can read profile'; end if;
  begin
    insert into public.course_trainers(course_id,user_id) values(course_id,outsider_id);
    raise exception 'Direct self-enrolment unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  perform public.join_course_by_code(invite,'Security test','');
  if not public.is_course_trainer(course_id) then raise exception 'Valid invite rejected'; end if;
  update public.course_trainers set trainer_name='Updated test' where user_id=outsider_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Member profile update rejected'; end if;
  update public.courses set created_by=outsider_id where id=course_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Member could take ownership'; end if;
  perform public.touch_course_revision(course_id,(select updated_at from public.courses where id=course_id));
  begin
    perform 1 from public.security_audit_log;
    raise exception 'Audit data exposed';
  exception when insufficient_privilege then null; end;
  reset role;
  if not exists(select 1 from public.security_audit_log where actor_id=outsider_id) then raise exception 'Missing audit event'; end if;
end $$;
select true as data_isolation_invites_owner_and_audit_checks_passed;
rollback;

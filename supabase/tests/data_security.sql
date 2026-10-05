begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  v_course_id uuid := gen_random_uuid();
  v_trainee_id uuid := gen_random_uuid();
  v_assessment_id uuid := gen_random_uuid();
  invite text := upper(replace(gen_random_uuid()::text,'-',''));
  affected integer;
begin
  -- Synthetic fixtures exist only inside this rolled-back transaction.
  insert into auth.users(id) values(owner_id),(outsider_id);
  insert into public.courses(id,code,created_by) values(v_course_id,invite,owner_id);
  if (select count(*) from public.course_invites ci where ci.course_id = v_course_id) <> 1 then
    raise exception 'New course must receive one invitation';
  end if;
  update public.course_invites ci set token = invite where ci.course_id = v_course_id;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  insert into public.course_trainers(course_id,user_id) values(v_course_id,owner_id) on conflict on constraint course_trainers_pkey do update set trainer_name=excluded.trainer_name;
  insert into public.trainees(id,course_id,name,training_number) values(v_trainee_id,v_course_id,'Synthetic trainee','TEST-001');
  insert into public.assessments(id,course_id,name,kind,max_score,date) values(v_assessment_id,v_course_id,'Synthetic assessment','theory',20,current_date);
  insert into public.grades(trainee_id,assessment_id,score) values(v_trainee_id,v_assessment_id,17);
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  if exists(select 1 from public.courses where id=v_course_id) then raise exception 'Outsider can read course'; end if;
  if exists(select 1 from public.profiles where id=owner_id) then raise exception 'Outsider can read profile'; end if;
  if exists(select 1 from public.trainees where id=v_trainee_id) then raise exception 'Outsider can read trainee'; end if;
  if exists(select 1 from public.assessments where id=v_assessment_id) then raise exception 'Outsider can read assessment'; end if;
  if exists(select 1 from public.grades where trainee_id=v_trainee_id) then raise exception 'Outsider can read grade'; end if;
  begin
    insert into public.course_trainers(course_id,user_id) values(v_course_id,outsider_id);
    raise exception 'Direct self-enrolment unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  perform public.join_course_by_code(invite,'Security test','');
  if not public.is_course_trainer(v_course_id) then raise exception 'Valid invite rejected'; end if;
  if not exists(select 1 from public.grades where trainee_id=v_trainee_id and score=17) then raise exception 'Member cannot read shared grade'; end if;
  update public.grades set score=19 where trainee_id=v_trainee_id and assessment_id=v_assessment_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Member cannot update shared grade'; end if;
  update public.course_trainers set trainer_name='Updated test' where user_id=outsider_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Member profile update rejected'; end if;
  update public.courses set created_by=outsider_id where id=v_course_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Member could take ownership'; end if;
  perform public.touch_course_revision(v_course_id,(select updated_at from public.courses where id=v_course_id));
  begin
    perform 1 from public.security_audit_log;
    raise exception 'Audit data exposed';
  exception when insufficient_privilege then null; end;
  reset role;
  if not exists(select 1 from public.security_audit_log where actor_id=outsider_id) then raise exception 'Missing audit event'; end if;
end $$;
select true as data_isolation_invites_owner_and_audit_checks_passed;
rollback;

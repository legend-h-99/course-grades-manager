-- Keep the legacy RPC compatible for members, without exposing other trainers.
create or replace function public.find_course_by_code(p_code text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'code', c.code, 'name', c.name, 'kind', c.kind,
    'sectionNumber', c.section_number, 'savedAt', c.saved_at,
    'trainers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', ct.user_id, 'name', ct.trainer_name,
        'employeeNumber', ct.employee_number, 'joinedAt', ct.joined_at
      ) order by ct.joined_at)
      from public.course_trainers ct where ct.course_id = c.id
    ), '[]'::jsonb)
  )
  from public.courses c
  where c.code = upper(trim(p_code))
    and auth.uid() is not null
    and (c.created_by = auth.uid() or exists (
      select 1 from public.course_trainers member
      where member.course_id = c.id and member.user_id = auth.uid()
    ));
$$;
revoke execute on function public.find_course_by_code(text) from public, anon;
grant execute on function public.find_course_by_code(text) to authenticated;
revoke execute on function public.check_invite_rate_limit(text) from public, anon;
revoke execute on function public.find_course_invite_by_code(text) from public, anon;
revoke execute on function public.join_course_by_code(text, text, text) from public, anon;
grant execute on function public.check_invite_rate_limit(text) to authenticated;
grant execute on function public.find_course_invite_by_code(text) to authenticated;
grant execute on function public.join_course_by_code(text, text, text) to authenticated;

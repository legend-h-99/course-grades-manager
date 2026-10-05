-- Production supports multiple invitations per course (the primary key is id).
-- Do not assume course_id has a unique constraint when creating the first invite.
create or replace function public.ensure_course_invite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.course_invites (course_id, token)
  select new.id, public.generate_invite_token()
  where not exists (
    select 1 from public.course_invites where course_id = new.id
  );
  return new;
end;
$$;

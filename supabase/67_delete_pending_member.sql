-- ---------------------------------------------------------------------
--  67. 승인대기 회원 삭제 (최고관리자 전용)
-- ---------------------------------------------------------------------
--  노회와 관계없는 가입 등, 승인대기 상태의 회원을 최고관리자가 지운다.
--  로그인 계정(auth.users)까지 지우며 profiles 는 딸려서 함께 지워진다.
--  계정을 지울 권한이 없는 환경이면 profiles 만 지우고 'profile_only' 를 돌려준다.
-- ---------------------------------------------------------------------

create or replace function public.delete_pending_member(p_id uuid)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_role  text;
  v_email text;
  v_name  text;
begin
  if public.my_role() <> 'superadmin' then
    raise exception '승인대기 회원 삭제는 최고관리자만 할 수 있습니다.';
  end if;
  select role, email, name into v_role, v_email, v_name from public.profiles where id = p_id;
  if v_role is null then
    raise exception '대상 회원을 찾을 수 없습니다.';
  end if;
  if v_role <> 'pending' then
    raise exception '승인대기 회원만 삭제할 수 있습니다. (현재 등급: %)', v_role;
  end if;

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select auth.uid(), p.email, p.name, 'superadmin', 'delete', '승인대기 회원 삭제',
         coalesce(v_name, '') || ' <' || coalesce(v_email, '') || '>'
    from public.profiles p where p.id = auth.uid();

  begin
    delete from auth.users where id = p_id;
  exception when insufficient_privilege then
    delete from public.profiles where id = p_id;
    return 'profile_only';
  end;
  return 'deleted';
end;
$fn$;

grant execute on function public.delete_pending_member(uuid) to authenticated;

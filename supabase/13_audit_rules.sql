-- =====================================================================
--  13. 감사 기록 규칙과 운영자 계정 처리
--      1) 감사 기록 열람 : 관리자(노회장·서기·간사)
--      2) 보관 기간      : 3년, 지나면 자동 폐기
--      3) 운영자 계정(superadmin)의 행위는 기록하지 않음
--      4) 운영자 계정은 다른 사람의 회원 목록 조회에 나타나지 않음
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 열람 권한 : 관리자 + 최고관리자
--    (수정·삭제 정책은 두지 않으므로 누구도 기록을 고치거나 지울 수 없다)
-- ---------------------------------------------------------------------
drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs
  for select using (public.can_manage());


-- ---------------------------------------------------------------------
-- 2. 최고관리자의 행위는 기록하지 않는다
--    화면(자바스크립트)에서도 막지만, 다른 경로로 들어오는 기록까지
--    확실히 막기 위해 데이터베이스에서 한 번 더 걸러낸다.
-- ---------------------------------------------------------------------
create or replace function public.audit_skip_superadmin()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if public.my_role() = 'superadmin' then
    return null;          -- 기록을 남기지 않고 조용히 넘어간다
  end if;
  return new;
end;
$fn$;

drop trigger if exists audit_skip_superadmin_trg on public.audit_logs;
create trigger audit_skip_superadmin_trg
  before insert on public.audit_logs
  for each row execute function public.audit_skip_superadmin();


-- ---------------------------------------------------------------------
-- 3. 보관 기간 3년
--    감독 화면을 열 때마다 호출되어, 3년이 지난 기록을 지운다.
--    지울 기록이 없으면 아무 일도 하지 않는다.
-- ---------------------------------------------------------------------
create or replace function public.purge_audit_logs()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_count integer;
begin
  if not public.can_manage() then
    return 0;
  end if;
  delete from public.audit_logs
   where created_at < now() - interval '3 years';
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function public.purge_audit_logs() from public;
grant execute on function public.purge_audit_logs() to authenticated;

comment on function public.purge_audit_logs() is
  '감사 기록 보관 기간(3년)이 지난 기록을 삭제한다. 관리자만 호출할 수 있다.';


-- ---------------------------------------------------------------------
-- 4. 운영자 계정은 회원 목록에 나타나지 않는다
--    화면에서 걸러내는 것만으로는 자료를 직접 조회하면 보이므로,
--    데이터베이스 단계에서 아예 조회되지 않게 한다.
--    (본인 계정은 profiles_self_read 정책으로 본인만 볼 수 있다)
-- ---------------------------------------------------------------------
drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_admin_read on public.profiles
  for select using (public.is_officer() and role <> 'superadmin');

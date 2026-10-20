-- =====================================================================
--  124. 임원 등급 2단계 인증 (Google OTP) — 서버 쪽 잠금 (2026-10-20)
--
--  임원 등급(최고관리자·노회장·서기·간사·임원)은 모두 2단계 인증을 쓴다 (노회 결정).
--  홈페이지(js/supabase-auth.js·mfa.html)는 이미 OTP 확인 전에는 화면을 열어 주지 않지만,
--  이 파일을 실행하면 서버도 OTP 확인을 마친 로그인(aal2)에게만 관리·임원 권한을 준다.
--  비밀번호가 새어 나가도, 홈페이지를 거치지 않고 서버를 직접 불러도 관리 기능을 쓸 수 없다.
--
--    1) public.mfa_ok()        지금 로그인이 OTP 확인까지 마쳤는가 (aal2)
--    2) can_manage()·is_officer()  원래 판정(등급)은 can_manage_role()·is_officer_role() 로 옮기고,
--                              원래 이름은 「등급 판정 그리고 mfa_ok()」로 바꾼다.
--                              (지금 운영 DB 의 정의를 그대로 옮기므로 다른 조건은 바뀌지 않는다)
--    3) admin_mfa_list()       최고관리자 — 임원별 OTP 등록 현황 (내 정보 화면)
--    4) admin_reset_mfa(id)    최고관리자 — 휴대전화를 잃어버린 분의 OTP 초기화
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--  먼저: Supabase → Authentication → Multi-Factor 에서 TOTP(App Authenticator)가 켜져 있어야 한다 (기본으로 켜져 있음).
--
--  ※ 실행한 뒤에는 최고관리자도 홈페이지에서 OTP 를 등록·확인해야 관리 기능이 열린다.
--    (홈페이지는 다음 화면을 열 때 OTP 등록·확인 화면으로 안내한다)
--  ※ 앞으로 can_manage()·is_officer() 를 「create or replace」로 다시 만드는 SQL 은 이 잠금을 지운다.
--    그런 일이 있으면 이 파일을 한 번 더 실행한다.
--
--  최고관리자 자신이 휴대전화를 잃어버렸을 때 (SQL Editor 에서):
--    delete from auth.mfa_factors where user_id = (select id from auth.users where email = '최고관리자 이메일');
--
--  되돌리기 (잠금만 풀기):
--    create or replace function public.can_manage() returns boolean language sql stable security definer
--      set search_path = public as $f$ select public.can_manage_role() $f$;
--    create or replace function public.is_officer() returns boolean language sql stable security definer
--      set search_path = public as $f$ select public.is_officer_role() $f$;
-- =====================================================================

-- 1) 지금 로그인이 OTP 확인까지 마쳤는가
create or replace function public.mfa_ok()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$fn$;
grant execute on function public.mfa_ok() to anon, authenticated;

-- 2) 관리·임원 권한에 OTP 확인 조건 — 지금 정의를 <이름>_role() 로 옮기고 원래 이름은 감싼다
do $do$
declare
  f text;
  d text;
begin
  foreach f in array array['can_manage', 'is_officer'] loop
    d := pg_get_functiondef(('public.' || f || '()')::regprocedure);
    if position('mfa_ok' in d) > 0 then
      raise notice '%() 는 이미 OTP 조건이 있습니다.', f;
      continue;
    end if;
    execute regexp_replace(d, 'FUNCTION public\.' || f || '\(\)', 'FUNCTION public.' || f || '_role()');
    execute format(
      'create or replace function public.%I() returns boolean language sql stable security definer '
      'set search_path = public as $f$ select public.%I() and public.mfa_ok() $f$', f, f || '_role');
    execute format('grant execute on function public.%I() to anon, authenticated', f || '_role');
    raise notice '%() 에 OTP 조건을 걸었습니다.', f;
  end loop;
end
$do$;

-- 3) 최고관리자 — 임원별 OTP 등록 현황
create or replace function public.admin_mfa_list()
returns table (id uuid, name text, role text, title text, enrolled boolean, enrolled_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $fn$
#variable_conflict use_column
begin
  if not (public.my_role() = 'superadmin' and public.mfa_ok()) then
    raise exception '최고관리자만 볼 수 있습니다.';
  end if;
  return query
  select p.id, p.name, p.role, p.title, f.at is not null, f.at
    from public.profiles p
    left join lateral (
      select min(m.created_at) as at
        from auth.mfa_factors m
       where m.user_id = p.id and m.factor_type = 'totp' and m.status = 'verified'
    ) f on true
   where p.role in ('superadmin', 'president', 'clerk', 'staff', 'officer')
   order by array_position(array['president', 'clerk', 'staff', 'officer', 'superadmin'], p.role), p.name;
end
$fn$;
revoke all on function public.admin_mfa_list() from public, anon;
grant execute on function public.admin_mfa_list() to authenticated;

-- 4) 최고관리자 — 휴대전화를 잃어버린 분의 OTP 초기화 (다음 로그인 때 새로 등록한다)
create or replace function public.admin_reset_mfa(p_user uuid)
returns integer language plpgsql security definer set search_path = public, auth as $fn$
declare n integer;
begin
  if not (public.my_role() = 'superadmin' and public.mfa_ok()) then
    raise exception '최고관리자만 2단계 인증을 초기화할 수 있습니다.';
  end if;
  if p_user = auth.uid() then
    raise exception '자기 계정은 여기서 초기화하지 않습니다. 내 정보의 「휴대전화를 바꿨습니다」를 쓰세요.';
  end if;
  delete from auth.mfa_factors where user_id = p_user;
  get diagnostics n = row_count;
  return n;
end
$fn$;
revoke all on function public.admin_reset_mfa(uuid) from public, anon;
grant execute on function public.admin_reset_mfa(uuid) to authenticated;

-- 확인: 아래 두 줄이 「... and public.mfa_ok()」 로 보이면 잠금이 걸린 것
select proname, prosrc from pg_proc
 where pronamespace = 'public'::regnamespace and proname in ('can_manage', 'is_officer', 'can_manage_role', 'is_officer_role')
 order by proname;

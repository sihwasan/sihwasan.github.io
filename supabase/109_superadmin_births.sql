-- =====================================================================
--  109. 최고관리자는 모든 것을 열람한다 — 생년월일·남은 임기
--
--  생년월일 조회 함수가 관리자(can_manage)와 함께 최고관리자를 분명히
--  허락하도록 다시 적는다. (can_manage 정의가 바뀌어도 최고관리자는 본다)
--
--  실행 방법 : Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

create or replace function public.can_see_births()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.can_manage()
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin');
$fn$;
grant execute on function public.can_see_births() to authenticated;

create or replace function public.roster_births()
returns table (id bigint, birth_date date)
language sql stable security definer set search_path = public as $fn$
  select r.id, r.birth_date from public.roster r
   where public.can_see_births() and r.birth_date is not null;
$fn$;
revoke all on function public.roster_births() from public;
grant execute on function public.roster_births() to authenticated;

create or replace function public.church_staff_births()
returns table (id bigint, birth_date date)
language sql stable security definer set search_path = public as $fn$
  select s.id, s.birth_date from public.church_staff s
   where public.can_see_births() and s.birth_date is not null;
$fn$;
revoke all on function public.church_staff_births() from public;
grant execute on function public.church_staff_births() to authenticated;

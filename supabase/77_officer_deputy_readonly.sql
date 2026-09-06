-- =====================================================================
--  77. 정·부 권한 정비 — 부회계는 열람만
--
--  노회 임원 가운데 <정>은 기록하고 <부>는 열람만 합니다.
--    · 회계   : 상회비·세례의무금 납부 기록, 노회 재정부 장부 기록
--    · 부회계 : 위 자료 열람만 (기록 불가)
--  (서기는 role=clerk 로 관리자 권한, 부서기는 role=officer 로 열람만이라
--   이미 그렇게 되어 있습니다.)
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 74_presbytery_ledger.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

-- 노회 회계 (직함이 정확히 '회계'인 노회 임원). 최고관리자는 복구용으로 포함.
create or replace function public.is_presbytery_treasurer()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and ((p.role = 'officer' and btrim(coalesce(p.title, '')) = '회계')
            or p.role = 'superadmin')
  );
$fn$;
grant execute on function public.is_presbytery_treasurer() to authenticated;

-- 노회 부회계 — 열람만
create or replace function public.is_presbytery_vice_treasurer()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'officer' and btrim(coalesce(p.title, '')) = '부회계'
  );
$fn$;
grant execute on function public.is_presbytery_vice_treasurer() to authenticated;

-- 상회비·세례의무금 기록: 관리자와 회계 (부회계는 열람만)
create or replace function public.is_dues_manager()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.can_manage() or exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'officer'
       and btrim(coalesce(p.title, '')) = '회계'
  );
$fn$;
grant execute on function public.is_dues_manager() to authenticated;

-- 노회 장부 열람: 회계·부회계, 관리자, 감사 기간의 감사부장·서기
create or replace function public.can_read_ledger(p_kind text, p_owner text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_kind
           when 'presbytery' then public.is_presbytery_treasurer()
                                or public.is_presbytery_vice_treasurer()
                                or public.can_manage()
                                or (public.is_audit_reviewer() and public.audit_window_open())
           else public.is_officer() or public.is_ledger_owner(p_kind, p_owner)
         end;
$fn$;
grant execute on function public.can_read_ledger(text, text) to authenticated;

-- 확인:
--   select p.name, p.title, p.role from public.profiles p where p.role = 'officer';

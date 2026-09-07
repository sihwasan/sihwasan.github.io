-- =====================================================================
--  86. 노회 재정부 장부 열람 — 회계·부회계만 (총관리자, 감사 기간의 감사부장·서기 포함)
--
--  전에는 관리자(노회장·서기·간사)도 열람할 수 있었다. 이제 회계 자료는
--  회계(기록)·부회계(열람)만 보며, 부서기 등 다른 임원은 보지 못한다.
--  홈페이지 메뉴(main.js showFinanceMenu)와 임원방(officer.html financeAccess)도 같은 규칙.
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run  (여러 번 실행해도 안전)
-- =====================================================================
create or replace function public.can_read_ledger(p_kind text, p_owner text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_kind
           when 'presbytery' then public.is_presbytery_treasurer()
                                or public.is_presbytery_vice_treasurer()
                                or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
                                or (public.is_audit_reviewer() and public.audit_window_open())
           when 'committee'  then public.is_committee_officer(p_owner)
                                or (public.is_audit_reviewer() and public.audit_window_open())
           else public.is_officer()
                or public.is_ledger_owner(p_kind, p_owner)
                or (public.is_audit_reviewer() and public.audit_window_open())
         end;
$fn$;
grant execute on function public.can_read_ledger(text, text) to authenticated;

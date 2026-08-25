-- =====================================================================
--  40. 회계 장부는 회계도 만들 수 있게
--
--  회계 장부를 적는 일은 본디 회계가 맡습니다.
--
--    · 상비부 : 부장·서기·회계가 모두 쓸 수 있었습니다. (그대로)
--    · 시찰   : 시찰장·서기만 쓸 수 있었습니다.
--               → 회계 장부에 한해 회계도 쓸 수 있게 합니다.
--
--  시찰의 다른 것(관내 교회·자료실·회의록)은 지금처럼 시찰장·서기가
--  맡습니다. 회계에게는 회계 장부만 열어 드립니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 36_audit_ledger.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 이 시찰의 회계인가
--    시찰 명부(sichals.treasurer)의 이름으로 알아본다.
--    명부에는 '김운갑 목사'처럼 적히므로 첫 낱말만 견준다.
-- ---------------------------------------------------------------------
create or replace function public.is_sichal_treasurer(p_sichal text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from public.sichals s
      join public.profiles p on p.id = auth.uid()
     where s.name = p_sichal
       and p.name is not null
       and split_part(btrim(coalesce(s.treasurer, '')), ' ', 1) = p.name
  );
$fn$;

grant execute on function public.is_sichal_treasurer(text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. 회계 장부를 쓸 수 있는 사람
--    상비부 : 부장·서기·회계  (is_committee_officer 가 셋을 모두 본다)
--    시찰   : 시찰장·서기·회계
-- ---------------------------------------------------------------------
create or replace function public.is_ledger_owner(p_kind text, p_owner text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_kind
           when 'committee' then public.is_committee_officer(p_owner)
           when 'sichal'    then public.is_sichal_officer(p_owner)
                              or public.is_sichal_treasurer(p_owner)
           else public.can_manage()
         end;
$fn$;

grant execute on function public.is_ledger_owner(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 확인 — 각 시찰의 회계가 누구인지
-- ---------------------------------------------------------------------
select name as "시찰", coalesce(head, '-') as "시찰장",
       coalesce(clerk, '-') as "서기", coalesce(treasurer, '-') as "회계"
  from public.sichals
 order by sort;

select name as "상비부", coalesce(head, '-') as "부장·위원장",
       coalesce(clerk, '-') as "서기", coalesce(treasurer, '-') as "회계"
  from public.committees
 order by sort;

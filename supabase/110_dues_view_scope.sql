-- =====================================================================
--  110. 상회비 열람 자격 — 상회비를 내는 분만 상회비 내역을 본다
--
--  ※※ 아직 적용하지 않은 제안입니다. 그대로 실행하지 마십시오. ※※
--  저장소의 SQL 은 운영 데이터베이스보다 오래되었을 수 있습니다.
--  아래에서 다시 만드는 함수(sichal_finance, sichal_finance_detail)는
--  72_sichal_finance_due.sql 을 바탕으로 마지막 where 한 줄만 바꾼 것이므로,
--  실행 전에 반드시 운영 본문과 견주어 보십시오.
--     select pg_get_functiondef('public.sichal_finance(int)'::regprocedure);
--     select pg_get_functiondef('public.sichal_finance_detail(int, text)'::regprocedure);
--     select pg_get_functiondef('public.my_dues(int)'::regprocedure);
--     select tablename, policyname, cmd, roles, qual
--       from pg_policies
--      where schemaname = 'public'
--        and tablename in ('dues_rates', 'dues_payments', 'dues_closings',
--                          'bapdues', 'sichal_fees', 'sichal_fee_rates');
--  운영 본문이 다르면 운영 본문에 where 조건만 옮겨 넣으십시오.
--
--  규칙 (화면 쪽 js/main.js 의 SHS.paysDues / SHS.duesAccess 와 같다)
--   상회비는 교회가 노회에 내는 돈이다. 그래서 상회비를 내는 시무 교회의
--   담임목사(명단 분류 '목사' — 직분 목사·위임목사·시무목사)와 장로만
--   상회비·세례의무금·시찰회비·교역자회비 내역을 본다.
--   부목사·무임목사·원로목사·은퇴목사·강도사·전도사 등은 보지 못한다.
--   허용 목록 방식 — 명단에 새 분류가 생겨도 여기 적지 않으면 막힌다.
--   단, 그 일을 맡은 분은 분류와 상관없이 그대로 본다.
--     · 노회 관리자(노회장·서기·간사·최고관리자), 노회 회계·부회계
--     · 시찰 내역은 그 시찰의 시찰장·서기·회계, 교역자회 임원, 감사부장·감사부 서기
--
--  바뀌는 것
--   1) 도우미 함수 pays_dues(), can_view_dues(), can_view_sichal_dues(시찰)
--   2) bapdues · sichal_fees · sichal_fee_rates 읽기 정책
--   3) sichal_finance · sichal_finance_detail 의 열람 조건 (is_member → 위 함수)
--   4) dues_rates · dues_payments · dues_closings 읽기 정책과 my_dues 함수 —
--      저장소에 정의가 없으므로(운영에서 직접 만든 것) 맨 아래 주석의
--      순서대로 손으로 고친다.
--
--  화면에서 이 자료를 읽는 곳 (적용 뒤 막힌 분에게는 빈 목록이 온다)
--   · js/board.js     my_dues, bapdues, sichal_finance(_detail), dues_* (관리자·임원)
--   · officer.html    dues_rates·dues_payments·dues_closings·bapdues (임원방)
--   · sichal.html     sichal_finance(_detail), bapdues, sichal_fees, sichal_fee_rates
--   · petition.html   dues_rates 의 church·pastor 만 (시찰 교회 목록용 — 비면
--                     교회상황 보고서의 교회 목록으로 대신하므로 깨지지 않는다)
--
--  ※ 여러 번 실행해도 안전합니다 (create or replace / drop policy if exists).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 도우미 함수
-- ---------------------------------------------------------------------

-- 내가 상회비를 내는 자리인가 (노회 명단 roster 의 분류·직분 기준)
-- 명단과 이어지지 않은 계정(roster_id 없음)은 가입할 때 적은 직분으로 본다
-- (화면의 SHS.duesAccess 와 같은 규칙).
create or replace function public.pays_dues()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from public.profiles p
      left join public.roster r on r.id = p.roster_id
     where p.id = auth.uid()
       and (
         -- 명단과 이어진 계정: 분류(category)가 원본
         (r.id is not null and (
              btrim(coalesce(r.category, '')) = '장로'
           or (btrim(coalesce(r.category, '')) in ('목사', '위임목사', '시무목사')
               and btrim(coalesce(r.position, '')) in ('', '목사', '위임목사', '시무목사', '담임목사'))
           -- 분류가 비어 있는 예전 명단은 직분만으로 본다
           or (btrim(coalesce(r.category, '')) = ''
               and btrim(coalesce(r.position, '')) in ('목사', '위임목사', '시무목사', '담임목사', '장로'))
         ))
         -- 명단과 이어지지 않은 계정: 가입할 때 적은 직분
         or (r.id is null
             and btrim(coalesce(p.position, '')) in ('목사', '위임목사', '시무목사', '담임목사', '장로'))
       )
  );
$fn$;
grant execute on function public.pays_dues() to authenticated;

comment on function public.pays_dues() is
  '상회비를 내는 자리인가 — 명단 분류가 장로, 또는 목사(직분 목사·위임목사·시무목사). 부목사·무임·원로·은퇴 등은 아니다';

-- 노회 상회비·세례의무금 내역을 볼 수 있는가
--   관리자, 노회 회계(is_dues_manager)·부회계, 그리고 상회비를 내는 분
create or replace function public.can_view_dues()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_member() and (
         public.can_manage()
      or public.is_dues_manager()
      or public.is_presbytery_vice_treasurer()
      or public.pays_dues()
  );
$fn$;
grant execute on function public.can_view_dues() to authenticated;

-- 그 시찰의 상회비·시찰회비·교역자회비 내역을 볼 수 있는가
--   위 can_view_dues() 에 더해 그 일을 맡은 시찰 임원·회계, 교역자회 임원, 감사부장·서기
create or replace function public.can_view_sichal_dues(p_sichal text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.can_view_dues()
      or public.is_sichal_officer(p_sichal)      -- 시찰장·서기 (노회 관리자 포함)
      or public.is_sichal_treasurer(p_sichal)    -- 시찰 회계
      or public.is_ministers_officer(p_sichal)   -- 교역자회 회장·서기·회계 (93)
      or public.is_audit_reviewer();             -- 감사부장·감사부 서기 (74)
$fn$;
grant execute on function public.can_view_sichal_dues(text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. 표 읽기 정책
--    쓰기 정책(for all)은 그대로 둔다. for all 정책은 읽기에도 걸리므로
--    관리자·회계·시찰 임원 등 쓰는 분은 지금처럼 읽는다.
-- ---------------------------------------------------------------------

-- 세례의무금 (47: 예전에는 is_member)
drop policy if exists bapdues_read on public.bapdues;
create policy bapdues_read on public.bapdues for select
  using (public.can_view_dues());

-- 시찰회비·교역자회비 납부 (50: 예전에는 is_member)
drop policy if exists sichal_fees_read on public.sichal_fees;
create policy sichal_fees_read on public.sichal_fees for select
  using (public.can_view_sichal_dues(sichal));

-- 시찰회가 정한 회비 (51: 예전에는 is_member)
drop policy if exists sichal_fee_rates_read on public.sichal_fee_rates;
create policy sichal_fee_rates_read on public.sichal_fee_rates for select
  using (public.can_view_sichal_dues(sichal));


-- ---------------------------------------------------------------------
-- 3. 시찰별 납부 현황 함수 — 본문은 72 그대로, 맨 끝 열람 조건만 바꾼다
--    (반환 열이 같으므로 drop 없이 create or replace. 운영 본문의 열이
--     다르면 여기서 오류가 나며 멈춘다 — 그때는 운영 본문에 조건만 옮길 것)
-- ---------------------------------------------------------------------
create or replace function public.sichal_finance(p_year int)
returns table (
  out_sichal        text,
  out_dues_churches int,
  out_dues_plan     bigint,
  out_dues_paid     bigint,
  out_dues_due      bigint,
  out_dues_paid_due bigint,
  out_dues_full     int,
  out_bap_churches  int,
  out_bap_join      int,
  out_bap_target    bigint,
  out_bap_paid      bigint
) language sql stable security definer set search_path = public as $fn$
  with el as (
    select public.fy_elapsed(p_year) as n
  ),
  d as (
    select coalesce(nullif(btrim(r.sichal), ''), '기타') as sichal,
           count(*)::int as nch,
           (sum(coalesce(r.monthly_amount, 0)) * 12)::bigint as plan,
           (sum(coalesce(r.monthly_amount, 0)) * (select n from el))::bigint as due,
           coalesce(sum(pp.paid), 0)::bigint as paid,
           coalesce(sum(pp.paid_due), 0)::bigint as paid_due,
           (count(*) filter (where coalesce(pp.months_due, 0) >= (select n from el)))::int as full_cnt
      from public.dues_rates r
      left join lateral (
        select sum(coalesce(p.amount, r.monthly_amount)) as paid,
               sum(coalesce(p.amount, r.monthly_amount))
                 filter (where (p.month + 8) % 12 < (select n from el)) as paid_due,
               count(*) filter (where (p.month + 8) % 12 < (select n from el)) as months_due
          from public.dues_payments p
         where p.year = r.year and p.church = r.church
      ) pp on true
     where r.year = p_year
     group by 1
  ),
  b as (
    select coalesce(sc.sichal, '기타') as sichal,
           count(*)::int as nch,
           (count(*) filter (where bb.paid > 0))::int as joined,
           coalesce(sum(bb.target), 0)::bigint as target,
           coalesce(sum(bb.paid), 0)::bigint as paid
      from public.bapdues bb
      left join lateral (
        select s.sichal from public.sichal_churches s
         where public._chkey(s.name) = public._chkey(bb.church) limit 1
      ) sc on true
     where bb.year = p_year
     group by 1
  )
  select coalesce(d.sichal, b.sichal),
         coalesce(d.nch, 0), coalesce(d.plan, 0), coalesce(d.paid, 0),
         coalesce(d.due, 0), coalesce(d.paid_due, 0), coalesce(d.full_cnt, 0),
         coalesce(b.nch, 0), coalesce(b.joined, 0), coalesce(b.target, 0), coalesce(b.paid, 0)
    from d full join b on d.sichal = b.sichal
   -- 바뀐 곳 (72: where public.is_member())
   -- 노회 전체 요약도 함께 돌려 주므로, 상회비를 내는 분이거나
   -- 어느 시찰에서든 그 일을 맡은 분(시찰 임원·회계·교역자회 임원·감사부)에게만
   where public.can_view_dues()
      or exists (select 1 from public.sichals s where public.can_view_sichal_dues(s.name));
$fn$;

create or replace function public.sichal_finance_detail(p_year int, p_sichal text)
returns table (
  out_church     text,
  out_monthly    int,
  out_months     int,
  out_months_due int,
  out_dues_paid  bigint,
  out_bap_target bigint,
  out_bap_paid   bigint
) language sql stable security definer set search_path = public as $fn$
  with el as (
    select public.fy_elapsed(p_year) as n
  ),
  dr as (
    select r.church,
           coalesce(r.monthly_amount, 0)::int as monthly,
           (select count(*) from public.dues_payments p
             where p.year = r.year and p.church = r.church)::int as months,
           (select count(*) from public.dues_payments p
             where p.year = r.year and p.church = r.church
               and (p.month + 8) % 12 < (select n from el))::int as months_due,
           (select coalesce(sum(coalesce(p.amount, r.monthly_amount)), 0)
              from public.dues_payments p
             where p.year = r.year and p.church = r.church)::bigint as paid
      from public.dues_rates r
     where r.year = p_year
       and coalesce(nullif(btrim(r.sichal), ''), '기타') = p_sichal
  ),
  bp as (
    select bb.church, bb.target, bb.paid
      from public.bapdues bb
     where bb.year = p_year
       and coalesce((select s.sichal from public.sichal_churches s
                      where public._chkey(s.name) = public._chkey(bb.church) limit 1),
                    '기타') = p_sichal
  )
  select coalesce(dr.church, bp.church),
         coalesce(dr.monthly, 0), coalesce(dr.months, 0), coalesce(dr.months_due, 0), coalesce(dr.paid, 0),
         coalesce(bp.target, 0), coalesce(bp.paid, 0)
    from dr full join bp on public._chkey(dr.church) = public._chkey(bp.church)
   -- 바뀐 곳 (72: where public.is_member())
   where public.can_view_sichal_dues(p_sichal)
   order by 1;
$fn$;

grant execute on function public.sichal_finance(int) to authenticated;
grant execute on function public.sichal_finance_detail(int, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 저장소에 정의가 없는 것 — 손으로 고친다 (아래는 주석 처리한 본보기)
-- ---------------------------------------------------------------------
--
-- (가) 나의 상회비 함수 my_dues(연도)
--   pg_get_functiondef 로 지금 본문을 받아, 맨 끝 where 에
--       and public.can_view_dues()
--   를 더해 create or replace 로 다시 만든다. (반환 열은 바꾸지 않는다)
--
-- (나) 상회비 원자료 dues_rates · dues_payments · dues_closings 의 읽기 정책
--   49 의 설명으로는 "상회비 원자료는 임원만" 읽는다(is_officer 로 짐작).
--   위 pg_policies 조회로 select(또는 all) 정책의 실제 이름과 조건을 확인한 뒤,
--   읽기 정책만 아래처럼 바꾼다. 정책 이름은 짐작이므로 실제 이름으로 고칠 것.
--   (이름이 다른 채로 새 정책을 더하기만 하면 permissive 정책끼리 OR 로
--    합쳐져 아무것도 막지 못한다 — 반드시 예전 읽기 정책을 지울 것)
--
--   drop policy if exists dues_rates_read on public.dues_rates;
--   create policy dues_rates_read on public.dues_rates for select
--     using (public.can_view_dues()
--            or public.is_sichal_officer(sichal) or public.is_sichal_treasurer(sichal));
--
--   drop policy if exists dues_payments_read on public.dues_payments;
--   create policy dues_payments_read on public.dues_payments for select
--     using (public.can_view_dues());
--
--   drop policy if exists dues_closings_read on public.dues_closings;
--   create policy dues_closings_read on public.dues_closings for select
--     using (public.can_view_dues());
--
-- ---------------------------------------------------------------------
-- 확인 (적용 뒤, 부목사·무임목사 계정으로 로그인한 세션에서)
--   select public.pays_dues(), public.can_view_dues();        -- 둘 다 false
--   select count(*) from public.sichal_finance(2026);          -- 0
--   select count(*) from public.bapdues;                       -- 0
-- 시무 교회 담임목사·장로 계정에서는 pays_dues() = true 이고 예전과 같이 보인다.
-- =====================================================================

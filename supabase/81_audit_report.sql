-- =====================================================================
--  81. 감사 결과와 감사 보고서
--
--  감사부가 감사 기간에 장부·회의록을 살펴 감사필을 찍으면, 그 결과를
--  한 화면(audit-report.html)에서 보고 <감사 보고서>로 인쇄·PDF 저장한다.
--    · 회계 장부 감사 결과 : 재정부·상비부·시찰 장부의 이월·수입·지출·잔액,
--      증빙 수, 감사필(일시·의견·도장), 마감 승인
--    · 회의록 감사 결과   : 상비부·시찰 회의록 수와 감사필 수
--    · 종합 의견·지적 사항 : 감사부장·서기가 적고 확정한다 (audit_reports)
--
--  누가 보나 : 노회 임원, 감사부, 노회 관리자 (장부 속 낱낱 항목이 아니라
--             합계와 감사 결과만 보인다)
--  누가 쓰나 : 감사부장·감사부 서기, 노회 관리자
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 80_audit_window_dates.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 감사 보고서 (종합 의견·지적 사항·확정)
--    year·period 는 감사 회기(감사를 한 해와 봄·가을)다.
--    봄 감사(3월)는 그 전해 4월에 시작한 회계연도를, 가을 감사는 그해
--    회계연도를 본다. (회계연도 = 봄이면 year-1, 가을이면 year)
-- ---------------------------------------------------------------------
create table if not exists public.audit_reports (
  id           bigserial primary key,
  year         integer not null,
  period       text not null check (period in ('봄', '가을')),
  from_on      date,
  until_on     date,
  summary      text,                 -- 종합 의견
  findings     text,                 -- 지적·권고 사항
  head         text,                 -- 확정 당시 감사부장
  clerk        text,                 -- 확정 당시 감사부 서기
  finalized_at timestamptz,
  finalized_by text,
  updated_at   timestamptz not null default now(),
  updated_by   text,
  unique (year, period)
);
alter table public.audit_reports enable row level security;

drop policy if exists audit_reports_read  on public.audit_reports;
drop policy if exists audit_reports_write on public.audit_reports;
create policy audit_reports_read on public.audit_reports for select
  using (public.is_officer() or public.is_audit_officer());
create policy audit_reports_write on public.audit_reports for all
  using (public.is_audit_reviewer() or public.can_manage())
  with check (public.is_audit_reviewer() or public.can_manage());

-- 감사 회기 → 회계연도
create or replace function public.audit_fiscal_year(p_year integer, p_period text)
returns integer language sql immutable as $fn$
  select case when p_period = '봄' then p_year - 1 else p_year end;
$fn$;


-- ---------------------------------------------------------------------
-- 2. 회계 장부 감사 결과 (합계와 감사 칸만 — 낱낱 항목은 아니다)
-- ---------------------------------------------------------------------
create or replace function public.audit_report_ledgers(p_year integer, p_period text)
returns table (
  book_id bigint, owner_kind text, owner text, year integer,
  opening_balance bigint, income bigint, expense bigint, balance bigint,
  entries integer, receipts integer, payouts integer, payouts_confirmed integer,
  audited_yn boolean, audit_year integer, audit_period text, audit_opinion text,
  audit_head text, audit_clerk text, audit_head_seal text, audit_clerk_seal text,
  audited_at timestamptz,
  closed_yn boolean, close_approved_at timestamptz, close_approved_by text, close_opinion text,
  sort integer
)
language sql stable security definer set search_path = public as $fn$
  select b.id, b.owner_kind, b.owner, b.year,
         b.opening_balance,
         coalesce((select sum(e.amount) from public.ledger_entries e where e.book_id = b.id and e.kind = '수입'), 0),
         coalesce((select sum(e.amount) from public.ledger_entries e where e.book_id = b.id and e.kind = '지출'), 0),
         public.ledger_balance(b.id),
         (select count(*) from public.ledger_entries e where e.book_id = b.id)::integer,
         (select count(*) from public.ledger_receipts r where r.book_id = b.id)::integer,
         (select count(*) from public.ledger_payouts p where p.book_id = b.id)::integer,
         (select count(*) from public.ledger_payouts p where p.book_id = b.id and p.status = '확인')::integer,
         b.audited_yn, b.audit_year, b.audit_period, b.audit_opinion,
         b.audit_head, b.audit_clerk, b.audit_head_seal, b.audit_clerk_seal, b.audited_at,
         b.closed_yn, b.close_approved_at, b.close_approved_by, b.close_opinion,
         case b.owner_kind when 'presbytery' then 0 when 'committee' then 100 else 200 end
           + coalesce((select c.sort from public.committees c where c.name = b.owner), 0)
           + coalesce((select s.sort::integer from public.sichals s where s.name = b.owner), 0)
    from public.ledger_books b
   where b.year = public.audit_fiscal_year(p_year, p_period)
     and (public.is_officer() or public.is_audit_officer())
   order by 26, b.owner;
$fn$;
grant execute on function public.audit_report_ledgers(integer, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 회의록 감사 결과 — 회계연도 안의 회의록 수와 이번 감사의 감사필 수
-- ---------------------------------------------------------------------
create or replace function public.audit_report_minutes(p_year integer, p_period text)
returns table (owner_kind text, owner text, total integer, audited integer, sort integer)
language sql stable security definer set search_path = public as $fn$
  with fy as (
    select public.audit_fiscal_year(p_year, p_period) as y
  ),
  rng as (
    select make_date(y, 4, 1) as d1, make_date(y + 1, 3, 31) as d2 from fy
  )
  select 'committee', c.name,
         (select count(*) from public.committee_minutes m, rng
           where m.committee = c.name and m.met_on between rng.d1 and rng.d2)::integer,
         (select count(*) from public.committee_minutes m, rng
           where m.committee = c.name and m.met_on between rng.d1 and rng.d2
             and m.audited_yn and m.audit_year = p_year and m.audit_period = p_period)::integer,
         100 + coalesce(c.sort, 0)
    from public.committees c
   where public.is_officer() or public.is_audit_officer()
  union all
  select 'sichal', s.name,
         (select count(*) from public.sichal_minutes m, rng
           where m.sichal = s.name and m.met_on between rng.d1 and rng.d2)::integer,
         (select count(*) from public.sichal_minutes m, rng
           where m.sichal = s.name and m.met_on between rng.d1 and rng.d2
             and m.audited_yn and m.audit_year = p_year and m.audit_period = p_period)::integer,
         200 + coalesce(s.sort::integer, 0)
    from public.sichals s
   where public.is_officer() or public.is_audit_officer()
   order by 5, 2;
$fn$;
grant execute on function public.audit_report_minutes(integer, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 감사 회기 목록 — 화면의 연도·봄가을 고르기에 쓴다
-- ---------------------------------------------------------------------
create or replace function public.audit_periods()
returns table (year integer, period text, source text)
language sql stable security definer set search_path = public as $fn$
  select x.year, x.period, min(x.source)
    from (
      select r.year, r.period, 'report' as source from public.audit_reports r
      union all
      select b.audit_year, b.audit_period, 'ledger' from public.ledger_books b
       where b.audited_yn and b.audit_year is not null and b.audit_period in ('봄', '가을')
      union all
      select (value->>'year')::integer, value->>'period', 'window'
        from public.site_settings where key = 'audit_window'
         and value->>'year' ~ '^\d{4}$' and value->>'period' in ('봄', '가을')
    ) x
   where public.is_officer() or public.is_audit_officer()
   group by x.year, x.period
   order by x.year desc, case x.period when '가을' then 1 else 0 end desc;
$fn$;
grant execute on function public.audit_periods() to authenticated;

-- 확인:
--   select owner_kind, owner, balance, audited_yn, audit_opinion from public.audit_report_ledgers(2026, '가을');
--   select * from public.audit_report_minutes(2026, '가을');

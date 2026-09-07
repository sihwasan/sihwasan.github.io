-- =====================================================================
--  79. 상비부 장부는 회계가 적고 부장·서기·회계가 본다 / 감사부 감사함
--
--  1) 상비부 장부
--       적기 : 그 부서의 회계 (상비부 명부의 회계, 또는 따로 지정한 회계)
--       열람 : 그 부서의 부장·서기·회계, 노회 관리자,
--              감사 기간의 감사부장·감사부 서기
--     (전에는 부장·서기·회계가 모두 적을 수 있었고 노회 임원 전원이 볼 수 있었다)
--  2) 시찰 장부도 감사 기간에는 감사부장·서기가 볼 수 있다.
--  3) 모든 상비부에 올해 회계연도 장부를 만들어 두어 바로 쓸 수 있게 한다.
--  4) 감사부장·서기가 대시보드 <감사> 함에서 한눈에 보는 장부 목록
--     (audit_ledger_overview) — 재정부·상비부·시찰 장부의 잔액과 진행 상태.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 78_ledger_close_approval.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 그 상비부의 회계인가
--    따로 지정한 임원(committee_officers, 직책 '회계') 또는
--    상비부 명부(committees.treasurer)의 이름. 최고관리자는 복구용으로 포함.
-- ---------------------------------------------------------------------
create or replace function public.is_committee_treasurer(p_committee text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.my_role() = 'superadmin'
      or exists (
           select 1 from public.committee_officers o
            where o.user_id = auth.uid() and o.committee = p_committee
              and o.position = '회계'
         )
      or exists (
           select 1
             from public.committees c
             join public.profiles p on p.id = auth.uid()
            where c.name = p_committee
              and p.name is not null
              and split_part(btrim(coalesce(c.treasurer, '')), ' ', 1) = p.name
         );
$fn$;
grant execute on function public.is_committee_treasurer(text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. 적는 사람 / 보는 사람
-- ---------------------------------------------------------------------
create or replace function public.is_ledger_owner(p_kind text, p_owner text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_kind
           when 'committee'  then public.is_committee_treasurer(p_owner)
           when 'sichal'     then public.is_sichal_officer(p_owner)
                               or public.is_sichal_treasurer(p_owner)
           when 'presbytery' then public.is_presbytery_treasurer()
           else public.can_manage()
         end;
$fn$;
grant execute on function public.is_ledger_owner(text, text) to authenticated;

create or replace function public.can_read_ledger(p_kind text, p_owner text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_kind
           when 'presbytery' then public.is_presbytery_treasurer()
                                or public.is_presbytery_vice_treasurer()
                                or public.can_manage()
                                or (public.is_audit_reviewer() and public.audit_window_open())
           when 'committee'  then public.is_committee_officer(p_owner)      -- 부장·서기·회계 (+관리자)
                                or (public.is_audit_reviewer() and public.audit_window_open())
           else public.is_officer()
                or public.is_ledger_owner(p_kind, p_owner)
                or (public.is_audit_reviewer() and public.audit_window_open())
         end;
$fn$;
grant execute on function public.can_read_ledger(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 모든 상비부에 올해 회계연도(4월 시작) 장부를 만들어 둔다
-- ---------------------------------------------------------------------
do $mk$
declare
  fy integer := case when extract(month from (now() at time zone 'Asia/Seoul')) >= 4
                     then extract(year from (now() at time zone 'Asia/Seoul'))::integer
                     else extract(year from (now() at time zone 'Asia/Seoul'))::integer - 1 end;
begin
  insert into public.ledger_books (owner_kind, owner, year, opening_balance, updated_by)
  select 'committee', c.name, fy, 0, '재정부'
    from public.committees c
  on conflict (owner_kind, owner, year) do nothing;
  insert into public.ledger_books (owner_kind, owner, year, opening_balance, updated_by)
  values ('presbytery', '노회', fy, 0, '재정부')
  on conflict (owner_kind, owner, year) do nothing;
end
$mk$;


-- ---------------------------------------------------------------------
-- 4. 감사함 — 감사부장·서기(와 관리자)가 보는 장부 한눈에 보기
-- ---------------------------------------------------------------------
create or replace function public.audit_ledger_overview(p_year integer)
returns table (
  book_id bigint, owner_kind text, owner text, year integer,
  opening_balance bigint, income bigint, expense bigint, balance bigint,
  entries integer, receipts integer, payouts integer,
  audited_yn boolean, audit_period text, audited_at timestamptz,
  closed_yn boolean, close_requested_at timestamptz, close_requested_by text,
  close_approved_at timestamptz, close_approved_by text,
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
         b.audited_yn, b.audit_period, b.audited_at,
         b.closed_yn, b.close_requested_at, b.close_requested_by,
         b.close_approved_at, b.close_approved_by,
         case b.owner_kind when 'presbytery' then 0 when 'committee' then 100 else 200 end
           + coalesce((select c.sort from public.committees c where c.name = b.owner), 0)
           + coalesce((select s.sort::integer from public.sichals s where s.name = b.owner), 0)
    from public.ledger_books b
   where b.year = p_year
     and (public.is_audit_reviewer() or public.can_manage())
   order by 20, b.owner;
$fn$;
grant execute on function public.audit_ledger_overview(integer) to authenticated;

-- 확인:
--   select owner_kind, owner, balance, audited_yn, closed_yn from public.audit_ledger_overview(2026);

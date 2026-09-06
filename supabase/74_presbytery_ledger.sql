-- =====================================================================
--  74. 노회 재정부 회계 장부 (1단계)
--
--  노회 재정부는 교회들이 낸 상납금(상회비·세례의무금)을 받아 상비부에
--  배정합니다. 상비부와 시찰이 쓰는 회계 장부(36_audit_ledger.sql)에
--  <노회> 장부를 한 권 더 두어 재정부 회계가 씁니다.
--
--  이 파일이 하는 일
--    1) 노회 회계·부회계, 감사부장·감사부 서기, 감사 기간을 데이터베이스가
--       알아보게 한다.
--    2) 장부 종류에 presbytery(노회)를 더하고, 노회 장부는
--         · 적기   : 노회 회계·부회계
--         · 열람   : 노회 회계·부회계, 관리자(노회장·서기·간사),
--                    감사 기간의 감사부장·감사부 서기
--       만 되게 한다. (다른 임원은 볼 수 없다)
--    3) 장부 항목에 과목·연동·배정 칸을 두고, 과목 목록 표를 만든다.
--    4) 상회비 납부 → 노회 장부 수입,  세례의무금 납입 → 노회 장부 수입,
--       노회 장부의 <상비부 배정> 지출 → 그 상비부 장부 수입으로
--       저절로 적히게 한다. (연동된 항목은 원본에서만 고친다)
--    5) 이미 기록된 상회비·세례의무금 납부를 노회 장부에 채워 넣는다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 36_audit_ledger.sql, 47_bapdues.sql, 60_sichal_fee_ledger.sql 을
--     먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 누가 누구인가
-- ---------------------------------------------------------------------

-- 노회 회계·부회계 (직함에 '회계'가 든 노회 임원). 최고관리자는 복구용으로 포함.
create or replace function public.is_presbytery_treasurer()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and ((p.role = 'officer' and coalesce(p.title, '') like '%회계%')
            or p.role = 'superadmin')
  );
$fn$;
grant execute on function public.is_presbytery_treasurer() to authenticated;

-- 감사부장·감사부 서기 (감사헌의부의 부장과 서기. 회계와 부원은 아니다)
create or replace function public.is_audit_reviewer()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
           select 1 from public.committee_officers o
            where o.user_id = auth.uid() and o.committee = '감사헌의부'
              and o.position in ('부장', '서기')
         )
      or exists (
           select 1
             from public.committees c
             join public.profiles p on p.id = auth.uid()
            where c.name = '감사헌의부'
              and p.name is not null
              and (split_part(btrim(coalesce(c.head, '')),  ' ', 1) = p.name
                or split_part(btrim(coalesce(c.clerk, '')), ' ', 1) = p.name)
         );
$fn$;
grant execute on function public.is_audit_reviewer() to authenticated;

-- 감사 기간인가 — 달력대로 3월(봄)·9월(가을), 또는 관리자가 손으로 열어 둔 때
-- (js/audit-mark.js 의 windowNow 와 같은 규칙)
create or replace function public.audit_window_open()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select (value->>'open')::boolean
                     from public.site_settings where key = 'audit_window'), false)
      or extract(month from (now() at time zone 'Asia/Seoul')) in (3, 9);
$fn$;
grant execute on function public.audit_window_open() to authenticated;


-- ---------------------------------------------------------------------
-- 2. 장부 종류에 노회(presbytery)를 더한다
--    owner_kind = 'presbytery' → owner 는 '노회'
-- ---------------------------------------------------------------------
alter table public.ledger_books drop constraint if exists ledger_books_owner_kind_check;
alter table public.ledger_books
  add constraint ledger_books_owner_kind_check
  check (owner_kind in ('committee', 'sichal', 'presbytery'));

-- 적을 수 있는 사람
--   상비부 : 부장·서기·회계 / 시찰 : 시찰장·서기·회계 / 노회 : 회계·부회계
create or replace function public.is_ledger_owner(p_kind text, p_owner text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_kind
           when 'committee'  then public.is_committee_officer(p_owner)
           when 'sichal'     then public.is_sichal_officer(p_owner)
                               or public.is_sichal_treasurer(p_owner)
           when 'presbytery' then public.is_presbytery_treasurer()
           else public.can_manage()
         end;
$fn$;
grant execute on function public.is_ledger_owner(text, text) to authenticated;

-- 볼 수 있는 사람
--   노회 장부 : 회계·부회계, 관리자, 감사 기간의 감사부장·서기
--   그 밖     : 지금처럼 노회 임원 전원과 그 장부의 임원
create or replace function public.can_read_ledger(p_kind text, p_owner text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_kind
           when 'presbytery' then public.is_presbytery_treasurer()
                                or public.can_manage()
                                or (public.is_audit_reviewer() and public.audit_window_open())
           else public.is_officer() or public.is_ledger_owner(p_kind, p_owner)
         end;
$fn$;
grant execute on function public.can_read_ledger(text, text) to authenticated;

drop policy if exists ledger_books_read on public.ledger_books;
create policy ledger_books_read on public.ledger_books for select
  using (public.can_read_ledger(owner_kind, owner));

drop policy if exists ledger_entries_read on public.ledger_entries;
create policy ledger_entries_read on public.ledger_entries for select
  using (exists (select 1 from public.ledger_books b
                  where b.id = book_id and public.can_read_ledger(b.owner_kind, b.owner)));


-- ---------------------------------------------------------------------
-- 3. 항목 칸 — 과목(category 는 이미 있다), 연동, 배정
--    link_kind : dues(상회비) / bapdues(세례의무금) / alloc(재정부 배정)
--    link_id   : 원본 줄의 번호
--    alloc_to  : 노회 장부의 지출이 어느 상비부에 배정된 것인지
-- ---------------------------------------------------------------------
alter table public.ledger_entries
  add column if not exists link_kind text,
  add column if not exists link_id   bigint,
  add column if not exists alloc_to  text;
create index if not exists ledger_entries_link_idx
  on public.ledger_entries (link_kind, link_id);

-- 연동된 항목은 원본(납부 현황·노회 장부)에서만 바뀐다.
-- 연동 함수는 app.ledger_sync 표시를 켜고 들어오므로 통과한다.
create or replace function public.guard_linked_entry()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_kind text;
begin
  if current_setting('app.ledger_sync', true) = '1' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  v_kind := case when tg_op = 'INSERT' then new.link_kind else old.link_kind end;
  if coalesce(v_kind, '') <> '' then
    raise exception '% 연동 항목은 원본에서 고치거나 지워 주세요.',
      case v_kind when 'dues' then '상회비' when 'bapdues' then '세례의무금'
                  when 'alloc' then '재정부 배정' else v_kind end;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end
$fn$;

drop trigger if exists guard_linked_ledger_entries on public.ledger_entries;
create trigger guard_linked_ledger_entries
  before insert or update or delete on public.ledger_entries
  for each row execute function public.guard_linked_entry();


-- ---------------------------------------------------------------------
-- 4. 과목 목록
--    장부마다 수입·지출 과목을 둔다. 노회 장부의 기본 과목을 넣어 두고,
--    회계가 화면에서 더하거나 지운다.
-- ---------------------------------------------------------------------
create table if not exists public.ledger_categories (
  id         bigserial primary key,
  owner_kind text not null,
  owner      text not null,
  kind       text not null check (kind in ('수입', '지출')),
  name       text not null,
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  unique (owner_kind, owner, kind, name)
);
alter table public.ledger_categories enable row level security;

drop policy if exists ledger_categories_read  on public.ledger_categories;
drop policy if exists ledger_categories_write on public.ledger_categories;
create policy ledger_categories_read on public.ledger_categories for select
  using (public.can_read_ledger(owner_kind, owner));
create policy ledger_categories_write on public.ledger_categories for all
  using (public.is_ledger_owner(owner_kind, owner))
  with check (public.is_ledger_owner(owner_kind, owner));

insert into public.ledger_categories (owner_kind, owner, kind, name, sort)
select 'presbytery', '노회', k, n, s
  from (values
    ('수입', '상회비',           1), ('수입', '세례의무금',      2),
    ('수입', '총회 지원금',      3), ('수입', '찬조금',          4),
    ('수입', '이자',             5), ('수입', '기타',            9),
    ('지출', '상비부 배정',      1), ('지출', '총회 상회비',     2),
    ('지출', '총회 세례의무금',  3), ('지출', '정기노회 경비',   4),
    ('지출', '임원회 경비',      5), ('지출', '사무비',          6),
    ('지출', '인건비',           7), ('지출', '통신비',          8),
    ('지출', '인쇄비',           9), ('지출', '경조비',         10),
    ('지출', '예비비',          11), ('지출', '기타',           19)
  ) as t(k, n, s)
on conflict (owner_kind, owner, kind, name) do nothing;


-- ---------------------------------------------------------------------
-- 5. 노회 장부 찾기 (없으면 만든다)
--    감사가 끝났거나 마감된 장부면 null 을 돌려 주어, 연동이 그 장부를
--    건드리지 않게 한다.
-- ---------------------------------------------------------------------
create or replace function public.presbytery_book_for(p_year integer, p_by text)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  b public.ledger_books%rowtype;
begin
  select * into b from public.ledger_books
   where owner_kind = 'presbytery' and owner = '노회' and year = p_year;
  if b.id is null then
    insert into public.ledger_books (owner_kind, owner, year, opening_balance, updated_by)
    values ('presbytery', '노회', p_year, 0, coalesce(p_by, '재정부'))
    on conflict (owner_kind, owner, year) do nothing;
    select * into b from public.ledger_books
     where owner_kind = 'presbytery' and owner = '노회' and year = p_year;
  end if;
  if b.id is null or b.audited_yn or coalesce(b.closed_yn, false) then
    return null;
  end if;
  return b.id;
end
$fn$;

-- 연동으로 적은 항목 하나를 지운다 (감사·마감된 장부는 그대로 둔다)
create or replace function public.drop_linked_entry(p_kind text, p_id bigint)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  perform set_config('app.ledger_sync', '1', true);
  delete from public.ledger_entries e
   using public.ledger_books b
   where e.link_kind = p_kind and e.link_id = p_id
     and b.id = e.book_id and not b.audited_yn and not coalesce(b.closed_yn, false);
  perform set_config('app.ledger_sync', '0', true);
end
$fn$;


-- ---------------------------------------------------------------------
-- 6. 상회비 납부 ↔ 노회 장부 수입
--    · 납부 입력  → 그 회기 노회 장부에 수입으로 적는다
--    · 납부 취소  → 자동으로 적은 수입을 함께 지운다
--    금액 단위: 상회비는 만원, 장부는 원 — 10,000을 곱해 적는다.
--    금액이 비어 있으면 그 교회의 월 부과액으로 본다. (화면과 같은 규칙)
-- ---------------------------------------------------------------------
create or replace function public.sync_dues_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_book  bigint;
  v_amt   bigint;
  v_title text;
begin
  if tg_op = 'DELETE' then
    perform public.drop_linked_entry('dues', old.id);
    return old;
  end if;

  v_book := public.presbytery_book_for(new.year, new.entered_by);
  if v_book is null then return new; end if;

  v_amt := coalesce(new.amount,
             (select r.monthly_amount from public.dues_rates r
               where r.year = new.year and r.church = new.church limit 1), 0)::bigint * 10000;
  v_title := new.church || ' 상회비 ' || new.month || '월분';

  perform set_config('app.ledger_sync', '1', true);
  if exists (select 1 from public.ledger_entries where link_kind = 'dues' and link_id = new.id) then
    update public.ledger_entries
       set entry_date = coalesce(new.paid_on, entry_date),
           title = v_title, church = new.church, amount = v_amt,
           updated_at = now()
     where link_kind = 'dues' and link_id = new.id;
  else
    insert into public.ledger_entries
      (book_id, entry_date, kind, category, title, church, amount, note, created_by,
       link_kind, link_id)
    values
      (v_book, coalesce(new.paid_on, current_date), '수입', '상회비', v_title,
       new.church, v_amt, '상회비 납부 현황과 자동 연동', new.entered_by, 'dues', new.id);
  end if;
  perform set_config('app.ledger_sync', '0', true);
  return new;
end
$fn$;

drop trigger if exists sync_dues_to_ledger on public.dues_payments;
create trigger sync_dues_to_ledger
  after insert or update or delete on public.dues_payments
  for each row execute function public.sync_dues_to_ledger();


-- ---------------------------------------------------------------------
-- 7. 세례의무금 납입 ↔ 노회 장부 수입
--    세례의무금은 교회마다 한 해 한 줄(bapdues.paid 가 납입액)이다.
--    납입액이 0보다 크면 그 줄 하나가 수입 한 줄이 되고, 0이 되면 지운다.
--    (총회 공문 연도가 곧 회기 연도다: 2026년분 = 2026 회계연도)
-- ---------------------------------------------------------------------
create or replace function public.sync_bapdues_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_book bigint;
  v_by   text;
begin
  if tg_op = 'DELETE' or coalesce(new.paid, 0) <= 0 then
    perform public.drop_linked_entry('bapdues', case when tg_op = 'DELETE' then old.id else new.id end);
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  v_book := public.presbytery_book_for(new.year, null);
  if v_book is null then return new; end if;
  select name into v_by from public.profiles where id = auth.uid();

  perform set_config('app.ledger_sync', '1', true);
  if exists (select 1 from public.ledger_entries where link_kind = 'bapdues' and link_id = new.id) then
    update public.ledger_entries
       set entry_date = coalesce(new.paid_on, entry_date),
           title = new.church || ' 세례의무금', church = new.church, amount = new.paid,
           updated_at = now()
     where link_kind = 'bapdues' and link_id = new.id;
  else
    insert into public.ledger_entries
      (book_id, entry_date, kind, category, title, church, amount, note, created_by,
       link_kind, link_id)
    values
      (v_book, coalesce(new.paid_on, current_date), '수입', '세례의무금',
       new.church || ' 세례의무금', new.church, new.paid, '세례의무금 관리와 자동 연동',
       coalesce(v_by, '세례의무금 관리'), 'bapdues', new.id);
  end if;
  perform set_config('app.ledger_sync', '0', true);
  return new;
end
$fn$;

drop trigger if exists sync_bapdues_to_ledger on public.bapdues;
create trigger sync_bapdues_to_ledger
  after insert or update or delete on public.bapdues
  for each row execute function public.sync_bapdues_to_ledger();


-- ---------------------------------------------------------------------
-- 8. 상비부 배정 — 노회 장부 지출 ↔ 상비부 장부 수입
--    노회 장부에 지출을 적으면서 배정 상비부(alloc_to)를 고르면,
--    그 상비부의 같은 회기 장부(없으면 만든다)에 수입 <노회 지원금>으로
--    함께 적힌다. 노회 장부에서 고치거나 지우면 함께 바뀐다.
-- ---------------------------------------------------------------------
create or replace function public.sync_alloc_to_committee()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  src   public.ledger_entries%rowtype;
  sb    public.ledger_books%rowtype;
  tb    public.ledger_books%rowtype;
begin
  if tg_op = 'DELETE' then src := old; else src := new; end if;
  select * into sb from public.ledger_books where id = src.book_id;
  if sb.id is null or sb.owner_kind <> 'presbytery' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- 먼저 이전 연동을 걷어 낸다 (상비부가 바뀌었거나 배정이 풀렸을 수 있다)
  perform public.drop_linked_entry('alloc', src.id);
  if tg_op = 'DELETE' then return old; end if;
  if new.kind <> '지출' or coalesce(new.alloc_to, '') = '' then return new; end if;

  select * into tb from public.ledger_books
   where owner_kind = 'committee' and owner = new.alloc_to and year = sb.year;
  if tb.id is null then
    insert into public.ledger_books (owner_kind, owner, year, opening_balance, updated_by)
    values ('committee', new.alloc_to, sb.year, 0, coalesce(new.created_by, '재정부'))
    on conflict (owner_kind, owner, year) do nothing;
    select * into tb from public.ledger_books
     where owner_kind = 'committee' and owner = new.alloc_to and year = sb.year;
  end if;
  if tb.id is null or tb.audited_yn or coalesce(tb.closed_yn, false) then return new; end if;

  perform set_config('app.ledger_sync', '1', true);
  insert into public.ledger_entries
    (book_id, entry_date, kind, category, title, amount, note, created_by, link_kind, link_id)
  values
    (tb.id, new.entry_date, '수입', '노회 지원금',
     '재정부 배정' || case when coalesce(new.title, '') <> '' then ' — ' || new.title else '' end,
     new.amount, '노회 재정부 장부와 자동 연동', new.created_by, 'alloc', new.id);
  perform set_config('app.ledger_sync', '0', true);
  return new;
end
$fn$;

drop trigger if exists sync_alloc_to_committee on public.ledger_entries;
create trigger sync_alloc_to_committee
  after insert or update or delete on public.ledger_entries
  for each row execute function public.sync_alloc_to_committee();


-- ---------------------------------------------------------------------
-- 9. 이미 기록된 상회비·세례의무금 납부를 노회 장부에 채워 넣는다
-- ---------------------------------------------------------------------
do $bf$
declare
  f      record;
  v_book bigint;
  v_amt  bigint;
begin
  for f in
    select d.* from public.dues_payments d
     where not exists (select 1 from public.ledger_entries e
                        where e.link_kind = 'dues' and e.link_id = d.id)
     order by d.year, d.paid_on, d.id
  loop
    v_book := public.presbytery_book_for(f.year, f.entered_by);
    if v_book is null then continue; end if;
    v_amt := coalesce(f.amount,
               (select r.monthly_amount from public.dues_rates r
                 where r.year = f.year and r.church = f.church limit 1), 0)::bigint * 10000;
    perform set_config('app.ledger_sync', '1', true);
    insert into public.ledger_entries
      (book_id, entry_date, kind, category, title, church, amount, note, created_by,
       link_kind, link_id)
    values
      (v_book, coalesce(f.paid_on, current_date), '수입', '상회비',
       f.church || ' 상회비 ' || f.month || '월분', f.church, v_amt,
       '상회비 납부 현황과 자동 연동', f.entered_by, 'dues', f.id);
  end loop;

  for f in
    select b.* from public.bapdues b
     where coalesce(b.paid, 0) > 0
       and not exists (select 1 from public.ledger_entries e
                        where e.link_kind = 'bapdues' and e.link_id = b.id)
     order by b.year, b.paid_on, b.id
  loop
    v_book := public.presbytery_book_for(f.year, null);
    if v_book is null then continue; end if;
    perform set_config('app.ledger_sync', '1', true);
    insert into public.ledger_entries
      (book_id, entry_date, kind, category, title, church, amount, note, created_by,
       link_kind, link_id)
    values
      (v_book, coalesce(f.paid_on, current_date), '수입', '세례의무금',
       f.church || ' 세례의무금', f.church, f.paid, '세례의무금 관리와 자동 연동',
       '세례의무금 관리', 'bapdues', f.id);
  end loop;
end
$bf$;


-- ---------------------------------------------------------------------
-- 10. 확인
-- ---------------------------------------------------------------------
-- select b.year, e.category, count(*) as 건수, sum(e.amount) as 금액
--   from public.ledger_entries e join public.ledger_books b on b.id = e.book_id
--  where b.owner_kind = 'presbytery'
--  group by b.year, e.category order by b.year, e.category;

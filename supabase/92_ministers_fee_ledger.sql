-- =====================================================================
--  92. 시찰 교역자회 — 교역자회비와 교역자회 회계장부를 시찰회와 분리
--
--  시찰 요청(2026-09-11): 시찰회 회계 관리에서
--    · 회비 납부 현황을 <시찰회비>와 <교역자회비>로 나누고,
--    · 회계 장부도 <시찰회 회계장부>와 <교역자회 회계장부>로 따로 둔다.
--  교역자회비는 한 해에 한 번 내며, 금액은 시찰회비 1회분과 같다
--  (예: 은평교회 30만원).
--
--  하는 일
--    1) 장부 종류에 'ministers'(교역자회)를 더한다. owner 는 시찰 이름 그대로
--       (예: owner_kind 'ministers', owner '남부시찰') — 화면에서는 '남부시찰 교역자회'.
--       적는 사람·보는 사람은 시찰 장부와 같다 (시찰장·서기·회계, 노회 임원, 감사 기간의 감사부).
--    2) 회비 표(sichal_fees)에 kind 칸: 'sichal'(시찰회비, half 1·2) / 'ministers'(교역자회비, half 0).
--    3) 납부 기록 ↔ 장부 연동: 교역자회비는 교역자회 장부에 '교역자회비' 수입으로 적힌다.
--    4) 지급 확인 알림의 지급처 표기 '○○시찰 교역자회'.
--    5) 올해 교역자회 장부를 시찰마다 미리 만들어 둔다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 장부 종류 'ministers'
-- ---------------------------------------------------------------------
alter table public.ledger_books drop constraint if exists ledger_books_owner_kind_check;
alter table public.ledger_books
  add constraint ledger_books_owner_kind_check
  check (owner_kind in ('committee', 'sichal', 'presbytery', 'ministers'));

-- 적는 사람 : 교역자회 장부도 그 시찰의 시찰장·서기·회계
create or replace function public.is_ledger_owner(p_kind text, p_owner text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_kind
           when 'committee'  then public.is_committee_treasurer(p_owner)
           when 'sichal'     then public.is_sichal_officer(p_owner)
                               or public.is_sichal_treasurer(p_owner)
           when 'ministers'  then public.is_sichal_officer(p_owner)
                               or public.is_sichal_treasurer(p_owner)
           when 'presbytery' then public.is_presbytery_treasurer()
           else public.can_manage()
         end;
$fn$;
grant execute on function public.is_ledger_owner(text, text) to authenticated;

-- 보는 사람 : 시찰·교역자회 장부는 노회 임원, 그 시찰 임원, 감사 기간의 감사부
create or replace function public.can_read_ledger(p_kind text, p_owner text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_kind
           when 'presbytery' then public.is_presbytery_treasurer()
                                or public.is_presbytery_vice_treasurer()
                                or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
                                or (public.is_audit_reviewer() and public.audit_window_open())
           when 'committee'  then public.is_committee_officer(p_owner)
                                or (public.is_audit_reviewer() and public.audit_window_open())
           else public.is_officer()                       -- 시찰 · 교역자회
                or public.is_ledger_owner(p_kind, p_owner)
                or (public.is_audit_reviewer() and public.audit_window_open())
         end;
$fn$;
grant execute on function public.can_read_ledger(text, text) to authenticated;

-- 지급 확인 알림의 지급처 표기
create or replace function public.ledger_payout_fill()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  e   public.ledger_entries%rowtype;
  b   public.ledger_books%rowtype;
  n   integer;
begin
  select * into e from public.ledger_entries where id = new.entry_id;
  select * into b from public.ledger_books   where id = coalesce(new.book_id, e.book_id);
  new.book_id        := b.id;
  new.entry_date     := e.entry_date;
  new.entry_title    := e.title;
  new.entry_category := e.category;
  new.owner_label    := case b.owner_kind
                          when 'presbytery' then '노회 재정부'
                          when 'ministers'  then b.owner || ' 교역자회'
                          else b.owner
                        end;
  new.recipient      := btrim(new.recipient);
  if new.created_by is null then
    select name into new.created_by from public.profiles where id = auth.uid();
  end if;

  if new.recipient_user is null and new.roster_id is not null then
    select p.id into new.recipient_user
      from public.profiles p
     where p.roster_id = new.roster_id
       and p.role not in ('pending', 'general') and coalesce(p.suspended, false) = false
     limit 1;
  end if;
  if new.recipient_user is null then
    select count(*) into n
      from public.profiles p
     where p.name = new.recipient
       and p.role not in ('pending', 'general') and coalesce(p.suspended, false) = false
       and (new.recipient_church is null or p.church is null or p.church = new.recipient_church);
    if n = 1 then
      select p.id into new.recipient_user
        from public.profiles p
       where p.name = new.recipient
         and p.role not in ('pending', 'general') and coalesce(p.suspended, false) = false
         and (new.recipient_church is null or p.church is null or p.church = new.recipient_church);
    end if;
  end if;
  return new;
end
$fn$;


-- ---------------------------------------------------------------------
-- 2. 회비 종류 — sichal(시찰회비, 상·하반기) / ministers(교역자회비, 연 1회 = half 0)
-- ---------------------------------------------------------------------
alter table public.sichal_fees add column if not exists kind text not null default 'sichal';

alter table public.sichal_fees drop constraint if exists sichal_fees_kind_check;
alter table public.sichal_fees
  add constraint sichal_fees_kind_check check (kind in ('sichal', 'ministers'));

alter table public.sichal_fees drop constraint if exists sichal_fees_half_check;
alter table public.sichal_fees
  add constraint sichal_fees_half_check
  check ((kind = 'sichal' and half in (1, 2)) or (kind = 'ministers' and half = 0));

-- 한 교회가 같은 해에 같은 회비를 두 번 내지 않게 (종류까지 포함해 다시 건다)
alter table public.sichal_fees drop constraint if exists sichal_fees_year_sichal_church_half_key;
alter table public.sichal_fees drop constraint if exists sichal_fees_uniq;
alter table public.sichal_fees
  add constraint sichal_fees_uniq unique (year, sichal, church, kind, half);

comment on column public.sichal_fees.kind is
  '회비 종류 — sichal: 시찰회비(half 1 상반기·2 하반기) / ministers: 교역자회비(연 1회, half 0)';


-- ---------------------------------------------------------------------
-- 3. 납부 기록 ↔ 장부 연동 (60 에서 확장)
--    · 시찰회비   → 시찰회 장부(sichal)   에 '시찰회비' 수입
--    · 교역자회비 → 교역자회 장부(ministers) 에 '교역자회비' 수입
--    장부가 없으면 만들고, 감사가 끝난 장부는 건드리지 않는다.
--    금액 단위: 회비는 만원, 장부는 원 — 10,000을 곱해 적는다.
-- ---------------------------------------------------------------------
create or replace function public.sync_fee_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_book  public.ledger_books%rowtype;
  v_kind  text;
  v_cat   text;
  v_title text;
begin
  if tg_op = 'DELETE' then
    delete from public.ledger_entries e
     using public.ledger_books b
     where e.fee_id = old.id and b.id = e.book_id and not b.audited_yn;
    return old;
  end if;

  v_kind := case when new.kind = 'ministers' then 'ministers' else 'sichal' end;

  select * into v_book from public.ledger_books
   where owner_kind = v_kind and owner = new.sichal and year = new.year;
  if v_book.id is null then
    insert into public.ledger_books (owner_kind, owner, year, opening_balance, updated_by)
    values (v_kind, new.sichal, new.year, 0, new.entered_by)
    on conflict (owner_kind, owner, year) do nothing;
    select * into v_book from public.ledger_books
     where owner_kind = v_kind and owner = new.sichal and year = new.year;
  end if;
  if v_book.id is null or v_book.audited_yn then
    return new;
  end if;

  if v_kind = 'ministers' then
    v_cat   := '교역자회비';
    v_title := new.church || ' 교역자회비';
  else
    v_cat   := '시찰회비';
    v_title := new.church || ' 시찰회비 (' ||
               case when new.half = 1 then '상반기' else '하반기' end || ')';
  end if;

  if tg_op = 'INSERT' then
    insert into public.ledger_entries
      (book_id, entry_date, kind, category, title, church, amount, note, created_by, fee_id)
    values
      (v_book.id, coalesce(new.paid_on, current_date), '수입', v_cat, v_title,
       new.church, new.amount::bigint * 10000, '회비 납부 현황과 자동 연동',
       new.entered_by, new.id);
  else
    update public.ledger_entries
       set entry_date = coalesce(new.paid_on, entry_date),
           title = v_title, church = new.church, category = v_cat,
           amount = new.amount::bigint * 10000,
           updated_at = now()
     where fee_id = new.id;
  end if;
  return new;
end
$fn$;

drop trigger if exists sync_fee_to_ledger on public.sichal_fees;
create trigger sync_fee_to_ledger
  after insert or update or delete on public.sichal_fees
  for each row execute function public.sync_fee_to_ledger();


-- ---------------------------------------------------------------------
-- 4. 올해 교역자회 장부를 시찰마다 미리 만든다 (이미 있으면 그대로)
-- ---------------------------------------------------------------------
insert into public.ledger_books (owner_kind, owner, year, opening_balance, updated_by)
select 'ministers', s.name, extract(year from current_date)::integer, 0, '시스템'
  from public.sichals s
on conflict (owner_kind, owner, year) do nothing;


-- 확인
-- select owner_kind, owner, year from public.ledger_books where owner_kind in ('sichal','ministers') order by owner, owner_kind;
-- select year, sichal, church, kind, half, amount, paid_on from public.sichal_fees order by sichal, church, kind, half;

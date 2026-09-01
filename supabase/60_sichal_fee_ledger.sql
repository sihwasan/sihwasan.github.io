-- =====================================================================
--  60. 시찰회비 ↔ 회계 장부 연동
--
--  1) 회계 장부 항목에 교회명 칸을 둔다.
--  2) 회비 납부 현황에서 납부를 기록하면 그 시찰의 회계 장부에
--     수입으로 자동 기록되고, 납부를 취소하면 함께 지워진다.
--     (감사가 끝난 장부는 건드리지 않는다)
--  3) 이미 납부로 기록된 회비도 장부에 채워 넣는다.
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
--  ※ 36_audit_ledger.sql, 50_sichal_fees.sql 을 먼저 실행하셔야 합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 장부 항목에 교회명 · 회비 연동 칸
-- ---------------------------------------------------------------------
alter table public.ledger_entries
  add column if not exists church text,
  add column if not exists fee_id bigint;
create index if not exists ledger_entries_fee_idx
  on public.ledger_entries (fee_id);

-- ---------------------------------------------------------------------
-- 2. 회비 납부 ↔ 장부 자동 기록
--    · 납부 입력  → 그 해 시찰 장부(없으면 새로 만든다)에 수입으로 적는다
--    · 납부 취소  → 자동으로 적은 수입을 함께 지운다
--    · 감사가 끝난 장부는 그대로 둔다 (잠금 규칙과 충돌하지 않게)
--    금액 단위: 회비는 만원, 장부는 원 — 10,000을 곱해 적는다.
-- ---------------------------------------------------------------------
create or replace function public.sync_fee_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_book  public.ledger_books%rowtype;
  v_title text;
begin
  if tg_op = 'DELETE' then
    delete from public.ledger_entries e
     using public.ledger_books b
     where e.fee_id = old.id and b.id = e.book_id and not b.audited_yn;
    return old;
  end if;

  select * into v_book from public.ledger_books
   where owner_kind = 'sichal' and owner = new.sichal and year = new.year;
  if v_book.id is null then
    insert into public.ledger_books (owner_kind, owner, year, opening_balance, updated_by)
    values ('sichal', new.sichal, new.year, 0, new.entered_by)
    on conflict (owner_kind, owner, year) do nothing;
    select * into v_book from public.ledger_books
     where owner_kind = 'sichal' and owner = new.sichal and year = new.year;
  end if;
  if v_book.id is null or v_book.audited_yn then
    return new;
  end if;

  v_title := new.church || ' 시찰회비 (' ||
             case when new.half = 1 then '상반기' else '하반기' end || ')';

  if tg_op = 'INSERT' then
    insert into public.ledger_entries
      (book_id, entry_date, kind, category, title, church, amount, note, created_by, fee_id)
    values
      (v_book.id, coalesce(new.paid_on, current_date), '수입', '시찰회비', v_title,
       new.church, new.amount::bigint * 10000, '회비 납부 현황과 자동 연동',
       new.entered_by, new.id);
  else
    update public.ledger_entries
       set entry_date = coalesce(new.paid_on, entry_date),
           title = v_title, church = new.church,
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
-- 3. 이미 납부로 기록된 회비를 장부에 채워 넣는다
-- ---------------------------------------------------------------------
do $bf$
declare f record;
begin
  for f in
    select * from public.sichal_fees sf
     where not exists (select 1 from public.ledger_entries e where e.fee_id = sf.id)
  loop
    insert into public.ledger_books (owner_kind, owner, year, opening_balance, updated_by)
    values ('sichal', f.sichal, f.year, 0, f.entered_by)
    on conflict (owner_kind, owner, year) do nothing;

    insert into public.ledger_entries
      (book_id, entry_date, kind, category, title, church, amount, note, created_by, fee_id)
    select b.id, coalesce(f.paid_on, f.created_at::date), '수입', '시찰회비',
           f.church || ' 시찰회비 (' || case when f.half = 1 then '상반기' else '하반기' end || ')',
           f.church, f.amount::bigint * 10000, '회비 납부 현황과 자동 연동', f.entered_by, f.id
      from public.ledger_books b
     where b.owner_kind = 'sichal' and b.owner = f.sichal and b.year = f.year
       and not b.audited_yn;
  end loop;
end
$bf$;

-- ---------------------------------------------------------------------
-- 4. 회계연도 마감
--    노회 회계연도는 4월부터 다음 해 3월까지다. 장부의 year는
--    회계연도가 시작하는 해를 뜻한다. (2026 = 2026.4 ~ 2027.3)
--    마감하면 남은 돈이 다음 회계연도 이월금으로 저절로 넘어가고,
--    마감된 장부에는 더 적을 수 없다. (마감 취소는 임원이 할 수 있다)
-- ---------------------------------------------------------------------
alter table public.ledger_books
  add column if not exists closed_yn boolean not null default false,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by text;

-- 마감되었거나 감사가 끝난 장부에는 항목을 더하거나 고칠 수 없다
create or replace function public.lock_entry_when_audited()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_book bigint;
  v_aud  boolean;
  v_clo  boolean;
begin
  if tg_op = 'DELETE' then v_book := old.book_id; else v_book := new.book_id; end if;
  select b.audited_yn, b.closed_yn into v_aud, v_clo
    from public.ledger_books b where b.id = v_book;
  if coalesce(v_aud, false) then
    raise exception '감사가 끝난 회계 장부는 고치거나 지울 수 없습니다. 감사부에 문의해 주세요.';
  end if;
  if coalesce(v_clo, false) then
    raise exception '마감된 회계연도 장부입니다. 마감을 취소한 뒤 고쳐 주세요.';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end
$fn$;

-- 마감: 남은 돈을 셈해 다음 회계연도 장부(없으면 새로 만든다)의
--       이월금으로 넘기고, 이 장부를 마감 표시한다.
create or replace function public.close_ledger_year(p_book bigint)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  b     public.ledger_books%rowtype;
  nb    public.ledger_books%rowtype;
  v_bal bigint;
  v_me  text;
begin
  select * into b from public.ledger_books where id = p_book;
  if b.id is null then raise exception '장부를 찾을 수 없습니다.'; end if;
  if not public.is_ledger_owner(b.owner_kind, b.owner) then
    raise exception '이 장부를 마감할 권한이 없습니다.';
  end if;
  if b.closed_yn then raise exception '이미 마감된 장부입니다.'; end if;

  v_bal := public.ledger_balance(p_book);
  select name into v_me from public.profiles where id = auth.uid();

  select * into nb from public.ledger_books
   where owner_kind = b.owner_kind and owner = b.owner and year = b.year + 1;
  if nb.id is null then
    insert into public.ledger_books (owner_kind, owner, year, opening_balance, updated_by)
    values (b.owner_kind, b.owner, b.year + 1, v_bal, coalesce(v_me, b.updated_by));
  else
    if nb.audited_yn then
      raise exception '다음 회계연도 장부가 이미 감사를 마쳐 이월금을 바꿀 수 없습니다.';
    end if;
    update public.ledger_books
       set opening_balance = v_bal, updated_at = now(), updated_by = coalesce(v_me, updated_by)
     where id = nb.id;
  end if;

  update public.ledger_books
     set closed_yn = true, closed_at = now(), closed_by = coalesce(v_me, '회계'),
         updated_at = now()
   where id = p_book;
  return v_bal;
end
$fn$;

grant execute on function public.close_ledger_year(bigint) to authenticated;

-- 마감 취소: 잘못 마감했을 때 임원이 되돌린다 (감사가 끝났으면 안 된다)
create or replace function public.reopen_ledger_year(p_book bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  b public.ledger_books%rowtype;
begin
  select * into b from public.ledger_books where id = p_book;
  if b.id is null then raise exception '장부를 찾을 수 없습니다.'; end if;
  if not public.is_ledger_owner(b.owner_kind, b.owner) then
    raise exception '이 장부를 고칠 권한이 없습니다.';
  end if;
  if b.audited_yn then raise exception '감사가 끝난 장부는 되돌릴 수 없습니다.'; end if;
  update public.ledger_books
     set closed_yn = false, closed_at = null, closed_by = null, updated_at = now()
   where id = p_book;
end
$fn$;

grant execute on function public.reopen_ledger_year(bigint) to authenticated;

-- 확인:
--   select e.entry_date, e.church, e.title, e.amount, e.fee_id
--     from public.ledger_entries e where e.fee_id is not null order by e.id;

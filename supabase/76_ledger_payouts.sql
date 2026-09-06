-- =====================================================================
--  76. 지급 확인 — 회의비·거마비처럼 영수증이 없는 지출의 수령 확인
--
--  재정부나 상비부가 회의비·거마비를 직접 주면 영수증을 받기 어렵습니다.
--  그래서 지출 항목에 <받는 사람>을 적어 두면
--    · 받는 사람 계정에 알림이 가고,
--    · 본인이 <내 정보 → 지급 수령 확인>에서 「수령 확인」을 누르면
--  그 확인이 영수증을 대신합니다. 계정이 없는 회원은 회계가 수기로
--  확인 처리합니다. (노회는 회원 일괄 선택으로 한꺼번에 적습니다)
--
--  이 파일이 하는 일
--    1) 지급 확인 표(ledger_payouts)를 만든다.
--    2) 받는 사람 이름으로 계정을 찾아 붙이고, 항목·장부 정보를 함께
--       적어 두어 받는 사람이 장부를 못 봐도 무엇을 받았는지 알게 한다.
--    3) 계정이 있으면 알림을 보낸다. (알림함의 <바로 가기> → 내 정보)
--    4) 본인이 수령 확인을 누르는 함수(confirm_payout)를 둔다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 75_ledger_receipts.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 지급 확인 표
-- ---------------------------------------------------------------------
create table if not exists public.ledger_payouts (
  id               bigserial primary key,
  entry_id         bigint not null references public.ledger_entries on delete cascade,
  book_id          bigint not null references public.ledger_books on delete cascade,
  roster_id        bigint,                     -- 노회 명단 번호 (있으면)
  recipient        text not null,              -- 받는 사람 이름
  recipient_church text,
  recipient_user   uuid,                       -- 받는 사람 계정 (있으면)
  amount           bigint not null default 0,
  status           text not null default '대기' check (status in ('대기', '확인')),
  confirmed_at     timestamptz,
  confirmed_by     text,                       -- 본인 이름, 또는 '회계 이름 (수기)'
  confirm_note     text,                       -- 수기 확인 사유
  -- 받는 사람에게 보여 줄 항목 정보 (장부를 못 보는 사람도 알 수 있게 베껴 둔다)
  owner_label      text,                       -- 노회 재정부 / 정치부 / 북부시찰
  entry_date       date,
  entry_title      text,
  entry_category   text,
  created_by       text,
  created_at       timestamptz not null default now()
);
create index if not exists ledger_payouts_entry_idx on public.ledger_payouts (entry_id);
create index if not exists ledger_payouts_book_idx  on public.ledger_payouts (book_id);
create index if not exists ledger_payouts_user_idx  on public.ledger_payouts (recipient_user, status);

alter table public.ledger_payouts enable row level security;

drop policy if exists ledger_payouts_read   on public.ledger_payouts;
drop policy if exists ledger_payouts_insert on public.ledger_payouts;
drop policy if exists ledger_payouts_update on public.ledger_payouts;
drop policy if exists ledger_payouts_delete on public.ledger_payouts;
-- 장부를 볼 수 있는 사람과, 받는 사람 본인이 본다
create policy ledger_payouts_read on public.ledger_payouts for select
  using (public.ledger_book_readable(book_id) or recipient_user = auth.uid());
-- 적고 고치고 지우는 것은 장부를 적는 사람(잠기지 않은 장부)
create policy ledger_payouts_insert on public.ledger_payouts for insert
  with check (public.ledger_book_writable(book_id)
              and exists (select 1 from public.ledger_entries e
                           where e.id = entry_id and e.book_id = ledger_payouts.book_id));
create policy ledger_payouts_update on public.ledger_payouts for update
  using (public.ledger_book_writable(book_id))
  with check (public.ledger_book_writable(book_id));
create policy ledger_payouts_delete on public.ledger_payouts for delete
  using (public.ledger_book_writable(book_id));


-- ---------------------------------------------------------------------
-- 2. 적을 때 채워 넣는 것 — 받는 사람 계정, 항목·장부 정보
-- ---------------------------------------------------------------------
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
  new.owner_label    := case b.owner_kind when 'presbytery' then '노회 재정부' else b.owner end;
  new.recipient      := btrim(new.recipient);
  if new.created_by is null then
    select name into new.created_by from public.profiles where id = auth.uid();
  end if;

  -- 받는 사람 계정: 명단 번호로 이어진 계정 → 같은 이름(한 사람일 때만)
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

drop trigger if exists ledger_payout_fill on public.ledger_payouts;
create trigger ledger_payout_fill
  before insert on public.ledger_payouts
  for each row execute function public.ledger_payout_fill();


-- ---------------------------------------------------------------------
-- 3. 계정이 있으면 알림을 보낸다
--    알림함의 <바로 가기>가 내 정보의 「지급 수령 확인」으로 이어진다.
-- ---------------------------------------------------------------------
create or replace function public.ledger_payout_notify()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.recipient_user is null then return new; end if;
  insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
  values (
    new.recipient_user, '회계',
    '[' || coalesce(new.owner_label, '노회') || '] ' ||
      coalesce(new.entry_category, '지급') || ' ' || to_char(new.amount, 'FM999,999,999,999') ||
      '원을 지급했습니다 — 수령 확인을 눌러 주세요',
    coalesce(to_char(new.entry_date, 'YYYY.MM.DD'), '') || ' ' || coalesce(new.entry_title, '') ||
      ' 으로 ' || to_char(new.amount, 'FM999,999,999,999') || '원을 지급했습니다. ' ||
      '받으셨으면 <바로 가기>를 눌러 내 정보의 「지급 수령 확인」에서 수령 확인을 눌러 주세요. ' ||
      '이 확인이 영수증을 대신합니다.',
    'payout-' || new.id, auth.uid(), new.created_by
  );
  return new;
end
$fn$;

drop trigger if exists ledger_payout_notify on public.ledger_payouts;
create trigger ledger_payout_notify
  after insert on public.ledger_payouts
  for each row execute function public.ledger_payout_notify();


-- ---------------------------------------------------------------------
-- 4. 본인이 수령 확인을 누른다
-- ---------------------------------------------------------------------
create or replace function public.confirm_payout(p_id bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  r    public.ledger_payouts%rowtype;
  v_me text;
begin
  select * into r from public.ledger_payouts where id = p_id;
  if r.id is null then raise exception '지급 기록을 찾을 수 없습니다.'; end if;
  if r.recipient_user is distinct from auth.uid() then
    raise exception '본인만 수령 확인을 할 수 있습니다.';
  end if;
  if r.status = '확인' then return; end if;
  select name into v_me from public.profiles where id = auth.uid();
  update public.ledger_payouts
     set status = '확인', confirmed_at = now(), confirmed_by = coalesce(v_me, r.recipient)
   where id = p_id;
  -- 알림도 읽음으로
  update public.notifications
     set read_at = now()
   where user_id = auth.uid() and dedupe_key = 'payout-' || p_id and read_at is null;
end
$fn$;

grant execute on function public.confirm_payout(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- 5. 확인
-- ---------------------------------------------------------------------
-- select id, owner_label, entry_title, recipient, amount, status, confirmed_by
--   from public.ledger_payouts order by id desc limit 20;

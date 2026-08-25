-- =====================================================================
--  36. 감사 · 회계 장부
--
--  근거 : 시화산노회 규칙 (감사헌의부의 임무 / 정기노회 전 감사)
--
--  봄·가을 정기노회 전에 감사부(감사헌의부)가 감사를 시행합니다.
--  감사 대상은 네 가지입니다.
--      상비부 회의록 · 상비부 회계 장부 · 시찰 회의록 · 시찰 회계 장부
--
--  이 파일이 하는 일
--    1) 감사부장·감사부 서기의 도장(사인)을 등록할 자리를 만든다.
--    2) 상비부에도 시찰과 똑같은 회의록을 둔다.
--    3) 상비부와 시찰이 함께 쓰는 회계 장부를 만든다.
--       이월금·수입·지출을 적고, 해마다 새 장부를 쓴다.
--    4) 회의록과 회계 장부에 '감사필' 칸을 둔다.
--    5) 감사가 끝난 자료는 고치거나 지울 수 없게 잠근다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 35_sichal.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 감사부가 누구인가
--    감사는 감사헌의부가 시행한다. 부장·서기·회계가 감사부원이다.
--    (노회 관리자도 함께 처리할 수 있다)
-- ---------------------------------------------------------------------
create or replace function public.is_audit_officer()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_committee_officer('감사헌의부');
$fn$;

grant execute on function public.is_audit_officer() to authenticated;


-- ---------------------------------------------------------------------
-- 2. 감사부장·감사부 서기 도장
--    증명서 직인과 같은 곳(seals)에 함께 둔다.
--    다만 이 두 개만은 감사부원도 꺼내 쓸 수 있어야 감사필을 찍는다.
-- ---------------------------------------------------------------------
insert into public.seals (key, label, sort) values
  ('감사부장',   '감사부장 도장·사인', 5),
  ('감사부서기', '감사부 서기 도장·사인', 6)
on conflict (key) do nothing;

drop policy if exists seals_read on public.seals;
create policy seals_read on public.seals for select using (
  public.can_manage()
  or (public.is_audit_officer() and key in ('감사부장', '감사부서기'))
);

-- 도장 그림 파일도 마찬가지로 그 두 개만 열어 준다.
-- (파일 이름은 '감사부장-1234567890.png' 처럼 열쇠말로 시작한다)
drop policy if exists seals_obj_read on storage.objects;
create policy seals_obj_read on storage.objects for select using (
  bucket_id = 'seals' and (
    public.can_manage()
    or (public.is_audit_officer()
        and (name like '감사부장-%' or name like '감사부서기-%'))
  )
);


-- ---------------------------------------------------------------------
-- 3. 상비부 회의록  (시찰 회의록과 같은 모양)
-- ---------------------------------------------------------------------
create table if not exists public.committee_minutes (
  id         bigserial primary key,
  committee  text not null,
  title      text not null,             -- 예: 제19회기 제2차 부회
  met_on     date,
  place      text,
  attendees  text,
  body       text,
  access     text not null default 'member'
             check (access in ('member', 'officer')),
  file_path  text,
  file_name  text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create index if not exists committee_minutes_idx
  on public.committee_minutes (committee, met_on desc, id desc);

alter table public.committee_minutes enable row level security;

drop policy if exists committee_minutes_read  on public.committee_minutes;
drop policy if exists committee_minutes_write on public.committee_minutes;
create policy committee_minutes_read on public.committee_minutes for select using (
  public.is_committee_officer(committee)
  or public.is_audit_officer()
  or (access = 'member'  and public.is_member())
  or (access = 'officer' and public.is_officer())
);
create policy committee_minutes_write on public.committee_minutes for all
  using (public.is_committee_officer(committee))
  with check (public.is_committee_officer(committee));


-- 상비부 회의록 첨부 보관함 (비공개)
--   경로 규칙 : <상비부이름>/<파일>
insert into storage.buckets (id, name, public) values ('committee-files', 'committee-files', false)
on conflict (id) do nothing;

drop policy if exists committee_files_read   on storage.objects;
drop policy if exists committee_files_insert on storage.objects;
drop policy if exists committee_files_delete on storage.objects;

create policy committee_files_read on storage.objects for select
  using (bucket_id = 'committee-files' and public.is_member());
create policy committee_files_insert on storage.objects for insert
  with check (bucket_id = 'committee-files'
              and public.is_committee_officer(split_part(name, '/', 1)));
create policy committee_files_delete on storage.objects for delete
  using (bucket_id = 'committee-files'
         and public.is_committee_officer(split_part(name, '/', 1)));


-- 시찰 회의록도 감사부가 볼 수 있어야 한다
drop policy if exists sichal_minutes_read on public.sichal_minutes;
create policy sichal_minutes_read on public.sichal_minutes for select using (
  public.is_sichal_officer(sichal)
  or public.is_audit_officer()
  or (access = 'member'  and public.is_member())
  or (access = 'sichal'  and public.is_member() and public.my_sichal_name() = sichal)
  or (access = 'officer' and public.is_officer())
);


-- ---------------------------------------------------------------------
-- 4. 회계 장부
--    상비부와 시찰이 같은 장부를 쓴다. owner_kind 로 갈라 둔다.
--      owner_kind = 'committee' → owner 는 상비부 이름
--      owner_kind = 'sichal'    → owner 는 시찰 이름
--    한 해에 한 장부. 해가 바뀌면 새 장부를 쓰고, 지난해 잔액을
--    이월금(opening_balance)으로 옮겨 적는다.
-- ---------------------------------------------------------------------
create or replace function public.is_ledger_owner(p_kind text, p_owner text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_kind
           when 'committee' then public.is_committee_officer(p_owner)
           when 'sichal'    then public.is_sichal_officer(p_owner)
           else public.can_manage()
         end;
$fn$;

grant execute on function public.is_ledger_owner(text, text) to authenticated;

create table if not exists public.ledger_books (
  id              bigserial primary key,
  owner_kind      text not null check (owner_kind in ('committee', 'sichal')),
  owner           text not null,
  year            integer not null,
  opening_balance bigint not null default 0,   -- 이월금
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text
);
create unique index if not exists ledger_books_idx
  on public.ledger_books (owner_kind, owner, year);

alter table public.ledger_books enable row level security;

drop policy if exists ledger_books_read  on public.ledger_books;
drop policy if exists ledger_books_write on public.ledger_books;
-- 회계는 정회원이 함께 본다. 적는 것은 그 부서·시찰의 임원이 한다.
create policy ledger_books_read  on public.ledger_books for select
  using (public.is_member());
create policy ledger_books_write on public.ledger_books for all
  using (public.is_ledger_owner(owner_kind, owner))
  with check (public.is_ledger_owner(owner_kind, owner));


create table if not exists public.ledger_entries (
  id         bigserial primary key,
  book_id    bigint not null references public.ledger_books on delete cascade,
  entry_date date,
  kind       text not null check (kind in ('수입', '지출')),
  category   text,                       -- 예: 회비 / 사업비 / 교통비
  title      text not null,
  amount     bigint not null default 0 check (amount >= 0),
  note       text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ledger_entries_idx
  on public.ledger_entries (book_id, entry_date, id);

alter table public.ledger_entries enable row level security;

drop policy if exists ledger_entries_read  on public.ledger_entries;
drop policy if exists ledger_entries_write on public.ledger_entries;
create policy ledger_entries_read on public.ledger_entries for select
  using (public.is_member());
create policy ledger_entries_write on public.ledger_entries for all
  using (exists (select 1 from public.ledger_books b
                  where b.id = book_id and public.is_ledger_owner(b.owner_kind, b.owner)))
  with check (exists (select 1 from public.ledger_books b
                       where b.id = book_id and public.is_ledger_owner(b.owner_kind, b.owner)));


-- ---------------------------------------------------------------------
-- 5. 감사필 칸
--    회의록 두 가지와 회계 장부에 같은 모양으로 붙인다.
--    도장은 찍을 당시 모습 그대로 그림째 담아 둔다. 나중에 도장을
--    바꾸어도 이미 감사가 끝난 자료는 그대로 남는다.
-- ---------------------------------------------------------------------
do $add$
declare t text;
begin
  foreach t in array array['sichal_minutes', 'committee_minutes', 'ledger_books'] loop
    execute format($f$
      alter table public.%I
        add column if not exists audited_yn       boolean not null default false,
        add column if not exists audit_year       integer,
        add column if not exists audit_period     text,     -- 봄 / 가을
        add column if not exists audit_opinion    text,
        add column if not exists audit_head       text,     -- 감사부장 성명
        add column if not exists audit_clerk      text,     -- 감사부 서기 성명
        add column if not exists audit_head_seal  text,     -- 그때 찍은 도장 그림
        add column if not exists audit_clerk_seal text,
        add column if not exists audited_at       timestamptz,
        add column if not exists audited_by       text
    $f$, t);
  end loop;
end
$add$;


-- ---------------------------------------------------------------------
-- 6. 감사가 끝난 자료는 잠근다
--
--    · 지울 수 없다.
--    · 내용을 고칠 수 없다. (감사 칸만 바뀔 수 있다)
--    · 감사 표시를 푸는 일은 감사부만 할 수 있다.
--      잘못 찍은 경우를 위한 것이며, 푼 기록은 감사 기록에 남는다.
-- ---------------------------------------------------------------------
create or replace function public.lock_when_audited()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  keep text[] := array['audited_yn', 'audit_year', 'audit_period', 'audit_opinion',
                       'audit_head', 'audit_clerk', 'audit_head_seal', 'audit_clerk_seal',
                       'audited_at', 'audited_by', 'updated_at', 'updated_by'];
begin
  if tg_op = 'DELETE' then
    if old.audited_yn then
      raise exception '감사가 끝난 자료는 지울 수 없습니다. 감사부에 문의해 주세요.';
    end if;
    return old;
  end if;

  if old.audited_yn and not new.audited_yn then
    if not public.is_audit_officer() then
      raise exception '감사 표시는 감사부만 풀 수 있습니다.';
    end if;
    return new;
  end if;

  if old.audited_yn and new.audited_yn then
    if (to_jsonb(new) - keep) is distinct from (to_jsonb(old) - keep) then
      raise exception '감사가 끝난 자료는 고칠 수 없습니다. 감사부에 문의해 주세요.';
    end if;
  end if;
  return new;
end
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['sichal_minutes', 'committee_minutes', 'ledger_books'] loop
    execute format('drop trigger if exists %I on public.%I', 'lock_audited_' || t, t);
    execute format(
      'create trigger %I before update or delete on public.%I
         for each row execute function public.lock_when_audited()',
      'lock_audited_' || t, t);
  end loop;
end
$trg$;


-- 회계 장부의 낱낱 항목도 장부가 감사를 마쳤으면 함께 잠근다
create or replace function public.lock_entry_when_audited()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_book bigint;
  v_aud  boolean;
begin
  if tg_op = 'DELETE' then v_book := old.book_id; else v_book := new.book_id; end if;
  select b.audited_yn into v_aud from public.ledger_books b where b.id = v_book;
  if coalesce(v_aud, false) then
    raise exception '감사가 끝난 회계 장부는 고치거나 지울 수 없습니다. 감사부에 문의해 주세요.';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end
$fn$;

drop trigger if exists lock_audited_ledger_entries on public.ledger_entries;
create trigger lock_audited_ledger_entries
  before insert or update or delete on public.ledger_entries
  for each row execute function public.lock_entry_when_audited();


-- ---------------------------------------------------------------------
-- 7. 감사필 처리
--    감사부만 부를 수 있고, 감사 칸 말고는 아무것도 건드리지 않는다.
--    p_kind : sichal_minutes / committee_minutes / ledger_books
-- ---------------------------------------------------------------------
create or replace function public.set_audit_mark(
  p_kind       text,
  p_id         bigint,
  p_done       boolean,
  p_year       integer  default null,
  p_period     text     default null,
  p_opinion    text     default null,
  p_head       text     default null,
  p_clerk      text     default null,
  p_head_seal  text     default null,
  p_clerk_seal text     default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_me   text;
  v_what text;
begin
  if p_kind not in ('sichal_minutes', 'committee_minutes', 'ledger_books') then
    raise exception '감사할 수 없는 자료입니다.';
  end if;
  if not public.is_audit_officer() then
    raise exception '감사 처리는 감사부(감사헌의부)만 할 수 있습니다.';
  end if;

  select name into v_me from public.profiles where id = auth.uid();

  if p_done then
    execute format($f$
      update public.%I
         set audited_yn = true, audit_year = $1, audit_period = $2, audit_opinion = $3,
             audit_head = $4, audit_clerk = $5,
             audit_head_seal = $6, audit_clerk_seal = $7,
             audited_at = now(), audited_by = $8
       where id = $9
    $f$, p_kind)
    using p_year, p_period, p_opinion, p_head, p_clerk,
          p_head_seal, p_clerk_seal, coalesce(v_me, '감사부'), p_id;
    v_what := '감사필 처리';
  else
    execute format($f$
      update public.%I
         set audited_yn = false, audit_opinion = null,
             audit_head_seal = null, audit_clerk_seal = null,
             audited_at = null, audited_by = null
       where id = $1
    $f$, p_kind)
    using p_id;
    v_what := '감사 표시 해제';
  end if;

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select auth.uid(), p.email, p.name, p.role, 'update', v_what,
         p_kind || ' #' || p_id ||
         coalesce(' / ' || p_year || '년 ' || p_period, '')
    from public.profiles p where p.id = auth.uid();
end
$fn$;

grant execute on function public.set_audit_mark(
  text, bigint, boolean, integer, text, text, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 8. 지난해 잔액을 이월금으로 가져오기
--    이월금 + 수입 − 지출 이 그 해의 남은 돈이다.
-- ---------------------------------------------------------------------
create or replace function public.ledger_balance(p_book bigint)
returns bigint language sql stable security definer set search_path = public as $fn$
  select coalesce((select b.opening_balance from public.ledger_books b where b.id = p_book), 0)
       + coalesce((select sum(case when e.kind = '수입' then e.amount else -e.amount end)
                     from public.ledger_entries e where e.book_id = p_book), 0);
$fn$;

grant execute on function public.ledger_balance(bigint) to authenticated;

create or replace function public.carry_over_balance(p_book bigint)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  b     public.ledger_books%rowtype;
  v_pre bigint;
  v_bal bigint;
begin
  select * into b from public.ledger_books where id = p_book;
  if b.id is null then raise exception '장부를 찾을 수 없습니다.'; end if;
  if not public.is_ledger_owner(b.owner_kind, b.owner) then
    raise exception '이 장부를 고칠 권한이 없습니다.';
  end if;
  if b.audited_yn then
    raise exception '감사가 끝난 장부는 고칠 수 없습니다.';
  end if;

  select id into v_pre from public.ledger_books
   where owner_kind = b.owner_kind and owner = b.owner and year = b.year - 1;
  if v_pre is null then
    raise exception '지난해(%년) 장부가 없습니다.', b.year - 1;
  end if;

  v_bal := public.ledger_balance(v_pre);
  update public.ledger_books
     set opening_balance = v_bal, updated_at = now()
   where id = p_book;
  return v_bal;
end
$fn$;

grant execute on function public.carry_over_balance(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- 9. 확인
-- ---------------------------------------------------------------------
select (select count(*) from public.seals where key in ('감사부장','감사부서기')) as "감사 도장 자리",
       (select count(*) from public.committee_minutes)                            as "상비부 회의록",
       (select count(*) from public.sichal_minutes)                               as "시찰 회의록",
       (select count(*) from public.ledger_books)                                 as "회계 장부",
       (select count(*) from public.ledger_entries)                               as "회계 항목";

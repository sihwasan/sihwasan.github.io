-- =====================================================================
--  93. 시찰 교역자회 임원(회장·서기·회계) — 시찰장이 임명, 교역자회 장부는 감사 대상 아님
--
--  시찰 요청(2026-09-11)
--    · 시찰회 안에는 목사로만 이루어진 교역자회가 있고, 회장·서기·회계가 임원이다.
--    · 회장은 시찰장과 따로 정하고, 서기·회계는 보통 시찰 서기·회계가 겸하지만 바뀔 수 있다.
--    · 임명·변경은 오직 시찰장만 한다 (관리자 메뉴가 아니라 시찰 화면의 회원 명단에서).
--    · 교역자회는 목사들의 사적 모임이므로 감사를 받지 않는다.
--
--  하는 일
--    1) ministers_officers 표 — 시찰·직책마다 한 사람 (노회 명단 번호, 이름, 교회, 계정)
--    2) is_sichal_head_strict : 시찰장 판정 (관리자·superadmin 예외 없음)
--       is_ministers_officer  : 내가 그 시찰 교역자회 임원인가 (계정 → 명단 번호 → 이름 순으로 맞춤)
--       set_ministers_officer : 시찰장이 임명·해제. 한 사람은 한 직책만, 같은 직책의 앞사람은 해제.
--    3) 교역자회 장부와 교역자회비는 교역자회 임원도 적을 수 있다.
--    4) 감사 제외 — 감사함·감사 보고서 목록에서 빠지고, 감사필을 찍을 수 없으며,
--       감사 기간이라도 감사부가 열람 권한을 얻지 않는다.
--       회계연도 마감은 감사부 승인 없이 회계가 바로 하고, 마감 취소도 회계가 한다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run
--  ※ 92_ministers_fee_ledger.sql 을 먼저 실행하셔야 합니다. 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 교역자회 임원 표
-- ---------------------------------------------------------------------
create table if not exists public.ministers_officers (
  id            bigserial primary key,
  sichal        text not null,
  position      text not null check (position in ('회장', '서기', '회계')),
  roster_id     bigint,                 -- 노회 명단 번호
  name          text not null,
  church        text,
  user_id       uuid,                   -- 계정 (있으면)
  appointed_by  text,
  appointed_at  timestamptz not null default now(),
  unique (sichal, position)
);
create index if not exists ministers_officers_sichal_idx on public.ministers_officers (sichal);

alter table public.ministers_officers enable row level security;
drop policy if exists ministers_officers_read on public.ministers_officers;
create policy ministers_officers_read on public.ministers_officers for select
  using (auth.uid() is not null);
-- 쓰기는 set_ministers_officer() 함수로만 한다 (시찰장 판정을 함수가 한다)

comment on table public.ministers_officers is
  '시찰 교역자회 임원(회장·서기·회계) — 시찰장이 회원 명단의 「시찰위원 선정」에서 임명';


-- ---------------------------------------------------------------------
-- 2. 판정 함수
-- ---------------------------------------------------------------------
-- 시찰장인가 — 시찰 임원 표의 시찰장 또는 시찰 명부의 시찰장 이름. (관리자 예외 없음)
create or replace function public.is_sichal_head_strict(p_sichal text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.sichal_officers o
                  where o.user_id = auth.uid() and o.sichal = p_sichal and o.position = '시찰장')
      or exists (select 1 from public.sichals s join public.profiles p on p.id = auth.uid()
                  where s.name = p_sichal and p.name is not null
                    and split_part(btrim(coalesce(s.head, '')), ' ', 1) = p.name);
$fn$;
grant execute on function public.is_sichal_head_strict(text) to authenticated;

-- 그 시찰 교역자회 임원인가 — 계정, 명단 번호, 이름(같은 교회) 순으로 맞춘다
create or replace function public.is_ministers_officer(p_sichal text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from public.ministers_officers o
      join public.profiles p on p.id = auth.uid()
     where o.sichal = p_sichal
       and ((o.user_id is not null and o.user_id = p.id)
         or (o.roster_id is not null and p.roster_id is not null and o.roster_id = p.roster_id)
         or (o.name = p.name and (o.church is null or p.church is null or o.church = p.church)))
  );
$fn$;
grant execute on function public.is_ministers_officer(text) to authenticated;

-- 시찰장이 임명·해제한다. p_roster_id 가 없으면 그 직책을 비운다.
create or replace function public.set_ministers_officer(p_sichal text, p_position text, p_roster_id bigint default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  r      public.roster%rowtype;
  v_uid  uuid;
  v_me   text;
  v_mail text;
  v_old  text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if not public.is_sichal_head_strict(p_sichal) then
    raise exception '교역자회 임원 임명은 그 시찰의 시찰장만 할 수 있습니다.';
  end if;
  if p_position not in ('회장', '서기', '회계') then
    raise exception '직책은 회장·서기·회계 가운데 하나여야 합니다.';
  end if;
  select name, email into v_me, v_mail from public.profiles where id = auth.uid();

  -- 해제
  if p_roster_id is null then
    select name into v_old from public.ministers_officers where sichal = p_sichal and position = p_position;
    delete from public.ministers_officers where sichal = p_sichal and position = p_position;
    insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
    values (auth.uid(), v_mail, v_me, 'sichal_head', 'update', '교역자회 임원 해제',
            p_sichal || ' ' || p_position || ' — ' || coalesce(v_old, '(없음)'));
    return;
  end if;

  select * into r from public.roster where id = p_roster_id;
  if r.id is null then raise exception '노회 명단에서 찾을 수 없습니다.'; end if;
  if r.sichal is distinct from p_sichal then
    raise exception '% 님은 % 소속이 아닙니다.', r.name, p_sichal;
  end if;
  if coalesce(r.category, '') not like '%목사%' then
    raise exception '교역자회 임원은 목사 회원만 될 수 있습니다.';
  end if;

  -- 계정 찾기: 명단 번호로 이어진 계정 → 같은 이름(같은 교회 우선)
  select p.id into v_uid from public.profiles p
   where p.roster_id = r.id and p.role not in ('pending', 'general') limit 1;
  if v_uid is null then
    select p.id into v_uid from public.profiles p
     where p.name = r.name and p.role not in ('pending', 'general')
       and (p.church is null or r.church is null or p.church = r.church)
     order by (p.church = r.church) desc nulls last
     limit 1;
  end if;

  -- 한 사람은 한 직책만
  delete from public.ministers_officers
   where sichal = p_sichal and roster_id = r.id and position <> p_position;

  insert into public.ministers_officers (sichal, position, roster_id, name, church, user_id, appointed_by)
  values (p_sichal, p_position, r.id, r.name, r.church, v_uid, v_me)
  on conflict (sichal, position) do update
    set roster_id = excluded.roster_id, name = excluded.name, church = excluded.church,
        user_id = excluded.user_id, appointed_by = excluded.appointed_by, appointed_at = now();

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  values (auth.uid(), v_mail, v_me, 'sichal_head', 'update', '교역자회 임원 임명',
          p_sichal || ' ' || p_position || ' ← ' || r.name || ' (' || coalesce(r.church, '') || ')');

  -- 본인 계정이 있으면 알린다 (알림이 안 되어도 임명은 된다)
  if v_uid is not null and v_uid <> auth.uid() then
    begin
      insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
      values (v_uid, '시찰',
              '[' || p_sichal || ' 교역자회] ' || p_position || '(으)로 임명되었습니다',
              coalesce(v_me, '시찰장') || ' 시찰장이 ' || r.name || ' 님을 ' || p_sichal || ' 교역자회 ' || p_position ||
                '(으)로 임명했습니다. ' ||
                case when p_position = '회계' then '교역자회 회계장부와 교역자회비 납부 현황을 시찰회 화면의 회계 관리에서 적을 수 있습니다.'
                     else '교역자회 회계장부를 시찰회 화면의 회계 관리에서 볼 수 있습니다.' end,
              'minoff-' || p_sichal || '-' || p_position || '-' || r.id || '-' || to_char(now(), 'YYYYMMDDHH24MISS'),
              auth.uid(), v_me);
    exception when others then null;
    end;
  end if;
end
$fn$;
grant execute on function public.set_ministers_officer(text, text, bigint) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 교역자회 장부·교역자회비는 교역자회 임원도 적는다
-- ---------------------------------------------------------------------
create or replace function public.is_ledger_owner(p_kind text, p_owner text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_kind
           when 'committee'  then public.is_committee_treasurer(p_owner)
           when 'sichal'     then public.is_sichal_officer(p_owner)
                               or public.is_sichal_treasurer(p_owner)
           when 'ministers'  then public.is_sichal_officer(p_owner)
                               or public.is_sichal_treasurer(p_owner)
                               or public.is_ministers_officer(p_owner)
           when 'presbytery' then public.is_presbytery_treasurer()
           else public.can_manage()
         end;
$fn$;
grant execute on function public.is_ledger_owner(text, text) to authenticated;

-- 보는 사람 — 교역자회 장부는 감사 기간이라도 감사부에게 열리지 않는다
create or replace function public.can_read_ledger(p_kind text, p_owner text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_kind
           when 'presbytery' then public.is_presbytery_treasurer()
                                or public.is_presbytery_vice_treasurer()
                                or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
                                or (public.is_audit_reviewer() and public.audit_window_open())
           when 'committee'  then public.is_committee_officer(p_owner)
                                or (public.is_audit_reviewer() and public.audit_window_open())
           when 'ministers'  then public.is_officer()
                                or public.is_ledger_owner(p_kind, p_owner)
           else public.is_officer()                       -- 시찰
                or public.is_ledger_owner(p_kind, p_owner)
                or (public.is_audit_reviewer() and public.audit_window_open())
         end;
$fn$;
grant execute on function public.can_read_ledger(text, text) to authenticated;

drop policy if exists sichal_fees_write on public.sichal_fees;
create policy sichal_fees_write on public.sichal_fees for all
  using (public.can_manage() or public.is_sichal_officer(sichal) or public.is_sichal_treasurer(sichal)
         or (kind = 'ministers' and public.is_ministers_officer(sichal)))
  with check (public.can_manage() or public.is_sichal_officer(sichal) or public.is_sichal_treasurer(sichal)
         or (kind = 'ministers' and public.is_ministers_officer(sichal)));

-- 알림 등에 쓰는 장부 이름
create or replace function public.ledger_label(p_kind text, p_owner text)
returns text language sql immutable as $fn$
  select case p_kind
           when 'presbytery' then '노회 재정부'
           when 'ministers'  then p_owner || ' 교역자회'
           else p_owner
         end;
$fn$;


-- ---------------------------------------------------------------------
-- 4. 감사 제외
-- ---------------------------------------------------------------------
-- 감사함 목록에서 뺀다
create or replace function public.audit_ledger_overview(p_year integer)
returns table (book_id bigint, owner_kind text, owner text, year integer, opening_balance bigint,
               income bigint, expense bigint, balance bigint, entries integer, receipts integer, payouts integer,
               audited_yn boolean, audit_period text, audited_at timestamptz, closed_yn boolean,
               close_requested_at timestamptz, close_requested_by text, close_approved_at timestamptz, close_approved_by text,
               sort integer)
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
     and b.owner_kind <> 'ministers'                      -- 교역자회 장부는 감사 대상이 아니다
     and (public.is_audit_reviewer() or public.can_manage())
   order by 20, b.owner;
$fn$;
grant execute on function public.audit_ledger_overview(integer) to authenticated;

-- 감사 보고서의 장부 표에서 뺀다
create or replace function public.audit_report_ledgers(p_year integer, p_period text)
returns table (book_id bigint, owner_kind text, owner text, year integer, opening_balance bigint,
               income bigint, expense bigint, balance bigint, entries integer, receipts integer, payouts integer,
               payouts_confirmed integer, audited_yn boolean, audit_year integer, audit_period text, audit_opinion text,
               audit_head text, audit_clerk text, audit_head_seal text, audit_clerk_seal text, audited_at timestamptz,
               closed_yn boolean, close_approved_at timestamptz, close_approved_by text, close_opinion text, sort integer)
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
     and b.owner_kind <> 'ministers'                      -- 교역자회 장부는 감사 대상이 아니다
     and (public.is_officer() or public.is_audit_officer())
   order by 26, b.owner;
$fn$;
grant execute on function public.audit_report_ledgers(integer, text) to authenticated;

-- 감사필을 찍을 수 없다
create or replace function public.set_audit_mark(
  p_kind text, p_id bigint, p_done boolean,
  p_year integer default null, p_period text default null, p_opinion text default null,
  p_head text default null, p_clerk text default null, p_head_seal text default null, p_clerk_seal text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_me   text;
  v_what text;
begin
  if p_kind not in ('sichal_minutes', 'committee_minutes', 'ledger_books') then
    raise exception '감사할 수 없는 자료입니다.';
  end if;
  if p_kind = 'ledger_books'
     and exists (select 1 from public.ledger_books b where b.id = p_id and b.owner_kind = 'ministers') then
    raise exception '교역자회 장부는 감사 대상이 아닙니다.';
  end if;
  if not public.is_audit_officer() then
    raise exception '감사 처리는 감사부(감사헌의부)만 할 수 있습니다.';
  end if;
  if p_done and not public.audit_window_open() and public.my_role() <> 'superadmin' then
    raise exception '감사 기간이 아닙니다. 노회 관리자가 사이트 관리 → 감사 기간에서 날짜를 정하면 감사필 처리를 할 수 있습니다.';
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

-- 마감 승인 요청은 받지 않는다 — 회계가 바로 마감한다
create or replace function public.request_ledger_close(p_book bigint, p_note text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  b     public.ledger_books%rowtype;
  v_me  text;
  v_bal bigint;
  v_lab text;
begin
  select * into b from public.ledger_books where id = p_book;
  if b.id is null then raise exception '장부를 찾을 수 없습니다.'; end if;
  if b.owner_kind = 'ministers' then
    raise exception '교역자회 장부는 감사부 승인 없이 <회계연도 마감>을 누르면 됩니다.';
  end if;
  if not public.is_ledger_owner(b.owner_kind, b.owner) then
    raise exception '이 장부의 마감을 요청할 권한이 없습니다.';
  end if;
  if b.closed_yn then raise exception '이미 마감된 장부입니다.'; end if;
  if b.close_requested_at is not null then raise exception '이미 마감 승인을 요청한 장부입니다.'; end if;

  select name into v_me from public.profiles where id = auth.uid();
  v_bal := public.ledger_balance(p_book);
  v_lab := public.ledger_label(b.owner_kind, b.owner);

  update public.ledger_books
     set close_requested_at = now(), close_requested_by = coalesce(v_me, '회계'),
         close_requester = auth.uid(), close_request_note = nullif(btrim(coalesce(p_note, '')), ''),
         close_approved_at = null, close_approved_by = null, close_opinion = null,
         updated_at = now()
   where id = p_book;

  insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
  select u, '회계',
         '[' || v_lab || '] ' || b.year || ' 회계연도 마감 승인 요청',
         coalesce(v_me, '회계') || ' 님이 ' || b.year || ' 회계연도(' || b.year || '.4 ~ ' || (b.year + 1) ||
           '.3) 장부의 마감 승인을 요청했습니다. 남은 돈 ' || to_char(v_bal, 'FM999,999,999,999') || '원. ' ||
           (case when p_note is not null and btrim(p_note) <> '' then '요청 말씀: ' || btrim(p_note) || ' ' else '' end) ||
           '장부를 살펴보신 뒤 장부 화면에서 <회기 마감 승인> 또는 <반려>를 눌러 주세요. ' ||
           '승인하면 남은 돈이 다음 회계연도 이월금으로 넘어가고 장부가 잠깁니다.',
         public.ledger_close_key(b), auth.uid(), v_me
    from public.audit_reviewer_ids() as u;
end
$fn$;

-- 회계연도 마감 — 교역자회 장부는 승인 없이
create or replace function public.close_ledger_year(p_book bigint)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  b    public.ledger_books%rowtype;
  v_me text;
begin
  select * into b from public.ledger_books where id = p_book;
  if b.id is null then raise exception '장부를 찾을 수 없습니다.'; end if;
  if not (public.is_ledger_owner(b.owner_kind, b.owner) or public.my_role() = 'superadmin') then
    raise exception '이 장부를 마감할 권한이 없습니다.';
  end if;
  if b.close_approved_at is null and b.owner_kind <> 'ministers' and public.my_role() <> 'superadmin' then
    raise exception '회기 마감은 감사부장·서기의 승인 뒤에 됩니다. 먼저 <마감 승인 요청>을 보내 주세요.';
  end if;
  select name into v_me from public.profiles where id = auth.uid();
  return public.ledger_close_apply(p_book, coalesce(v_me, '회계'));
end
$fn$;

-- 마감 취소 — 교역자회 장부는 그 장부를 적는 사람이 되돌린다
create or replace function public.reopen_ledger_year(p_book bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  b public.ledger_books%rowtype;
begin
  select * into b from public.ledger_books where id = p_book;
  if b.id is null then raise exception '장부를 찾을 수 없습니다.'; end if;
  if b.owner_kind = 'ministers' then
    if not (public.is_ledger_owner(b.owner_kind, b.owner) or public.can_manage()) then
      raise exception '교역자회 장부의 마감 취소는 그 장부를 적는 임원이 합니다.';
    end if;
  elsif not (public.is_audit_reviewer() or public.can_manage()) then
    raise exception '마감 취소는 감사부장·감사부 서기나 노회 관리자가 합니다.';
  end if;
  if b.audited_yn then raise exception '감사가 끝난 장부는 되돌릴 수 없습니다.'; end if;
  update public.ledger_books
     set closed_yn = false, closed_at = null, closed_by = null,
         close_requested_at = null, close_requested_by = null, close_requester = null,
         close_request_note = null, close_approved_at = null, close_approved_by = null,
         updated_at = now()
   where id = p_book;
end
$fn$;

-- 확인
-- select sichal, position, name, church, user_id, appointed_by, appointed_at from public.ministers_officers order by sichal, position;

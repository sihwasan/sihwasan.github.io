-- =====================================================================
--  78. 회기 마감은 감사부의 승인으로 (5단계)
--
--  회계가 회계연도 장부를 마감하려면 먼저 <마감 승인 요청>을 보내고,
--  감사 기간에 감사부장·감사부 서기가 장부를 살핀 뒤 <회기 마감 승인>을
--  누르면 그때 남은 돈이 다음 회계연도 이월금으로 넘어가고 장부가 잠깁니다.
--  노회·상비부·시찰 장부 모두 같습니다.
--
--  이 파일이 하는 일
--    1) 장부에 마감 요청·승인 칸을 둔다.
--    2) 감사가 끝난 장부도 마감(승인)은 할 수 있게 잠금 규칙을 손본다.
--    3) 마감 요청 → 감사부장·서기에게 알림, 승인·반려 → 요청한 회계에게 알림.
--    4) 마감(이월)은 승인 함수 안에서만 일어난다. 되돌리기는 감사부·관리자만.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 77_officer_deputy_readonly.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 마감 요청·승인 칸
-- ---------------------------------------------------------------------
alter table public.ledger_books
  add column if not exists close_requested_at timestamptz,
  add column if not exists close_requested_by text,
  add column if not exists close_requester    uuid,
  add column if not exists close_request_note text,
  add column if not exists close_approved_at  timestamptz,
  add column if not exists close_approved_by  text,
  add column if not exists close_opinion      text;


-- ---------------------------------------------------------------------
-- 2. 감사가 끝난 장부는 내용을 못 고치되, 마감(승인) 칸은 바뀔 수 있다
-- ---------------------------------------------------------------------
create or replace function public.lock_when_audited()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  keep text[] := array['audited_yn', 'audit_year', 'audit_period', 'audit_opinion',
                       'audit_head', 'audit_clerk', 'audit_head_seal', 'audit_clerk_seal',
                       'audited_at', 'audited_by', 'updated_at', 'updated_by',
                       'closed_yn', 'closed_at', 'closed_by',
                       'close_requested_at', 'close_requested_by', 'close_requester',
                       'close_request_note', 'close_approved_at', 'close_approved_by',
                       'close_opinion'];
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


-- ---------------------------------------------------------------------
-- 3. 누구에게 알리나 — 감사부장·감사부 서기의 계정
-- ---------------------------------------------------------------------
create or replace function public.audit_reviewer_ids()
returns setof uuid language sql stable security definer set search_path = public as $fn$
  select o.user_id from public.committee_officers o
   where o.committee = '감사헌의부' and o.position in ('부장', '서기')
  union
  select p.id
    from public.committees c
    join public.profiles p on p.name is not null
     and (split_part(btrim(coalesce(c.head, '')),  ' ', 1) = p.name
       or split_part(btrim(coalesce(c.clerk, '')), ' ', 1) = p.name)
   where c.name = '감사헌의부'
     and p.role not in ('pending', 'general') and coalesce(p.suspended, false) = false;
$fn$;

-- 장부 이름표: 노회 재정부 / 정치부 / 북부시찰
create or replace function public.ledger_label(p_kind text, p_owner text)
returns text language sql immutable as $fn$
  select case p_kind when 'presbytery' then '노회 재정부' else p_owner end;
$fn$;

-- 알림의 <바로 가기>가 그 장부 화면으로 이어지도록 열쇠말에 장부 정보를 담는다
create or replace function public.ledger_close_key(b public.ledger_books)
returns text language sql immutable as $fn$
  select 'lclose-' || b.id || '-' || b.owner_kind || '-' || b.owner;
$fn$;


-- ---------------------------------------------------------------------
-- 4. 마감 적용 (권한 검사 없음 — 승인 함수 안에서만 부른다)
--    남은 돈을 셈해 다음 회계연도 장부(없으면 만든다)의 이월금으로 넘기고
--    이 장부를 마감 표시한다.
-- ---------------------------------------------------------------------
create or replace function public.ledger_close_apply(p_book bigint, p_by text)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  b     public.ledger_books%rowtype;
  nb    public.ledger_books%rowtype;
  v_bal bigint;
begin
  select * into b from public.ledger_books where id = p_book;
  if b.id is null then raise exception '장부를 찾을 수 없습니다.'; end if;
  if b.closed_yn then raise exception '이미 마감된 장부입니다.'; end if;

  v_bal := public.ledger_balance(p_book);

  select * into nb from public.ledger_books
   where owner_kind = b.owner_kind and owner = b.owner and year = b.year + 1;
  if nb.id is null then
    insert into public.ledger_books (owner_kind, owner, year, opening_balance, updated_by)
    values (b.owner_kind, b.owner, b.year + 1, v_bal, coalesce(p_by, b.updated_by));
  else
    if nb.audited_yn then
      raise exception '다음 회계연도 장부가 이미 감사를 마쳐 이월금을 바꿀 수 없습니다.';
    end if;
    update public.ledger_books
       set opening_balance = v_bal, updated_at = now(), updated_by = coalesce(p_by, updated_by)
     where id = nb.id;
  end if;

  update public.ledger_books
     set closed_yn = true, closed_at = now(), closed_by = coalesce(p_by, '감사부'),
         updated_at = now()
   where id = p_book;
  return v_bal;
end
$fn$;


-- ---------------------------------------------------------------------
-- 5. 회계: 마감 승인 요청 / 요청 취소
-- ---------------------------------------------------------------------
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
grant execute on function public.request_ledger_close(bigint, text) to authenticated;

create or replace function public.cancel_ledger_close_request(p_book bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  b public.ledger_books%rowtype;
begin
  select * into b from public.ledger_books where id = p_book;
  if b.id is null then raise exception '장부를 찾을 수 없습니다.'; end if;
  if not (public.is_ledger_owner(b.owner_kind, b.owner) or public.is_audit_reviewer() or public.can_manage()) then
    raise exception '이 장부의 마감 요청을 취소할 권한이 없습니다.';
  end if;
  if b.closed_yn then raise exception '이미 마감된 장부입니다.'; end if;
  update public.ledger_books
     set close_requested_at = null, close_requested_by = null, close_requester = null,
         close_request_note = null, updated_at = now()
   where id = p_book;
end
$fn$;
grant execute on function public.cancel_ledger_close_request(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- 6. 감사부장·서기: 회기 마감 승인 / 반려
--    감사 기간(3·9월 또는 관리자가 연 때)에만 할 수 있다.
-- ---------------------------------------------------------------------
create or replace function public.approve_ledger_close(p_book bigint, p_opinion text default null)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  b     public.ledger_books%rowtype;
  v_me  text;
  v_bal bigint;
  v_lab text;
begin
  select * into b from public.ledger_books where id = p_book;
  if b.id is null then raise exception '장부를 찾을 수 없습니다.'; end if;
  if not (public.is_audit_reviewer() or public.my_role() = 'superadmin') then
    raise exception '회기 마감 승인은 감사부장·감사부 서기가 합니다.';
  end if;
  if not (public.audit_window_open() or public.my_role() = 'superadmin') then
    raise exception '감사 기간이 아닙니다. 노회 관리자가 감사 기간을 열어 두면 승인할 수 있습니다.';
  end if;
  if b.closed_yn then raise exception '이미 마감된 장부입니다.'; end if;
  if b.close_requested_at is null then
    raise exception '회계의 마감 승인 요청이 아직 없습니다.';
  end if;

  select name into v_me from public.profiles where id = auth.uid();
  v_lab := public.ledger_label(b.owner_kind, b.owner);

  update public.ledger_books
     set close_approved_at = now(), close_approved_by = coalesce(v_me, '감사부'),
         close_opinion = nullif(btrim(coalesce(p_opinion, '')), ''), updated_at = now()
   where id = p_book;

  v_bal := public.ledger_close_apply(p_book, coalesce(v_me, '감사부'));

  if b.close_requester is not null then
    insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
    values (b.close_requester, '회계',
      '[' || v_lab || '] ' || b.year || ' 회계연도 마감이 승인되었습니다',
      coalesce(v_me, '감사부') || ' 님이 마감을 승인했습니다. 남은 돈 ' || to_char(v_bal, 'FM999,999,999,999') ||
        '원이 ' || (b.year + 1) || ' 회계연도 이월금으로 넘어갔고 장부는 잠겼습니다.' ||
        (case when p_opinion is not null and btrim(p_opinion) <> '' then ' 의견: ' || btrim(p_opinion) else '' end),
      public.ledger_close_key(b) || '-ok', auth.uid(), v_me);
  end if;
  return v_bal;
end
$fn$;
grant execute on function public.approve_ledger_close(bigint, text) to authenticated;

create or replace function public.reject_ledger_close(p_book bigint, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  b    public.ledger_books%rowtype;
  v_me text;
  v_lab text;
begin
  select * into b from public.ledger_books where id = p_book;
  if b.id is null then raise exception '장부를 찾을 수 없습니다.'; end if;
  if not (public.is_audit_reviewer() or public.my_role() = 'superadmin') then
    raise exception '마감 반려는 감사부장·감사부 서기가 합니다.';
  end if;
  if b.close_requested_at is null then raise exception '마감 승인 요청이 없습니다.'; end if;

  select name into v_me from public.profiles where id = auth.uid();
  v_lab := public.ledger_label(b.owner_kind, b.owner);

  update public.ledger_books
     set close_requested_at = null, close_requested_by = null, close_requester = null,
         close_request_note = null, close_opinion = nullif(btrim(coalesce(p_reason, '')), ''),
         updated_at = now()
   where id = p_book;

  if b.close_requester is not null then
    insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
    values (b.close_requester, '회계',
      '[' || v_lab || '] ' || b.year || ' 회계연도 마감 요청이 반려되었습니다',
      coalesce(v_me, '감사부') || ' 님이 마감 요청을 반려했습니다.' ||
        (case when p_reason is not null and btrim(p_reason) <> '' then ' 사유: ' || btrim(p_reason) else '' end) ||
        ' 장부를 고친 뒤 다시 마감 승인을 요청해 주세요.',
      public.ledger_close_key(b) || '-no', auth.uid(), v_me);
  end if;
end
$fn$;
grant execute on function public.reject_ledger_close(bigint, text) to authenticated;


-- ---------------------------------------------------------------------
-- 7. 예전 마감 함수는 승인이 있어야만 통한다 / 되돌리기는 감사부·관리자만
-- ---------------------------------------------------------------------
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
  if b.close_approved_at is null and public.my_role() <> 'superadmin' then
    raise exception '회기 마감은 감사부장·서기의 승인 뒤에 됩니다. 먼저 <마감 승인 요청>을 보내 주세요.';
  end if;
  select name into v_me from public.profiles where id = auth.uid();
  return public.ledger_close_apply(p_book, coalesce(v_me, '회계'));
end
$fn$;
grant execute on function public.close_ledger_year(bigint) to authenticated;

create or replace function public.reopen_ledger_year(p_book bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  b public.ledger_books%rowtype;
begin
  select * into b from public.ledger_books where id = p_book;
  if b.id is null then raise exception '장부를 찾을 수 없습니다.'; end if;
  if not (public.is_audit_reviewer() or public.can_manage()) then
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
grant execute on function public.reopen_ledger_year(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- 8. 확인
-- ---------------------------------------------------------------------
-- select id, owner_kind, owner, year, closed_yn, close_requested_at, close_requested_by,
--        close_approved_at, close_approved_by from public.ledger_books order by owner_kind, owner, year;

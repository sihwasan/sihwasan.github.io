-- =====================================================================
--  31. 증명서 발급 (신청 → 서기 발급 → 신청자가 PDF로 내려받기)
--
--  지금까지는 발급한 증명서가 서기 컴퓨터(브라우저)에만 남아서
--  신청자가 받을 수 없었습니다. 이제는 발급한 증명서를 노회 서버에
--  보관하고, 신청자가 홈페이지에서 바로 열어 PDF로 저장합니다.
--
--  · 발급번호는 회기별로 자동 채번합니다. (예: 시화산노 제19-001호)
--  · 발급 즉시 신청 건이 발급완료로 바뀌고 신청자에게 알림이 갑니다.
--  · 직인은 발급 당시 모습 그대로 증명서에 박아 보관하므로,
--    나중에 직인을 바꾸어도 이미 발급한 증명서는 그대로 유지됩니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 발급한 증명서 보관
-- ---------------------------------------------------------------------
create table if not exists public.doc_issues (
  id           bigserial primary key,
  request_id   bigint references public.doc_requests on delete set null,
  user_id      uuid references auth.users on delete set null,  -- 신청자(수령인)
  session_no   int  not null default 19,                       -- 회기
  seq          int  not null,                                  -- 회기 안에서의 순번
  doc_no       text not null,                                  -- 시화산노 제19-001호
  doc_type     text not null,
  name         text not null,
  position     text,
  church       text,
  purpose      text,
  copies       int  not null default 1,
  body_text    text,                                           -- 증명 문구
  issuer_name  text,                                           -- 발급 처리자 (예: 홍길동 (서기 대행))
  president    text,                                           -- 발급 명의 (노회장)
  seals        jsonb not null default '{}'::jsonb,             -- 발급 당시 날인 모습
  issued_on    date not null default current_date,
  void_yn      boolean not null default false,                 -- 취소(무효) 여부
  void_reason  text,
  created_at   timestamptz not null default now()
);

create unique index if not exists doc_issues_no_idx  on public.doc_issues (doc_no);
create index if not exists doc_issues_user_idx       on public.doc_issues (user_id, created_at desc);
create index if not exists doc_issues_req_idx        on public.doc_issues (request_id);

alter table public.doc_issues enable row level security;

drop policy if exists doc_issues_self  on public.doc_issues;
drop policy if exists doc_issues_admin on public.doc_issues;

-- 신청자는 본인이 받은 증명서만 열람
create policy doc_issues_self on public.doc_issues for select
  using (user_id = auth.uid());
-- 관리자(노회장·서기·간사)는 전체 열람·처리
create policy doc_issues_admin on public.doc_issues for all
  using (public.can_manage()) with check (public.can_manage());


-- ---------------------------------------------------------------------
-- 2. 증명서 발급
--    발급번호 채번 · 보관 · 신청 상태 변경 · 신청자 알림을 한 번에 한다.
-- ---------------------------------------------------------------------
create or replace function public.issue_document(
  p_request_id  bigint,
  p_doc_type    text,
  p_name        text,
  p_position    text,
  p_church      text,
  p_purpose     text,
  p_copies      int,
  p_body_text   text,
  p_seals       jsonb,
  p_president   text,
  p_session_no  int
)
returns public.doc_issues
language plpgsql security definer set search_path = public as $fn$
declare
  v_session int := coalesce(p_session_no, 19);
  v_seq     int;
  v_no      text;
  v_user    uuid;
  v_me      text;
  v_row     public.doc_issues;
begin
  if not public.can_manage() then
    raise exception '증명서 발급 권한이 없습니다. 서기에게 문의해 주세요.';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_church), '') = '' then
    raise exception '대상자 성명과 소속 교회를 입력해 주세요.';
  end if;

  select name into v_me from public.profiles where id = auth.uid();

  -- 같은 회기에서 발급번호가 겹치지 않도록 잠근다
  perform pg_advisory_xact_lock(hashtext('shs_doc_issue_' || v_session));
  select coalesce(max(seq), 0) + 1 into v_seq
    from public.doc_issues where session_no = v_session;
  v_no := '시화산노 제' || v_session || '-' || lpad(v_seq::text, 3, '0') || '호';

  -- 신청서에서 온 발급이면 신청자를 수령인으로 연결한다
  if p_request_id is not null then
    select user_id into v_user from public.doc_requests where id = p_request_id;
  end if;

  insert into public.doc_issues (
    request_id, user_id, session_no, seq, doc_no, doc_type, name, position,
    church, purpose, copies, body_text, issuer_name, president, seals)
  values (
    p_request_id, v_user, v_session, v_seq, v_no, p_doc_type, p_name, p_position,
    p_church, p_purpose, greatest(coalesce(p_copies, 1), 1), p_body_text,
    coalesce(v_me, '노회 사무실'), p_president, coalesce(p_seals, '{}'::jsonb))
  returning * into v_row;

  -- 신청 건을 발급완료로 바꾸고 신청자에게 알린다
  if p_request_id is not null then
    update public.doc_requests
       set status = '발급완료',
           handled_by = coalesce(v_me, '노회 사무실'),
           updated_at = now()
     where id = p_request_id;

    if v_user is not null then
      insert into public.notifications (user_id, kind, title, body)
      values (v_user, '서류',
              '신청하신 ' || p_doc_type || '가 발급되었습니다',
              '발급번호 ' || v_no || E'\n' ||
              '서류발급 화면의 내 신청 내역에서 증명서를 열어 PDF로 저장하실 수 있습니다.');
    end if;
  end if;

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select auth.uid(), p.email, p.name, p.role, 'issue', '증명서 발급',
         v_no || ' ' || p_doc_type || ' (대상 ' || p_name || ', ' || p_church || ')'
    from public.profiles p where p.id = auth.uid();

  return v_row;
end;
$fn$;

grant execute on function public.issue_document(
  bigint, text, text, text, text, text, int, text, jsonb, text, int) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 발급 취소 (잘못 발급한 경우 무효로 표시한다. 기록은 남긴다)
-- ---------------------------------------------------------------------
create or replace function public.void_document(p_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_no text;
begin
  if not public.can_manage() then
    raise exception '발급 취소 권한이 없습니다.';
  end if;
  update public.doc_issues
     set void_yn = true, void_reason = p_reason
   where id = p_id
  returning doc_no into v_no;

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select auth.uid(), p.email, p.name, p.role, 'update', '증명서 발급 취소',
         coalesce(v_no, p_id::text) || ' / 사유: ' || coalesce(p_reason, '-')
    from public.profiles p where p.id = auth.uid();
end;
$fn$;

grant execute on function public.void_document(bigint, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 확인
-- ---------------------------------------------------------------------
select doc_no as "발급번호", doc_type as "서류", name as "대상자",
       church as "교회", issued_on as "발급일", issuer_name as "발급자"
  from public.doc_issues
 order by id desc
 limit 20;

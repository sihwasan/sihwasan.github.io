-- =====================================================================
--  33. 증명서 발급번호 표기 변경 (시화산노 → 시화산)
--
--  발급번호를 "시화산노 제19-001호"에서 "시화산 제19-001호"로 바꿉니다.
--  · 앞으로 발급하는 증명서부터 새 표기로 채번됩니다.
--  · 이미 발급된 증명서의 발급번호도 같은 표기로 함께 정리합니다.
--    (회기·순번은 그대로이므로 발급 대장의 연속성은 유지됩니다)
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 발급 함수의 채번 표기를 바꾼다
--    (31_doc_issue.sql 의 issue_document 와 동일하며, 발급번호 문구만 다름)
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
  v_no := '시화산 제' || v_session || '-' || lpad(v_seq::text, 3, '0') || '호';

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
-- 2. 이미 발급된 증명서의 발급번호도 같은 표기로 정리한다
-- ---------------------------------------------------------------------
update public.doc_issues
   set doc_no = replace(doc_no, '시화산노 제', '시화산 제')
 where doc_no like '시화산노 제%';


-- ---------------------------------------------------------------------
-- 3. 확인
-- ---------------------------------------------------------------------
select doc_no as "발급번호", doc_type as "서류", name as "대상자", issued_on as "발급일"
  from public.doc_issues
 order by id desc
 limit 20;

-- =====================================================================
--  159. 서류 발급 승인 때 발급번호 정하기
--
--  발급번호는 지금까지 홈페이지가 회기별로 자동으로 이어 붙였습니다.
--  그런데 사무실에서 손으로 내는 서류도 같은 대장의 번호를 쓰므로,
--  홈페이지 번호와 사무실 번호가 겹칠 수 있습니다.
--
--  이제 서기(또는 노회장)가 <발급 승인>을 누를 때 발급번호를 확인하고
--  고칠 수 있습니다.
--    · 승인 창에 자동으로 이어지는 다음 번호가 미리 들어 있습니다.
--      사무실 대장에서 이미 쓴 번호면 그 자리에서 고칩니다.
--    · 정한 번호는 신청 건에 붙어 있다가, <증명서 발급> 때 그 번호로 발급됩니다.
--    · 이미 발급한 번호, 다른 신청에 정해 둔 번호는 저장되지 않습니다.
--    · 번호를 비우면 종전처럼 발급할 때 자동으로 붙습니다.
--    · 승인한 뒤 발급하기 전까지는 <번호 수정>으로 다시 고칠 수 있습니다.
--      (발급한 뒤에는 종이 문서와 어긋나지 않도록 고칠 수 없습니다 — 종전과 같음)
--
--  이 파일은 새 표 하나와 함수 하나만 만듭니다.
--  발급 함수(issue_document)·승인 함수(approve_doc_request)는 고치지 않습니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다.
--  ※ 실행하기 전에는 홈페이지가 번호 지정 없이 종전처럼 승인합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 신청 건에 정해 둔 발급번호
--    (신청서 표에 칸을 더하지 않고 따로 둔다 — 신청자가 자기 신청을
--     넣거나 고치면서 번호를 건드릴 수 없게 하려는 것)
-- ---------------------------------------------------------------------
create table if not exists public.doc_request_nos (
  request_id  bigint primary key references public.doc_requests on delete cascade,
  doc_no      text not null,
  set_by      text,
  set_at      timestamptz not null default now()
);

alter table public.doc_request_nos enable row level security;

-- 관리자(노회장·서기·간사)는 읽기만. 쓰기는 아래 함수로만 한다.
drop policy if exists doc_request_nos_read on public.doc_request_nos;
create policy doc_request_nos_read on public.doc_request_nos for select
  using (public.can_manage());

revoke insert, update, delete on public.doc_request_nos from anon, authenticated;
grant select on public.doc_request_nos to authenticated;


-- ---------------------------------------------------------------------
-- 2. 발급번호 정하기 · 고치기 · 지우기 (서기·노회장·최고관리자)
--    p_doc_no 를 비우면 정해 둔 번호를 지운다 (발급할 때 자동으로 붙는다).
-- ---------------------------------------------------------------------
create or replace function public.set_doc_request_no(p_id bigint, p_doc_no text)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_no     text := nullif(regexp_replace(btrim(coalesce(p_doc_no, '')), '\s+', ' ', 'g'), '');
  v_key    text;
  v_status text;
  v_me     text;
begin
  if not public.can_manage()
     or coalesce(public.my_role(), '') not in ('clerk', 'president', 'superadmin') then
    raise exception '발급번호는 서기·노회장만 정할 수 있습니다.';
  end if;

  select status into v_status from public.doc_requests where id = p_id;
  if not found then
    raise exception '신청 건을 찾을 수 없습니다.';
  end if;
  if v_status = '반려' then
    raise exception '반려한 신청에는 발급번호를 정할 수 없습니다.';
  end if;
  if exists (select 1 from public.doc_issues i
              where i.request_id = p_id and not coalesce(i.void_yn, false)) then
    raise exception '이미 증명서를 발급한 신청입니다. 발급한 뒤에는 번호를 고칠 수 없습니다.';
  end if;

  select name into v_me from public.profiles where id = auth.uid();

  -- 번호를 비우면 자동 번호로 되돌린다
  if v_no is null then
    delete from public.doc_request_nos where request_id = p_id;
    return null;
  end if;
  if length(v_no) > 60 then
    raise exception '발급번호가 너무 깁니다.';
  end if;

  -- 두 사람이 같은 번호를 동시에 정하지 못하게 잠근다
  perform pg_advisory_xact_lock(hashtext('shs_doc_request_no'));

  -- 띄어쓰기만 다른 번호도 같은 번호로 본다 (시화산노 제20-001호 = 시화산노 제 20-001 호)
  v_key := regexp_replace(v_no, '\s', '', 'g');

  if exists (select 1 from public.doc_issues i
              where regexp_replace(i.doc_no, '\s', '', 'g') = v_key) then
    raise exception '% 는 이미 발급 대장에 있는 번호입니다. 다른 번호를 적어 주세요.', v_no;
  end if;
  if exists (select 1
               from public.doc_request_nos n
               join public.doc_requests q on q.id = n.request_id
              where n.request_id <> p_id
                and q.status <> '반려'
                and regexp_replace(n.doc_no, '\s', '', 'g') = v_key) then
    raise exception '% 는 다른 신청 건에 이미 정해 둔 번호입니다. 다른 번호를 적어 주세요.', v_no;
  end if;

  insert into public.doc_request_nos (request_id, doc_no, set_by, set_at)
  values (p_id, v_no, coalesce(v_me, '서기'), now())
  on conflict (request_id) do update
    set doc_no = excluded.doc_no, set_by = excluded.set_by, set_at = excluded.set_at;

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select auth.uid(), p.email, p.name, p.role, 'update', '서류 발급번호 지정',
         '신청번호 ' || p_id || ' → ' || v_no
    from public.profiles p where p.id = auth.uid();

  return v_no;
end;
$fn$;

revoke all on function public.set_doc_request_no(bigint, text) from public, anon;
grant execute on function public.set_doc_request_no(bigint, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 확인 — 정해 둔 번호 (처음에는 0줄)
-- ---------------------------------------------------------------------
select n.request_id as "신청번호", q.name as "신청자", q.doc_type as "서류",
       q.status as "상태", n.doc_no as "정한 발급번호", n.set_by as "정한 사람", n.set_at as "정한 때"
  from public.doc_request_nos n
  join public.doc_requests q on q.id = n.request_id
 order by n.set_at desc
 limit 20;

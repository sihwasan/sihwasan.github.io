-- =====================================================================
--  32. 서류 발급 사실을 노회장에게 알림 + 텔레그램 알림함
--
--  · 서기(또는 간사)가 증명서를 발급하면 노회장에게 알림이 갑니다.
--    노회장이 직접 발급한 경우에는 자기 자신에게 보내지 않습니다.
--  · 서류 신청이 들어오면 관리자 모두에게 알림이 갑니다.
--  · 텔레그램으로 보낼 알림은 outbox 표에 쌓아 두고,
--    사무실 컴퓨터의 알림 봇이 가져가 보냅니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다.
--  ※ 31_doc_issue.sql 을 먼저 실행하셔야 합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 텔레그램으로 보낼 알림 보관함
--    사무실 컴퓨터의 봇이 이 표를 살펴 아직 보내지 않은 것을 보냅니다.
-- ---------------------------------------------------------------------
create table if not exists public.telegram_outbox (
  id         bigserial primary key,
  kind       text not null,            -- 서류신청 / 서류발급 / 임원교체 / 알림
  title      text not null,
  body       text,
  sent_at    timestamptz,              -- 보낸 시각 (비어 있으면 아직 안 보냄)
  created_at timestamptz not null default now()
);

create index if not exists telegram_outbox_pending_idx
  on public.telegram_outbox (sent_at, id);

alter table public.telegram_outbox enable row level security;

drop policy if exists telegram_outbox_admin on public.telegram_outbox;
-- 관리자(노회장·서기·간사)만 보고 처리할 수 있다
create policy telegram_outbox_admin on public.telegram_outbox for all
  using (public.can_manage()) with check (public.can_manage());


-- ---------------------------------------------------------------------
-- 2. 서류 신청이 들어오면 관리자에게 알린다
-- ---------------------------------------------------------------------
create or replace function public.on_doc_request()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  -- 홈페이지 알림함: 노회장·서기·간사 모두에게
  insert into public.notifications (user_id, kind, title, body)
  select p.id, '서류',
         new.name || ' 님의 ' || new.doc_type || ' 신청',
         '소속 ' || coalesce(new.church, '-') || E'\n' ||
         '용도 ' || coalesce(new.purpose, '-') || ' / ' || new.copies || '부' ||
         case when coalesce(new.memo, '') <> '' then E'\n요청사항 ' || new.memo else '' end
    from public.profiles p
   where p.role in ('president', 'clerk', 'staff')
     and coalesce(p.suspended, false) = false;

  -- 텔레그램 관리자 방으로 보낼 알림
  insert into public.telegram_outbox (kind, title, body)
  values ('서류신청',
          '📄 서류 신청이 들어왔습니다',
          new.name || ' (' || coalesce(new.church, '-') || ')' || E'\n' ||
          '서류: ' || new.doc_type || ' / 용도: ' || coalesce(new.purpose, '-') ||
          ' / ' || new.copies || '부' ||
          case when coalesce(new.memo, '') <> '' then E'\n요청사항: ' || new.memo else '' end ||
          E'\n\n임원방 → 서류 발급 화면에서 처리해 주세요.');

  return new;
end;
$fn$;

drop trigger if exists doc_request_notify on public.doc_requests;
create trigger doc_request_notify
  after insert on public.doc_requests
  for each row execute function public.on_doc_request();


-- ---------------------------------------------------------------------
-- 3. 증명서를 발급하면 노회장에게 알린다
-- ---------------------------------------------------------------------
create or replace function public.on_doc_issue()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_issuer uuid := auth.uid();
begin
  -- 노회장에게 (본인이 발급한 경우는 빼고)
  insert into public.notifications (user_id, kind, title, body)
  select p.id, '서류',
         '증명서가 발급되었습니다 (' || new.doc_no || ')',
         new.doc_type || ' / 대상 ' || new.name || ' (' || coalesce(new.church, '-') || ')' || E'\n' ||
         '용도 ' || coalesce(new.purpose, '-') || E'\n' ||
         '발급 ' || coalesce(new.issuer_name, '-')
    from public.profiles p
   where p.role = 'president'
     and coalesce(p.suspended, false) = false
     and (v_issuer is null or p.id <> v_issuer);

  insert into public.telegram_outbox (kind, title, body)
  values ('서류발급',
          '✅ 증명서를 발급했습니다',
          new.doc_no || ' ' || new.doc_type || E'\n' ||
          '대상: ' || new.name || ' (' || coalesce(new.church, '-') || ')' || E'\n' ||
          '용도: ' || coalesce(new.purpose, '-') || E'\n' ||
          '발급: ' || coalesce(new.issuer_name, '-') || E'\n\n' ||
          '신청자가 홈페이지에서 PDF로 내려받을 수 있습니다.');

  return new;
end;
$fn$;

drop trigger if exists doc_issue_notify on public.doc_issues;
create trigger doc_issue_notify
  after insert on public.doc_issues
  for each row execute function public.on_doc_issue();


-- ---------------------------------------------------------------------
-- 4. 노회장·서기가 바뀌면 알린다 (텔레그램 봇이 인수인계를 안내한다)
-- ---------------------------------------------------------------------
create or replace function public.on_role_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_label text;
begin
  if coalesce(old.role, '') = coalesce(new.role, '') then
    return new;
  end if;

  v_label := case new.role
    when 'president' then '노회장'
    when 'clerk'     then '서기'
    when 'staff'     then '간사'
    else null end;

  -- 새로 임원이 된 경우
  if v_label is not null then
    insert into public.telegram_outbox (kind, title, body)
    values ('임원교체',
            '🔔 ' || v_label || '이(가) 새로 정해졌습니다',
            coalesce(new.name, '(이름 없음)') || ' (' || coalesce(new.church, '-') || ')' ||
            ' 님이 ' || v_label || '을(를) 맡으셨습니다.');
  end if;

  -- 임원에서 물러난 경우
  v_label := case old.role
    when 'president' then '노회장'
    when 'clerk'     then '서기'
    when 'staff'     then '간사'
    else null end;
  if v_label is not null then
    insert into public.telegram_outbox (kind, title, body)
    values ('임원교체',
            '🔕 ' || v_label || '에서 물러나셨습니다',
            coalesce(old.name, '(이름 없음)') || ' (' || coalesce(old.church, '-') || ')' ||
            ' 님이 ' || v_label || ' 직임을 마치셨습니다.');
  end if;

  return new;
end;
$fn$;

drop trigger if exists profile_role_notify on public.profiles;
create trigger profile_role_notify
  after update of role on public.profiles
  for each row execute function public.on_role_change();


-- ---------------------------------------------------------------------
-- 5. 현재 관리자 명단 (봇이 인수인계를 안내할 때 쓴다)
-- ---------------------------------------------------------------------
create or replace function public.current_officers()
returns table (out_role text, out_name text, out_church text)
language sql stable security definer set search_path = public as $fn$
  select p.role, p.name, p.church
    from public.profiles p
   where p.role in ('president', 'clerk', 'staff')
     and coalesce(p.suspended, false) = false
     and public.can_manage()
   order by case p.role when 'president' then 1 when 'clerk' then 2 else 3 end, p.name;
$fn$;

grant execute on function public.current_officers() to authenticated;


-- ---------------------------------------------------------------------
-- 6. 확인
-- ---------------------------------------------------------------------
select kind as "종류", title as "제목", created_at as "만든 때"
  from public.telegram_outbox
 order by id desc
 limit 10;

-- =====================================================================
--  43. 전 회원에게 알림 보내기
--
--  노회 관리자(노회장·서기·간사·최고관리자)가 알림함으로 전 회원에게
--  한 번에 알림을 보낼 수 있게 합니다.
--
--  받는 분
--    승인이 끝난 회원 모두입니다. (승인대기·정지된 계정은 뺍니다)
--
--  보낸이
--    보낸이는 로그인한 관리자에게서 서버가 직접 적습니다.
--    브라우저에서 보낸이를 정하거나 나중에 고칠 수 없습니다.
--    받은 분도 자기 알림의 <읽음> 표시만 바꿀 수 있고
--    제목·내용·보낸이는 손댈 수 없습니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 보낸이 칸
-- ---------------------------------------------------------------------
alter table public.notifications add column if not exists sent_by      uuid;
alter table public.notifications add column if not exists sent_by_name text;


-- ---------------------------------------------------------------------
-- 2. 받은 알림은 <읽음>만 바꿀 수 있다
--    제목·내용·보낸이를 고치지 못하도록 막는다.
--    서버 안에서 도는 일(security definer 함수)은 그대로 통과시킨다.
-- ---------------------------------------------------------------------
create or replace function public.notifications_guard()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if auth.uid() is null then          -- 서버가 스스로 하는 일
    return new;
  end if;
  if new.user_id     is distinct from old.user_id
  or new.kind        is distinct from old.kind
  or new.title       is distinct from old.title
  or new.body        is distinct from old.body
  or new.sent_by     is distinct from old.sent_by
  or new.sent_by_name is distinct from old.sent_by_name
  or new.created_at  is distinct from old.created_at then
    raise exception '받은 알림은 읽음 표시만 바꿀 수 있습니다.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists notifications_guard_tg on public.notifications;
create trigger notifications_guard_tg
  before update on public.notifications
  for each row execute function public.notifications_guard();


-- ---------------------------------------------------------------------
-- 3. 전 회원에게 보내기
--    보낸이는 auth.uid() 에서 가져오므로 브라우저가 정할 수 없다.
--    같은 제목을 1분 안에 두 번 보내면 두 번째는 그냥 0을 돌려준다.
--    (버튼을 두 번 눌러 두 통이 가는 일을 막는다)
-- ---------------------------------------------------------------------
create or replace function public.send_notice_to_all(
  p_kind  text,
  p_title text,
  p_body  text
) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  v_me    uuid := auth.uid();
  v_name  text;
  v_kind  text := coalesce(nullif(btrim(p_kind), ''), '공지');
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
  v_sent  integer := 0;
begin
  if not public.can_manage() then
    raise exception '전 회원 알림은 노회 관리자만 보낼 수 있습니다.';
  end if;
  if v_title = '' then
    raise exception '알림 제목을 적어 주세요.';
  end if;
  if length(v_title) > 120 then
    raise exception '알림 제목은 120자까지 적을 수 있습니다.';
  end if;

  -- 보낸이 : 로그인한 관리자 (브라우저가 정하지 않는다)
  select btrim(coalesce(p.name, '') || ' ' ||
               coalesce(nullif(p.title, ''), coalesce(p.position, '')))
    into v_name
    from public.profiles p
   where p.id = v_me;
  v_name := nullif(btrim(coalesce(v_name, '')), '');
  if v_name is null then v_name := '노회 사무실'; end if;

  -- 실수로 두 번 누른 경우
  if exists (
       select 1 from public.notifications n
        where n.sent_by = v_me
          and n.title = v_title
          and n.created_at > now() - interval '1 minute'
     ) then
    return 0;
  end if;

  insert into public.notifications (user_id, kind, title, body, sent_by, sent_by_name)
  select p.id, v_kind, v_title, nullif(v_body, ''), v_me, v_name
    from public.profiles p
   where coalesce(p.role, 'pending') <> 'pending'
     and coalesce(p.suspended, false) = false;

  get diagnostics v_sent = row_count;
  return v_sent;
end;
$fn$;

grant execute on function public.send_notice_to_all(text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 받을 분이 몇 분인지 미리 세어 본다 (보내기 전 확인용)
-- ---------------------------------------------------------------------
create or replace function public.notice_target_count()
returns integer language sql stable security definer set search_path = public as $fn$
  select case when public.can_manage() then (
    select count(*)::int from public.profiles p
     where coalesce(p.role, 'pending') <> 'pending'
       and coalesce(p.suspended, false) = false
  ) else 0 end;
$fn$;

grant execute on function public.notice_target_count() to authenticated;


-- 확인
select '43 전 회원 알림 등록 완료' as "결과",
       public.notice_target_count() as "받을 분";

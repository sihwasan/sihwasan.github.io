-- =====================================================================
--  48. 대상 그룹별 알림 보내기 (명부 연동)
--
--  시스템 알림의 대상을 명부(시찰 임원·상비부 임원·노회 임원 등)와
--  연동해, 관리자가 고른 그룹에게 알림함으로 알림을 보냅니다.
--
--  그룹
--    관리자      : 노회장·서기·간사·최고관리자
--    임원        : 관리자 + 임원 등급(부노회장·부서기·회계 등)
--    시찰장      : 시찰 명부의 시찰장 + 따로 지정한 시찰 임원(시찰장)
--    시찰 서기   : 시찰 명부의 서기 + 따로 지정한 시찰 임원(서기)
--    상비부장    : 상비부·위원회 명부의 부장(위원장) + 지정 임원(부장·위원장)
--    상비부 서기 : 상비부·위원회 명부의 서기 + 지정 임원(서기)
--    전 회원     : 승인이 끝난 회원 모두
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

create or replace function public.recipients_of_group(p_group text)
returns setof uuid
language sql stable security definer set search_path = public as $fn$
  select p.id from public.profiles p
  where p.role <> 'pending'
    and coalesce(p.suspended, false) = false
    and (
      case p_group
        when '관리자' then p.role in ('superadmin','president','clerk','staff')
        when '간사'   then p.role in ('superadmin','staff')
        when '임원'   then p.role in ('superadmin','president','clerk','staff','officer')
        when '전 회원' then true
        when '시찰장' then
          exists (select 1 from public.sichals s
                   where split_part(btrim(coalesce(s.head, '')), ' ', 1) = p.name)
          or exists (select 1 from public.sichal_officers so
                      where so.user_id = p.id and so.position = '시찰장')
        when '시찰 서기' then
          exists (select 1 from public.sichals s
                   where split_part(btrim(coalesce(s.clerk, '')), ' ', 1) = p.name)
          or exists (select 1 from public.sichal_officers so
                      where so.user_id = p.id and so.position = '서기')
        when '상비부장' then
          exists (select 1 from public.committees c
                   where split_part(btrim(coalesce(c.head, '')), ' ', 1) = p.name)
          or exists (select 1 from public.committee_officers o
                      where o.user_id = p.id and o.position in ('부장','위원장'))
        when '상비부 서기' then
          exists (select 1 from public.committees c
                   where split_part(btrim(coalesce(c.clerk, '')), ' ', 1) = p.name)
          or exists (select 1 from public.committee_officers o
                      where o.user_id = p.id and o.position = '서기')
        else false
      end
    );
$fn$;

create or replace function public.send_notice_to_group(
  p_group text,
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
    raise exception '알림 발송은 노회 관리자만 할 수 있습니다.';
  end if;
  if v_title = '' then
    raise exception '제목을 입력해 주세요.';
  end if;
  select name into v_name from public.profiles where id = v_me;

  -- 같은 그룹에 같은 제목을 1분 안에 두 번 보내면 두 번째는 0을 돌려준다
  if exists (
    select 1 from public.notifications n
     where n.sent_by = v_me and n.title = v_title
       and n.created_at > now() - interval '1 minute'
  ) then
    return 0;
  end if;

  insert into public.notifications (user_id, kind, title, body, sent_by, sent_by_name)
  select r, v_kind, v_title, v_body, v_me, v_name
    from public.recipients_of_group(p_group) r;
  get diagnostics v_sent = row_count;
  return v_sent;
end;
$fn$;

grant execute on function public.send_notice_to_group(text, text, text, text) to authenticated;
-- 받는 사람 목록 함수는 서버 안에서만 쓴다
revoke all on function public.recipients_of_group(text) from public, anon, authenticated;

-- 확인:  select count(*) from public.recipients_of_group('시찰장');

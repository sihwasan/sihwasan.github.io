-- =====================================================================
--  106. 오늘의 노회 — 시스템에 설정된 정기노회 날에 열린다
--
--  「오늘의 노회」(첫 화면 히어로 창과 입장)는 서기가 QR 코드를 만든 날짜가
--  아니라, 시스템에 설정된 노회 날에 열린다.
--    1) 사이트 관리 → 노회 운영 → 노회 일정 설정의 <정기노회 일정>
--       (meetings 표, 봄·가을 정기노회·임시노회)에 오늘 날짜가 있으면 노회 날.
--    2) 그 해 그 정기노회의 날짜가 아직 적혀 있지 않으면,
--       기준일 규칙(site_settings 'ops_dates', 기본 봄 4월·가을 10월 둘째 주 월요일)으로 본다.
--  QR 코드는 언제든 미리 만들 수 있고, 입장은 노회 날에만 된다.
--
--  실행 방법 : Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run
--  ※ 105_today_assembly.sql 다음에 실행합니다. 여러 번 실행해도 안전합니다.
-- =====================================================================


-- 몇째 주 월요일
create or replace function public.nth_monday(p_year integer, p_month integer, p_week integer)
returns date language sql immutable as $fn$
  select make_date(p_year, p_month, 1)
         + ((8 - extract(dow from make_date(p_year, p_month, 1))::integer) % 7)
         + 7 * (p_week - 1);
$fn$;


-- 오늘이 노회 날이면 그 노회의 이름을, 아니면 null 을 돌려준다
create or replace function public.assembly_meeting_day()
returns text language plpgsql stable security definer set search_path = public as $fn$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_y     integer := extract(year from v_today)::integer;
  v_kind  text;
  d       jsonb;
begin
  -- 1) 노회 일정에 적힌 날
  select kind into v_kind from public.meetings
   where meet_date = v_today
   order by confirmed desc, id desc limit 1;
  if v_kind is not null then return v_kind; end if;

  -- 2) 날짜를 아직 적지 않은 정기노회는 기준일 규칙으로
  select value into d from public.site_settings where key = 'ops_dates';
  d := coalesce(d, '{"springMonth":4,"springWeek":2,"fallMonth":10,"fallWeek":2}'::jsonb);
  if v_today = public.nth_monday(v_y, coalesce((d->>'springMonth')::integer, 4), coalesce((d->>'springWeek')::integer, 2))
     and not exists (select 1 from public.meetings
                      where kind = '봄 정기노회' and meet_date is not null
                        and extract(year from meet_date) = v_y) then
    return '봄 정기노회';
  end if;
  if v_today = public.nth_monday(v_y, coalesce((d->>'fallMonth')::integer, 10), coalesce((d->>'fallWeek')::integer, 2))
     and not exists (select 1 from public.meetings
                      where kind = '가을 정기노회' and meet_date is not null
                        and extract(year from meet_date) = v_y) then
    return '가을 정기노회';
  end if;
  return null;
end
$fn$;
grant execute on function public.assembly_meeting_day() to anon, authenticated;


-- 첫 화면 — 노회 날이면 「오늘의 노회」 창 하나만 보여 준다 (QR 생성과 무관)
create or replace function public.assembly_today()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_kind  text := public.assembly_meeting_day();
  v_title text;
begin
  if v_kind is null then return null; end if;
  -- 서기가 만들어 둔 QR(노회)이 있으면 그 이름을, 없으면 일정의 구분을 쓴다
  select title into v_title from public.assembly_meetings
   where status <> 'closed' order by session_no desc nulls last, id desc limit 1;
  return jsonb_build_object('title', coalesce(v_title, v_kind), 'kind', v_kind,
                            'meet_date', (now() at time zone 'Asia/Seoul')::date);
end
$fn$;
grant execute on function public.assembly_today() to anon, authenticated;


-- 입장 — QR 코드의 날짜가 아니라 시스템의 노회 날에만
create or replace function public.assembly_enter(p_code text)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  m public.assembly_meetings%rowtype;
  p public.profiles%rowtype;
  j jsonb;
begin
  if auth.uid() is null then raise exception '로그인해 주세요.'; end if;
  select * into m from public.assembly_meetings
   where code = upper(btrim(coalesce(p_code, ''))) and status <> 'closed';
  if m.id is null then raise exception '입장 코드가 맞지 않거나 이미 마친 노회입니다.'; end if;
  if public.assembly_meeting_day() is null then
    raise exception '노회 당일에 입장할 수 있습니다. (노회 날짜는 노회 일정에 설정된 날입니다)';
  end if;
  select * into p from public.profiles where id = auth.uid();
  j := to_jsonb(p);
  if p.id is null or p.role = 'pending' then
    raise exception '승인 대기 중인 계정은 입장할 수 없습니다. 서기에게 문의해 주세요.';
  end if;
  if p.role = 'general' then
    raise exception '일반회원은 노회 회원이 아니므로 입장할 수 없습니다.';
  end if;
  if coalesce((j->>'suspended')::boolean, false) then
    raise exception '이용이 정지된 계정입니다.';
  end if;

  insert into public.assembly_attendees
    (meeting_id, user_id, roster_id, name, church, position, kind, grade, full_member)
  values
    (m.id, p.id, nullif(j->>'roster_id', '')::bigint, p.name, p.church, p.position,
     case when coalesce(p.position, '') like '%목사%' then '목사'
          when coalesce(p.position, '') like '%장로%' then '장로'
          else '기타' end,
     case p.role when 'advisory' then '언권회원' when 'associate' then '준회원'
                 when 'general' then '일반회원' else '정회원' end,
     public.is_full_member())
  on conflict (meeting_id, user_id) do nothing;
  return m.id;
end
$fn$;
revoke all on function public.assembly_enter(text) from public, anon;
grant execute on function public.assembly_enter(text) to authenticated;

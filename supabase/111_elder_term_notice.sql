-- =====================================================================
--  111. 정기노회 4주 전 — 총대 장로 임기 확인 알림 (서기에게)
--
--  정기노회 4주(28일) 전부터, 노회 장로 총대 가운데 남은 임기가
--  1년 미만인 분의 명단(교회 · 장로 · 남은 임기)을 서기의 알림함으로 보냅니다.
--  해당 교회에는 공문을 보내 다른 장로를 총대로 파송하도록 안내합니다.
--  (공문 시안과 워드 파일 : elder-notice.html 「총대 장로 임기 확인 · 공문」)
--
--  근거 : 시화산노회 규칙 제16조 2항
--         노회총대: 정치 제10장 제2조에 의거하여 당회장이 제출한다.
--
--  · 장로 총대  = 노회 명단(roster)의 직분 '장로' 가운데 교체되지 않은 분(active)
--                 + 노회 명단에 장로 줄이 없는 교회 명부(church_staff)의 총대장로
--                 (110 오늘의 노회 자격 판정과 같은 규칙)
--  · 남은 임기  = 오늘부터 정년일(retire_date: 만 71세 생일 하루 전)까지 꽉 찬 개월 수
--                 회원 관리·시찰 화면의 '남은 임기' 칸과 같은 셈입니다.
--                 1년 미만 = 12개월 미만 (정년이 지난 분도 포함)
--  · 정기노회 날 = 노회 일정 설정(meetings)의 봄·가을 정기노회 날짜.
--                 그 해 그 정기노회 날짜가 비어 있으면 기준일 규칙
--                 (site_settings 'ops_dates', 기본 4월·10월 둘째 주 월요일)
--  · 받는 분    = 노회장(president)·서기(clerk)·간사(staff)와 최고관리자(superadmin)
--  · 한 정기노회에 한 번만 보냅니다 (dedupe_key = 'elder-term-YYYYMMDD').
--    해당자가 없어도 "해당 없음"으로 한 번 알립니다.
--
--  run_reminders 는 고치지 않습니다. 이 함수는 따로 있고, 홈페이지가 하루 한 번
--  run_reminders 와 같은 자리(js/main.js)에서 함께 부릅니다.
--
--  실행 방법 : Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다. (106 의 nth_monday 를 같은 정의로 다시 만듭니다)
-- =====================================================================


-- 몇째 주 월요일 (106 과 같은 정의)
create or replace function public.nth_monday(p_year integer, p_month integer, p_week integer)
returns date language sql immutable as $fn$
  select make_date(p_year, p_month, 1)
         + ((8 - extract(dow from make_date(p_year, p_month, 1))::integer) % 7)
         + 7 * (p_week - 1);
$fn$;


-- ---------------------------------------------------------------------
-- 1. 다음 정기노회 (오늘 포함, 가장 가까운 봄·가을 정기노회)
-- ---------------------------------------------------------------------
create or replace function public.next_regular_meeting()
returns table (kind text, meet_date date, place text)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  d       jsonb;
  y       integer;
  c       date;
  b_kind  text;
  b_date  date;
  b_place text;
begin
  -- 1) 노회 일정 설정에 적힌 날짜
  select m.kind, m.meet_date, m.place into b_kind, b_date, b_place
    from public.meetings m
   where m.meet_date >= v_today
     and m.kind like '%정기노회%'
   order by m.meet_date, m.confirmed desc, m.id desc
   limit 1;

  -- 2) 날짜가 아직 적히지 않은 정기노회는 기준일 규칙으로
  select value into d from public.site_settings where key = 'ops_dates';
  d := coalesce(d, '{"springMonth":4,"springWeek":2,"fallMonth":10,"fallWeek":2}'::jsonb);
  for y in extract(year from v_today)::integer .. extract(year from v_today)::integer + 1 loop
    c := public.nth_monday(y, coalesce((d->>'springMonth')::integer, 4), coalesce((d->>'springWeek')::integer, 2));
    if c >= v_today and (b_date is null or c < b_date)
       and not exists (select 1 from public.meetings x
                        where x.kind = '봄 정기노회' and x.meet_date is not null
                          and extract(year from x.meet_date) = y) then
      b_kind := '봄 정기노회'; b_date := c; b_place := null;
    end if;
    c := public.nth_monday(y, coalesce((d->>'fallMonth')::integer, 10), coalesce((d->>'fallWeek')::integer, 2));
    if c >= v_today and (b_date is null or c < b_date)
       and not exists (select 1 from public.meetings x
                        where x.kind = '가을 정기노회' and x.meet_date is not null
                          and extract(year from x.meet_date) = y) then
      b_kind := '가을 정기노회'; b_date := c; b_place := null;
    end if;
  end loop;

  if b_date is null then return; end if;
  return query select b_kind, b_date, b_place;
end
$fn$;
grant execute on function public.next_regular_meeting() to authenticated;


-- ---------------------------------------------------------------------
-- 2. 4주 전 알림 보내기
--    홈페이지가 하루 한 번 조용히 부르고, 이미 보낸 알림은 다시 보내지 않는다.
-- ---------------------------------------------------------------------
create or replace function public.run_elder_term_notice()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_today  date := (now() at time zone 'Asia/Seoul')::date;
  v_kind   text;
  v_meet   date;
  v_place  text;
  v_days   integer;
  v_key    text;
  v_sess   jsonb;
  v_no     integer;
  v_name   text;
  v_when   text;
  v_list   text;
  v_cnt    integer := 0;
  v_chs    integer := 0;
  v_unk    text;
  v_unkn   integer := 0;
  v_title  text;
  v_body   text;
  v_sent   integer := 0;
begin
  if auth.uid() is null then
    return 0;
  end if;

  select n.kind, n.meet_date, n.place into v_kind, v_meet, v_place
    from public.next_regular_meeting() n;
  if v_meet is null then return 0; end if;

  v_days := v_meet - v_today;
  if v_days < 0 or v_days > 28 then return 0; end if;     -- 4주 전부터 노회 날까지

  v_key := 'elder-term-' || to_char(v_meet, 'YYYYMMDD');

  -- 이미 모든 받는 분에게 보냈으면 명단을 셈하지 않고 끝낸다
  if not exists (
    select 1 from public.profiles p
     where p.role in ('president', 'clerk', 'staff', 'superadmin')
       and coalesce(p.suspended, false) = false
       and not exists (select 1 from public.notifications n
                        where n.user_id = p.id and n.dedupe_key = v_key)
  ) then
    return 0;
  end if;

  -- 회기 : 회기 설정에 그 날 시작하는 회기가 있으면 그 번호, 없으면 현재 회기 + 1
  select value into v_sess from public.site_settings where key = 'sessions';
  begin
    select (x->>'no')::integer into v_no
      from jsonb_array_elements(coalesce(v_sess->'list', '[]'::jsonb)) x
     where x->>'from' = to_char(v_meet, 'YYYY-MM-DD')
     limit 1;
    if v_no is null and (v_sess->>'current') is not null then
      v_no := (v_sess->>'current')::integer + 1;
    end if;
  exception when others then
    v_no := null;
  end;
  v_name := case when v_no is not null then '제' || v_no || '회 정기노회' else v_kind end;

  v_when := to_char(v_meet, 'FMYYYY년 FMMM월 FMDD일') ||
            '(' || (array['일','월','화','수','목','금','토'])[extract(dow from v_meet)::integer + 1] || ')' ||
            coalesce(' · ' || nullif(btrim(v_place), ''), '') ||
            case when v_days = 0 then ' (오늘)' else ' (' || v_days || '일 남음)' end;

  -- 장로 총대와 남은 임기
  with el as (
    select r.church, r.name, r.birth_date
      from public.roster r
     where r.category = '장로'
       and coalesce(r.active, true)
    union all
    select s.church, s.name, s.birth_date
      from public.church_staff s
     where coalesce(s.is_chongdae, false)
       and coalesce(s.role, '') like '%장로%'
       and coalesce(s.role, '') not like '%원로%'
       and coalesce(s.role, '') not like '%은퇴%'
       and not exists (
             select 1 from public.roster r2
              where r2.category = '장로'
                and (r2.id = s.roster_id
                  or (regexp_replace(coalesce(r2.name, ''), '\s', '', 'g')
                        = regexp_replace(coalesce(s.name, ''), '\s', '', 'g')
                      and regexp_replace(regexp_replace(coalesce(r2.church, ''), '\s', '', 'g'), '교회$', '')
                        = regexp_replace(regexp_replace(coalesce(s.church, ''), '\s', '', 'g'), '교회$', '')))
           )
  ), calc as (
    select el.church, el.name, public.retire_date(el.birth_date) as rd
      from el
     where el.birth_date is not null
  ), due as (
    select calc.*,
           ((extract(year from rd) - extract(year from v_today)) * 12
             + (extract(month from rd) - extract(month from v_today))
             - case when extract(day from rd) < extract(day from v_today) then 1 else 0 end)::integer as months
      from calc
  )
  select count(*),
         count(distinct regexp_replace(regexp_replace(coalesce(church, ''), '\s', '', 'g'), '교회$', '')),
         string_agg(
           '· ' || coalesce(nullif(btrim(church), ''), '(교회 미등록)') || ' ' || name || ' 장로 — ' ||
           case when rd < v_today then '정년 경과'
                else '남은 임기 ' ||
                     case when months >= 12 then (months / 12) || '년' || case when months % 12 > 0 then ' ' || (months % 12) || '개월' else '' end
                          when months > 0 then months || '개월'
                          else '한 달 미만' end
           end ||
           ' (정년 ' || to_char(rd, 'FMYYYY. FMMM. FMDD.') || ')',
           chr(10) order by church, rd)
    into v_cnt, v_chs, v_list
    from due
   where rd < v_today or months < 12;

  -- 생년월일이 없어 확인하지 못한 분
  select count(*), string_agg(name || '(' || coalesce(nullif(btrim(church), ''), '교회 미등록') || ')', ', ' order by church, name)
    into v_unkn, v_unk
    from (
      select r.church, r.name from public.roster r
       where r.category = '장로' and coalesce(r.active, true) and r.birth_date is null
    ) u;

  if v_cnt > 0 then
    v_title := '[' || v_name || ' 4주 전] 총대 장로 임기 확인 — 공문 발송 대상 ' || v_chs || '개 교회';
    v_body :=
      v_name || ' : ' || v_when || chr(10) || chr(10) ||
      '노회 장로 총대 가운데 남은 임기(총회 정년까지)가 1년 미만인 분이 ' || v_cnt || '명 있습니다.' || chr(10) ||
      '해당 교회(' || v_chs || '곳)에 공문을 보내 다른 장로를 총대로 파송하도록 안내해 주세요.' || chr(10) ||
      '(노회규칙 제16조 2항 — 노회총대는 당회장이 제출한다)' || chr(10) || chr(10) ||
      v_list || chr(10) || chr(10) ||
      '공문 시안은 임원방 → 「총대 장로 임기 확인 · 공문」에서 보고 워드 파일로 내려받을 수 있습니다.';
  else
    v_title := '[' || v_name || ' 4주 전] 총대 장로 임기 확인 — 해당 없음';
    v_body :=
      v_name || ' : ' || v_when || chr(10) || chr(10) ||
      '노회 장로 총대 가운데 남은 임기(총회 정년까지)가 1년 미만인 분이 없습니다.' || chr(10) ||
      '이번 정기노회에는 총대 파송 안내 공문을 보낼 교회가 없습니다.';
  end if;
  if v_unkn > 0 then
    v_body := v_body || chr(10) || chr(10) ||
      '※ 생년월일이 없어 확인하지 못한 장로 총대 ' || v_unkn || '명 : ' || v_unk;
  end if;

  insert into public.notifications (user_id, kind, title, body, dedupe_key)
  select p.id, '총대 안내', v_title, v_body, v_key
    from public.profiles p
   where p.role in ('president', 'clerk', 'staff', 'superadmin')
     and coalesce(p.suspended, false) = false
     and not exists (select 1 from public.notifications n
                      where n.user_id = p.id and n.dedupe_key = v_key);
  get diagnostics v_sent = row_count;
  return v_sent;
end;
$fn$;

revoke all on function public.run_elder_term_notice() from public;
grant execute on function public.run_elder_term_notice() to authenticated;

comment on function public.run_elder_term_notice() is
  '정기노회 4주(28일) 전부터 서기에게 남은 임기 1년 미만 장로 총대 명단(교회·장로·남은 임기)을 알린다. 한 정기노회에 한 번.';


-- 확인 : 다음 정기노회와 지금 보낼 명단 (알림은 보내지 않음)
select n.kind as "다음 정기노회", n.meet_date as "날짜", n.place as "장소",
       n.meet_date - (now() at time zone 'Asia/Seoul')::date as "남은 날"
  from public.next_regular_meeting() n;

select r.church as "교회", r.name as "장로", public.retire_date(r.birth_date) as "정년일"
  from public.roster r
 where r.category = '장로' and coalesce(r.active, true)
   and r.birth_date is not null
   and public.retire_date(r.birth_date) < ((now() at time zone 'Asia/Seoul')::date + interval '1 year')::date
 order by r.church, 3;

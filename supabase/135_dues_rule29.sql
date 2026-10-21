-- =====================================================================
--  135. 상회비 미납 규정(노회규칙 제28조·제29조)을 시스템으로
--
--  노회규칙
--    제28조 (상회비 납부) 각 지교회 상회비는 매월 납입 시는 월말까지, 일시납일
--           경우에는 노회 개회 2주 전까지는 완납하여야 한다.
--    제29조 (상회비 미납 규정)
--      1. 상회비 미납 시에는 각종 서류나 증명서의 발급, 접수가 중지된다.
--      2. 과년도 상회비 미납금은 당해 연도 배당금에 합산 납입해야 한다.
--      3. 상회비 및 총회 세례교인헌금 미납교회는 노회 임원 및 총대,
--         시찰·상비부 임원을 할 수 없다.
--
--  기준 (2026-10-21 결정)
--    · 상회비만 본다. 세례교인헌금(세례의무금) 미납은 이 적용에서 뺀다.
--    · "미납" = 이번 회기(4월 시작)에서 기한(그 달 말)이 지난 달 가운데
--      납부 기록(dues_payments)이 없는 달. 이번 달은 월말까지 낼 수 있으므로
--      미납으로 보지 않는다.
--    · 회계가 입금을 기록할 시간을 주기 위해, 지난달분은 유예일
--      (site_settings.dues_rule29.grace_days, 기본 3일)이 지난 뒤부터 미납으로 본다.
--    · 지난 회기(과년도) 미납은 여기서 세지 않는다. 마감된 회기의 정산은 회계가 따로 다룬다.
--    · 임원 = 노회 임원(임원 명부·계정 등급), 총회 총대(delegates), 시찰의 시찰장·서기·회계,
--      상비부의 부장(위원장)·서기·회계. 상비부 '부원'은 임원이 아니다.
--
--  하는 일
--    1) dues29_churches(연도)  : 기한 지난 미납이 있는 교회 목록           (임원·관리자)
--    2) dues29_affected(연도)  : 그 교회 소속으로 위 직책을 맡은 분         (임원·관리자)
--    3) my_dues_rule29()       : 로그인한 분 자신의 상태                   (대시보드·서류 신청·청원)
--    4) 서류 발급 신청(doc_requests)·청원서 전달(petition_submissions)의 접수 차단 (제29조 1항)
--       — 노회 관리자(노회장·서기·간사·최고관리자)가 직접 넣는 것은 막지 않는다.
--    5) notify_dues_rule29(수동) : 미납 교회의 담임목사·장로와 직책을 맡은 분에게 알림,
--       회계·서기·노회장·간사에게 요약 알림. 자동은 달마다 한 번(유예일 뒤, 누가 들어오든
--       main.js 의 하루 한 번 자리에서), 수동(임원방 단추)은 하루 한 번.
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다 (create or replace / drop … if exists).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. 설정 — 유예일
-- ---------------------------------------------------------------------
insert into public.site_settings (key, value)
values ('dues_rule29', '{"grace_days": 3}'::jsonb)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------
-- 1. 도우미
-- ---------------------------------------------------------------------

-- 교회 이름 맞추기 열쇠 — 띄어쓰기와 끝의 '교회'를 뺀다 (반월 = 반월교회 = 반월 교회)
create or replace function public.dues29_key(t text)
returns text language sql immutable as $fn$
  select regexp_replace(regexp_replace(coalesce(t, ''), '\s+', '', 'g'), '교회$', '');
$fn$;

-- 지금 회기 연도 (4월 시작, 한국 시간)
create or replace function public.fy_now()
returns int language sql stable as $fn$
  select case when extract(month from (now() at time zone 'Asia/Seoul'))::int >= 4
              then extract(year from (now() at time zone 'Asia/Seoul'))::int
              else extract(year from (now() at time zone 'Asia/Seoul'))::int - 1 end;
$fn$;

-- 유예일 (지난달분을 미납으로 잡기 전에 회계가 입금을 기록할 수 있는 날수)
create or replace function public.dues29_grace_days()
returns int language sql stable security definer set search_path = public as $fn$
  select greatest(0, least(28, coalesce(
    (select (value ->> 'grace_days')::int from public.site_settings where key = 'dues_rule29'), 3)));
$fn$;

-- 그 교회의 기한 지난 미납 달 (달력 월 번호, 회기 순서)
--   지난 회기: 12달 모두 기한 지남 / 다음 회기: 없음 /
--   이번 회기: 이번 달 전까지, 다만 유예일 안이면 지난달도 아직 뺀다
create or replace function public.dues29_late_months(p_year int, p_church text)
returns int[] language sql stable security definer set search_path = public as $fn$
  with lim as (
    select case
             when p_year < public.fy_now() then 12
             when p_year > public.fy_now() then 0
             else public.fy_elapsed(p_year) - 1
                  - case when extract(day from (now() at time zone 'Asia/Seoul'))::int
                              <= public.dues29_grace_days() then 1 else 0 end
           end as n
  ),
  fm as (
    select t.m, t.idx
      from unnest(array[4,5,6,7,8,9,10,11,12,1,2,3]) with ordinality as t(m, idx)
  )
  select coalesce(array_agg(fm.m order by fm.idx), '{}'::int[])
    from fm, lim
   where fm.idx <= lim.n
     and not exists (
       select 1 from public.dues_payments p
        where p.year = p_year and p.church = p_church and p.month = fm.m
     );
$fn$;

-- 상회비를 내는 자리인가 (명단 분류·직분. 110 의 pays_dues 와 같은 규칙)
create or replace function public.dues29_pays(p_category text, p_position text)
returns boolean language sql immutable as $fn$
  select case
           when btrim(coalesce(p_category, '')) = '장로' then true
           when btrim(coalesce(p_category, '')) in ('목사', '위임목사', '시무목사')
             then btrim(coalesce(p_position, '')) in ('', '목사', '위임목사', '시무목사', '담임목사')
           when btrim(coalesce(p_category, '')) = ''
             then btrim(coalesce(p_position, '')) in ('목사', '위임목사', '시무목사', '담임목사', '장로')
           else false
         end;
$fn$;

-- 그 분이 맡은 직책 — 노회 임원 · 총회 총대 · 시찰 임원 · 상비부 임원(부장·서기·회계)
--   이름(+교회)과 계정으로 찾는다. 시찰·상비부 명부는 "이름 직분" 꼴이라 맨 앞 이름으로 맞춘다.
create or replace function public.dues29_roles(p_name text, p_church text, p_user uuid)
returns text[] language sql stable security definer set search_path = public as $fn$
  with k as (
    select btrim(coalesce(p_name, '')) as nm, public.dues29_key(p_church) as ck
  )
  select coalesce(array_agg(distinct t.r order by t.r), '{}'::text[])
    from (
      -- 노회 임원 (임원 명부 site_settings.officers)
      select case when coalesce(o ->> 'role', '') like '%노회장%' then o ->> 'role'
                  else '노회 ' || (o ->> 'role') end as r
        from public.site_settings s
        cross join jsonb_array_elements(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) o
        cross join k
       where s.key = 'officers'
         and btrim(coalesce(o ->> 'name', '')) <> ''
         and btrim(o ->> 'name') = k.nm
         and (coalesce(o ->> 'church', '') = '' or public.dues29_key(o ->> 'church') = k.ck)
      union all
      -- 노회 임원 (계정 등급 — 노회장·서기·임원)
      select case p.role when 'president' then '노회장'
                         when 'clerk' then '노회 서기'
                         else '노회 ' || coalesce(nullif(btrim(p.title), ''), '임원') end
        from public.profiles p
       where p_user is not null and p.id = p_user and p.role in ('president', 'clerk', 'officer')
      union all
      -- 총회 총대 (자격 기간 안의 현 총대)
      select '총회 ' || d.kind
        from public.delegates d cross join k
       where d.active
         and btrim(d.name) = k.nm
         and (coalesce(d.church, '') = '' or public.dues29_key(d.church) = k.ck)
         and (d.term_until is null or d.term_until >= current_date)
      union all
      -- 시찰 임원 (시찰 정보의 시찰장·서기·회계)
      select s.name || ' ' || x.pos
        from public.sichals s
        cross join lateral (values (s.head, '시찰장'), (s.clerk, '서기'), (s.treasurer, '회계')) as x(nm, pos)
        cross join k
       where k.nm <> '' and split_part(btrim(coalesce(x.nm, '')), ' ', 1) = k.nm
      union all
      select so.sichal || ' ' || so.position
        from public.sichal_officers so
       where p_user is not null and so.user_id = p_user
      union all
      -- 상비부 임원 (부장·서기·회계)
      select c.name || ' ' || x.pos
        from public.committees c
        cross join lateral (values
          (c.head, case when c.name like '%위원회' then '위원장' else '부장' end),
          (c.clerk, '서기'), (c.treasurer, '회계')) as x(nm, pos)
        cross join k
       where k.nm <> '' and split_part(btrim(coalesce(x.nm, '')), ' ', 1) = k.nm
      union all
      select co.committee || ' ' || co.position
        from public.committee_officers co
       where p_user is not null and co.user_id = p_user
    ) t;
$fn$;

-- 도우미는 서버 안에서만 쓴다
revoke all on function public.dues29_late_months(int, text) from public, anon, authenticated;
revoke all on function public.dues29_roles(text, text, uuid) from public, anon, authenticated;
grant execute on function public.dues29_key(text) to authenticated;
grant execute on function public.fy_now() to authenticated;
grant execute on function public.dues29_grace_days() to authenticated;
grant execute on function public.dues29_pays(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. 기한 지난 미납 교회 (임원·관리자)
-- ---------------------------------------------------------------------
drop function if exists public.dues29_churches(int);
create function public.dues29_churches(p_year int default null)
returns table (
  out_church      text,
  out_sichal      text,
  out_pastor      text,
  out_monthly     int,      -- 월액 (만원)
  out_late_months int[],    -- 기한 지난 미납 달
  out_late_count  int,
  out_late_amount int,      -- 만원
  out_cur_unpaid  boolean,  -- 이번 달분도 아직 안 냈는가 (기한 전)
  out_notified_at timestamptz  -- 이 교회에 마지막으로 미납 안내가 나간 때
) language sql stable security definer set search_path = public as $fn$
  with yr as (select coalesce(p_year, public.fy_now()) as y)
  select r.church,
         coalesce(nullif(btrim(r.sichal), ''), '기타'),
         r.pastor,
         coalesce(r.monthly_amount, 0)::int,
         lm.months,
         coalesce(array_length(lm.months, 1), 0),
         coalesce(array_length(lm.months, 1), 0) * coalesce(r.monthly_amount, 0)::int,
         (yr.y = public.fy_now() and not exists (
            select 1 from public.dues_payments p
             where p.year = r.year and p.church = r.church
               and p.month = extract(month from (now() at time zone 'Asia/Seoul'))::int)),
         (select max(n.created_at) from public.notifications n
           where n.dedupe_key like 'dues29-' || yr.y || '-' || public.dues29_key(r.church) || '-%')
    from public.dues_rates r
    cross join yr
    cross join lateral (select public.dues29_late_months(r.year, r.church) as months) lm
   where r.year = yr.y
     and (public.is_officer() or public.can_manage())
     and coalesce(array_length(lm.months, 1), 0) > 0
   order by coalesce(nullif(btrim(r.sichal), ''), '기타'), r.sort, r.id;
$fn$;
grant execute on function public.dues29_churches(int) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 제3항 해당자 — 미납 교회 소속으로 직책을 맡은 분
-- ---------------------------------------------------------------------
-- 서버 안에서 쓰는 본체 (열람 조건 없음)
drop function if exists public._dues29_affected(int);
create function public._dues29_affected(p_year int)
returns table (
  out_church      text,
  out_sichal      text,
  out_late_months int[],
  out_late_amount int,
  out_name        text,
  out_category    text,
  out_position    text,
  out_user_id     uuid,
  out_roles       text[],
  out_notified_at timestamptz
) language sql stable security definer set search_path = public as $fn$
  with yr as (select coalesce(p_year, public.fy_now()) as y),
  ch as (
    select r.church,
           coalesce(nullif(btrim(r.sichal), ''), '기타') as sichal,
           coalesce(r.monthly_amount, 0)::int as monthly,
           lm.months
      from public.dues_rates r
      cross join yr
      cross join lateral (select public.dues29_late_months(r.year, r.church) as months) lm
     where r.year = yr.y and coalesce(array_length(lm.months, 1), 0) > 0
  ),
  -- 그 교회 사람: 명단(roster)에 있는 분 + 명단과 이어지지 않았지만 교회가 같은 계정
  people as (
    select ch.church, ch.sichal, ch.months, ch.monthly,
           r.name, coalesce(r.category, '') as category, coalesce(r.position, '') as position,
           (select p.id from public.profiles p where p.roster_id = r.id limit 1) as uid,
           r.sort as ord
      from ch
      join public.roster r on public.dues29_key(r.church) = public.dues29_key(ch.church)
    union all
    select ch.church, ch.sichal, ch.months, ch.monthly,
           p.name, '', coalesce(p.position, ''), p.id, 9999
      from ch
      join public.profiles p
        on p.roster_id is null and p.name is not null
       and public.dues29_key(p.church) = public.dues29_key(ch.church)
       and coalesce(p.role, 'pending') not in ('pending', 'general')
  )
  select pe.church, pe.sichal, pe.months,
         coalesce(array_length(pe.months, 1), 0) * pe.monthly,
         pe.name, pe.category, pe.position, pe.uid, rl.roles,
         (select max(n.created_at) from public.notifications n
           where pe.uid is not null and n.user_id = pe.uid and n.dedupe_key like 'dues29-%')
    from people pe
    cross join lateral (select public.dues29_roles(pe.name, pe.church, pe.uid) as roles) rl
   where coalesce(array_length(rl.roles, 1), 0) > 0
   order by pe.sichal, pe.church, pe.ord, pe.name;
$fn$;
revoke all on function public._dues29_affected(int) from public, anon, authenticated;

-- 화면에서 부르는 것 (임원·관리자)
drop function if exists public.dues29_affected(int);
create function public.dues29_affected(p_year int default null)
returns table (
  out_church      text,
  out_sichal      text,
  out_late_months int[],
  out_late_amount int,
  out_name        text,
  out_category    text,
  out_position    text,
  out_user_id     uuid,
  out_roles       text[],
  out_notified_at timestamptz
) language sql stable security definer set search_path = public as $fn$
  select * from public._dues29_affected(p_year)
   where public.is_officer() or public.can_manage();
$fn$;
grant execute on function public.dues29_affected(int) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 한 분의 상태 — 대시보드와 접수 차단이 같이 쓴다
-- ---------------------------------------------------------------------
create or replace function public.dues29_status_of(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_fy     int := public.fy_now();
  v_name   text;
  v_church text;
  v_cat    text;
  v_pos    text;
  v_rchurch text;
  v_sichal text;
  v_monthly int;
  v_late   int[];
  v_roles  text[];
  v_mo     int := extract(month from (now() at time zone 'Asia/Seoul'))::int;
  v_cur_unpaid boolean := false;
begin
  if p_user is null then return null; end if;

  -- 내 교회: 명단(roster)이 원본, 명단과 이어지지 않은 계정은 가입 때 적은 교회
  select coalesce(r.name, p.name), coalesce(r.church, p.church),
         coalesce(r.category, ''), coalesce(r.position, p.position, '')
    into v_name, v_church, v_cat, v_pos
    from public.profiles p
    left join public.roster r on r.id = p.roster_id
   where p.id = p_user;

  if coalesce(v_church, '') = '' then
    return jsonb_build_object('fy', v_fy, 'church', null, 'in_dues', false, 'blocked', false);
  end if;

  select r.church, coalesce(nullif(btrim(r.sichal), ''), '기타'), coalesce(r.monthly_amount, 0)::int
    into v_rchurch, v_sichal, v_monthly
    from public.dues_rates r
   where r.year = v_fy and public.dues29_key(r.church) = public.dues29_key(v_church)
   order by r.id limit 1;
  if not found then
    return jsonb_build_object('fy', v_fy, 'church', v_church, 'in_dues', false, 'blocked', false);
  end if;

  v_late  := public.dues29_late_months(v_fy, v_rchurch);
  v_roles := public.dues29_roles(v_name, v_church, p_user);
  v_cur_unpaid := not exists (
    select 1 from public.dues_payments p
     where p.year = v_fy and p.church = v_rchurch and p.month = v_mo);

  return jsonb_build_object(
    'fy', v_fy, 'church', v_rchurch, 'sichal', v_sichal, 'in_dues', true,
    'monthly', v_monthly,
    'late_months', to_jsonb(v_late),
    'late_count', coalesce(array_length(v_late, 1), 0),
    'late_amount', coalesce(array_length(v_late, 1), 0) * v_monthly,
    'cur_month', v_mo, 'cur_unpaid', v_cur_unpaid,
    'roles', to_jsonb(v_roles), 'role_count', coalesce(array_length(v_roles, 1), 0),
    'blocked', coalesce(array_length(v_late, 1), 0) > 0,
    'grace_days', public.dues29_grace_days());
end
$fn$;
revoke all on function public.dues29_status_of(uuid) from public, anon, authenticated;

-- 로그인한 분 자신의 상태
create or replace function public.my_dues_rule29()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select public.dues29_status_of(auth.uid());
$fn$;
grant execute on function public.my_dues_rule29() to authenticated;

comment on function public.my_dues_rule29() is
  '노회규칙 제29조 — 내 교회의 기한 지난 상회비 미납 달·금액, 내가 맡은 직책, 서류 접수 차단 여부';


-- ---------------------------------------------------------------------
-- 5. 접수 차단 (제29조 1항) — 서류 발급 신청 · 청원서 전달
--    노회 관리자(노회장·서기·간사·최고관리자)가 직접 넣는 것은 막지 않는다.
-- ---------------------------------------------------------------------
create or replace function public.dues29_guard_intake()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  st       jsonb;
  v_months text;
begin
  if new.user_id is null then return new; end if;
  if public.can_manage() then return new; end if;
  st := public.dues29_status_of(new.user_id);
  if coalesce((st ->> 'blocked')::boolean, false) then
    select string_agg(x.v, '·' order by x.i) into v_months
      from jsonb_array_elements_text(st -> 'late_months') with ordinality as x(v, i);
    raise exception '노회규칙 제29조 제1항에 따라 상회비 미납 중에는 서류 발급 신청과 청원서 접수가 중지됩니다. (% — %년 회기 %월분 미납, %만원) 납부 뒤 다시 신청해 주세요. 이미 납부하셨다면 노회 회계에게 납부 확인을 요청해 주세요.',
      st ->> 'church', st ->> 'fy', coalesce(v_months, ''), st ->> 'late_amount';
  end if;
  return new;
end
$fn$;

drop trigger if exists dues29_guard_doc_requests on public.doc_requests;
create trigger dues29_guard_doc_requests
  before insert on public.doc_requests
  for each row execute function public.dues29_guard_intake();

drop trigger if exists dues29_guard_petitions on public.petition_submissions;
create trigger dues29_guard_petitions
  before insert on public.petition_submissions
  for each row execute function public.dues29_guard_intake();


-- ---------------------------------------------------------------------
-- 6. 알림 — 미납 교회의 담임목사·장로와 직책을 맡은 분, 그리고 회계·서기·노회장·간사 요약
--    자동(p_manual=false): 누가 들어오든 하루 한 번 자리(main.js)에서 부르며, 달마다 한 번만 간다.
--                        유예일 안(1일~grace_days)에는 보내지 않는다.
--    수동(p_manual=true) : 관리자·노회 회계가 임원방에서 누른다. 하루 한 번만 간다.
-- ---------------------------------------------------------------------
create or replace function public.notify_dues_rule29(p_manual boolean default false)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_me       uuid := auth.uid();
  v_fy       int  := public.fy_now();
  v_kst      timestamp := (now() at time zone 'Asia/Seoul');
  v_stamp    text;
  v_sender   text;
  v_sent     int := 0;
  v_churches int := 0;
  v_ch       record;
  v_m        record;
  v_roles    text[];
  v_months   text;
  v_key      text;
  v_title    text;
  v_body     text;
  v_cur_unpaid boolean;
  v_sum      text := '';
  v_aff      text := '';
  v_aff_n    int := 0;
  v_a        record;
begin
  if v_me is null then return 0; end if;

  if p_manual then
    if not (public.can_manage() or public.is_presbytery_treasurer()) then
      raise exception '미납 안내 알림은 노회 관리자와 노회 회계만 보낼 수 있습니다.';
    end if;
    select nullif(btrim(coalesce(p.name, '') || ' ' ||
                        coalesce(nullif(p.title, ''), coalesce(p.position, ''))), '')
      into v_sender
      from public.profiles p where p.id = v_me;
    v_sender := coalesce(v_sender, '노회 사무실');
    v_stamp  := 'm' || to_char(v_kst, 'YYYYMMDD');
  else
    if extract(day from v_kst)::int <= public.dues29_grace_days() then return 0; end if;
    v_sender := '노회 사무실 (자동 안내)';
    v_stamp  := to_char(v_kst, 'YYYYMM');
  end if;

  for v_ch in
    select r.church,
           coalesce(nullif(btrim(r.sichal), ''), '기타') as sichal,
           coalesce(r.monthly_amount, 0)::int as monthly,
           lm.months
      from public.dues_rates r
      cross join lateral (select public.dues29_late_months(r.year, r.church) as months) lm
     where r.year = v_fy and coalesce(array_length(lm.months, 1), 0) > 0
     order by coalesce(nullif(btrim(r.sichal), ''), '기타'), r.sort, r.id
  loop
    v_churches := v_churches + 1;
    v_months := array_to_string(v_ch.months, '·') || '월';
    v_key    := 'dues29-' || v_fy || '-' || public.dues29_key(v_ch.church) || '-' || v_stamp;
    v_cur_unpaid := not exists (
      select 1 from public.dues_payments p
       where p.year = v_fy and p.church = v_ch.church
         and p.month = extract(month from v_kst)::int);
    v_sum := v_sum || '· ' || v_ch.church || ' (' || v_ch.sichal || ') — ' || v_months || '분 ' ||
             coalesce(array_length(v_ch.months, 1), 0) || '개월, ' ||
             (coalesce(array_length(v_ch.months, 1), 0) * v_ch.monthly) || '만원' || chr(10);

    for v_m in
      select p.id as uid,
             coalesce(r.name, p.name) as name,
             coalesce(r.category, '') as category,
             coalesce(r.position, p.position, '') as position,
             coalesce(r.church, p.church) as church
        from public.profiles p
        left join public.roster r on r.id = p.roster_id
       where coalesce(p.role, 'pending') not in ('pending', 'general')
         and coalesce(p.suspended, false) = false
         and public.dues29_key(coalesce(r.church, p.church)) = public.dues29_key(v_ch.church)
    loop
      v_roles := public.dues29_roles(v_m.name, v_m.church, v_m.uid);
      -- 받는 분: 상회비를 내는 자리(담임목사·장로)와 직책을 맡은 분
      if not (public.dues29_pays(v_m.category, v_m.position)
              or coalesce(array_length(v_roles, 1), 0) > 0) then
        continue;
      end if;
      if exists (select 1 from public.notifications n
                  where n.user_id = v_m.uid and n.dedupe_key = v_key) then
        continue;
      end if;

      v_title := '[상회비] ' || v_ch.church || ' ' || v_months || '분 미납 안내 (노회규칙 제29조)';
      v_body  :=
        v_ch.church || ' 상회비 ' || v_fy || '년 회기 ' || v_months || '분 (' ||
        coalesce(array_length(v_ch.months, 1), 0) || '개월, ' ||
        (coalesce(array_length(v_ch.months, 1), 0) * v_ch.monthly) || '만원)이 아직 납부 확인되지 않았습니다.' ||
        chr(10) || chr(10) ||
        '노회규칙 제28조에 따라 매월 상회비는 그 달 말까지 납부하셔야 하며, 제29조에 따라 미납 중에는' || chr(10) ||
        ' 1. 각종 서류·증명서의 발급과 접수가 중지됩니다. (홈페이지의 서류 발급 신청과 청원서 전달이 막힙니다)' || chr(10) ||
        ' 2. 과년도 미납금은 당해 연도 배당금에 합산하여 납부하셔야 합니다.' || chr(10) ||
        ' 3. 미납교회는 노회 임원 및 총대, 시찰·상비부 임원을 할 수 없습니다.' || chr(10) ||
        case when coalesce(array_length(v_roles, 1), 0) > 0
             then '    ※ 현재 맡고 계신 직책: ' || array_to_string(v_roles, ', ') || chr(10)
             else '' end ||
        case when v_cur_unpaid
             then chr(10) || '이번 달(' || extract(month from v_kst)::int || '월)분도 아직 납부 전입니다. 이번 달 말일까지 납부해 주세요.' || chr(10)
             else '' end ||
        chr(10) ||
        '납부하시면 노회 회계가 확인한 뒤 대시보드 <나의 상회비>의 안내가 사라집니다. ' ||
        '이미 납부하셨는데도 이 안내를 받으셨다면 노회 회계에게 납부 확인을 요청해 주세요.';

      insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
      values (v_m.uid, '상회비', left(v_title, 200), v_body, v_key,
              case when p_manual then v_me else null end, v_sender);
      v_sent := v_sent + 1;
    end loop;
  end loop;

  if v_churches = 0 then return 0; end if;

  -- 요약: 제3항 해당자 (계정이 없는 분도 포함)
  for v_a in select * from public._dues29_affected(v_fy) loop
    v_aff_n := v_aff_n + 1;
    v_aff := v_aff || '· ' || v_a.out_name || ' (' || v_a.out_church || ') — ' ||
             array_to_string(v_a.out_roles, ', ') ||
             case when v_a.out_user_id is null then ' [계정 없음]' else '' end || chr(10);
  end loop;

  v_key := 'dues29-sum-' || v_fy || '-' || v_stamp;
  insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
  select p.id, '상회비',
         left('[상회비] 기한 지난 미납 교회 ' || v_churches || '곳 · 제29조 3항 해당 ' || v_aff_n || '명 (' ||
              to_char(v_kst, 'FMYYYY.FMMM.FMDD') || ' 기준)', 200),
         v_fy || '년 회기 상회비 가운데 기한(그 달 말)이 지난 미납이 있는 교회입니다. 세례의무금은 세지 않았습니다.' || chr(10) ||
         chr(10) || '[미납 교회]' || chr(10) || v_sum || chr(10) ||
         '[노회규칙 제29조 3항 — 노회 임원·총대·시찰·상비부 임원 자격 제한 해당자]' || chr(10) ||
         case when v_aff_n > 0 then v_aff else '· 해당 없음' || chr(10) end || chr(10) ||
         '미납 교회 회원은 서류 발급 신청과 청원서 전달이 막혀 있습니다(제1항). ' ||
         '당사자에게는 ' || case when p_manual then '지금' else '이달' end || ' 안내 알림 ' || v_sent || '통이 나갔습니다. ' ||
         '임원방 → 상회비 관리에서 현황을 보실 수 있습니다.',
         v_key,
         case when p_manual then v_me else null end, v_sender
    from public.profiles p
   where coalesce(p.suspended, false) = false
     and (p.role in ('president', 'clerk', 'staff')
          or (p.role = 'officer' and coalesce(p.title, '') like '%회계%'))
     and not exists (select 1 from public.notifications n
                      where n.user_id = p.id and n.dedupe_key = v_key);

  return v_sent;
end
$fn$;
grant execute on function public.notify_dues_rule29(boolean) to authenticated;

comment on function public.notify_dues_rule29(boolean) is
  '노회규칙 제29조 — 기한 지난 상회비 미납 교회의 담임목사·장로·직책자에게 안내 알림, 회계·서기·노회장·간사에게 요약. 자동은 달마다, 수동은 하루 한 번';


-- ---------------------------------------------------------------------
-- 확인
-- ---------------------------------------------------------------------
select '135 상회비 미납 규정 등록 완료' as "결과",
       public.fy_now() as "회기",
       public.dues29_grace_days() as "유예일",
       (select count(*) from public.dues_rates r
         where r.year = public.fy_now()
           and coalesce(array_length(public.dues29_late_months(r.year, r.church), 1), 0) > 0) as "기한 지난 미납 교회",
       (select count(*) from public._dues29_affected(public.fy_now())) as "제3항 해당자";

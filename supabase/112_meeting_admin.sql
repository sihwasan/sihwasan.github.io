-- =====================================================================
--  112. 노회 회의관리 — 정회·속회(새 QR로 다시 입장), 노회 마치기 안전장치·다시 열기,
--       부서기 열람
--
--  1) 정회 · 속회
--     · 서기가 「정회」를 누르면 투표를 올릴 수 없고, 입장도 받지 않는다.
--     · 「속회」를 누르면 출석 QR 코드가 새로 바뀐다. (round 가 하나 올라간다)
--       이미 입장했던 분도 새 QR 코드를 찍어 다시 입장해야 「현장에 있는 분」으로 센다.
--     · 투표는 지금 차례(round)에 입장해 있는 표결 회원만 한다.
--       재석 수(가결 기준의 분모)도 지금 현장에 있는 표결 회원만 센다.
--  2) 노회 마치기는 출석자 명단을 확정한 뒤에만 된다.
--     잘못 마쳤으면 서기가 「다시 열기」로 되돌린다. (assembly_reopen)
--  3) 회의관리 화면(meeting-admin.html)
--     · 서기(노회장·간사 포함 can_manage) — 입력
--     · 부서기 — 열람만 (assembly_list, assembly_admin 을 읽을 수 있다)
--
--  ※ 105 → 106 → 107 → 108 → 110_assembly_observer.sql 다음에 실행합니다.
--  ※ 여러 번 실행해도 안전합니다.
--  실행 방법 : Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run
-- =====================================================================

do $chk$
begin
  if to_regprocedure('public.assembly_seat()') is null then
    raise exception '먼저 110_assembly_observer.sql 을 실행해 주세요.';
  end if;
end
$chk$;


-- ---------------------------------------------------------------------
-- 1. 칸
-- ---------------------------------------------------------------------
alter table public.assembly_meetings  add column if not exists round      integer not null default 1;
alter table public.assembly_meetings  add column if not exists recess     boolean not null default false;
alter table public.assembly_meetings  add column if not exists recess_at  timestamptz;
alter table public.assembly_meetings  add column if not exists resumed_at timestamptz;
alter table public.assembly_meetings  add column if not exists codes      jsonb not null default '[]'::jsonb; -- 지난 QR 코드 기록
alter table public.assembly_attendees add column if not exists round      integer not null default 1;     -- 마지막으로 입장한 차례
alter table public.assembly_attendees add column if not exists reentered_at timestamptz;

comment on column public.assembly_meetings.round is '속회할 때마다 1씩 올라간다. 지금 차례에 입장한 분만 현장 투표';
comment on column public.assembly_attendees.round is '이 분이 마지막으로 QR을 찍고 입장한 차례';


-- ---------------------------------------------------------------------
-- 2. 볼 수 있는 사람 / 쓸 수 있는 사람
-- ---------------------------------------------------------------------
-- 부서기 — 임원(officer) 가운데 직책이 정확히 '부서기'인 분 (회록부서기·부회록서기는 아님)
create or replace function public.is_vice_clerk()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and role = 'officer' and btrim(coalesce(title, '')) = '부서기');
$fn$;

create or replace function public.can_view_meeting()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.can_manage() or public.is_vice_clerk();
$fn$;
grant execute on function public.is_vice_clerk() to authenticated;
grant execute on function public.can_view_meeting() to authenticated;


-- ---------------------------------------------------------------------
-- 3. 입장하기 (110 기준) — 정회 중에는 받지 않고, 속회 뒤에는 새 차례로 다시 입장
-- ---------------------------------------------------------------------
create or replace function public.assembly_enter(p_code text)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  m public.assembly_meetings%rowtype;
  p public.profiles%rowtype;
  j jsonb;
  s jsonb;
  v_old text;
begin
  if auth.uid() is null then raise exception '로그인해 주세요.'; end if;
  select * into m from public.assembly_meetings
   where code = upper(btrim(coalesce(p_code, ''))) and status <> 'closed';
  if m.id is null then
    -- 정회 전 QR(지난 코드)을 찍었는가
    select x.code into v_old from public.assembly_meetings x
     where x.status <> 'closed' and x.codes ? upper(btrim(coalesce(p_code, ''))) limit 1;
    if v_old is not null then
      raise exception '정회 전에 쓰던 QR 코드입니다. 속회하면서 새 QR 코드가 나왔습니다. 회의장의 새 QR 코드를 찍어 주세요.';
    end if;
    raise exception '입장 코드가 맞지 않거나 이미 마친 노회입니다.';
  end if;
  if m.recess then
    raise exception '지금은 정회 중입니다. 속회하면 회의장에 새 QR 코드가 나옵니다. 그 QR 코드를 찍어 입장해 주세요.';
  end if;
  if public.assembly_meeting_day() is null then
    raise exception '노회 당일에 입장할 수 있습니다. (노회 날짜는 노회 일정에 설정된 날입니다)';
  end if;
  select * into p from public.profiles where id = auth.uid();
  j := to_jsonb(p);
  if p.id is null then
    raise exception '승인 대기 중인 계정은 입장할 수 없습니다. 서기에게 문의해 주세요.';
  end if;
  if coalesce((j->>'suspended')::boolean, false) then
    raise exception '이용이 정지된 계정입니다.';
  end if;

  s := public.assembly_seat();
  if s is null or s->>'seat' is null then
    if p.role = 'pending' then
      raise exception '승인 대기 중인 계정은 입장할 수 없습니다. 서기에게 문의해 주세요.';
    end if;
    if p.role = 'general' then
      raise exception '일반회원은 노회 회원이 아니므로 입장할 수 없습니다.';
    end if;
    if s->>'kind' = '장로' then
      raise exception '찾아 주셔서 감사합니다. 노회에는 당회에서 총대로 파송된 장로님께서 입장하십니다. 총대로 파송되셨다면 서기에게 말씀해 주세요. 바로 확인해 드리겠습니다.';
    end if;
    raise exception '입장할 수 없는 계정입니다. 서기에게 문의해 주세요.';
  end if;

  insert into public.assembly_attendees
    (meeting_id, user_id, roster_id, name, church, position, kind, grade, full_member, seat, honor, round)
  values
    (m.id, p.id, nullif(j->>'roster_id', '')::bigint, p.name, p.church, p.position,
     coalesce(s->>'kind', '기타'), s->>'grade', s->>'seat' = 'vote', s->>'seat', s->'veteran', m.round)
  on conflict (meeting_id, user_id) do update
     set round = excluded.round,
         reentered_at = case when public.assembly_attendees.round <> excluded.round then now()
                             else public.assembly_attendees.reentered_at end;
  return m.id;
end
$fn$;
revoke all on function public.assembly_enter(text) from public, anon;
grant execute on function public.assembly_enter(text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 정회 · 속회
-- ---------------------------------------------------------------------
create or replace function public.assembly_recess(p_meeting bigint)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_manage() then raise exception '서기만 정회할 수 있습니다.'; end if;
  if exists (select 1 from public.assembly_votes where meeting_id = p_meeting and status = '진행') then
    raise exception '진행 중인 투표를 먼저 종료해 주세요.';
  end if;
  update public.assembly_meetings set recess = true, recess_at = now()
   where id = p_meeting and status <> 'closed';
  if not found then raise exception '진행 중인 노회가 아닙니다.'; end if;
end
$fn$;

-- 속회 — 새 QR 코드를 만들고 차례를 하나 올린다. 돌려주는 값 = 새 코드
create or replace function public.assembly_resume(p_meeting bigint)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  m      public.assembly_meetings%rowtype;
  v_code text;
begin
  if not public.can_manage() then raise exception '서기만 속회할 수 있습니다.'; end if;
  select * into m from public.assembly_meetings where id = p_meeting and status <> 'closed' for update;
  if m.id is null then raise exception '진행 중인 노회가 아닙니다.'; end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from public.assembly_meetings where code = v_code);
  end loop;
  update public.assembly_meetings
     set code = v_code, round = m.round + 1, recess = false, resumed_at = now(),
         codes = coalesce(m.codes, '[]'::jsonb) || to_jsonb(m.code)
   where id = m.id;
  return v_code;
end
$fn$;


-- ---------------------------------------------------------------------
-- 5. 투표 — 정회 중에는 올리지 않고, 지금 차례에 입장한 표결 회원만
-- ---------------------------------------------------------------------
create or replace function public.assembly_vote_start(p_meeting bigint, p_title text, p_mode text, p_rule text,
                                                      p_test boolean default false)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  v_id bigint;
  v_me text;
begin
  if not public.can_manage() then raise exception '서기만 투표를 올릴 수 있습니다.'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception '투표 주제를 적어 주세요.'; end if;
  if p_mode not in ('기명', '무기명') then raise exception '기명·무기명 가운데 골라 주세요.'; end if;
  if p_rule not in ('과반', '3분의2') then raise exception '가결 기준(과반·3분의 2)을 골라 주세요.'; end if;
  if not exists (select 1 from public.assembly_meetings where id = p_meeting and status <> 'closed') then
    raise exception '진행 중인 노회가 아닙니다.';
  end if;
  if exists (select 1 from public.assembly_meetings where id = p_meeting and recess) then
    raise exception '정회 중에는 투표를 올릴 수 없습니다. 속회한 뒤 새 QR로 다시 입장을 받고 투표해 주세요.';
  end if;
  if exists (select 1 from public.assembly_votes where meeting_id = p_meeting and status = '진행') then
    raise exception '진행 중인 투표가 있습니다. 먼저 종료해 주세요.';
  end if;
  select name into v_me from public.profiles where id = auth.uid();
  insert into public.assembly_votes (meeting_id, title, mode, rule, is_test, created_by)
  values (p_meeting, btrim(p_title), p_mode, p_rule, coalesce(p_test, false), v_me) returning id into v_id;
  return v_id;
end
$fn$;

create or replace function public.assembly_vote_cast(p_vote bigint, p_choice text)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v    public.assembly_votes%rowtype;
  a    public.assembly_attendees%rowtype;
  m    public.assembly_meetings%rowtype;
  v_me text;
begin
  select * into v from public.assembly_votes where id = p_vote;
  if v.id is null or v.status <> '진행' then raise exception '투표가 이미 종료되었습니다.'; end if;
  if p_choice not in ('찬성', '반대') then raise exception '찬성·반대 가운데 골라 주세요.'; end if;
  select * into m from public.assembly_meetings where id = v.meeting_id;
  select * into a from public.assembly_attendees
   where meeting_id = v.meeting_id and user_id = auth.uid();
  if a.id is null then raise exception '먼저 노회에 입장해 주세요.'; end if;
  -- 정회 뒤 속회했으면 새 QR로 다시 입장한 분만 (현장에 있는 분만 투표)
  if a.round <> m.round then
    raise exception '속회 후 새 QR 코드로 다시 입장해야 투표할 수 있습니다. 회의장의 새 QR 코드를 찍어 주세요.';
  end if;
  if not a.full_member or coalesce(a.seat, 'vote') <> 'vote' or not public.is_full_member() then
    raise exception '표결은 정회원 목사와 총대 장로께서 하십니다.';
  end if;
  begin
    insert into public.assembly_vote_voters (vote_id, user_id) values (v.id, auth.uid());
  exception when unique_violation then
    raise exception '이미 투표하셨습니다.';
  end;
  if v.mode = '기명' then
    select name into v_me from public.profiles where id = auth.uid();
    insert into public.assembly_ballots (vote_id, choice, voter_id, voter_name)
    values (v.id, p_choice, auth.uid(), v_me);
  else
    -- 무기명: 표를 남기지 않고 수만 센다
    if p_choice = '찬성' then
      update public.assembly_votes set anon_yes = anon_yes + 1 where id = v.id;
    else
      update public.assembly_votes set anon_no = anon_no + 1 where id = v.id;
    end if;
  end if;
end
$fn$;

-- 재석 = 지금 차례에 입장해 있는 표결 회원
create or replace function public.assembly_vote_end(p_vote bigint)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_manage() then raise exception '서기만 투표를 종료할 수 있습니다.'; end if;
  update public.assembly_votes v
     set status = '종료', ended_at = now(),
         eligible = (select count(*) from public.assembly_attendees a
                       join public.assembly_meetings m on m.id = a.meeting_id
                      where a.meeting_id = v.meeting_id and a.full_member and a.round = m.round)
   where v.id = p_vote and v.status = '진행';
end
$fn$;


-- ---------------------------------------------------------------------
-- 6. 노회 마치기 — 명단을 확정한 뒤에만 / 잘못 마쳤으면 다시 열기
-- ---------------------------------------------------------------------
create or replace function public.assembly_close(p_meeting bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  m public.assembly_meetings%rowtype;
begin
  if not public.can_manage() then raise exception '서기만 노회를 마칠 수 있습니다.'; end if;
  select * into m from public.assembly_meetings where id = p_meeting;
  if m.id is null or m.status = 'closed' then return; end if;
  if m.status = 'open' then
    raise exception '출석자 명단을 아직 확정하지 않았습니다. 「명단 확정하기」를 먼저 눌러 주세요.';
  end if;
  if exists (select 1 from public.assembly_attendees where meeting_id = m.id and not confirmed) then
    raise exception '확정 뒤에 입장한 분이 명단에 들어가지 않았습니다. 「명단에 넣기」를 먼저 눌러 주세요.';
  end if;
  if exists (select 1 from public.assembly_votes where meeting_id = p_meeting and status = '진행') then
    raise exception '진행 중인 투표를 먼저 종료해 주세요.';
  end if;
  update public.assembly_meetings set status = 'closed', closed_at = now(), recess = false
   where id = p_meeting and status <> 'closed';
end
$fn$;

create or replace function public.assembly_reopen(p_meeting bigint)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  m public.assembly_meetings%rowtype;
  v_st text;
begin
  if not exists (select 1 from public.profiles
                  where id = auth.uid() and role in ('clerk', 'superadmin')) then
    raise exception '서기만 마친 노회를 다시 열 수 있습니다.';
  end if;
  select * into m from public.assembly_meetings where id = p_meeting;
  if m.id is null then raise exception '노회를 찾지 못했습니다.'; end if;
  if m.status <> 'closed' then return m.status; end if;
  -- 명단을 확정한 적이 없으면 입장 받는 상태로, 확정했으면 회의 진행 상태로
  v_st := case when m.confirmed_at is null then 'open' else 'confirmed' end;
  update public.assembly_meetings set status = v_st, closed_at = null where id = m.id;
  return v_st;
end
$fn$;


-- ---------------------------------------------------------------------
-- 7. 화면 상태 (110 기준) — 정회·차례·현장 여부를 더한다
-- ---------------------------------------------------------------------
create or replace function public.assembly_state(p_code text default null, p_meeting bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  p      public.profiles%rowtype;
  m      public.assembly_meetings%rowtype;
  a      public.assembly_attendees%rowtype;
  v_mgr  boolean;
  v_tre  boolean;
  v_code boolean := false;
  j      jsonb;
  v_vote bigint;
  v_seat jsonb;
begin
  if v_uid is null then return jsonb_build_object('login', false, 'now', now()); end if;
  select * into p from public.profiles where id = v_uid;
  v_mgr := public.can_manage();
  v_tre := public.is_presbytery_treasurer();

  if btrim(coalesce(p_code, '')) <> '' then
    select * into m from public.assembly_meetings
     where code = upper(btrim(p_code)) and status <> 'closed';
    v_code := m.id is not null;
  end if;
  if m.id is null and p_meeting is not null and (v_mgr or v_tre) then
    select * into m from public.assembly_meetings where id = p_meeting;
  end if;
  if m.id is null then
    select * into m from public.assembly_meetings x
     where x.status <> 'closed'
     order by (x.meet_date = (now() at time zone 'Asia/Seoul')::date) desc,
              exists (select 1 from public.assembly_attendees t
                       where t.meeting_id = x.id and t.user_id = v_uid) desc,
              (x.meet_date >= (now() at time zone 'Asia/Seoul')::date) desc,
              abs(x.meet_date - (now() at time zone 'Asia/Seoul')::date)
     limit 1;
  end if;
  if m.id is null then
    select * into m from public.assembly_meetings x
     where x.status = 'closed' and x.closed_at > now() - interval '60 days'
       and (v_mgr or v_tre or exists (select 1 from public.assembly_attendees t
                                       where t.meeting_id = x.id and t.user_id = v_uid))
     order by x.id desc limit 1;
  end if;

  if m.id is not null then
    select * into a from public.assembly_attendees where meeting_id = m.id and user_id = v_uid;
  end if;
  if a.id is not null then
    if a.seat is not null then
      v_seat := jsonb_build_object('kind', a.kind, 'seat', a.seat, 'grade', a.grade, 'veteran', a.honor);
    end if;
  else
    v_seat := public.assembly_seat();
  end if;

  j := jsonb_build_object('login', true, 'now', now(), 'code_ok', v_code,
    'me', jsonb_build_object('name', p.name, 'position', p.position, 'church', p.church, 'role', p.role,
                             'full', case when a.id is not null then a.full_member
                                          when v_seat is not null then coalesce(v_seat->>'seat' = 'vote', false)
                                          else public.is_full_member() end,
                             'mgr', v_mgr, 'tre', v_tre,
                             'seat_known', v_seat is not null,
                             'seat', v_seat->>'seat', 'grade', v_seat->>'grade',
                             'kind', v_seat->>'kind', 'veteran', v_seat->'veteran'));
  if m.id is null then return j || jsonb_build_object('meeting', null); end if;

  j := j || jsonb_build_object(
    'meeting', jsonb_build_object('id', m.id, 'title', m.title, 'session_no', m.session_no, 'meet_date', m.meet_date,
                 'status', m.status, 'confirmed_at', m.confirmed_at,
                 'recess', m.recess, 'round', m.round, 'recess_at', m.recess_at, 'resumed_at', m.resumed_at,
                 'today', m.meet_date = (now() at time zone 'Asia/Seoul')::date,
                 'code', case when v_mgr then m.code else null end),
    'entered', a.id is not null,
    'my', case when a.id is null then null else jsonb_build_object(
            'id', a.id, 'name', a.name, 'church', a.church, 'position', a.position,
            'grade', a.grade, 'full_member', a.full_member, 'confirmed', a.confirmed,
            'seat', a.seat, 'honor', a.honor,
            'present', a.round = m.round,
            'entered_at', a.entered_at, 'reentered_at', a.reentered_at, 'allow_amount', a.allow_amount,
            'allow_status', a.allow_status, 'allow_paid_at', a.allow_paid_at,
            'allow_paid_by', a.allow_paid_by, 'allow_received_at', a.allow_received_at,
            'in_ledger', a.ledger_entry_id is not null) end);

  if a.id is null and not v_mgr and not v_tre then return j; end if;

  j := j || jsonb_build_object('counts', (
    select jsonb_build_object(
      'total', count(*) filter (where coalesce(seat, '') <> 'observe'),
      'pastor', count(*) filter (where kind = '목사' and coalesce(seat, '') <> 'observe'),
      'elder', count(*) filter (where kind = '장로' and coalesce(seat, '') <> 'observe'),
      'etc', count(*) filter (where kind = '기타' and coalesce(seat, '') <> 'observe'),
      'observer', count(*) filter (where seat = 'observe'),
      'full', count(*) filter (where full_member and round = m.round),
      'present', count(*) filter (where round = m.round and coalesce(seat, '') <> 'observe'),
      'away', count(*) filter (where round <> m.round and coalesce(seat, '') <> 'observe'),
      'c_total', count(*) filter (where confirmed and coalesce(seat, '') <> 'observe'),
      'c_pastor', count(*) filter (where confirmed and kind = '목사' and coalesce(seat, '') <> 'observe'),
      'c_elder', count(*) filter (where confirmed and kind = '장로' and coalesce(seat, '') <> 'observe'),
      'c_etc', count(*) filter (where confirmed and kind = '기타' and coalesce(seat, '') <> 'observe'),
      'c_observer', count(*) filter (where confirmed and seat = 'observe'))
      from public.assembly_attendees where meeting_id = m.id));

  select id into v_vote from public.assembly_votes where meeting_id = m.id order by id desc limit 1;
  j := j || jsonb_build_object(
    'vote', public.assembly_vote_json(v_vote),
    'history', (select coalesce(jsonb_agg(public.assembly_vote_json(x.id) order by x.id desc), '[]'::jsonb)
                  from public.assembly_votes x
                 where x.meeting_id = m.id and x.status = '종료' and x.id <> coalesce(v_vote, 0) and not x.is_test));

  if v_mgr or v_tre then
    j := j || jsonb_build_object('attendees', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'church', t.church, 'position', t.position,
               'kind', t.kind, 'grade', t.grade, 'confirmed', t.confirmed,
               'seat', t.seat, 'honor', t.honor, 'present', t.round = m.round,
               'entered_at', t.entered_at, 'reentered_at', t.reentered_at, 'allow_amount', t.allow_amount,
               'allow_status', t.allow_status, 'allow_received_at', t.allow_received_at,
               'in_ledger', t.ledger_entry_id is not null)
             order by case when t.seat = 'observe' then 4
                           when t.kind = '목사' then 1 when t.kind = '장로' then 2 else 3 end, t.name), '[]'::jsonb)
        from public.assembly_attendees t where t.meeting_id = m.id));
  end if;
  return j;
end
$fn$;


-- ---------------------------------------------------------------------
-- 8. 회의관리 — 회기 목록과 한 노회의 모든 기록 (서기·부서기)
-- ---------------------------------------------------------------------
create or replace function public.assembly_list()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'title', m.title, 'session_no', m.session_no, 'meet_date', m.meet_date,
           'status', m.status, 'recess', m.recess, 'round', m.round,
           'code', case when public.can_manage() then m.code else null end,
           'today', m.meet_date = (now() at time zone 'Asia/Seoul')::date,
           'attendees', (select count(*) from public.assembly_attendees a where a.meeting_id = m.id),
           'confirmed', (select count(*) from public.assembly_attendees a where a.meeting_id = m.id and a.confirmed),
           'votes', (select count(*) from public.assembly_votes v where v.meeting_id = m.id and not v.is_test))
         order by m.session_no desc nulls last, m.id desc), '[]'::jsonb)
    from public.assembly_meetings m
   where public.can_view_meeting();
$fn$;

create or replace function public.assembly_admin(p_meeting bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  m public.assembly_meetings%rowtype;
begin
  if not public.can_view_meeting() then raise exception '서기·부서기만 볼 수 있습니다.'; end if;
  select * into m from public.assembly_meetings where id = p_meeting;
  if m.id is null then return null; end if;
  return jsonb_build_object(
    'can_edit', public.can_manage(),
    'meeting', jsonb_build_object('id', m.id, 'title', m.title, 'session_no', m.session_no,
                 'meet_date', m.meet_date, 'status', m.status, 'created_by', m.created_by, 'created_at', m.created_at,
                 'confirmed_at', m.confirmed_at, 'confirmed_by', m.confirmed_by, 'closed_at', m.closed_at,
                 'recess', m.recess, 'round', m.round, 'recess_at', m.recess_at, 'resumed_at', m.resumed_at,
                 'code', case when public.can_manage() then m.code else null end),
    'attendees', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'church', t.church, 'position', t.position,
               'kind', t.kind, 'grade', t.grade, 'seat', t.seat, 'honor', t.honor,
               'full_member', t.full_member, 'confirmed', t.confirmed,
               'present', t.round = m.round, 'round', t.round,
               'entered_at', t.entered_at, 'reentered_at', t.reentered_at,
               'allow_amount', t.allow_amount, 'allow_status', t.allow_status,
               'allow_paid_by', t.allow_paid_by, 'allow_received_at', t.allow_received_at,
               'in_ledger', t.ledger_entry_id is not null)
             order by case when t.seat = 'observe' then 4
                           when t.kind = '목사' then 1 when t.kind = '장로' then 2 else 3 end, t.name), '[]'::jsonb)
        from public.assembly_attendees t where t.meeting_id = m.id),
    'votes', (
      select coalesce(jsonb_agg(public.assembly_vote_json(v.id) || jsonb_build_object('created_by', v.created_by)
                                order by v.id), '[]'::jsonb)
        from public.assembly_votes v where v.meeting_id = m.id));
end
$fn$;


-- ---------------------------------------------------------------------
-- 9. 권한
-- ---------------------------------------------------------------------
do $g$
declare
  f text;
begin
  foreach f in array array[
    'assembly_recess(bigint)', 'assembly_resume(bigint)', 'assembly_reopen(bigint)',
    'assembly_close(bigint)', 'assembly_vote_start(bigint, text, text, text, boolean)',
    'assembly_vote_end(bigint)', 'assembly_list()', 'assembly_admin(bigint)']
  loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end
$g$;
revoke all on function public.assembly_state(text, bigint) from public;
grant execute on function public.assembly_state(text, bigint) to anon, authenticated;
revoke all on function public.assembly_vote_cast(bigint, text) from public, anon;
grant execute on function public.assembly_vote_cast(bigint, text) to authenticated;


-- ---------------------------------------------------------------------
-- 10. 확인 — 회기별 상태와 확정 명단 수
--     (명단 확정 없이 마친 노회는 status = closed, confirmed_at 이 비어 있음 →
--      회의관리 화면에서 「다시 열기」 후 「명단 확정하기」)
-- ---------------------------------------------------------------------
select m.session_no, m.title, m.status, m.confirmed_at, m.round, m.recess,
       (select count(*) from public.assembly_attendees a where a.meeting_id = m.id) as 입장,
       (select count(*) from public.assembly_attendees a where a.meeting_id = m.id and a.confirmed) as 확정
  from public.assembly_meetings m order by m.id desc;

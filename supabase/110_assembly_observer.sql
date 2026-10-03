-- =====================================================================
--  110. 오늘의 노회 — 입장 자격 · 표결권 정리, 증경부노회장 장로님 예우 참관
--
--  노회 회원과 표결
--    · 표결(투표)은 정회원 목사와 총대 장로만 한다.
--        정회원 목사 = 위임·시무목사, 부목사, 무임목사 (언권회원·준회원·원로·은퇴목사 제외)
--        총대 장로   = 노회 명단(roster)에 장로 총대로 올라 있는 분
--                      (category '장로', 교체되지 않음) — 또는 교회 명부의 총대장로 표시,
--                      또는 지금 노회 임원(officer·president·clerk)으로 섬기는 장로
--    · 원로목사·은퇴목사·언권회원·준회원 목사는 입장해 언권(발언)만 가진다. 표결은 하지 않는다.
--    · 총대가 아닌 장로는 입장할 수 없다.
--    · 예외: 증경부노회장(사이트 관리 → 임원 명부 → 증경노회장단, site_settings 'veterans')을
--      지내신 장로님은 총대가 아니어도 예우하여 「참관」으로 모신다. 언권·표결은 없다.
--      (지금 총대인 증경부노회장 장로님은 여느 총대 장로와 같이 표결한다)
--    · 목사·장로가 아닌 계정(간사 등)은 참관으로 입장한다. 표결은 없다.
--
--  재석 수(가결 기준의 분모)는 입장한 사람 가운데 표결권이 있는 사람(full_member)만 센다.
--  참관은 참석 수·목사·장로 총대 수에 넣지 않고 「참관」으로 따로 센다.
--
--  바뀌는 함수 : assembly_seat (새로), assembly_enter, assembly_vote_cast, assembly_state
--  바뀌는 표   : assembly_attendees 에 seat(자리: vote 표결 / speak 언권 / observe 참관),
--                honor(예우 — 증경부노회장 회기) 칸을 더한다.
--
--  ※ 저장소의 SQL 은 운영 DB 보다 늦을 수 있습니다. 실행하기 전에 운영 DB 에서
--       select pg_get_functiondef('public.assembly_enter(text)'::regprocedure);
--       select pg_get_functiondef('public.assembly_vote_cast(bigint, text)'::regprocedure);
--       select pg_get_functiondef('public.assembly_state(text, bigint)'::regprocedure);
--     로 지금 함수 본문을 꺼내 아래(105·106·108 기준)와 비교하고, 운영에만 있는 고침이
--     있으면 함께 옮겨 주세요.
--
--  실행 방법 : Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run
--  ※ 105, 106, 107, 108 다음에 실행합니다. 여러 번 실행해도 안전합니다.
--  ※ 실행하지 않아도 화면은 예전처럼 동작합니다. (예우 안내·참관 구분만 나타나지 않음)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 입장 명단에 자리·예우 칸
-- ---------------------------------------------------------------------
alter table public.assembly_attendees add column if not exists seat  text;   -- vote / speak / observe
alter table public.assembly_attendees add column if not exists honor jsonb;  -- {"role":"증경부노회장","sessions":[19]}

comment on column public.assembly_attendees.seat is
  '노회 자리 — vote(표결: 정회원 목사·총대 장로) / speak(언권: 원로·은퇴·언권·준회원 목사) / observe(참관)';
comment on column public.assembly_attendees.honor is
  '예우 — 증경부노회장 장로님이면 {"role":"증경부노회장","sessions":[회기...]}';


-- ---------------------------------------------------------------------
-- 2. 지금 로그인한 사람의 노회 자리
--    돌려주는 값 : {"kind": 목사/장로/기타, "seat": vote/speak/observe/null,
--                  "grade": 정회원/언권회원/준회원/참관, "veteran": {...} 또는 없음}
--    seat 이 null 이면 입장할 수 없다.
-- ---------------------------------------------------------------------
create or replace function public.assembly_seat()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  p      public.profiles%rowtype;
  j      jsonb;
  r      public.roster%rowtype;
  v_name text;
  v_ch   text;
  v_rch  text;
  v_pos  text;
  v_kind text;
  v_full boolean;
  v_del  boolean := false;
  v_emer boolean;
  v_list jsonb;
  v_n    integer := 0;
  v_sess jsonb;
begin
  if v_uid is null then return null; end if;
  select * into p from public.profiles where id = v_uid;
  if p.id is null then return null; end if;
  j := to_jsonb(p);
  v_name := regexp_replace(coalesce(p.name, ''), '\s', '', 'g');
  v_ch   := regexp_replace(regexp_replace(coalesce(p.church, ''), '\s', '', 'g'), '교회$', '');

  -- 노회 명단(roster)의 내 줄 : 이어진 번호 → 없으면 같은 이름·교회
  if nullif(j->>'roster_id', '') is not null then
    select * into r from public.roster where id = (j->>'roster_id')::bigint;
  end if;
  if r.id is null and v_name <> '' and v_ch <> '' then
    select * into r from public.roster x
     where regexp_replace(coalesce(x.name, ''), '\s', '', 'g') = v_name
       and regexp_replace(regexp_replace(coalesce(x.church, ''), '\s', '', 'g'), '교회$', '') = v_ch
     order by coalesce(x.active, true) desc, x.id
     limit 1;
  end if;
  v_rch := regexp_replace(regexp_replace(coalesce(r.church, ''), '\s', '', 'g'), '교회$', '');

  v_pos  := coalesce(nullif(btrim(coalesce(p.position, '')), ''), r.position, r.category, '');
  v_kind := case when v_pos like '%목사%' then '목사'
                 when v_pos like '%장로%' then '장로'
                 else '기타' end;
  v_full := public.is_full_member();   -- 언권회원·준회원·일반회원·승인대기·정년 미확정은 아님

  -- ── 목사 ──────────────────────────────────────────────────────────
  if v_kind = '목사' then
    if p.role in ('pending', 'general') then
      return jsonb_build_object('kind', v_kind, 'seat', null, 'grade', null);
    end if;
    v_emer := coalesce(r.category, '') in ('원로목사', '은퇴목사')
              or v_pos like '%원로%' or v_pos like '%은퇴%';
    if v_full and not v_emer then
      -- 위임·시무목사, 부목사, 무임목사
      return jsonb_build_object('kind', v_kind, 'seat', 'vote', 'grade', '정회원');
    end if;
    return jsonb_build_object('kind', v_kind, 'seat', 'speak',
             'grade', case when p.role = 'associate' then '준회원' else '언권회원' end);
  end if;

  -- ── 장로 ──────────────────────────────────────────────────────────
  if v_kind = '장로' then
    -- 총대인가 : 노회 임원 / 노회 명단의 장로 총대(교체되지 않음)
    --           / (노회 명단에 장로 줄이 없을 때만) 교회 명부의 총대장로 표시
    --   명단에서 '교체됨'(active = false)인 분은 교회 명부 표시가 남아 있어도 총대로 보지 않는다.
    v_del := coalesce(p.role in ('officer', 'president', 'clerk'), false);
    if r.id is not null and coalesce(r.category, '') = '장로' then
      v_del := v_del or coalesce(r.active, true);
    elsif not v_del then
      begin
        select true into v_del
          from public.church_staff s
         where coalesce(s.is_chongdae, false)
           and coalesce(s.role, '') not like '%원로%'
           and coalesce(s.role, '') not like '%은퇴%'
           and ((r.id is not null and s.roster_id = r.id)
             or (v_name <> '' and v_ch <> ''
                 and regexp_replace(coalesce(s.name, ''), '\s', '', 'g') = v_name
                 and regexp_replace(regexp_replace(coalesce(s.church, ''), '\s', '', 'g'), '교회$', '') = v_ch))
         limit 1;
      exception when others then
        v_del := false;
      end;
      v_del := coalesce(v_del, false);
    end if;
    if v_del and v_full then
      return jsonb_build_object('kind', v_kind, 'seat', 'vote', 'grade', '정회원');
    end if;

    -- 증경부노회장을 지내신 장로님 — 예우 참관
    --   증경단 명단의 이름이 같고, 두 쪽에 교회가 다 적혀 있으면 교회도 맞아야 한다.
    select value into v_list from public.site_settings where key = 'veterans';
    v_list := case when jsonb_typeof(v_list) = 'array' then v_list
                   else coalesce(v_list->'list', '[]'::jsonb) end;
    if jsonb_typeof(v_list) <> 'array' then v_list := '[]'::jsonb; end if;
    if v_name <> '' then
      select count(*),
             coalesce(jsonb_agg(distinct t.sno order by t.sno) filter (where t.sno is not null), '[]'::jsonb)
        into v_n, v_sess
        from (select case when coalesce(x->>'session_no', '') ~ '^\d{1,4}$'
                          then (x->>'session_no')::integer end as sno,
                     regexp_replace(regexp_replace(coalesce(x->>'church', ''), '\s', '', 'g'), '교회$', '') as vc
                from jsonb_array_elements(v_list) x
               where btrim(coalesce(x->>'role', '')) = '증경부노회장'
                 and coalesce(x->>'position', '') not like '%목사%'
                 and regexp_replace(coalesce(x->>'name', ''), '\s', '', 'g') = v_name) t
       where t.vc = ''
          or (v_ch = '' and v_rch = '')
          or t.vc = v_ch or t.vc = v_rch
          or (v_ch <> '' and (strpos(t.vc, v_ch) > 0 or strpos(v_ch, t.vc) > 0))
          or (v_rch <> '' and (strpos(t.vc, v_rch) > 0 or strpos(v_rch, t.vc) > 0));
    end if;
    if v_n > 0 then
      return jsonb_build_object('kind', v_kind, 'seat', 'observe', 'grade', '참관',
               'veteran', jsonb_build_object('role', '증경부노회장', 'sessions', v_sess));
    end if;

    -- 총대가 아닌 장로님은 입장할 수 없다
    return jsonb_build_object('kind', v_kind, 'seat', null, 'grade', null);
  end if;

  -- ── 목사·장로가 아닌 계정(간사 등) — 참관 ─────────────────────────
  if p.role in ('pending', 'general') then
    return jsonb_build_object('kind', v_kind, 'seat', null, 'grade', null);
  end if;
  return jsonb_build_object('kind', v_kind, 'seat', 'observe', 'grade', '참관');
end
$fn$;
-- 다른 assembly_* 함수 안에서만 쓴다
revoke all on function public.assembly_seat() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. 입장하기 (106 기준) — 자리를 정해 적는다
-- ---------------------------------------------------------------------
create or replace function public.assembly_enter(p_code text)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  m public.assembly_meetings%rowtype;
  p public.profiles%rowtype;
  j jsonb;
  s jsonb;
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
    (meeting_id, user_id, roster_id, name, church, position, kind, grade, full_member, seat, honor)
  values
    (m.id, p.id, nullif(j->>'roster_id', '')::bigint, p.name, p.church, p.position,
     coalesce(s->>'kind', '기타'), s->>'grade', s->>'seat' = 'vote', s->>'seat', s->'veteran')
  on conflict (meeting_id, user_id) do nothing;
  return m.id;
end
$fn$;
revoke all on function public.assembly_enter(text) from public, anon;
grant execute on function public.assembly_enter(text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 투표하기 (108 기준) — 입장 때 표결 자리(정회원 목사·총대 장로)로 들어온 사람만
-- ---------------------------------------------------------------------
create or replace function public.assembly_vote_cast(p_vote bigint, p_choice text)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v    public.assembly_votes%rowtype;
  a    public.assembly_attendees%rowtype;
  v_me text;
begin
  select * into v from public.assembly_votes where id = p_vote;
  if v.id is null or v.status <> '진행' then raise exception '투표가 이미 종료되었습니다.'; end if;
  if p_choice not in ('찬성', '반대') then raise exception '찬성·반대 가운데 골라 주세요.'; end if;
  select * into a from public.assembly_attendees
   where meeting_id = v.meeting_id and user_id = auth.uid();
  if a.id is null then raise exception '먼저 노회에 입장해 주세요.'; end if;
  -- 표결은 정회원 목사·총대 장로만 (참관·언권·준회원은 하지 않는다)
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
revoke all on function public.assembly_vote_cast(bigint, text) from public, anon;
grant execute on function public.assembly_vote_cast(bigint, text) to authenticated;


-- ---------------------------------------------------------------------
-- 5. 화면 상태 (105 기준) — 내 자리·예우, 참관 수를 함께 담는다
--    참석·목사·장로 총대 수에서 참관은 빼고 'observer' 로 따로 센다.
--    재석(가결 기준) 'full' 은 표결 자리만 센다. (assembly_vote_end 의 eligible 과 같은 기준)
-- ---------------------------------------------------------------------
drop function if exists public.assembly_state(text);
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
  -- 서기·회계가 회기 상자에서 고른 노회
  if m.id is null and p_meeting is not null and (v_mgr or v_tre) then
    select * into m from public.assembly_meetings where id = p_meeting;
  end if;
  -- 오늘 열리는 노회 → 내가 입장해 있는 노회 → 가장 가까운 앞으로의 노회
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
    -- 마친 노회 — 거마비 수령 확인·승인이 남아 있을 수 있어 60일 동안 보여 준다
    select * into m from public.assembly_meetings x
     where x.status = 'closed' and x.closed_at > now() - interval '60 days'
       and (v_mgr or v_tre or exists (select 1 from public.assembly_attendees t
                                       where t.meeting_id = x.id and t.user_id = v_uid))
     order by x.id desc limit 1;
  end if;

  if m.id is not null then
    select * into a from public.assembly_attendees where meeting_id = m.id and user_id = v_uid;
  end if;
  -- 내 자리 : 입장했으면 입장 때 정해진 자리, 아니면 지금 자격으로 (입장 전 안내용)
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
                 'today', m.meet_date = (now() at time zone 'Asia/Seoul')::date,
                 'code', case when v_mgr then m.code else null end),
    'entered', a.id is not null,
    'my', case when a.id is null then null else jsonb_build_object(
            'id', a.id, 'name', a.name, 'church', a.church, 'position', a.position,
            'grade', a.grade, 'full_member', a.full_member, 'confirmed', a.confirmed,
            'seat', a.seat, 'honor', a.honor,
            'entered_at', a.entered_at, 'allow_amount', a.allow_amount,
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
      'full', count(*) filter (where full_member),
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
               'seat', t.seat, 'honor', t.honor,
               'entered_at', t.entered_at, 'allow_amount', t.allow_amount,
               'allow_status', t.allow_status, 'allow_received_at', t.allow_received_at,
               'in_ledger', t.ledger_entry_id is not null)
             order by case when t.seat = 'observe' then 4
                           when t.kind = '목사' then 1 when t.kind = '장로' then 2 else 3 end, t.name), '[]'::jsonb)
        from public.assembly_attendees t where t.meeting_id = m.id));
  end if;
  return j;
end
$fn$;
revoke all on function public.assembly_state(text, bigint) from public;
grant execute on function public.assembly_state(text, bigint) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. 확인 — 지금 열려 있는 노회의 자리별 인원
-- ---------------------------------------------------------------------
select m.title, a.seat, a.grade, count(*)
  from public.assembly_attendees a join public.assembly_meetings m on m.id = a.meeting_id
 where m.status <> 'closed'
 group by m.title, a.seat, a.grade
 order by 1, 2, 3;

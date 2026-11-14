-- =====================================================================
--  159. 오늘의 노회 — 증경부노회장 은퇴장로님 예우 입장 바로잡기 (임선규 장로님) — 2026-11-14
--
--  있었던 일
--    임선규 장로님(은광교회)은 은퇴하셨으나 부노회장을 지내신 분이라 예우로 노회에
--    참석하실 수 있는데, 「오늘의 노회」 입장이 거절되었다.
--
--  원인 — 110 의 assembly_seat 가 증경부노회장 확인을 너무 좁게 했다
--    · 증경단 명단(사이트 관리 → 임원 명부 → 증경노회장단, site_settings 'veterans')의
--      구분이 글자 그대로 '증경부노회장'일 때만 예우로 보았다.
--      증경단 추가 창의 구분 기본값이 '증경노회장'이라, 장로님을 그대로 저장하거나
--      '증경 부노회장'처럼 띄어 적으면 예우를 받지 못했다.
--    · 역대 노회 임원(site_settings 'history_officers')에 부노회장으로 올라 있어도
--      증경단 명단에 없으면 보지 않았다.
--    · 계정의 직분 칸이 비었거나 '장로'가 들어 있지 않으면(기타) 증경단 확인을 아예 하지 않았다.
--    · 계정의 교회와 증경단 명단의 교회 표기가 다르면 맞지 않았다.
--
--  고침
--    1) assembly_honor_vp(uid, 성명, 교회, 명단 교회) — 증경부노회장 예우 확인을 한 곳에서 한다
--       · 증경단 명단 : 구분에 '부노회장'이 들어 있는 분(띄어쓰기 무시),
--                       구분이 '증경노회장'이어도 직분이 장로인 분 (장로님은 노회장이 되지 않으므로 입력 실수)
--       · 증경단 줄에 user_id 가 있으면 그 계정만, 교회 표기와 상관없이 예우한다 (서기의 출입 승인)
--       · 역대 노회 임원의 부노회장 칸(vps)에 이름이 있는 목사가 아닌 분
--    2) assembly_seat — 직분 칸이 빈 계정·승인대기 계정이라도 증경부노회장이면 예우 참관
--       (총대 장로님은 지금처럼 표결, 목사님은 지금처럼)
--       assembly_seat_for(uid) 로 다른 분의 자리도 SQL Editor 에서 확인할 수 있게 한다.
--    3) assembly_enter — 총대가 아닌 장로님께 드리는 안내에
--       「증경부노회장을 지내신 장로님은 은퇴하셨더라도 예우로 참관 입장」 안내를 더한다
--    4) 임선규 장로님 — 증경단 명단에 증경부노회장으로 바로잡고 계정을 이어 출입을 승인하며,
--       정중히 맞이하는 알림을 보낸다 (같은 알림은 한 번만 간다)
--
--  ※ 저장소의 SQL 은 운영 DB 보다 늦을 수 있습니다. 실행하기 전에 운영 DB 에서
--       select pg_get_functiondef('public.assembly_enter(text)'::regprocedure);
--     로 지금 함수 본문을 꺼내 112_meeting_admin.sql 의 assembly_enter 와 비교하고,
--     운영에만 있는 고침이 있으면 아래 3) 에 함께 옮겨 주세요.
--  ※ 110, 112 다음에 실행합니다.
--  실행 : Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--         마지막 결과 표에 임선규 장로님 계정의 「노회 자리」가 나옵니다.
-- =====================================================================

do $chk$
begin
  if to_regprocedure('public.assembly_seat()') is null then
    raise exception '먼저 110_assembly_observer.sql 을 실행해 주세요.';
  end if;
end
$chk$;


-- ---------------------------------------------------------------------
-- 1. 증경부노회장 예우 확인
--    돌려주는 값 : {"role": "증경부노회장", "sessions": [회기...]} 또는 null
-- ---------------------------------------------------------------------
create or replace function public.assembly_honor_vp(p_uid uuid, p_name text, p_church text, p_rchurch text)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_name   text := regexp_replace(coalesce(p_name, ''), '\s', '', 'g');
  v_ch     text := regexp_replace(regexp_replace(coalesce(p_church, ''), '\s', '', 'g'), '교회$', '');
  v_rch    text := regexp_replace(regexp_replace(coalesce(p_rchurch, ''), '\s', '', 'g'), '교회$', '');
  v_list   jsonb;
  v_hist   jsonb;
  v_n      integer := 0;
  v_hn     integer := 0;
  v_sess   jsonb := '[]'::jsonb;
  v_hsess  jsonb := '[]'::jsonb;
  v_other  boolean := false;
  v_all    jsonb;
begin
  if v_name = '' and p_uid is null then return null; end if;

  -- ① 증경단 명단
  select value into v_list from public.site_settings where key = 'veterans';
  v_list := case when jsonb_typeof(v_list) = 'array' then v_list
                 else coalesce(v_list->'list', '[]'::jsonb) end;
  if jsonb_typeof(v_list) <> 'array' then v_list := '[]'::jsonb; end if;

  with vt as (
    select case when coalesce(x->>'session_no', '') ~ '^\d{1,4}$'
                then (x->>'session_no')::integer end as sno,
           regexp_replace(regexp_replace(coalesce(x->>'church', ''), '\s', '', 'g'), '교회$', '') as vc,
           regexp_replace(coalesce(x->>'name', ''), '\s', '', 'g') as vn,
           nullif(btrim(coalesce(x->>'user_id', '')), '') as vu
      from jsonb_array_elements(v_list) x
     where coalesce(x->>'position', '') not like '%목사%'
       and (regexp_replace(coalesce(x->>'role', ''), '\s', '', 'g') like '%부노회장%'
            or (regexp_replace(coalesce(x->>'role', ''), '\s', '', 'g') like '%노회장%'
                and coalesce(x->>'position', '') like '%장로%'))
  )
  select count(*) filter (where hit),
         coalesce(jsonb_agg(distinct sno order by sno) filter (where hit and sno is not null), '[]'::jsonb),
         coalesce(bool_or(not hit and vu is not null and vn = v_name), false)
    into v_n, v_sess, v_other
    from (select vt.*,
                 ((p_uid is not null and vu = p_uid::text)
                  or (vu is null and v_name <> '' and vn = v_name and (
                         vc = ''
                      or (v_ch = '' and v_rch = '')
                      or vc = v_ch or vc = v_rch
                      or (v_ch  <> '' and (strpos(vc, v_ch)  > 0 or strpos(v_ch,  vc) > 0))
                      or (v_rch <> '' and (strpos(vc, v_rch) > 0 or strpos(v_rch, vc) > 0))))) as hit
            from vt) t;

  -- 같은 이름의 증경단 줄이 다른 계정에 이어져 있으면(서기가 승인한 계정이 따로 있으면) 이름만으로는 모시지 않는다
  if v_n = 0 and v_other then return null; end if;

  -- ② 역대 노회 임원의 부노회장 칸 — 이름으로 (회기를 알려 주기도 한다)
  if v_name <> '' then
    select value into v_hist from public.site_settings where key = 'history_officers';
    v_hist := case when jsonb_typeof(v_hist) = 'array' then v_hist
                   else coalesce(v_hist->'list', '[]'::jsonb) end;
    if jsonb_typeof(v_hist) = 'array' then
      begin
        select count(*),
               coalesce(jsonb_agg(distinct t.sno order by t.sno) filter (where t.sno is not null), '[]'::jsonb)
          into v_hn, v_hsess
          from (select substring(coalesce(o->>'no', '') from '\d{1,4}')::integer as sno, vp
                  from jsonb_array_elements(v_hist) o,
                       lateral unnest(case jsonb_typeof(o->'vps')
                                        when 'array'  then array(select jsonb_array_elements_text(o->'vps'))
                                        when 'string' then regexp_split_to_array(o->>'vps', '[,·/、\n]')
                                        else array[]::text[] end) as vp) t
         where t.vp not like '%목사%'
           and regexp_replace(
                 regexp_replace(regexp_replace(t.vp, '\([^)]*\)', '', 'g'), '\s', '', 'g'),
                 '(은퇴|원로)?장로$', '') = v_name;
      exception when others then
        v_hn := 0; v_hsess := '[]'::jsonb;
      end;
    end if;
  end if;

  if v_n = 0 and v_hn = 0 then return null; end if;

  select coalesce(jsonb_agg(distinct s order by s), '[]'::jsonb) into v_all
    from (select (e)::integer as s from jsonb_array_elements_text(v_sess) e
          union
          select (e)::integer from jsonb_array_elements_text(v_hsess) e) z;

  return jsonb_build_object('role', '증경부노회장', 'sessions', v_all);
end
$fn$;
revoke all on function public.assembly_honor_vp(uuid, text, text, text) from public, anon, authenticated;

comment on function public.assembly_honor_vp(uuid, text, text, text) is
  '증경부노회장 장로님 예우 확인 — 증경단 명단(구분에 부노회장, 또는 장로인데 증경노회장으로 적힌 줄, user_id 연결) · 역대 임원 부노회장 칸';


-- ---------------------------------------------------------------------
-- 2. 노회 자리 — 110 의 assembly_seat 를 계정 번호로 부를 수 있게 하고,
--    증경부노회장 확인을 넓힌다 (나머지 판정은 110 그대로)
--    돌려주는 값 : {"kind": 목사/장로/기타, "seat": vote/speak/observe/null,
--                  "grade": 정회원/언권회원/준회원/참관, "veteran": {...} 또는 없음}
-- ---------------------------------------------------------------------
create or replace function public.assembly_seat_for(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  p      public.profiles%rowtype;
  j      jsonb;
  r      public.roster%rowtype;
  v_name text;
  v_ch   text;
  v_pos  text;
  v_kind text;
  v_full boolean;
  v_del  boolean := false;
  v_emer boolean;
  v_vet  jsonb;
begin
  if p_uid is null then return null; end if;
  select * into p from public.profiles where id = p_uid;
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

  v_pos  := coalesce(nullif(btrim(coalesce(p.position, '')), ''), r.position, r.category, '');
  v_kind := case when v_pos like '%목사%' then '목사'
                 when v_pos like '%장로%' then '장로'
                 else '기타' end;

  -- 온전한 정회원인가 — 본인이면 is_full_member() 그대로, 다른 분(SQL Editor 확인용)이면 같은 기준으로
  if p_uid = auth.uid() then
    v_full := public.is_full_member();
  else
    v_full := p.role not in ('pending', 'general', 'advisory', 'associate')
              and not coalesce((j->>'suspended')::boolean, false)
              and (not public.is_retired(p.birth_date) or coalesce((j->>'retire_applied')::boolean, false));
  end if;

  -- ── 목사 (110 그대로) ─────────────────────────────────────────────
  if v_kind = '목사' then
    if p.role in ('pending', 'general') then
      return jsonb_build_object('kind', v_kind, 'seat', null, 'grade', null);
    end if;
    v_emer := coalesce(r.category, '') in ('원로목사', '은퇴목사')
              or v_pos like '%원로%' or v_pos like '%은퇴%';
    if v_full and not v_emer then
      return jsonb_build_object('kind', v_kind, 'seat', 'vote', 'grade', '정회원');
    end if;
    return jsonb_build_object('kind', v_kind, 'seat', 'speak',
             'grade', case when p.role = 'associate' then '준회원' else '언권회원' end);
  end if;

  -- ── 장로 ──────────────────────────────────────────────────────────
  if v_kind = '장로' then
    -- 총대인가 (110 그대로)
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
  end if;

  -- ── 증경부노회장을 지내신 장로님 — 은퇴하셨어도, 승인대기·직분 칸이 비어 있어도 예우 참관 ──
  v_vet := public.assembly_honor_vp(p.id, p.name, p.church, r.church);
  if v_vet is not null then
    return jsonb_build_object('kind', '장로', 'seat', 'observe', 'grade', '참관', 'veteran', v_vet);
  end if;

  -- 총대가 아닌 장로님은 입장할 수 없다
  if v_kind = '장로' then
    return jsonb_build_object('kind', v_kind, 'seat', null, 'grade', null);
  end if;

  -- ── 목사·장로가 아닌 계정(간사 등) — 참관 (110 그대로) ─────────────
  if p.role in ('pending', 'general') then
    return jsonb_build_object('kind', v_kind, 'seat', null, 'grade', null);
  end if;
  return jsonb_build_object('kind', v_kind, 'seat', 'observe', 'grade', '참관');
end
$fn$;
revoke all on function public.assembly_seat_for(uuid) from public, anon, authenticated;

-- 지금 로그인한 사람의 자리 — 다른 assembly_* 함수(입장·상태)가 이것을 부른다
create or replace function public.assembly_seat()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select public.assembly_seat_for(auth.uid())
$fn$;
revoke all on function public.assembly_seat() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. 입장하기 (112 기준) — 입장하지 못하는 장로님께 증경부노회장 예우 입장을 안내한다
--    바뀐 곳은 '승인대기'와 '장로' 안내 글뿐이다.
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
      if s->>'kind' = '장로' then
        raise exception '찾아 주셔서 감사합니다. 아직 노회 회원으로 확인되지 않은 계정입니다. 증경부노회장을 지내신 장로님은 은퇴하셨더라도 예우로 참관 입장하실 수 있으니 서기에게 말씀해 주세요. 바로 확인해 모시겠습니다.';
      end if;
      raise exception '승인 대기 중인 계정은 입장할 수 없습니다. 서기에게 문의해 주세요.';
    end if;
    if p.role = 'general' then
      raise exception '일반회원은 노회 회원이 아니므로 입장할 수 없습니다.';
    end if;
    if s->>'kind' = '장로' then
      raise exception '찾아 주셔서 감사합니다. 노회에는 당회에서 총대로 파송된 장로님께서 입장하십니다. 증경부노회장을 지내신 장로님은 은퇴하셨더라도 예우로 참관 입장하실 수 있습니다. 총대로 파송되셨거나 부노회장을 지내셨다면 서기에게 말씀해 주세요. 바로 확인해 모시겠습니다.';
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
-- 4. 임선규 장로님 — 증경부노회장 예우 출입 승인과 맞이하는 알림
--    · 증경단 명단에 이미 계시면 구분을 '증경부노회장'으로 바로잡고(직분·교회가 비었으면 채움),
--      안 계시면 증경부노회장으로 올린다.
--    · 목사가 아닌 '임선규' 계정이 하나뿐이면 그 계정을 증경단 줄에 잇는다(user_id).
--      그러면 계정의 교회 표기와 상관없이 예우로 입장하신다.
--    · 장로님 계정마다 맞이하는 알림을 한 번 보낸다. (알림함·바탕 화면 알림 → 「오늘의 노회」로)
-- ---------------------------------------------------------------------
do $do$
declare
  v_uids   uuid[];
  v_uid    uuid;
  v_church text;
  v_pos    text;
  v_rch    text;
  v_wrap   jsonb;
  v_list   jsonb;
  v_new    jsonb := '[]'::jsonb;
  x        jsonb;
  v_found  boolean := false;
  v_sno    integer;
  v_sent   integer := 0;
begin
  select array_agg(p.id order by p.created_at) into v_uids
    from public.profiles p
   where regexp_replace(coalesce(p.name, ''), '\s', '', 'g') = '임선규'
     and coalesce(p.position, '') not like '%목사%';
  if coalesce(array_length(v_uids, 1), 0) = 1 then v_uid := v_uids[1]; end if;

  if v_uid is not null then
    select nullif(btrim(coalesce(p.church, '')), ''), nullif(btrim(coalesce(p.position, '')), '')
      into v_church, v_pos
      from public.profiles p where p.id = v_uid;
  end if;
  select nullif(btrim(coalesce(r.church, '')), '') into v_rch
    from public.roster r
   where regexp_replace(coalesce(r.name, ''), '\s', '', 'g') = '임선규'
     and coalesce(r.category, '') not like '%목사%'
   order by coalesce(r.active, true) desc, r.id
   limit 1;

  -- 역대 임원에 부노회장 회기가 적혀 있으면 가져온다
  begin
    v_sno := (public.assembly_honor_vp(null, '임선규', null, null)->'sessions'->>0)::integer;
  exception when others then v_sno := null;
  end;

  select value into v_wrap from public.site_settings where key = 'veterans';
  v_list := case when jsonb_typeof(v_wrap) = 'array' then v_wrap
                 else coalesce(v_wrap->'list', '[]'::jsonb) end;
  if jsonb_typeof(v_list) <> 'array' then v_list := '[]'::jsonb; end if;

  for x in select e from jsonb_array_elements(v_list) e loop
    if regexp_replace(coalesce(x->>'name', ''), '\s', '', 'g') = '임선규'
       and coalesce(x->>'position', '') not like '%목사%' then
      v_found := true;
      x := x || jsonb_build_object('role', '증경부노회장');
      if btrim(coalesce(x->>'position', '')) = '' then
        x := x || jsonb_build_object('position', coalesce(v_pos, '장로'));
      end if;
      if btrim(coalesce(x->>'church', '')) = '' and coalesce(v_church, v_rch) is not null then
        x := x || jsonb_build_object('church', coalesce(v_church, v_rch));
      end if;
      if coalesce(x->>'session_no', '') = '' and v_sno is not null then
        x := x || jsonb_build_object('session_no', v_sno);
      end if;
      if v_uid is not null then
        x := x || jsonb_build_object('user_id', v_uid::text);
      end if;
    end if;
    v_new := v_new || jsonb_build_array(x);
  end loop;

  if not v_found then
    v_new := v_new || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'role', '증경부노회장',
      'name', '임선규',
      'position', coalesce(v_pos, '장로'),
      'church', coalesce(v_church, v_rch, '은광교회'),
      'session_no', v_sno,
      'user_id', v_uid::text)));
  end if;

  insert into public.site_settings (key, value, updated_at)
  values ('veterans',
          case when jsonb_typeof(v_wrap) = 'array' then v_new
               else coalesce(v_wrap, '{}'::jsonb) || jsonb_build_object('list', v_new) end,
          now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  -- 정중히 맞이하는 알림 (계정마다 한 번)
  insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by_name)
  select p.id, '안내',
         '[오늘의 노회] 임선규 장로님, 노회에 예우를 갖추어 모시겠습니다',
         '임선규 장로님, 평안하십니까. 시화산노회입니다.' || chr(10) || chr(10) ||
         '노회에 입장하시는 과정에서 불편을 드려 진심으로 송구합니다. ' ||
         '확인해 보니 부노회장을 지내신 장로님의 예우 입장이 홈페이지에서 바르게 확인되지 않아 생긴 일이었고, 곧바로 바로잡았습니다.' || chr(10) || chr(10) ||
         '장로님께서는 은퇴하셨어도 부노회장으로 노회를 섬겨 주신 증경부노회장이시기에, ' ||
         '노회는 예우를 갖추어 장로님을 모십니다. ' ||
         '노회 날에 「오늘의 노회」에서 입장하기를 누르시고 회의장의 출석 QR 코드를 찍으시면 참관으로 입장하십니다. ' ||
         '(회의 중 발언과 표결은 총대께서 하시게 됩니다.)' || chr(10) || chr(10) ||
         '그동안 노회를 위해 쏟아 주신 수고와 기도에 깊이 감사드립니다. ' ||
         '장로님께서 함께해 주시는 것만으로도 노회에 큰 힘과 격려가 됩니다. 늘 강건하시기를 기도합니다.' || chr(10) || chr(10) ||
         '시화산노회 드림',
         'honor-vp-' || p.id::text,
         '시화산노회'
    from public.profiles p
   where p.id = any(coalesce(v_uids, array[]::uuid[]))
     and not exists (select 1 from public.notifications n
                      where n.user_id = p.id and n.dedupe_key = 'honor-vp-' || p.id::text);
  get diagnostics v_sent = row_count;

  begin
    insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
    values (null, null, '시스템', 'system', 'update', '증경부노회장 예우 입장 승인',
            '임선규 장로 — 증경단 ' || case when v_found then '구분 바로잡음' else '새로 등재' end ||
            ', 계정 ' || coalesce(array_length(v_uids, 1), 0) || '개' ||
            case when v_uid is not null then ' (계정 연결)' else '' end ||
            ', 맞이 알림 ' || v_sent || '건');
  exception when others then null;
  end;
end
$do$;


-- ---------------------------------------------------------------------
-- 5. 확인 — 임선규 장로님 계정과 노회 자리
--    「노회 자리」가 observe(참관) 이고 veteran 이 있으면 예우 입장이 됩니다.
--    계정이 없다고 나오면 장로님께서 먼저 회원 가입을 하셔야 입장하실 수 있습니다.
-- ---------------------------------------------------------------------
select coalesce(p.name, '임선규') as "성명",
       p.church   as "교회",
       p.position as "직분",
       p.role     as "등급",
       public.assembly_seat_for(p.id) as "노회 자리",
       case when p.id is null then '가입한 계정이 없습니다 — 회원 가입 뒤 입장하실 수 있습니다'
            when public.assembly_seat_for(p.id)->>'seat' = 'observe'
                 and public.assembly_seat_for(p.id) ? 'veteran' then '증경부노회장 예우 참관 입장 가능'
            when public.assembly_seat_for(p.id)->>'seat' = 'vote' then '총대(표결)로 입장'
            when public.assembly_seat_for(p.id)->>'seat' is not null then '입장 가능 — ' || (public.assembly_seat_for(p.id)->>'grade')
            else '아직 입장할 수 없습니다 — 계정을 확인해 주세요' end as "확인",
       (select count(*) from public.notifications n
         where n.user_id = p.id and n.dedupe_key = 'honor-vp-' || p.id::text) as "맞이 알림"
  from (select 1) d
  left join public.profiles p
    on regexp_replace(coalesce(p.name, ''), '\s', '', 'g') = '임선규'
   and coalesce(p.position, '') not like '%목사%';

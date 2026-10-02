-- =====================================================================
--  105. 오늘의 노회 — QR 출석 · 명단 확정 · 거마비 · 전자투표
--
--  흐름
--    1) 서기가 <노회 출석 QR 코드 생성>으로 노회를 연다. (assembly_open)
--    2) 회원이 QR을 찍고 로그인해 「입장하기」를 누른다. (assembly_enter)
--       정회원·언권회원·준회원이 입장하고 계수된다. (일반회원·승인대기는 입장 불가)
--    3) 회의가 시작되면 서기가 「명단 확정하기」를 누른다. (assembly_confirm)
--       확정 명단은 회계에게 알림으로 전달된다.
--    4) 회계가 확정 명단에서 거마비 받을 사람·금액을 정해 승인한다.
--       (assembly_allowance_approve) 받는 사람에게 알림이 간다.
--    5) 받은 사람이 「수령 확인」을 누르면 (assembly_allowance_receive)
--       영수증으로 처리되고 노회 재정부 장부에 지출로 자동 기입된다.
--    6) 전자투표 — 서기가 안건을 올리고(기명/무기명) 종료한다.
--       입장한 정회원만 투표한다. 종료 10초 뒤부터 결과가 나온다.
--
--  표는 모두 RLS로 잠그고, 읽고 쓰는 일은 아래 함수로만 한다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 74_presbytery_ledger.sql, 102_associate_not_full_member.sql 이후에 실행.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 표
-- ---------------------------------------------------------------------
create table if not exists public.assembly_meetings (
  id           bigserial primary key,
  title        text not null,
  meet_date    date not null default current_date,
  code         text not null unique,           -- QR에 담기는 입장 코드
  status       text not null default 'open' check (status in ('open', 'confirmed', 'closed')),
  confirmed_at timestamptz,
  confirmed_by text,
  closed_at    timestamptz,
  created_by   text,
  created_at   timestamptz not null default now()
);

create table if not exists public.assembly_attendees (
  id                bigserial primary key,
  meeting_id        bigint not null references public.assembly_meetings on delete cascade,
  user_id           uuid not null,
  roster_id         bigint,
  name              text,
  church            text,
  position          text,
  kind              text not null default '기타',   -- 목사 / 장로 / 기타
  grade             text,                           -- 정회원 / 언권회원 / 준회원 / 회원
  full_member       boolean not null default false, -- 입장 때 정회원이었는가
  entered_at        timestamptz not null default now(),
  confirmed         boolean not null default false, -- 서기가 확정한 명단에 들었는가
  -- 거마비
  allow_amount      bigint,
  allow_status      text check (allow_status in ('지급', '수령')),
  allow_paid_at     timestamptz,
  allow_paid_by     text,
  allow_received_at timestamptz,
  ledger_entry_id   bigint,
  unique (meeting_id, user_id)
);
create index if not exists assembly_attendees_user_idx on public.assembly_attendees (user_id);

create table if not exists public.assembly_votes (
  id         bigserial primary key,
  meeting_id bigint not null references public.assembly_meetings on delete cascade,
  title      text not null,
  mode       text not null check (mode in ('기명', '무기명')),
  status     text not null default '진행' check (status in ('진행', '종료')),
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  eligible   integer,                          -- 종료 때 입장해 있던 정회원 수
  created_by text
);
create index if not exists assembly_votes_meeting_idx on public.assembly_votes (meeting_id, id);

-- 누가 투표했는가 (두 번 투표 막기). 무기명일 때 표와 이어지지 않도록 시각을 두지 않는다.
create table if not exists public.assembly_vote_voters (
  vote_id bigint not null references public.assembly_votes on delete cascade,
  user_id uuid not null,
  primary key (vote_id, user_id)
);

-- 표. 무기명이면 voter_id·voter_name 을 비워 둔다.
create table if not exists public.assembly_ballots (
  id         bigserial primary key,
  vote_id    bigint not null references public.assembly_votes on delete cascade,
  choice     text not null check (choice in ('찬성', '반대')),
  voter_id   uuid,
  voter_name text
);
create index if not exists assembly_ballots_vote_idx on public.assembly_ballots (vote_id);

-- 정책을 두지 않는다 = 표를 직접 읽고 쓸 수 없다. 아래 함수로만 다룬다.
alter table public.assembly_meetings    enable row level security;
alter table public.assembly_attendees   enable row level security;
alter table public.assembly_votes       enable row level security;
alter table public.assembly_vote_voters enable row level security;
alter table public.assembly_ballots     enable row level security;


-- ---------------------------------------------------------------------
-- 2. 서기 — 노회 열기 (출석 QR 코드 생성)
-- ---------------------------------------------------------------------
alter table public.assembly_meetings add column if not exists session_no integer;  -- 노회 회기

-- QR 코드 생성은 서기만 (최고관리자는 관리를 위해 함께)
drop function if exists public.assembly_open(text, date);
create or replace function public.assembly_open(p_title text, p_date date, p_session integer)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_code text;
  v_me   text;
begin
  if not exists (select 1 from public.profiles
                  where id = auth.uid() and role in ('clerk', 'superadmin')) then
    raise exception '서기만 출석 QR 코드를 만들 수 있습니다.';
  end if;
  if coalesce(p_session, 0) <= 0 then raise exception '노회 회기를 적어 주세요.'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception '노회 이름을 적어 주세요.'; end if;
  if exists (select 1 from public.assembly_meetings where status <> 'closed') then
    raise exception '이미 열려 있는 노회가 있습니다. 먼저 그 노회를 마쳐 주세요.';
  end if;
  select name into v_me from public.profiles where id = auth.uid();
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  insert into public.assembly_meetings (title, meet_date, code, created_by, session_no)
  values (btrim(p_title), coalesce(p_date, current_date), v_code, v_me, p_session);
  return v_code;
end
$fn$;


-- ---------------------------------------------------------------------
-- 3. 회원 — 입장하기
-- ---------------------------------------------------------------------
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
  if m.meet_date <> (now() at time zone 'Asia/Seoul')::date then
    raise exception '노회 당일(%)에 입장할 수 있습니다.', to_char(m.meet_date, 'FMMM"월" FMDD"일"');
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


-- ---------------------------------------------------------------------
-- 4. 서기 — 명단 확정 / 잘못 입장한 사람 빼기 / 노회 마치기
--    확정은 여러 번 누를 수 있다. (확정 뒤에 들어온 사람을 더할 때)
-- ---------------------------------------------------------------------
create or replace function public.assembly_confirm(p_meeting bigint)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  m    public.assembly_meetings%rowtype;
  v_me text;
  n    integer;
begin
  if not public.can_manage() then raise exception '서기만 명단을 확정할 수 있습니다.'; end if;
  select * into m from public.assembly_meetings where id = p_meeting;
  if m.id is null or m.status = 'closed' then raise exception '진행 중인 노회가 아닙니다.'; end if;
  select name into v_me from public.profiles where id = auth.uid();

  update public.assembly_attendees set confirmed = true
   where meeting_id = m.id and not confirmed;
  update public.assembly_meetings
     set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), confirmed_by = v_me
   where id = m.id;
  select count(*) into n from public.assembly_attendees where meeting_id = m.id and confirmed;

  -- 확정 명단을 회계에게 전달한다
  insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
  select p.id, '회계',
         '[' || m.title || '] 참석 명단이 확정되었습니다 — 거마비 지급을 승인해 주세요',
         '확정 명단 ' || n || '명이 전달되었습니다. 「오늘의 노회」에서 거마비 받을 분과 금액을 정해 승인해 주세요.',
         'asmconf-' || m.id, auth.uid(), v_me
    from public.profiles p
   where p.role = 'officer' and coalesce(p.title, '') like '%회계%'
     and not exists (select 1 from public.notifications x
                      where x.user_id = p.id and x.dedupe_key = 'asmconf-' || m.id);
  return n;
end
$fn$;

create or replace function public.assembly_attendee_remove(p_id bigint)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_manage() then raise exception '서기만 할 수 있습니다.'; end if;
  if exists (select 1 from public.assembly_attendees where id = p_id and allow_status is not null) then
    raise exception '거마비가 지급된 사람은 명단에서 뺄 수 없습니다.';
  end if;
  delete from public.assembly_attendees where id = p_id;
end
$fn$;

create or replace function public.assembly_close(p_meeting bigint)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_manage() then raise exception '서기만 노회를 마칠 수 있습니다.'; end if;
  if exists (select 1 from public.assembly_votes where meeting_id = p_meeting and status = '진행') then
    raise exception '진행 중인 투표를 먼저 종료해 주세요.';
  end if;
  update public.assembly_meetings set status = 'closed', closed_at = now()
   where id = p_meeting and status <> 'closed';
end
$fn$;


-- ---------------------------------------------------------------------
-- 5. 회계 — 거마비 지급 승인 / 취소
--    p_items : [{"id": 참석자 번호, "amount": 금액}, ...]
-- ---------------------------------------------------------------------
create or replace function public.assembly_allowance_approve(p_meeting bigint, p_items jsonb)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  m    public.assembly_meetings%rowtype;
  it   jsonb;
  a    public.assembly_attendees%rowtype;
  v_me text;
  v_amt bigint;
  n    integer := 0;
begin
  if not public.is_presbytery_treasurer() then raise exception '회계만 거마비를 승인할 수 있습니다.'; end if;
  select * into m from public.assembly_meetings where id = p_meeting;
  if m.id is null or m.status = 'open' then raise exception '서기가 명단을 확정한 뒤에 승인할 수 있습니다.'; end if;
  select name into v_me from public.profiles where id = auth.uid();

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_amt := coalesce((it->>'amount')::bigint, 0);
    if v_amt <= 0 then continue; end if;
    update public.assembly_attendees
       set allow_amount = v_amt, allow_status = '지급', allow_paid_at = now(), allow_paid_by = v_me
     where id = (it->>'id')::bigint and meeting_id = m.id and confirmed and allow_status is null
     returning * into a;
    if a.id is null then continue; end if;
    n := n + 1;
    insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
    values (a.user_id, '회계',
            '[' || m.title || '] 거마비 ' || to_char(v_amt, 'FM999,999,999') || '원을 지급했습니다 — 수령 확인을 눌러 주세요',
            '거마비 ' || to_char(v_amt, 'FM999,999,999') || '원을 받으셨으면 「오늘의 노회」에서 수령 확인을 눌러 주세요. 이 확인이 영수증을 대신합니다.',
            'allow-' || a.id, auth.uid(), v_me);
  end loop;
  return n;
end
$fn$;

create or replace function public.assembly_allowance_cancel(p_id bigint)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_presbytery_treasurer() then raise exception '회계만 할 수 있습니다.'; end if;
  update public.assembly_attendees
     set allow_amount = null, allow_status = null, allow_paid_at = null, allow_paid_by = null
   where id = p_id and allow_status = '지급';
  if not found then raise exception '이미 수령 확인된 건은 취소할 수 없습니다.'; end if;
  delete from public.notifications where dedupe_key = 'allow-' || p_id;
end
$fn$;


-- ---------------------------------------------------------------------
-- 6. 받은 사람 — 수령 확인 → 영수증 처리 + 노회 장부 자동 기입
-- ---------------------------------------------------------------------
create or replace function public.assembly_allowance_receive(p_id bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  a       public.assembly_attendees%rowtype;
  m       public.assembly_meetings%rowtype;
  v_book  bigint;
  v_entry bigint;
begin
  select * into a from public.assembly_attendees where id = p_id for update;
  if a.id is null or a.user_id is distinct from auth.uid() then
    raise exception '본인만 수령 확인을 할 수 있습니다.';
  end if;
  if a.allow_status = '수령' then return; end if;
  if a.allow_status is distinct from '지급' then raise exception '지급된 거마비가 없습니다.'; end if;
  select * into m from public.assembly_meetings where id = a.meeting_id;

  -- 노회 재정부 장부에 지출로 적는다. (장부가 마감되어 못 적어도 수령 확인은 된다)
  begin
    v_book := public.presbytery_book_for(extract(year from m.meet_date)::integer, a.allow_paid_by);
    if v_book is not null then
      perform set_config('app.ledger_sync', '1', true);
      insert into public.ledger_entries
        (book_id, entry_date, kind, category, title, church, amount, note, created_by, link_kind, link_id)
      values
        (v_book, m.meet_date, '지출', '정기노회 경비',
         m.title || ' 거마비 — ' || coalesce(a.name, '') || ' ' || coalesce(a.position, ''),
         a.church, a.allow_amount,
         '오늘의 노회 자동 기입 · 본인 수령 확인(영수증 대체) ' ||
           to_char(now() at time zone 'Asia/Seoul', 'YYYY.MM.DD HH24:MI'),
         a.allow_paid_by, 'allowance', a.id)
      returning id into v_entry;
      perform set_config('app.ledger_sync', '0', true);
    end if;
  exception when others then
    v_entry := null;
  end;
  perform set_config('app.ledger_sync', '0', true);

  update public.assembly_attendees
     set allow_status = '수령', allow_received_at = now(), ledger_entry_id = v_entry
   where id = a.id;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and dedupe_key = 'allow-' || a.id and read_at is null;
end
$fn$;


-- ---------------------------------------------------------------------
-- 7. 전자투표
-- ---------------------------------------------------------------------
create or replace function public.assembly_vote_start(p_meeting bigint, p_title text, p_mode text)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  v_id bigint;
  v_me text;
begin
  if not public.can_manage() then raise exception '서기만 투표를 올릴 수 있습니다.'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception '투표 주제를 적어 주세요.'; end if;
  if p_mode not in ('기명', '무기명') then raise exception '기명·무기명 가운데 골라 주세요.'; end if;
  if not exists (select 1 from public.assembly_meetings where id = p_meeting and status <> 'closed') then
    raise exception '진행 중인 노회가 아닙니다.';
  end if;
  if exists (select 1 from public.assembly_votes where meeting_id = p_meeting and status = '진행') then
    raise exception '진행 중인 투표가 있습니다. 먼저 종료해 주세요.';
  end if;
  select name into v_me from public.profiles where id = auth.uid();
  insert into public.assembly_votes (meeting_id, title, mode, created_by)
  values (p_meeting, btrim(p_title), p_mode, v_me) returning id into v_id;
  return v_id;
end
$fn$;

create or replace function public.assembly_vote_cast(p_vote bigint, p_choice text)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v    public.assembly_votes%rowtype;
  v_me text;
begin
  select * into v from public.assembly_votes where id = p_vote;
  if v.id is null or v.status <> '진행' then raise exception '투표가 이미 종료되었습니다.'; end if;
  if p_choice not in ('찬성', '반대') then raise exception '찬성·반대 가운데 골라 주세요.'; end if;
  if not public.is_full_member() then raise exception '정회원만 투표할 수 있습니다.'; end if;
  if not exists (select 1 from public.assembly_attendees
                  where meeting_id = v.meeting_id and user_id = auth.uid()) then
    raise exception '먼저 노회에 입장해 주세요.';
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
    insert into public.assembly_ballots (vote_id, choice) values (v.id, p_choice);
  end if;
end
$fn$;

create or replace function public.assembly_vote_end(p_vote bigint)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_manage() then raise exception '서기만 투표를 종료할 수 있습니다.'; end if;
  update public.assembly_votes v
     set status = '종료', ended_at = now(),
         eligible = (select count(*) from public.assembly_attendees a
                      where a.meeting_id = v.meeting_id and a.full_member)
   where v.id = p_vote and v.status = '진행';
end
$fn$;

-- 투표 한 건을 화면에 줄 모양으로. 결과는 종료 10초 뒤부터 담긴다.
create or replace function public.assembly_vote_json(p_vote bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v     public.assembly_votes%rowtype;
  j     jsonb;
  v_yes integer;
  v_no  integer;
begin
  select * into v from public.assembly_votes where id = p_vote;
  if v.id is null then return null; end if;
  j := jsonb_build_object(
    'id', v.id, 'title', v.title, 'mode', v.mode, 'status', v.status,
    'started_at', v.started_at, 'ended_at', v.ended_at,
    'cast', (select count(*) from public.assembly_vote_voters x where x.vote_id = v.id),
    'voted', exists (select 1 from public.assembly_vote_voters x
                      where x.vote_id = v.id and x.user_id = auth.uid()));
  if v.status = '종료' and now() >= v.ended_at + interval '10 seconds' then
    select count(*) filter (where choice = '찬성'), count(*) filter (where choice = '반대')
      into v_yes, v_no from public.assembly_ballots where vote_id = v.id;
    j := j || jsonb_build_object('result', jsonb_build_object(
      'yes', v_yes, 'no', v_no, 'total', v_yes + v_no, 'eligible', v.eligible,
      'passed', v_yes > v_no,
      'names', case when v.mode = '기명' then
                 (select coalesce(jsonb_agg(jsonb_build_object('name', b.voter_name, 'choice', b.choice)
                                            order by b.choice desc, b.voter_name), '[]'::jsonb)
                    from public.assembly_ballots b where b.vote_id = v.id)
               else null end));
  end if;
  return j;
end
$fn$;


-- ---------------------------------------------------------------------
-- 8. 화면이 몇 초마다 부르는 함수 — 보는 사람에게 허락된 것만 담아 준다
-- ---------------------------------------------------------------------
create or replace function public.assembly_state(p_code text default null)
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
  if m.id is null then
    select * into m from public.assembly_meetings where status <> 'closed' order by id desc limit 1;
  end if;
  if m.id is null then
    -- 마친 노회 — 거마비 수령 확인·승인이 남아 있을 수 있어 60일 동안 보여 준다
    select * into m from public.assembly_meetings x
     where x.status = 'closed' and x.closed_at > now() - interval '60 days'
       and (v_mgr or v_tre or exists (select 1 from public.assembly_attendees t
                                       where t.meeting_id = x.id and t.user_id = v_uid))
     order by x.id desc limit 1;
  end if;

  j := jsonb_build_object('login', true, 'now', now(), 'code_ok', v_code,
    'me', jsonb_build_object('name', p.name, 'position', p.position, 'church', p.church, 'role', p.role,
                             'full', public.is_full_member(), 'mgr', v_mgr, 'tre', v_tre));
  if m.id is null then return j || jsonb_build_object('meeting', null); end if;

  select * into a from public.assembly_attendees where meeting_id = m.id and user_id = v_uid;
  j := j || jsonb_build_object(
    'meeting', jsonb_build_object('id', m.id, 'title', m.title, 'session_no', m.session_no, 'meet_date', m.meet_date,
                 'status', m.status, 'confirmed_at', m.confirmed_at,
                 'today', m.meet_date = (now() at time zone 'Asia/Seoul')::date,
                 'code', case when v_mgr then m.code else null end),
    'entered', a.id is not null,
    'my', case when a.id is null then null else jsonb_build_object(
            'id', a.id, 'name', a.name, 'church', a.church, 'position', a.position,
            'grade', a.grade, 'full_member', a.full_member, 'confirmed', a.confirmed,
            'entered_at', a.entered_at, 'allow_amount', a.allow_amount,
            'allow_status', a.allow_status, 'allow_paid_at', a.allow_paid_at,
            'allow_paid_by', a.allow_paid_by, 'allow_received_at', a.allow_received_at,
            'in_ledger', a.ledger_entry_id is not null) end);

  if a.id is null and not v_mgr and not v_tre then return j; end if;

  j := j || jsonb_build_object('counts', (
    select jsonb_build_object(
      'total', count(*),
      'pastor', count(*) filter (where kind = '목사'),
      'elder', count(*) filter (where kind = '장로'),
      'etc', count(*) filter (where kind = '기타'),
      'full', count(*) filter (where full_member),
      'c_total', count(*) filter (where confirmed),
      'c_pastor', count(*) filter (where confirmed and kind = '목사'),
      'c_elder', count(*) filter (where confirmed and kind = '장로'),
      'c_etc', count(*) filter (where confirmed and kind = '기타'))
      from public.assembly_attendees where meeting_id = m.id));

  select id into v_vote from public.assembly_votes where meeting_id = m.id order by id desc limit 1;
  j := j || jsonb_build_object(
    'vote', public.assembly_vote_json(v_vote),
    'history', (select coalesce(jsonb_agg(public.assembly_vote_json(x.id) order by x.id desc), '[]'::jsonb)
                  from public.assembly_votes x
                 where x.meeting_id = m.id and x.status = '종료' and x.id <> coalesce(v_vote, 0)));

  if v_mgr or v_tre then
    j := j || jsonb_build_object('attendees', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'church', t.church, 'position', t.position,
               'kind', t.kind, 'grade', t.grade, 'confirmed', t.confirmed,
               'entered_at', t.entered_at, 'allow_amount', t.allow_amount,
               'allow_status', t.allow_status, 'allow_received_at', t.allow_received_at,
               'in_ledger', t.ledger_entry_id is not null)
             order by case t.kind when '목사' then 1 when '장로' then 2 else 3 end, t.name), '[]'::jsonb)
        from public.assembly_attendees t where t.meeting_id = m.id));
  end if;
  return j;
end
$fn$;


-- ---------------------------------------------------------------------
-- 8-1. 오늘이 노회 날인가 — 첫 화면이 묻는다 (로그인 전에도)
--      노회 날이면 첫 화면이 「오늘의 노회」 창 하나만 보여 준다.
-- ---------------------------------------------------------------------
create or replace function public.assembly_today()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object('title', m.title, 'meet_date', m.meet_date)
    from public.assembly_meetings m
   where m.status <> 'closed' and m.meet_date = (now() at time zone 'Asia/Seoul')::date
   order by m.id desc limit 1;
$fn$;
grant execute on function public.assembly_today() to anon, authenticated;


-- ---------------------------------------------------------------------
-- 9. 권한 — 로그인한 사람만 부른다 (함수 안에서 다시 자격을 본다)
-- ---------------------------------------------------------------------
revoke all on function public.assembly_vote_json(bigint) from public, anon, authenticated;
do $g$
declare
  f text;
begin
  foreach f in array array[
    'assembly_open(text, date, integer)', 'assembly_enter(text)', 'assembly_confirm(bigint)',
    'assembly_attendee_remove(bigint)', 'assembly_close(bigint)',
    'assembly_allowance_approve(bigint, jsonb)', 'assembly_allowance_cancel(bigint)',
    'assembly_allowance_receive(bigint)', 'assembly_vote_start(bigint, text, text)',
    'assembly_vote_cast(bigint, text)', 'assembly_vote_end(bigint)', 'assembly_state(text)']
  loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end
$g$;
-- 로그인 전에도 화면이 "로그인해 주세요"를 알 수 있게 상태 함수만 열어 둔다
grant execute on function public.assembly_state(text) to anon;

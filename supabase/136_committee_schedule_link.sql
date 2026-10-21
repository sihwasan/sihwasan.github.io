-- =====================================================================
--  136. 상비부 달력 → 노회 일정 연동 · 여러 날 일정 (2026-10-21)
--
--  문제: 교육친교부가 부서 달력에 「제주 부부수양회」를 넣어도 노회 일정에는
--        서기가 따로 또 적어야 했고(주관부서도 손으로 적었다), 부서 달력은
--        하루짜리 일정만 넣을 수 있었다.
--  해결:
--   · 부서 달력 일정에 「노회 일정에도 올리기」(to_schedule)를 켜면 노회 일정
--     (site_schedule)에 「상비부 일정」으로 한 줄이 저절로 생기고, 주관부서가
--     그 부서로 적힌다. 부서 달력에서 고치면 노회 일정도 따라 바뀌고, 끄거나
--     지우면 노회 일정에서도 빠진다.
--   · 상비부 임원은 노회 일정 표에 직접 쓸 권한이 없으므로 이 일은 서버의
--     트리거(security definer)가 한다. 어느 노회 일정 줄과 이어졌는지(schedule_id)는
--     서버만 정한다 — 화면이 보낸 값은 무시한다.
--   · 노회 일정에서 서기가 그 줄을 지우면 부서 달력의 「노회 일정에도 올리기」도
--     꺼진다. 서기가 고친 행사 갈래·공지 여부·회비 같은 칸은 부서가 바꾼 칸이
--     아니면 그대로 둔다.
--   · 부서 알림(notify_committee)에 끝 날짜도 적는다 (「일시 : 2026년 11월 2일 ~ 11월 4일」
--     — 알림함은 끝 날 다음 날부터 지난 알림으로 접는다).
--   · 이미 따로 적혀 있던 교육친교부 「제주 부부수양회」(부서 달력 6번)와 노회 일정의
--     「목사장로 부부 수양회」(10번)를 서로 잇는다.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--  (drop trigger 가 있어 「Potential issue detected」 창이 뜨면 Run query 를 한 번 더 누릅니다)
-- =====================================================================

-- 1. 칸 ---------------------------------------------------------------
alter table public.committee_events add column if not exists to_schedule boolean not null default false;
-- 외래 키는 일부러 걸지 않는다 — 트리거 안에서 노회 일정 줄을 지울 때 외래 키 동작이
-- 지금 고치는 부서 일정 줄을 다시 고치려 들면 PostgreSQL 이 그 저장을 막는다.
alter table public.committee_events add column if not exists schedule_id bigint;
create unique index if not exists committee_events_schedule_idx
  on public.committee_events (schedule_id) where schedule_id is not null;

comment on column public.committee_events.to_schedule is '노회 일정에도 올리기 (켜면 site_schedule 에 상비부 일정으로 생긴다)';
comment on column public.committee_events.schedule_id is '이어진 노회 일정(site_schedule.id) — 서버 트리거만 정한다';


-- 2. 노회 일정에 쓸 제목 — 부서 이름이 제목에 없으면 앞에 붙인다 ------------------
create or replace function public.committee_event_title(p_com text, p_title text)
returns text language sql immutable as $fn$
  select case when coalesce(p_title, '') = '' then p_com
              when position(p_com in p_title) > 0 then p_title
              else p_com || ' · ' || p_title end
$fn$;

-- 날짜 꼬리표 — 노회 일정 화면(schedule.html labelOf)과 같은 꼴: 11.2 / 11.2~11.4
create or replace function public.committee_event_label(p_from date, p_to date)
returns text language sql immutable as $fn$
  select to_char(p_from, 'FMMM.FMDD') ||
         case when p_to is not null and p_to > p_from then '~' || to_char(p_to, 'FMMM.FMDD') else '' end
$fn$;


-- 3. 부서 일정이 들어오거나 바뀌면 노회 일정을 맞춘다 -----------------------------
create or replace function public.committee_event_schedule_sync()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_want boolean;
  v_end  date;
  v_sid  bigint;
  v_kind text;
  v_meta jsonb;
begin
  -- 노회 일정 쪽 트리거가 고친 것(서기가 노회 일정에서 지움)은 그대로 둔다
  if pg_trigger_depth() > 1 then return new; end if;

  -- 이어진 줄은 서버만 정한다 — 화면이 보낸 값은 버린다
  if tg_op = 'INSERT' then
    new.schedule_id := null;
  else
    new.schedule_id := old.schedule_id;
  end if;

  v_want := coalesce(new.to_schedule, false) and new.event_date is not null and new.kind = '일정';
  v_end  := case when new.end_date is not null and new.end_date > new.event_date then new.end_date end;

  -- 끄거나 일정이 아니게 되면 노회 일정에서 뺀다
  if not v_want then
    if new.schedule_id is not null then
      delete from public.site_schedule where id = new.schedule_id;
      new.schedule_id := null;
    end if;
    return new;
  end if;

  if new.schedule_id is not null then
    select kind into v_kind from public.site_schedule where id = new.schedule_id;
    if not found then new.schedule_id := null; end if;
  end if;

  -- 처음 올림 — 노회 일정에 새 줄 (공지는 서기가 노회 일정에서 켠다)
  if new.schedule_id is null then
    insert into public.site_schedule (title, kind, event_date, end_date, date_label, sort, meta, post_notice)
    values (public.committee_event_title(new.committee, new.title), '상비부 일정',
            new.event_date, v_end, public.committee_event_label(new.event_date, v_end),
            to_char(new.event_date, 'YYYYMMDD')::int,
            jsonb_build_object('dept', new.committee, 'committee_event_id', new.id,
                               'loc', coalesce(new.place, ''), 'info', coalesce(new.body, ''),
                               'time', '', 'note', ''),
            false)
    returning id into v_sid;
    new.schedule_id := v_sid;
    return new;
  end if;

  -- 이미 이어진 줄 — 부서가 바꾼 칸만 옮겨 적는다 (서기가 고친 다른 칸은 그대로)
  v_meta := jsonb_build_object('dept', new.committee, 'committee_event_id', new.id);
  if tg_op = 'UPDATE' and coalesce(old.to_schedule, false) then
    if new.place is distinct from old.place then
      v_meta := v_meta || jsonb_build_object(case when v_kind = '수양회' then 'place' else 'loc' end,
                                             coalesce(new.place, ''));
    end if;
    if new.body is distinct from old.body then
      v_meta := v_meta || jsonb_build_object('info', coalesce(new.body, ''));
    end if;
    if new.title is distinct from old.title and v_kind = '수양회' then
      v_meta := v_meta || jsonb_build_object('rname', new.title);
    end if;
    update public.site_schedule s
       set title = case when new.title is distinct from old.title or new.committee is distinct from old.committee
                        then case when v_kind = '수양회' then new.title
                                  else public.committee_event_title(new.committee, new.title) end
                        else s.title end,
           event_date = case when new.event_date is distinct from old.event_date
                               or new.end_date is distinct from old.end_date
                             then new.event_date else s.event_date end,
           end_date   = case when new.event_date is distinct from old.event_date
                               or new.end_date is distinct from old.end_date
                             then v_end else s.end_date end,
           date_label = case when new.event_date is distinct from old.event_date
                               or new.end_date is distinct from old.end_date
                             then public.committee_event_label(new.event_date, v_end) else s.date_label end,
           sort       = case when new.event_date is distinct from old.event_date
                             then to_char(new.event_date, 'YYYYMMDD')::int else s.sort end,
           meta = coalesce(s.meta, '{}'::jsonb) || v_meta
     where s.id = new.schedule_id;
  else
    -- 이어 두기만 한 줄(아래 6. 처럼) — 주관부서·번호만 적는다
    update public.site_schedule s
       set meta = coalesce(s.meta, '{}'::jsonb) || v_meta
     where s.id = new.schedule_id;
  end if;
  return new;
end
$fn$;

drop trigger if exists committee_event_schedule_trg on public.committee_events;
create trigger committee_event_schedule_trg
  before insert or update on public.committee_events
  for each row execute function public.committee_event_schedule_sync();


-- 4. 부서 일정을 지우면 노회 일정에서도 뺀다 (지운 뒤에 — 그래야 서로 막지 않는다) ---
create or replace function public.committee_event_schedule_drop()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if old.schedule_id is not null then
    delete from public.site_schedule where id = old.schedule_id;
  end if;
  return old;
end
$fn$;

drop trigger if exists committee_event_schedule_drop_trg on public.committee_events;
create trigger committee_event_schedule_drop_trg
  after delete on public.committee_events
  for each row execute function public.committee_event_schedule_drop();


-- 5. 서기가 노회 일정에서 그 줄을 지우면 부서 달력의 「노회 일정에도 올리기」를 끈다 ----
create or replace function public.schedule_committee_unlink()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  -- 부서 쪽 트리거가 지운 것이면 그쪽이 이미 정리한다
  if pg_trigger_depth() > 1 then return old; end if;
  update public.committee_events
     set to_schedule = false, schedule_id = null
   where schedule_id = old.id;
  return old;
end
$fn$;

drop trigger if exists schedule_committee_unlink_trg on public.site_schedule;
create trigger schedule_committee_unlink_trg
  before delete on public.site_schedule
  for each row execute function public.schedule_committee_unlink();


-- 6. 이미 따로 적힌 교육친교부 제주 부부수양회를 서로 잇는다 ------------------------
--    (부서 달력 6번 2026-11-02 하루 → 끝 날 11-04 도 맞춘다. 노회 일정 10번의 내용은 그대로)
alter table public.committee_events disable trigger committee_event_schedule_trg;
update public.committee_events ce
   set to_schedule = true, schedule_id = 10,
       end_date = coalesce(ce.end_date, date '2026-11-04')
 where ce.id = 6 and ce.committee = '교육친교부' and ce.event_date = date '2026-11-02'
   and ce.schedule_id is null
   and exists (select 1 from public.site_schedule s where s.id = 10 and s.event_date = date '2026-11-02')
   and not exists (select 1 from public.committee_events x where x.schedule_id = 10);
alter table public.committee_events enable trigger committee_event_schedule_trg;
update public.site_schedule s
   set meta = coalesce(s.meta, '{}'::jsonb) ||
              jsonb_build_object('dept', '교육친교부', 'committee_event_id', 6)
 where s.id = 10 and exists (select 1 from public.committee_events ce where ce.id = 6 and ce.schedule_id = 10);


-- 7. 부서 알림에 끝 날짜도 ------------------------------------------------------
--    44_committee_members.sql 의 notify_committee 와 같고, 일시 줄에 「~ 끝 날」만 더했다.
create or replace function public.notify_committee(p_event bigint)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  ev   public.committee_events%rowtype;
  com  public.committees%rowtype;
  v_n  integer := 0;
  v_names text[];
begin
  select * into ev from public.committee_events where id = p_event;
  if ev.id is null then raise exception '알릴 내용을 찾을 수 없습니다.'; end if;
  if not public.is_committee_officer(ev.committee) then
    raise exception '이 부서의 임원만 알림을 보낼 수 있습니다.';
  end if;

  select * into com from public.committees where name = ev.committee;

  -- 1·2·3년조와 위원 명단, 그리고 임원을 쉼표로 나누어 이름 목록을 만든다
  select array_agg(btrim(x)) into v_names
    from unnest(string_to_array(
           concat_ws(',', com.y1, com.y2, com.y3, com.members,
                          com.head, com.clerk, com.treasurer), ',')) x
   where btrim(x) <> '';

  insert into public.notifications (user_id, kind, title, body, dedupe_key)
  select p.id, '상비부',
         '[' || ev.committee || '] ' || ev.title,
         coalesce(ev.body, '') ||
         case when ev.event_date is not null
              then chr(10) || '일시 : ' || to_char(ev.event_date, 'FMYYYY년 FMMM월 FMDD일')
                   || case when ev.end_date is not null and ev.end_date > ev.event_date
                           then ' ~ ' || case when extract(year from ev.end_date) <> extract(year from ev.event_date)
                                              then to_char(ev.end_date, 'FMYYYY년 FMMM월 FMDD일')
                                              else to_char(ev.end_date, 'FMMM월 FMDD일') end
                           else '' end
                   || coalesce(' · ' || ev.place, '')
              else '' end,
         'com-ev-' || ev.id
    from public.profiles p
   where p.name is not null
     and p.name = any(v_names)
     and not exists (
           select 1 from public.notifications n
            where n.user_id = p.id and n.dedupe_key = 'com-ev-' || ev.id
         );
  get diagnostics v_n = row_count;

  update public.committee_events set notify = true, updated_at = now() where id = p_event;
  return v_n;
end;
$fn$;

revoke all on function public.notify_committee(bigint) from public;
grant execute on function public.notify_committee(bigint) to authenticated;


-- 확인
select ce.id, ce.committee, ce.title, ce.event_date, ce.end_date, ce.to_schedule, ce.schedule_id,
       s.title as "노회 일정", s.meta->>'dept' as "주관부서"
  from public.committee_events ce
  left join public.site_schedule s on s.id = ce.schedule_id
 order by ce.id;

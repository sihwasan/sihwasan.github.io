-- =====================================================================
--  130. 노회 출석부 — 회기마다 회원 출결 (출석 · 불참(이유서) · 결석 · 면제) — 2026-10-21
--
--  출석부 한 장(attendance_sheets) = 노회 한 번 (오늘의 노회 QR 회의와 같은 날짜).
--  줄(attendance_records) = 회원 명단(roster)의 한 분.
--
--    · 출석 대상 : 회원 명단의 정회원 목사(위임·시무·부목사·무임)와 총대 장로.
--                  원로·은퇴목사, 언권회원·준회원, 직원, 교체된(비활성) 분은 대상이 아니다.
--    · 출석      : 그날 「오늘의 노회」에 QR 로 입장한 분 (대상이 아니어도 입장했으면 「출석」으로 남는다)
--    · 불참      : 입장하지 않았고 불참 이유서(129)를 낸 분 — 이유서 내용이 출석부에 함께 붙는다
--    · 결석      : 입장도 이유서도 없는 분 — 회원 신상과 결석 관리에서 횟수를 센다
--    · 면제      : 서기가 정하는 것 (공무·병상 등 노회가 인정한 경우)
--
--  연동 : 서기가 회의관리 「출석부」에서 한 번 만들면, 그 뒤로 이유서를 내거나 고치거나 거두거나,
--         QR 입장이 늘면 그 출석부가 저절로 다시 맞춰진다. 서기가 손으로 바꾼 줄은 그대로 둔다.
--  열람 : 회의관리를 보는 분(노회장·서기·간사·최고관리자·부서기)과 본인(자기 줄).
--  고침 : 서기·최고관리자 (2단계 인증) — 출결 상태와 메모만.
--
--  먼저 129_absence_reasons.sql 을 실행해야 합니다.
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
-- =====================================================================

create table if not exists public.attendance_sheets (
  id          bigserial primary key,
  meet_date   date not null unique,
  session_no  integer,
  title       text not null,
  assembly_id bigint references public.assembly_meetings (id) on delete set null,
  meeting_id  bigint references public.meetings (id) on delete set null,
  built_at    timestamptz,
  built_by    text,
  created_at  timestamptz not null default now()
);

create table if not exists public.attendance_records (
  id          bigserial primary key,
  sheet_id    bigint not null references public.attendance_sheets (id) on delete cascade,
  roster_id   bigint references public.roster (id) on delete set null,   -- 명단에서 지워져도 기록은 남는다
  name        text,
  church      text,
  position    text,
  category    text,
  obligated   boolean not null default true,          -- 출석 대상인가 (결석을 세는 줄)
  status      text not null check (status in ('출석', '불참', '결석', '면제')),
  absence_id  bigint references public.absence_reasons (id) on delete set null,
  reason_kind text,
  reason      text,
  reason_at   timestamptz,
  entered_at  timestamptz,                             -- QR 입장 시각
  manual      boolean not null default false,          -- 서기가 손으로 바꾼 줄 (다시 맞출 때 상태를 그대로 둔다)
  note        text check (note is null or char_length(note) <= 500),
  updated_by  text,
  updated_at  timestamptz not null default now(),
  unique (sheet_id, roster_id)
);
create index if not exists attendance_records_roster_idx on public.attendance_records (roster_id);

-- 회의관리를 보는 분 (112 의 can_view_meeting: 노회장·서기·간사·최고관리자 + 부서기)
create or replace function public.attendance_viewer()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.can_manage() or public.is_vice_clerk()
$fn$;
grant execute on function public.attendance_viewer() to authenticated;

alter table public.attendance_sheets  enable row level security;
alter table public.attendance_records enable row level security;
revoke all on public.attendance_sheets, public.attendance_records from anon;
grant select, delete on public.attendance_sheets to authenticated;
grant select, update on public.attendance_records to authenticated;
revoke insert on public.attendance_sheets, public.attendance_records from authenticated;

drop policy if exists att_sheets_read   on public.attendance_sheets;
drop policy if exists att_sheets_delete on public.attendance_sheets;
drop policy if exists att_rec_read      on public.attendance_records;
drop policy if exists att_rec_update    on public.attendance_records;
create policy att_sheets_read on public.attendance_sheets for select to authenticated
  using (public.is_member() or public.attendance_viewer());
create policy att_sheets_delete on public.attendance_sheets for delete to authenticated
  using (public.absence_checker());
create policy att_rec_read on public.attendance_records for select to authenticated
  using (public.attendance_viewer()
         or exists (select 1 from public.profiles p where p.id = auth.uid() and p.roster_id is not null and p.roster_id = attendance_records.roster_id));
create policy att_rec_update on public.attendance_records for update to authenticated
  using (public.absence_checker()) with check (public.absence_checker());

-- 서기가 고칠 때: 출결 상태·메모만, 손으로 바꾼 표시와 고친 분을 남긴다
create or replace function public.attendance_records_before()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  -- 다시 맞추기(attendance_refresh)가 고치는 것은 그대로 둔다 — 그 함수가 shs.att_sync 를 켜고 돈다
  if current_setting('shs.att_sync', true) = 'on' then return new; end if;
  if auth.uid() is not null then          -- 사람이 고친 것
    new.sheet_id := old.sheet_id; new.roster_id := old.roster_id;
    new.name := old.name; new.church := old.church; new.position := old.position; new.category := old.category;
    new.obligated := old.obligated; new.absence_id := old.absence_id;
    new.reason_kind := old.reason_kind; new.reason := old.reason; new.reason_at := old.reason_at; new.entered_at := old.entered_at;
    new.note := nullif(btrim(coalesce(new.note, '')), '');
    if new.status is distinct from old.status then new.manual := true; end if;
    new.updated_by := (select p.name from public.profiles p where p.id = auth.uid());
    new.updated_at := now();
  end if;
  return new;
end
$fn$;
drop trigger if exists attendance_records_before_trg on public.attendance_records;
create trigger attendance_records_before_trg before update on public.attendance_records
  for each row execute function public.attendance_records_before();

-- 이름·교회 맞춤 (띄어쓰기·끝의 「교회」 무시)
create or replace function public.att_norm_name(t text)
returns text language sql immutable set search_path = public as $fn$
  select regexp_replace(coalesce(t, ''), '\s', '', 'g')
$fn$;
create or replace function public.att_norm_church(t text)
returns text language sql immutable set search_path = public as $fn$
  select regexp_replace(regexp_replace(coalesce(t, ''), '\s', '', 'g'), '교회$', '')
$fn$;

-- 출석 대상: 활성 명단의 정회원 목사(위임·시무·부목사·무임)와 총대 장로
create or replace function public.att_obligated(p_category text, p_role text, p_active boolean)
returns boolean language sql immutable set search_path = public as $fn$
  select coalesce(p_active, true)
     and coalesce(p_role, 'member') not in ('advisory', 'associate', 'general', 'pending', 'staff')
     and (coalesce(p_category, '') in ('목사', '무임목사', '부목사', '위임목사', '시무목사', '장로'))
$fn$;

-- 출석부 한 장을 지금 자료로 다시 맞춘다 (손으로 바꾼 줄은 상태를 그대로 둔다)
create or replace function public.attendance_refresh(p_sheet bigint)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  s public.attendance_sheets%rowtype;
  v jsonb;
begin
  select * into s from public.attendance_sheets where id = p_sheet;
  if s.id is null then return null; end if;
  perform set_config('shs.att_sync', 'on', true);

  with ros as (
    select r.id, r.name, r.church, r.position, r.category,
           public.att_obligated(r.category, r.role, r.active) as obligated,
           public.att_norm_name(r.name) as nn, public.att_norm_church(r.church) as nc
      from public.roster r
  ),
  att as (   -- 그날 입장한 분 → 명단 줄
    select q.rid, min(q.entered_at) as entered_at
      from (select coalesce(a.roster_id, p.roster_id,
                     (select x.id from ros x where x.nn = public.att_norm_name(a.name) and x.nc = public.att_norm_church(a.church)
                       order by x.obligated desc, x.id limit 1)) as rid,
                   a.entered_at
              from public.assembly_attendees a
              left join public.profiles p on p.id = a.user_id
             where s.assembly_id is not null and a.meeting_id = s.assembly_id) q
     where q.rid is not null
     group by q.rid
  ),
  abs as (   -- 그 회의에 낸 불참 이유서 → 명단 줄
    select distinct on (rid) rid, b.id, b.reason_kind, b.reason, b.updated_at
      from (select b.*, coalesce(p.roster_id,
                     (select x.id from ros x where x.nn = public.att_norm_name(b.name) and x.nc = public.att_norm_church(b.church)
                       order by x.obligated desc, x.id limit 1)) as rid
              from public.absence_reasons b
              left join public.profiles p on p.id = b.user_id
             where s.meeting_id is not null and b.meeting_id = s.meeting_id) b
     where rid is not null
     order by rid, b.updated_at desc
  ),
  want as (
    select r.id as rid, r.name, r.church, r.position, r.category, r.obligated,
           att.entered_at, abs.id as absence_id, abs.reason_kind, abs.reason, abs.updated_at as reason_at,
           case when att.rid is not null then '출석' when abs.rid is not null then '불참' else '결석' end as status
      from ros r
      left join att on att.rid = r.id
      left join abs on abs.rid = r.id
     where r.obligated or att.rid is not null
  ),
  up as (
    insert into public.attendance_records as t (sheet_id, roster_id, name, church, position, category, obligated, status,
                                                absence_id, reason_kind, reason, reason_at, entered_at, updated_at)
    select s.id, w.rid, w.name, w.church, w.position, w.category, w.obligated, w.status,
           w.absence_id, w.reason_kind, w.reason, w.reason_at, w.entered_at, now()
      from want w
    on conflict (sheet_id, roster_id) do update
       set name = excluded.name, church = excluded.church, position = excluded.position, category = excluded.category,
           obligated = excluded.obligated, absence_id = excluded.absence_id, reason_kind = excluded.reason_kind,
           reason = excluded.reason, reason_at = excluded.reason_at, entered_at = excluded.entered_at,
           status = case when t.manual then t.status else excluded.status end,
           updated_at = case when t.manual then t.updated_at else now() end
    returning t.roster_id
  )
  delete from public.attendance_records d
   where d.sheet_id = s.id and not d.manual and d.roster_id is not null
     and d.roster_id not in (select roster_id from up where roster_id is not null);

  perform set_config('shs.att_sync', 'off', true);
  select jsonb_build_object(
           'sheet', s.id,
           '출석', count(*) filter (where status = '출석' and obligated),
           '불참', count(*) filter (where status = '불참' and obligated),
           '결석', count(*) filter (where status = '결석' and obligated),
           '면제', count(*) filter (where status = '면제' and obligated),
           '대상', count(*) filter (where obligated),
           '대상 밖 출석', count(*) filter (where not obligated and status = '출석'))
    into v from public.attendance_records where sheet_id = s.id;
  return v;
end
$fn$;
revoke all on function public.attendance_refresh(bigint) from public, anon, authenticated;

-- 서기가 「출석부 만들기·다시 맞추기」를 누를 때 (오늘의 노회 회의 번호로)
create or replace function public.attendance_build(p_assembly bigint)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  m   public.assembly_meetings%rowtype;
  v_mt bigint;
  v_id bigint;
  v_me text := (select p.name from public.profiles p where p.id = auth.uid());
begin
  if not public.absence_checker() then raise exception '서기만 출석부를 만들 수 있습니다 (2단계 인증 확인).'; end if;
  select * into m from public.assembly_meetings where id = p_assembly;
  if m.id is null then raise exception '오늘의 노회 기록을 찾지 못했습니다.'; end if;
  select id into v_mt from public.meetings where meet_date = m.meet_date order by confirmed desc, id desc limit 1;
  insert into public.attendance_sheets (meet_date, session_no, title, assembly_id, meeting_id, built_at, built_by)
  values (m.meet_date, m.session_no, m.title, m.id, v_mt, now(), v_me)
  on conflict (meet_date) do update
     set session_no = excluded.session_no, title = excluded.title, assembly_id = excluded.assembly_id,
         meeting_id = coalesce(excluded.meeting_id, attendance_sheets.meeting_id), built_at = now(), built_by = v_me
  returning id into v_id;
  return public.attendance_refresh(v_id);
end
$fn$;
revoke all on function public.attendance_build(bigint) from public, anon;
grant execute on function public.attendance_build(bigint) to authenticated;

-- 연동: 이유서가 바뀌거나 QR 입장이 늘면, 그날 출석부가 있으면 다시 맞춘다
create or replace function public.attendance_sync_absence()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_sheet bigint;
begin
  select s.id into v_sheet from public.attendance_sheets s
   where s.meeting_id = coalesce(new.meeting_id, old.meeting_id)
      or s.meet_date = (select m.meet_date from public.meetings m where m.id = coalesce(new.meeting_id, old.meeting_id))
   limit 1;
  if v_sheet is not null then perform public.attendance_refresh(v_sheet); end if;
  return null;
end
$fn$;
drop trigger if exists attendance_sync_absence_trg on public.absence_reasons;
create trigger attendance_sync_absence_trg after insert or update or delete on public.absence_reasons
  for each row execute function public.attendance_sync_absence();

create or replace function public.attendance_sync_attendee()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_sheet bigint;
begin
  select s.id into v_sheet from public.attendance_sheets s
   where s.assembly_id = coalesce(new.meeting_id, old.meeting_id) limit 1;
  if v_sheet is not null then perform public.attendance_refresh(v_sheet); end if;
  return null;
end
$fn$;
drop trigger if exists attendance_sync_attendee_trg on public.assembly_attendees;
create trigger attendance_sync_attendee_trg after insert or delete on public.assembly_attendees
  for each row execute function public.attendance_sync_attendee();

-- 확인:
--   select s.title, r.name, r.church, r.status, r.reason_kind, r.manual from public.attendance_records r
--     join public.attendance_sheets s on s.id = r.sheet_id order by s.meet_date desc, r.status, r.name;

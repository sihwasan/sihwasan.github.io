-- =====================================================================
--  20. 상비부 대시보드
--
--  근거 : 시화산노회 규칙 제4장 제10~12조 (상비부 조직·선정방법·각 부 임무)
--
--  각 상비부의 부장·서기가 자기 부서 화면에 들어가 회기 동안 할 일을
--  달력에 잡고 공지를 올릴 수 있게 합니다.
--  고시규칙부처럼 부서 전용 업무(모의고사 응시 승인, 고시자료 열람 요청)가
--  있는 부서는 그 화면에서 바로 처리합니다.
--
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 상비부 임원 (부장·서기·회계)
--    지정은 관리자가 합니다.
-- ---------------------------------------------------------------------
create table if not exists public.committee_officers (
  id         bigserial primary key,
  committee  text not null,
  user_id    uuid not null references auth.users on delete cascade,
  position   text not null default '부장',    -- 부장 / 서기 / 회계
  created_at timestamptz not null default now(),
  created_by text
);
create unique index if not exists committee_officers_idx
  on public.committee_officers (committee, user_id);

alter table public.committee_officers enable row level security;

drop policy if exists committee_officers_read  on public.committee_officers;
drop policy if exists committee_officers_write on public.committee_officers;
-- 본인이 어느 부서 임원인지 확인해야 하므로 로그인 회원은 읽을 수 있다
create policy committee_officers_read  on public.committee_officers for select
  using (auth.uid() is not null);
create policy committee_officers_write on public.committee_officers for all
  using (public.can_manage()) with check (public.can_manage());


-- ---------------------------------------------------------------------
-- 2. 내가 이 부서의 임원인가
--    · committee_officers 에 지정되어 있거나
--    · 상비부 명부(committees)의 부장·서기·회계 이름과 내 이름이 같거나
--    · 관리자이면
--    그 부서의 일을 처리할 수 있다.
-- ---------------------------------------------------------------------
create or replace function public.is_committee_officer(p_committee text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.can_manage()
      or exists (
           select 1 from public.committee_officers o
            where o.user_id = auth.uid() and o.committee = p_committee
         )
      or exists (
           select 1
             from public.committees c
             join public.profiles p on p.id = auth.uid()
            where c.name = p_committee
              and p.name is not null
              and (split_part(btrim(coalesce(c.head, '')),      ' ', 1) = p.name
                or split_part(btrim(coalesce(c.clerk, '')),     ' ', 1) = p.name
                or split_part(btrim(coalesce(c.treasurer, '')), ' ', 1) = p.name)
         );
$fn$;

-- 내가 임원으로 있는 부서 목록
create or replace function public.my_committees()
returns table (committee text, duty_name text)
language sql stable security definer set search_path = public as $fn$
  select o.committee, o.position
    from public.committee_officers o
   where o.user_id = auth.uid()
  union
  select c.name,
         case when split_part(btrim(coalesce(c.head, '')), ' ', 1) = p.name then '부장'
              when split_part(btrim(coalesce(c.clerk, '')), ' ', 1) = p.name then '서기'
              else '회계' end
    from public.committees c
    join public.profiles p on p.id = auth.uid()
   where p.name is not null
     and (split_part(btrim(coalesce(c.head, '')),      ' ', 1) = p.name
       or split_part(btrim(coalesce(c.clerk, '')),     ' ', 1) = p.name
       or split_part(btrim(coalesce(c.treasurer, '')), ' ', 1) = p.name);
$fn$;

-- 고시부 임원 판정에 상비부 임원 지정도 함께 본다
create or replace function public.is_exam_officer()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.exam_officers where user_id = auth.uid())
      or public.is_committee_officer('고시규칙부');
$fn$;


-- ---------------------------------------------------------------------
-- 3. 상비부 일정·공지
--    kind : 일정(달력에 표시) / 공지 / 할일
-- ---------------------------------------------------------------------
create table if not exists public.committee_events (
  id          bigserial primary key,
  committee   text not null,
  kind        text not null default '일정',
  title       text not null,
  body        text,
  event_date  date,
  end_date    date,
  place       text,
  done        boolean not null default false,
  notify      boolean not null default false,   -- 부원에게 알림을 보냈는가
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists committee_events_idx
  on public.committee_events (committee, event_date desc, id desc);

alter table public.committee_events enable row level security;

drop policy if exists committee_events_read  on public.committee_events;
drop policy if exists committee_events_write on public.committee_events;
-- 상비부 활동은 정회원이 함께 볼 수 있고, 등록·수정은 그 부서 임원이 한다
create policy committee_events_read  on public.committee_events for select
  using (public.is_member());
create policy committee_events_write on public.committee_events for all
  using (public.is_committee_officer(committee))
  with check (public.is_committee_officer(committee));


-- ---------------------------------------------------------------------
-- 4. 자료 열람 요청 (고시자료 등)
-- ---------------------------------------------------------------------
create table if not exists public.access_requests (
  id          bigserial primary key,
  committee   text not null default '고시규칙부',
  user_id     uuid not null references auth.users on delete cascade,
  user_name   text,
  user_church text,
  subject     text not null,                    -- 무엇을 보고 싶은지
  reason      text,
  status      text not null default 'pending',  -- pending / approved / rejected
  decided_by  text,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists access_requests_idx
  on public.access_requests (committee, status, created_at desc);

alter table public.access_requests enable row level security;

drop policy if exists access_requests_self   on public.access_requests;
drop policy if exists access_requests_insert on public.access_requests;
drop policy if exists access_requests_admin  on public.access_requests;
create policy access_requests_self   on public.access_requests for select using (user_id = auth.uid());
create policy access_requests_insert on public.access_requests for insert
  with check (user_id = auth.uid() and public.is_member());
create policy access_requests_admin  on public.access_requests for all
  using (public.is_committee_officer(committee))
  with check (public.is_committee_officer(committee));


-- ---------------------------------------------------------------------
-- 5. 부원에게 알림 보내기
--    상비부 명부(1·2·3년조)에 이름이 있는 회원에게 보냅니다.
-- ---------------------------------------------------------------------
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

  -- 1·2·3년조 명단을 쉼표로 나누어 이름 목록을 만든다
  select array_agg(btrim(x)) into v_names
    from unnest(string_to_array(
           concat_ws(',', com.y1, com.y2, com.y3, com.head, com.clerk, com.treasurer), ',')) x
   where btrim(x) <> '';

  insert into public.notifications (user_id, kind, title, body, dedupe_key)
  select p.id, '상비부',
         '[' || ev.committee || '] ' || ev.title,
         coalesce(ev.body, '') ||
         case when ev.event_date is not null
              then chr(10) || '일시 : ' || to_char(ev.event_date, 'FMYYYY년 FMMM월 FMDD일')
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

select (select count(*) from public.committees)          as "상비부",
       (select count(*) from public.committee_officers)  as "지정된 임원";

-- =====================================================================
--  61. 노회 진행 관리자
--
--  노회 회의 순서지를 서기가 미리 만들어 두고, 회의 당일 순서를
--  하나씩 진행·완료 처리하면서 회의를 이끄는 진행 도구입니다.
--
--    · meeting_sessions : 회의 한 번 (예: 제20회 가을 정기노회)
--    · meeting_items    : 그 회의의 순서 항목 (개회예배, 임원선거...)
--
--  보기: 정회원 전체 (회의 진행 상황을 회원들도 볼 수 있게)
--  쓰기: 노회 관리자 (노회장·서기·간사)
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

create table if not exists public.meeting_sessions (
  id          bigserial primary key,
  title       text not null,                 -- 예: 제20회 가을 정기노회
  session_no  integer,                       -- 회기 번호
  meet_on     date,
  place       text,
  status      text not null default '준비'
              check (status in ('준비', '진행', '정회', '폐회')),
  quorum_note text,                          -- 성수 보고 (목사 n/장로 n — 성수)
  started_at  timestamptz,
  ended_at    timestamptz,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.meeting_items (
  id          bigserial primary key,
  session_id  bigint not null references public.meeting_sessions on delete cascade,
  sort        integer not null default 0,
  section     text,                          -- 예: Ⅰ. 개회예배 / Ⅱ. 회무처리(오전)
  title       text not null,                 -- 예: 임원선거
  leader      text,                          -- 담당 (인도자·보고자)
  detail      text,                          -- 준비 메모
  status      text not null default '대기'
              check (status in ('대기', '진행중', '완료', '건너뜀')),
  result      text,                          -- 처리 결과 (가결·부결·요지)
  started_at  timestamptz,
  done_at     timestamptz,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists meeting_items_idx
  on public.meeting_items (session_id, sort, id);

alter table public.meeting_sessions enable row level security;
alter table public.meeting_items    enable row level security;

drop policy if exists meeting_sessions_read  on public.meeting_sessions;
drop policy if exists meeting_sessions_write on public.meeting_sessions;
create policy meeting_sessions_read on public.meeting_sessions for select
  using (public.is_member());
create policy meeting_sessions_write on public.meeting_sessions for all
  using (public.can_manage()) with check (public.can_manage());

drop policy if exists meeting_items_read  on public.meeting_items;
drop policy if exists meeting_items_write on public.meeting_items;
create policy meeting_items_read on public.meeting_items for select
  using (public.is_member());
create policy meeting_items_write on public.meeting_items for all
  using (public.can_manage()) with check (public.can_manage());

-- 확인:
--   select s.title, count(i.id) from public.meeting_sessions s
--     left join public.meeting_items i on i.session_id = s.id group by s.id;

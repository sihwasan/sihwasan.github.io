-- =====================================================================
--  64. 회의록 작성 매니저
--
--  회록서기가 회의를 진행하며 회의록을 규격대로 적어 나가는 곳입니다.
--  적는 동안의 내용은 doc(jsonb) 한 칸에 통째로 담기고,
--  다 적은 뒤 서기·노회장이 회의록 목록(minutes_board)에 올립니다.
--
--  보기·쓰기 : 노회 임원 전원 (회록서기가 적고, 임원이 함께 살펴봅니다)
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

create table if not exists public.presbytery_minutes (
  id          bigserial primary key,
  session_id  bigint,                        -- 노회 진행 관리자의 회의 (있으면)
  title       text not null,                 -- 예: 제20회 정기노회 회의록
  meet_on     date,
  doc         jsonb not null default '{}'::jsonb,
  status      text not null default '작성중'
              check (status in ('작성중', '채택', '등록')),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists presbytery_minutes_idx
  on public.presbytery_minutes (meet_on desc, id desc);

alter table public.presbytery_minutes enable row level security;

drop policy if exists presbytery_minutes_read  on public.presbytery_minutes;
drop policy if exists presbytery_minutes_write on public.presbytery_minutes;
create policy presbytery_minutes_read on public.presbytery_minutes for select
  using (public.is_officer());
create policy presbytery_minutes_write on public.presbytery_minutes for all
  using (public.is_officer()) with check (public.is_officer());

-- 확인:
--   select id, title, meet_on, status from public.presbytery_minutes order by id desc;

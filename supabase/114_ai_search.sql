-- =====================================================================
--  114. AI 자료 검색 — 질문 기록 (2026-10-20)
--
--  첫 화면의 AI 검색(cloudflare/ai 창구)이 질문 한 건마다 여기에 한 줄 남긴다.
--  관리자가 「관리자 → AI 검색·API 설정」에서 누가 무엇을 물었고 토큰이 얼마나
--  들었는지 본다. 열쇠(API 키)·모델·한도 설정은 이 표가 아니라 창구의 KV 에 있다.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
-- =====================================================================

create table if not exists public.ai_logs (
  id            bigserial primary key,
  user_id       uuid references auth.users on delete set null,
  user_name     text,
  role          text,
  question      text not null,
  answer_chars  integer not null default 0,
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  tools         jsonb not null default '[]'::jsonb,   -- 쓴 도구 이름들
  ms            integer not null default 0,           -- 걸린 시간(밀리초)
  created_at    timestamptz not null default now()
);
create index if not exists ai_logs_created_idx on public.ai_logs (created_at desc);
create index if not exists ai_logs_user_idx on public.ai_logs (user_id, created_at desc);

alter table public.ai_logs enable row level security;

-- 질문한 본인이 자기 줄을 남기고, 관리자(노회장·서기·간사·최고관리자)가 읽는다
drop policy if exists ai_logs_insert on public.ai_logs;
drop policy if exists ai_logs_read   on public.ai_logs;
create policy ai_logs_insert on public.ai_logs for insert
  with check (auth.uid() = user_id);
create policy ai_logs_read on public.ai_logs for select
  using (public.can_manage());

-- 확인:  select created_at, user_name, role, question, input_tokens, output_tokens from public.ai_logs order by id desc limit 20;

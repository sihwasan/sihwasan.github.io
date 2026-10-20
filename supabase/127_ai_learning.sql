-- =====================================================================
--  127. AI 검색 — 쓰면 쓸수록 나아지는 구조 1단계 (2026-10-20)
--
--  AI 모델을 다시 가르치지 않는다. 사람(관리자)이 확인한 답만 검색 근거로 쌓는다.
--
--    1) 질문 기록(ai_logs)에 답 본문·근거 목록·「자료에서 못 찾음」 표시를 함께 남긴다.
--       창구(cloudflare/ai)가 답을 마치면 한 줄 남기고 그 번호를 화면에 돌려준다.
--    2) ai_feedback — 질문한 본인이 그 답에 「도움이 됐어요 / 아니에요(이유)」를 단다.
--       본인 질문에만, 본인 평가만 쓰고 고친다. 평가는 ai_logs 의 fb_* 칸에도 그대로 옮겨 적는다.
--    3) ai_verified — 관리자가 확인해 승인한 답. 열람 등급(member·officer·admin)마다
--       그 등급 이상만 읽는다. 창구는 질문한 분의 증표로 읽으므로 등급에 맞는 답만 근거가 된다.
--       관리자는 「관리자 → AI 검색·API 설정」의 「못 찾은 질문」 탭에서 승인한다.
--
--  최고관리자의 질문은 117 sql 대로 기록하지 않는다 (그래서 최고관리자 답에는 평가 단추가 없다).
--  can_manage()·is_officer() 는 124 sql 의 2단계 인증 잠금을 그대로 쓴다 (여기서 다시 만들지 않는다).
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--  먼저 114_ai_search.sql · 117_ai_logs_skip_superadmin.sql 이 실행되어 있어야 합니다.
-- =====================================================================

-- 1) 질문 기록에 답 본문·근거·못 찾음 표시 ---------------------------------
alter table public.ai_logs add column if not exists thread      text;
alter table public.ai_logs add column if not exists answer      text;                 -- 근거 표시 [R3]{{…}} 포함, 2만 자까지
alter table public.ai_logs add column if not exists sources     jsonb;                -- [{ref,title,url,kind,cited,quotes,snippet}]
alter table public.ai_logs add column if not exists no_answer   boolean not null default false;
alter table public.ai_logs add column if not exists fb_helpful  boolean;              -- 평가 (ai_feedback 에서 옮겨 적음)
alter table public.ai_logs add column if not exists fb_reason   text;
alter table public.ai_logs add column if not exists fb_at       timestamptz;
alter table public.ai_logs add column if not exists review      text;                 -- 관리자 처리: verified(승인) · skip(넘김)
alter table public.ai_logs add column if not exists reviewed_at timestamptz;
alter table public.ai_logs add column if not exists reviewed_by text;
alter table public.ai_logs add column if not exists verified_id bigint;

alter table public.ai_logs drop constraint if exists ai_logs_review_chk;
alter table public.ai_logs add constraint ai_logs_review_chk check (review is null or review in ('verified', 'skip'));
alter table public.ai_logs drop constraint if exists ai_logs_size_chk;
alter table public.ai_logs add constraint ai_logs_size_chk check (
  char_length(question) <= 2000
  and (answer is null or char_length(answer) <= 20000)
  and (sources is null or pg_column_size(sources) <= 200000)
  and (thread is null or char_length(thread) <= 40));

create index if not exists ai_logs_review_idx on public.ai_logs (created_at desc)
  where no_answer or fb_helpful = false;

-- 본인 질문 줄은 본인도 읽는다 (창구가 남긴 줄 번호를 돌려받는 데 필요)
drop policy if exists ai_logs_read_own on public.ai_logs;
create policy ai_logs_read_own on public.ai_logs for select to authenticated
  using (user_id = auth.uid());

-- 관리자만 처리 표시(review)를 고친다. 질문·답 본문은 누구도 고치지 못한다.
revoke update on public.ai_logs from anon, authenticated;
grant update (review, reviewed_at, reviewed_by, verified_id) on public.ai_logs to authenticated;
drop policy if exists ai_logs_review on public.ai_logs;
create policy ai_logs_review on public.ai_logs for update to authenticated
  using (public.can_manage()) with check (public.can_manage());


-- 2) 답 평가 ---------------------------------------------------------------
create table if not exists public.ai_feedback (
  log_id     bigint primary key references public.ai_logs (id) on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  helpful    boolean not null,
  reason     text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_feedback enable row level security;
revoke all on public.ai_feedback from anon;
grant select, insert, update on public.ai_feedback to authenticated;

drop policy if exists ai_feedback_read   on public.ai_feedback;
drop policy if exists ai_feedback_insert on public.ai_feedback;
drop policy if exists ai_feedback_update on public.ai_feedback;
-- 본인 것과 관리자
create policy ai_feedback_read on public.ai_feedback for select to authenticated
  using (user_id = auth.uid() or public.can_manage());
-- 본인 질문에만 본인 이름으로
create policy ai_feedback_insert on public.ai_feedback for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.ai_logs l where l.id = log_id and l.user_id = auth.uid()));
-- 본인 평가만 고친다 (다른 질문으로 옮기지 못한다 — log_id 는 바꿀 수 없음, 아래 트리거)
create policy ai_feedback_update on public.ai_feedback for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.ai_feedback_before()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'UPDATE' and (new.log_id <> old.log_id or new.user_id <> old.user_id) then
    raise exception '평가를 다른 질문으로 옮길 수 없습니다.';
  end if;
  new.reason := nullif(btrim(coalesce(new.reason, '')), '');
  new.updated_at := now();
  return new;
end
$fn$;
drop trigger if exists ai_feedback_before_trg on public.ai_feedback;
create trigger ai_feedback_before_trg before insert or update on public.ai_feedback
  for each row execute function public.ai_feedback_before();

-- 평가를 질문 기록에도 옮겨 적는다 (관리자 화면이 한 표에서 「낮은 평가」를 거른다)
create or replace function public.ai_feedback_sync()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.ai_logs
     set fb_helpful = new.helpful, fb_reason = new.reason, fb_at = new.updated_at
   where id = new.log_id;
  return new;
end
$fn$;
drop trigger if exists ai_feedback_sync_trg on public.ai_feedback;
create trigger ai_feedback_sync_trg after insert or update on public.ai_feedback
  for each row execute function public.ai_feedback_sync();


-- 3) 확인된 답 (관리자 승인) -------------------------------------------------
create table if not exists public.ai_verified (
  id           bigserial primary key,
  question     text not null check (char_length(question) between 2 and 500),
  keywords     text check (keywords is null or char_length(keywords) <= 300),   -- 함께 찾을 말 (선택)
  answer       text not null check (char_length(answer) between 2 and 8000),
  sources      jsonb not null default '[]'::jsonb,                               -- 원문 근거 [{title,url,kind}]
  level        text not null default 'member' check (level in ('member', 'officer', 'admin')),
  active       boolean not null default true,
  from_log     bigint references public.ai_logs (id) on delete set null,
  created_by   uuid references auth.users on delete set null,
  created_name text,
  updated_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (pg_column_size(sources) <= 50000)
);
create index if not exists ai_verified_active_idx on public.ai_verified (level) where active;

alter table public.ai_verified enable row level security;
revoke all on public.ai_verified from anon;
grant select, insert, update, delete on public.ai_verified to authenticated;
grant usage, select on sequence public.ai_verified_id_seq to authenticated;

drop policy if exists ai_verified_read   on public.ai_verified;
drop policy if exists ai_verified_insert on public.ai_verified;
drop policy if exists ai_verified_update on public.ai_verified;
drop policy if exists ai_verified_delete on public.ai_verified;
-- 등급별 열람: 정회원용(member)=정회원 이상, 임원용(officer)=임원(2단계 인증), 관리자용(admin)=관리자.
-- 관리자는 숨긴 것까지 모두 본다.
create policy ai_verified_read on public.ai_verified for select to authenticated
  using (public.can_manage()
         or (active and case level when 'member'  then public.is_member()
                                   when 'officer' then public.is_officer()
                                   else false end));
create policy ai_verified_insert on public.ai_verified for insert to authenticated
  with check (public.can_manage());
create policy ai_verified_update on public.ai_verified for update to authenticated
  using (public.can_manage()) with check (public.can_manage());
create policy ai_verified_delete on public.ai_verified for delete to authenticated
  using (public.can_manage());

-- 누가 만들고 고쳤는지 이름을 적는다
create or replace function public.ai_verified_before()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_name text := (select p.name from public.profiles p where p.id = auth.uid());
begin
  new.question := btrim(new.question);
  new.answer   := btrim(new.answer);
  new.keywords := nullif(btrim(coalesce(new.keywords, '')), '');
  if tg_op = 'INSERT' then
    new.created_by   := coalesce(auth.uid(), new.created_by);
    new.created_name := coalesce(v_name, new.created_name);
    new.created_at   := now();
  else
    new.created_by := old.created_by; new.created_name := old.created_name; new.created_at := old.created_at;
    new.from_log   := old.from_log;
  end if;
  new.updated_name := coalesce(v_name, new.updated_name);
  new.updated_at   := now();
  return new;
end
$fn$;
drop trigger if exists ai_verified_before_trg on public.ai_verified;
create trigger ai_verified_before_trg before insert or update on public.ai_verified
  for each row execute function public.ai_verified_before();

-- 승인하면 그 질문 기록을 「처리함(승인)」으로, 확인된 답을 지우면 다시 「처리 전」으로
create or replace function public.ai_verified_after()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' and new.from_log is not null then
    update public.ai_logs
       set review = 'verified', verified_id = new.id, reviewed_at = now(), reviewed_by = new.created_name
     where id = new.from_log;
  elsif tg_op = 'DELETE' then
    update public.ai_logs
       set review = null, verified_id = null, reviewed_at = null, reviewed_by = null
     where verified_id = old.id;
  end if;
  return null;
end
$fn$;
drop trigger if exists ai_verified_after_trg on public.ai_verified;
create trigger ai_verified_after_trg after insert or delete on public.ai_verified
  for each row execute function public.ai_verified_after();

-- 확인:
--   select id, created_at, no_answer, fb_helpful, fb_reason, review, left(question, 40) from public.ai_logs order by id desc limit 20;
--   select id, level, active, left(question, 40), updated_name, updated_at from public.ai_verified order by id desc;

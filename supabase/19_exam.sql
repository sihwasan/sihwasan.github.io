-- =====================================================================
--  19. 목사·장로 고시 모의고사
--
--  근거 : 시화산노회 규칙 제7장 제22~23조 (고시 과목)
--         「시화산노회 고시부 목사장로 고시가이드」 (2025. 9. 고시부 발행)
--
--  과목 배정
--    목사       : 목회학, 권징조례, 신조, 예배모범           (+ 면접)
--    장로       : 성경, 정치, 권징조례, 신조, 상식, 소요리    (+ 면접)
--    전도사     : 성경, 상식, 영어                            (+ 면접)
--    목사후보생 : 성경, 상식, 영어                            (+ 면접)
--    · 면접은 필기가 아니므로 모의고사에서 제외합니다.
--    · 성경은 성경통신 신구약 수료증으로 대체되므로 문제 은행이 없습니다.
--
--  정답은 서버에만 두고 응시자에게 내려보내지 않습니다.
--  채점도 서버에서 합니다. (화면을 뜯어보아도 정답을 알 수 없습니다)
--
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 고시부 임원 (부장·서기)
--    이 분들만 응시 요청을 승인할 수 있습니다. 지정은 관리자가 합니다.
-- ---------------------------------------------------------------------
create table if not exists public.exam_officers (
  id         bigserial primary key,
  user_id    uuid not null references auth.users on delete cascade,
  position   text not null default '부장',      -- 부장 / 서기
  created_at timestamptz not null default now(),
  created_by text
);
create unique index if not exists exam_officers_user_idx on public.exam_officers (user_id);

alter table public.exam_officers enable row level security;

drop policy if exists exam_officers_read  on public.exam_officers;
drop policy if exists exam_officers_write on public.exam_officers;
-- 본인이 고시부 임원인지 스스로 확인할 수 있어야 하므로 로그인 회원은 읽을 수 있다
create policy exam_officers_read  on public.exam_officers for select using (auth.uid() is not null);
create policy exam_officers_write on public.exam_officers for all
  using (public.can_manage()) with check (public.can_manage());

create or replace function public.is_exam_officer()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.exam_officers where user_id = auth.uid())
      or public.can_manage();
$fn$;


-- ---------------------------------------------------------------------
-- 2. 문제 은행
--    응시자는 이 표를 직접 읽을 수 없습니다. (정답이 들어 있기 때문)
-- ---------------------------------------------------------------------
create table if not exists public.exam_questions (
  id       bigserial primary key,
  subject  text not null,          -- 목회학 / 정치 / 신조 / 권징조례 / 예배모범 / 상식 / 영어 / 소요리
  question text not null,
  options  jsonb not null,         -- ["보기1","보기2","보기3","보기4"]
  answer   smallint not null,      -- 0~3
  active   boolean not null default true,
  source   text default '시화산노회 고시부 목사장로 고시가이드'
);
create index if not exists exam_questions_subj_idx on public.exam_questions (subject) where active;

alter table public.exam_questions enable row level security;

drop policy if exists exam_questions_read  on public.exam_questions;
drop policy if exists exam_questions_write on public.exam_questions;
create policy exam_questions_read  on public.exam_questions for select
  using (public.is_exam_officer());
create policy exam_questions_write on public.exam_questions for all
  using (public.is_exam_officer()) with check (public.is_exam_officer());


-- ---------------------------------------------------------------------
-- 3. 응시 요청
-- ---------------------------------------------------------------------
create table if not exists public.exam_requests (
  id          bigserial primary key,
  user_id     uuid not null references auth.users on delete cascade,
  user_name   text,
  user_church text,
  track       text not null,                    -- 목사 / 장로 / 전도사 / 목사후보생
  status      text not null default 'pending',  -- pending / approved / rejected
  note        text,
  decided_by  text,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists exam_requests_user_idx on public.exam_requests (user_id, created_at desc);

alter table public.exam_requests enable row level security;

drop policy if exists exam_requests_self   on public.exam_requests;
drop policy if exists exam_requests_insert on public.exam_requests;
drop policy if exists exam_requests_admin  on public.exam_requests;
create policy exam_requests_self   on public.exam_requests for select using (user_id = auth.uid());
create policy exam_requests_insert on public.exam_requests for insert
  with check (user_id = auth.uid() and public.is_member());
create policy exam_requests_admin  on public.exam_requests for all
  using (public.is_exam_officer()) with check (public.is_exam_officer());


-- ---------------------------------------------------------------------
-- 4. 응시 기록 (개인당 2회)
-- ---------------------------------------------------------------------
create table if not exists public.exam_attempts (
  id           bigserial primary key,
  user_id      uuid not null references auth.users on delete cascade,
  user_name    text,
  track        text not null,
  question_ids bigint[] not null,
  answers      smallint[],
  score        integer,
  total        integer,
  started_at   timestamptz not null default now(),
  submitted_at timestamptz
);
create index if not exists exam_attempts_user_idx on public.exam_attempts (user_id, started_at desc);

alter table public.exam_attempts enable row level security;

drop policy if exists exam_attempts_self  on public.exam_attempts;
drop policy if exists exam_attempts_admin on public.exam_attempts;
create policy exam_attempts_self  on public.exam_attempts for select using (user_id = auth.uid());
create policy exam_attempts_admin on public.exam_attempts for select using (public.is_exam_officer());


-- ---------------------------------------------------------------------
-- 5. 과목 배정
-- ---------------------------------------------------------------------
create or replace function public.exam_subjects(p_track text)
returns text[] language sql immutable as $fn$
  select case p_track
    when '목사'       then array['목회학', '권징조례', '신조', '예배모범']
    when '장로'       then array['정치', '권징조례', '신조', '상식', '소요리']
    when '전도사'     then array['상식', '영어']
    when '목사후보생' then array['상식', '영어']
    else array[]::text[]
  end;
$fn$;


-- ---------------------------------------------------------------------
-- 6. 시험 시작
--    · 승인받은 사람만
--    · 개인당 2회까지
--    · 과목마다 골고루 뽑아 섞는다
--    · 정답은 돌려주지 않는다
-- ---------------------------------------------------------------------
create or replace function public.start_exam(p_track text, p_per_subject integer default 10)
returns table (attempt_id bigint, qid bigint, subject text, question text, options jsonb)
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid    uuid := auth.uid();
  v_name   text;
  v_used   integer;
  v_ok     boolean;
  v_subs   text[];
  v_ids    bigint[];
  v_att    bigint;
  v_n      integer := greatest(1, least(coalesce(p_per_subject, 10), 30));
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select p.name into v_name from public.profiles p where p.id = v_uid;

  -- 보던 시험을 끝내지 않고 나갔다면 그 시험을 이어서 본다 (횟수를 더 쓰지 않는다)
  select a.id, a.question_ids into v_att, v_ids
    from public.exam_attempts a
   where a.user_id = v_uid and a.submitted_at is null
   order by a.started_at desc limit 1;
  if v_att is not null then
    return query
      select v_att, q.id, q.subject, q.question, q.options
        from public.exam_questions q
        join unnest(v_ids) with ordinality as u(qid, ord) on u.qid = q.id
       order by u.ord;
    return;
  end if;

  select exists (
    select 1 from public.exam_requests r
     where r.user_id = v_uid and r.track = p_track and r.status = 'approved'
  ) into v_ok;
  if not v_ok then
    raise exception '고시부의 응시 승인을 먼저 받으셔야 합니다.';
  end if;

  select count(*) into v_used from public.exam_attempts a where a.user_id = v_uid;
  if v_used >= 2 then
    raise exception '모의고사는 개인당 2회까지 응시하실 수 있습니다. (이미 %회 응시)', v_used;
  end if;

  v_subs := public.exam_subjects(p_track);
  if array_length(v_subs, 1) is null then
    raise exception '고시 과목이 정해지지 않은 구분입니다.';
  end if;

  -- 과목마다 무작위로 뽑아 모은다
  select array_agg(x.id) into v_ids
    from (
      select q.id,
             row_number() over (partition by q.subject order by random()) as rn
        from public.exam_questions q
       where q.active and q.subject = any(v_subs)
    ) x
   where x.rn <= v_n;

  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception '아직 등록된 문제가 없습니다. 고시부에 문의해 주세요.';
  end if;

  insert into public.exam_attempts (user_id, user_name, track, question_ids, total)
  values (v_uid, v_name, p_track, v_ids, array_length(v_ids, 1))
  returning id into v_att;

  return query
    select v_att, q.id, q.subject, q.question, q.options
      from public.exam_questions q
      join unnest(v_ids) with ordinality as u(qid, ord) on u.qid = q.id
     order by u.ord;
end;
$fn$;


-- ---------------------------------------------------------------------
-- 7. 답안 제출과 채점 (서버에서 채점)
-- ---------------------------------------------------------------------
create or replace function public.submit_exam(p_attempt bigint, p_answers smallint[])
returns table (score integer, total integer,
               qid bigint, subject text, question text, options jsonb,
               correct smallint, chosen smallint)
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid   uuid := auth.uid();
  v_att   public.exam_attempts%rowtype;
  v_score integer := 0;
begin
  select * into v_att from public.exam_attempts where id = p_attempt;
  if v_att.id is null then
    raise exception '응시 기록을 찾을 수 없습니다.';
  end if;
  if v_att.user_id <> v_uid then
    raise exception '본인의 응시 기록이 아닙니다.';
  end if;
  if v_att.submitted_at is not null then
    raise exception '이미 제출한 시험입니다.';
  end if;

  select count(*) into v_score
    from unnest(v_att.question_ids) with ordinality as u(qid, ord)
    join public.exam_questions q on q.id = u.qid
   where q.answer = coalesce(p_answers[u.ord], -1);

  update public.exam_attempts
     set answers = p_answers, score = v_score, submitted_at = now()
   where id = p_attempt;

  return query
    select v_score, v_att.total, q.id, q.subject, q.question, q.options,
           q.answer, coalesce(p_answers[u.ord], -1)::smallint
      from unnest(v_att.question_ids) with ordinality as u(qid, ord)
      join public.exam_questions q on q.id = u.qid
     order by u.ord;
end;
$fn$;

revoke all on function public.start_exam(text, integer)   from public;
revoke all on function public.submit_exam(bigint, smallint[]) from public;
grant execute on function public.start_exam(text, integer)   to authenticated;
grant execute on function public.submit_exam(bigint, smallint[]) to authenticated;


-- ---------------------------------------------------------------------
-- 8. 자료실에 고시집 자리를 만든다
--    (파일은 자료실 관리에서 끌어다 놓아 올려 주세요)
-- ---------------------------------------------------------------------
insert into public.archive_items (section, title, description, doc_date, access, link_url, sort)
select '고시', '시화산노회 고시부 목사장로 고시가이드',
       '고시 과목·제출서류 안내와 과목별 예상 문제가 실린 고시집입니다. 이 책을 바탕으로 모의고사를 볼 수 있습니다.',
       date '2025-09-01', 'member', 'exam.html', 200
where not exists (
  select 1 from public.archive_items where title = '시화산노회 고시부 목사장로 고시가이드'
);

select (select count(*) from public.exam_questions) as "문제",
       (select count(*) from public.exam_officers)  as "고시부 임원";

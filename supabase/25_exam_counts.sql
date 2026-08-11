-- =====================================================================
--  25. 모의고사 : 응시 횟수 제한 폐지 + 과목별 문항 수 확인
--
--  · 로그인하신 분은 횟수 제한 없이 몇 번이든 응시하실 수 있습니다.
--  · 과목당 문항 수를 골랐는데 그만큼 나오지 않는 것은
--    그 과목에 등록된 문제가 부족하기 때문입니다.
--    화면에서 바로 확인하실 수 있도록 과목별 문항 수를 알려 주는 기능을 넣습니다.
--    (문제 내용과 정답은 내보내지 않고 개수만 알려 줍니다)
--
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 과목별 문항 수 (개수만 알려 준다)
-- ---------------------------------------------------------------------
create or replace function public.exam_question_counts()
returns table (subject text, n integer)
language sql stable security definer set search_path = public as $fn$
  select q.subject, count(*)::integer
    from public.exam_questions q
   where q.active
   group by q.subject
   order by q.subject;
$fn$;

revoke all on function public.exam_question_counts() from public;
grant execute on function public.exam_question_counts() to authenticated;

comment on function public.exam_question_counts() is
  '과목별 문항 수만 알려 준다. 문제 내용과 정답은 내보내지 않는다.';


-- ---------------------------------------------------------------------
-- 2. 응시 횟수 제한 폐지
--    보던 시험을 끝내지 않고 나가셨다면 그 시험을 이어서 보시게 됩니다.
-- ---------------------------------------------------------------------
create or replace function public.start_exam(p_track text, p_per_subject integer default 10)
returns table (attempt_id bigint, qid bigint, subject text, question text, options jsonb)
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid    uuid := auth.uid();
  v_name   text;
  v_subs   text[];
  v_ids    bigint[];
  v_att    bigint;
  v_n      integer := greatest(1, least(coalesce(p_per_subject, 10), 50));
begin
  if v_uid is null then
    raise exception '로그인 후 이용하실 수 있습니다.';
  end if;

  select p.name into v_name from public.profiles p where p.id = v_uid;

  -- 보던 시험을 끝내지 않고 나갔다면 그 시험을 이어서 본다
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

  v_subs := public.exam_subjects(p_track);
  if array_length(v_subs, 1) is null then
    raise exception '고시 과목이 정해지지 않은 구분입니다.';
  end if;

  -- 과목마다 v_n 개씩 무작위로 뽑는다.
  -- 그 과목에 문제가 v_n 개보다 적으면 있는 만큼만 나온다.
  select array_agg(x.id) into v_ids
    from (
      select q.id,
             row_number() over (partition by q.subject order by random()) as rn
        from public.exam_questions q
       where q.active and q.subject = any(v_subs)
    ) x
   where x.rn <= v_n;

  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception '이 구분(%)의 과목에 등록된 문제가 없습니다. 고시부에 문의해 주세요.', p_track;
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
-- 3. 확인 : 어느 과목에 문제가 몇 개 들어가 있는지
--    합계가 735 가 아니면 supabase/exam-questions/ 폴더의 01~08 파일 중
--    실행하지 않은 것이 있습니다.
-- ---------------------------------------------------------------------
select coalesce(subject, '합계') as "과목", count(*) as "문항"
  from public.exam_questions
 where active
 group by rollup (subject)
 order by count(*) desc;

-- =====================================================================
--  23. 모의고사 응시 승인 절차 폐지
--
--  로그인하신 분은 누구나 모의고사를 보실 수 있습니다.
--  고시부의 승인을 받는 과정을 없앱니다.
--  응시 횟수(개인당 2회)는 그대로 두고,
--  고시부 임원과 관리자는 문제를 점검해야 하므로 횟수 제한을 받지 않습니다.
--
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

create or replace function public.start_exam(p_track text, p_per_subject integer default 10)
returns table (attempt_id bigint, qid bigint, subject text, question text, options jsonb)
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid    uuid := auth.uid();
  v_name   text;
  v_used   integer;
  v_subs   text[];
  v_ids    bigint[];
  v_att    bigint;
  v_n      integer := greatest(1, least(coalesce(p_per_subject, 10), 30));
begin
  if v_uid is null then
    raise exception '로그인 후 이용하실 수 있습니다.';
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

  -- 고시부 임원과 관리자는 문제를 점검해야 하므로 횟수 제한을 받지 않는다
  if not public.is_exam_officer() then
    select count(*) into v_used from public.exam_attempts a where a.user_id = v_uid;
    if v_used >= 2 then
      raise exception '모의고사는 개인당 2회까지 응시하실 수 있습니다. (이미 %회 응시)', v_used;
    end if;
  end if;

  v_subs := public.exam_subjects(p_track);
  if array_length(v_subs, 1) is null then
    raise exception '고시 과목이 정해지지 않은 구분입니다.';
  end if;

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

-- 이제 쓰지 않는 응시 요청 자료를 비웁니다. (표는 남겨 둡니다)
delete from public.exam_requests;

select '승인 절차가 폐지되었습니다. 로그인하신 분은 누구나 응시하실 수 있습니다.' as "결과";

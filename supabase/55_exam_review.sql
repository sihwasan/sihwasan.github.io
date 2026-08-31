-- 55. 모의고사 다듬기
--   · start_exam 에 p_fresh 추가: true 면 진행 중 시험을 버리고 새로 출제
--   · review_exam: 제출한 본인 시험의 문항·내 답·정답 다시 보기
--   · 본인 응시 기록 삭제 허용
--   (실제 적용은 Supabase migration start_exam_fresh, exam_review_delete 로 완료)

create or replace function public.review_exam(p_attempt bigint)
returns table (qid bigint, subject text, question text, options jsonb,
               correct smallint, chosen smallint)
language plpgsql security definer set search_path = public as $fn$
declare
  v_att public.exam_attempts%rowtype;
begin
  select * into v_att from public.exam_attempts a where a.id = p_attempt;
  if v_att.id is null or v_att.user_id <> auth.uid() then
    raise exception '본인의 응시 기록이 아닙니다.';
  end if;
  if v_att.submitted_at is null then
    raise exception '아직 제출하지 않은 시험입니다.';
  end if;
  return query
    select q.id, q.subject, q.question, q.options,
           q.answer, coalesce(v_att.answers[u.ord], -1)::smallint
      from unnest(v_att.question_ids) with ordinality as u(uqid, ord)
      join public.exam_questions q on q.id = u.uqid
     order by u.ord;
end;
$fn$;
revoke all on function public.review_exam(bigint) from public;
grant execute on function public.review_exam(bigint) to authenticated;

drop policy if exists exam_attempts_delete on public.exam_attempts;
create policy exam_attempts_delete on public.exam_attempts for delete
  using (user_id = auth.uid());

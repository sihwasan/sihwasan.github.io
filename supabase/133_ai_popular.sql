-- 133. 회원들이 가장 많이 묻는 질문 — 첫 화면 AI 검색의 보기 질문(칩)을 여기서 받는다
--  ai_logs(114 sql)에 쌓인 질문을 최근 180일 기준으로 같은 질문끼리 묶어 많이 물은 순서로 돌려준다.
--  최고관리자의 질문은 애초에 기록되지 않으므로(117 sql) 자연히 빠진다.
--  실행: Supabase SQL Editor 에 붙여 넣고 실행. (여러 번 실행해도 안전)

create or replace function public.ai_popular_questions(n integer default 6, days integer default 180)
returns table (question text, cnt bigint, last_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  with q as (
    select
      /* 묶는 열쇠: 소문자, 띄어쓰기 하나로, 끝의 물음표·마침표·공백 제거 */
      lower(regexp_replace(regexp_replace(trim(question), '\s+', ' ', 'g'), '[?？.。!\s]+$', '')) as k,
      trim(question) as original,
      created_at
    from public.ai_logs
    where created_at >= now() - make_interval(days => greatest(days, 1))
      and coalesce(role, '') <> 'superadmin'
      and length(trim(question)) between 6 and 80
  ),
  g as (
    select k, count(*) as cnt, max(created_at) as last_at
    from q
    group by k
  )
  select
    (select original from q where q.k = g.k order by q.created_at desc limit 1) as question,
    g.cnt, g.last_at
  from g
  order by g.cnt desc, g.last_at desc
  limit greatest(n, 1);
$$;

revoke all on function public.ai_popular_questions(integer, integer) from public;
grant execute on function public.ai_popular_questions(integer, integer) to authenticated;

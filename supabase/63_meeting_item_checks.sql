-- =====================================================================
--  63. 순서 안의 세부 체크 목록
--
--  시찰 보고(북부·상록·남부)나 상비부 보고처럼 한 순서 안에서
--  여러 곳이 차례로 보고하는 경우, 어디까지 보고가 끝났는지
--  하나씩 체크할 수 있도록 meeting_items에 checks 칸을 더합니다.
--
--    checks 예시:
--      [{"t":"북부시찰","ok":true,"at":"2026-09-01T01:20:00Z"},
--       {"t":"상록시찰","ok":false,"at":null}]
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

alter table public.meeting_items
  add column if not exists checks jsonb not null default '[]'::jsonb;

-- 확인:
--   select title, checks from public.meeting_items order by session_id, sort;

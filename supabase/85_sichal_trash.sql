-- =====================================================================
--  85. 시찰 자료실 — 서기·시찰장의 삭제는 <삭제한 자료>로 보관, 총관리자만 완전 삭제
--
--  petition_submissions(청원서)·sichal_docs(자료)에 deleted_at / deleted_by 칸을 둔다.
--  서기·시찰장이 지우면 이 칸만 채워 보관하고(되돌리기 가능), 총관리자는 줄을 바로 지운다.
--  화면(sichal.html·mydocs.html·officer.html)은 deleted_at 이 있는 줄을 숨긴다.
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run  (여러 번 실행해도 안전)
-- =====================================================================
alter table public.petition_submissions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;
alter table public.sichal_docs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;
create index if not exists petition_sub_deleted_idx on public.petition_submissions (sichal) where deleted_at is not null;
create index if not exists sichal_docs_deleted_idx on public.sichal_docs (sichal) where deleted_at is not null;

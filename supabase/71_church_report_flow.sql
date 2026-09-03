-- =====================================================================
--  71. 교회상황 보고서 — 결재 흐름
--
--  교회 작성 → 시찰 서기 취합 → 노회 서기 제출 → 노회 서기 반영(승인)
--
--    church_reports.status
--      '작성'      교회가 쓰는 중 (기본값)
--      '시찰접수'  교회가 시찰 서기에게 냈다
--      '노회제출'  시찰 서기가 노회 서기에게 냈다
--      '반영완료'  노회 서기가 받아 반영했다  ← 여기서 끝납니다
--      '보완요청'  노회 서기가 고쳐 달라고 돌려보냈다
--
--    ※ 노회 서기의 승인이 곧 노회장의 승인입니다.
--       따로 노회장 결재 단계를 두지 않습니다.
--
--    sichal_sent_at      교회가 시찰에 낸 시각
--    presbytery_sent_at  시찰 서기가 노회 서기에게 낸 시각
--    approved_at         노회 서기가 반영한 시각
--    approved_by         반영한 사람
--    review_note         보완요청 사유 등 노회 서기의 의견
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다. 이미 들어 있는 내용은 건드리지 않습니다.
--  ※ 열람·수정 권한(RLS)은 35·41 에서 정한 그대로 둡니다. 여기서 바꾸지 않습니다.
--       SELECT  is_officer()  또는 is_sichal_officer(sichal)
--               또는 (is_member() AND my_church() = church)
--       UPDATE/DELETE  can_manage()  또는 is_sichal_officer(sichal)
--               또는 (is_full_member() AND my_church() = church)
--     열람 범위는 <본인 교회 + 임원>입니다. 반영이 끝나도 넓어지지 않습니다.
-- =====================================================================

alter table public.church_reports
  add column if not exists status text not null default '작성';
alter table public.church_reports
  add column if not exists sichal_sent_at timestamptz;
alter table public.church_reports
  add column if not exists presbytery_sent_at timestamptz;
alter table public.church_reports
  add column if not exists approved_at timestamptz;
alter table public.church_reports
  add column if not exists approved_by uuid references auth.users on delete set null;
alter table public.church_reports
  add column if not exists review_note text;

-- 노회 서기가 <노회제출>된 것부터 빨리 찾도록
create index if not exists church_reports_status_idx
  on public.church_reports (year, status, sichal);


-- 확인
select (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'church_reports'
           and column_name in ('status', 'sichal_sent_at', 'presbytery_sent_at',
                               'approved_at', 'approved_by', 'review_note'))  as "더한 칸 (6이어야 정상)",
       (select count(*) from public.church_reports)                           as "보고서",
       (select count(*) from public.church_reports where status = '노회제출')  as "노회제출",
       (select count(*) from public.church_reports where status = '반영완료')  as "반영완료";

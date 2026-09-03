-- =====================================================================
--  70. 청원서 <서류 진단>
--
--  교회(당회장)가 시찰 서기에게 낸 청원서를, 시찰 서기가 열어 보고
--  적합 · 보완요청 · 반려로 진단합니다. 언제 누가 진단했는지 남깁니다.
--
--    petition_submissions.status  '제출됨' → '적합' / '보완요청' / '반려'
--    petition_submissions.note    시찰 서기의 진단 의견 (신청자에게 보입니다)
--    petition_submissions.reviewed_at / reviewed_by   ← 이 파일에서 더합니다
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다. 이미 들어 있는 내용은 건드리지 않습니다.
--  ※ 열람·수정 권한(RLS)은 54 에서 정한 그대로 둡니다. 여기서 바꾸지 않습니다.
--       SELECT  본인 글이거나  public.is_sichal_officer(sichal)
--       UPDATE  public.is_sichal_officer(sichal)
--       DELETE  (본인 AND status='제출됨')  또는  public.is_sichal_officer(sichal)
-- =====================================================================

alter table public.petition_submissions
  add column if not exists reviewed_at timestamptz;
alter table public.petition_submissions
  add column if not exists reviewed_by uuid references auth.users on delete set null;

-- 시찰 서기가 아직 진단하지 않은 것부터 빨리 찾도록
create index if not exists petition_sub_status_idx
  on public.petition_submissions (sichal, status, created_at desc);


-- 확인
select (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'petition_submissions'
           and column_name = 'reviewed_at')                          as "진단한 날 칸",
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'petition_submissions'
           and column_name = 'reviewed_by')                          as "진단한 사람 칸",
       (select count(*) from public.petition_submissions)            as "받은 청원서",
       (select count(*) from public.petition_submissions
         where status = '제출됨')                                     as "미처리";

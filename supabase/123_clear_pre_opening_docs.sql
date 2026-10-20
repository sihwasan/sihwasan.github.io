-- =====================================================================
--  123. 정식 오픈 전 서류 신청·발급 기록 지우기 (2026-10-20)
--
--  제20회 정기노회(2026-10-12)로 홈페이지가 정식 오픈되었다.
--  그 전에 시험 삼아 접수·발급한 서류를 모두 지운다.
--
--    · 서류 신청            doc_requests   — 2026-10-12 전에 들어온 것 전부
--    · 발급 대장            doc_issues     — 그 신청으로 발급한 것과 2026-10-12 전에 발급한 것
--                                            (시화산노 제19-001호·제19-002호 등)
--    · 발급 대장 삭제 기록  doc_deletions  — 2026-10-12 전에 남은 것
--    · 알림함의 서류 알림   notifications  — 종류 '서류', 2026-10-12 전에 보낸 것
--
--  2026-10-12 이후에 들어온 신청·발급은 건드리지 않는다.
--  감사 기록(audit_logs)과 노회 회계 장부는 건드리지 않는다 (서류 수수료는 장부와 연결되어 있지 않다).
--  발급번호는 회기별로 매기므로 다음 발급은 시화산노 제20-001호부터 시작한다.
--  보관소(Cloudflare R2 sihwasan-certs)에 남는 옛 증명서 PDF 는 발급 기록이 없어지면
--  누구도 내려받을 수 없다 (내려받기 주소를 줄 때 발급 기록을 확인하므로).
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.
--        한 덩어리로 돌아가므로 중간에 오류가 나면 아무것도 지워지지 않는다.
--        지운 뒤에는 되돌릴 수 없다. 끝나면 지운 건수와 남은 건수가 표로 보인다.
--
--  미리 보기만 하려면 아래 두 줄만 골라서(드래그) 실행한다 — 아무것도 지우지 않는다.
--    select id, created_at::date as 신청일, name, church, doc_type, purpose, status
--      from public.doc_requests where created_at < '2026-10-12 00:00:00+09' order by id;
-- =====================================================================

begin;

drop table if exists _gone;
create temp table _gone (no int, 항목 text, 건수 bigint);

-- 1. 발급 대장 — 오픈 전 신청으로 발급한 것, 오픈 전에 발급한 것
with d as (
  delete from public.doc_issues
   where created_at < '2026-10-12 00:00:00+09'
      or request_id in (select id from public.doc_requests where created_at < '2026-10-12 00:00:00+09')
  returning 1
)
insert into _gone select 1, '발급 대장 (증명서)', count(*) from d;

-- 2. 발급 대장 삭제 기록
with d as (
  delete from public.doc_deletions where deleted_at < '2026-10-12 00:00:00+09' returning 1
)
insert into _gone select 2, '발급 대장 삭제 기록', count(*) from d;

-- 3. 서류 신청
with d as (
  delete from public.doc_requests where created_at < '2026-10-12 00:00:00+09' returning 1
)
insert into _gone select 3, '서류 신청', count(*) from d;

-- 4. 알림함의 서류 알림 (신청 접수·입금 확인·발급 알림)
with d as (
  delete from public.notifications where kind = '서류' and created_at < '2026-10-12 00:00:00+09' returning 1
)
insert into _gone select 4, '알림함의 서류 알림', count(*) from d;

commit;

-- 결과: 지운 건수와, 오픈 뒤(2026-10-12 이후) 남아 있는 건수
select 항목, 건수 as "건수" from (
  select no, 항목, 건수 from _gone
  union all
  select 5, '남은 서류 신청 (오픈 뒤)', count(*) from public.doc_requests
  union all
  select 6, '남은 발급 대장 (오픈 뒤)', count(*) from public.doc_issues
) r
order by no;

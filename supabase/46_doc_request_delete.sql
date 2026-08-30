-- =====================================================================
-- 시화산노회 홈페이지 : 서류 신청 본인 삭제
--
-- 실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣고 Run
--
-- 신청자가 자신의 서류 신청 중 아직 처리되지 않은 건(입금 대기 '신청',
-- '반려')을 스스로 삭제할 수 있게 합니다. 발급이 진행된 건은 발급 대장과
-- 연결되어 있으므로 삭제할 수 없습니다.
--
--   ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

drop policy if exists doc_requests_self_delete on public.doc_requests;
create policy doc_requests_self_delete on public.doc_requests for delete
  using (auth.uid() = user_id and status in ('신청','반려'));

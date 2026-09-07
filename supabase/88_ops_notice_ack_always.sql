-- =====================================================================
--  88. 시스템 알림 — 모든 알림에 <완료> 단추
--
--  전에는 규칙마다 <확인 완료 단추>를 켜 둔 것만 받는 사람이 끌 수 있었는데,
--  기본이 꺼짐이라 상단 배너에 단추가 하나도 없었다. 이제 모든 시스템 알림에
--  <완료> 단추가 붙고, 누르면 이번 회기에는 다시 보이지 않는다
--  (ops_notice_acks 에 남아 어느 기기에서든 같다).
--  규칙 화면의 켜고 끄는 칸은 없앴고, 열(ack_enabled)은 남겨 두되 늘 참이다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 82_ops_notice_ack.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

alter table public.ops_notices alter column ack_enabled set default true;

update public.ops_notices
   set ack_enabled = true
 where ack_enabled is distinct from true;

-- 확인:
--   select id, title, ack_enabled from public.ops_notices order by sort;

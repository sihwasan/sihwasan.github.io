-- =====================================================================
--  118. 제20회 정기노회(2026. 10. 12.) 청빙 결의 반영 — 담임목사 갱신 (2026-10-20)
--
--  정치부 보고 가결 사항 (세 분 모두 지금은 그 교회의 시무목사다):
--    · 경기은목교회  김영창씨 시무목사 청빙  → 담임 김영창 (시무목사)
--    · 노진교회      손병민씨 위임목사 청빙  → 담임 손병민 (지금은 시무목사, 위임식 2026. 10. 31. 뒤 119 sql 로 위임목사)
--    · 목자교회      송지용씨 위임목사 청빙  → 담임 송지용 (지금은 시무목사, 위임식 뒤 120 sql 로 위임목사)
--
--  회원교회 목록(sichal_churches.pastor)과 회원 명단(roster.church/position),
--  그분들의 계정(profiles.church/position)을 함께 맞춘다.
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
-- =====================================================================

-- 1. 회원교회 담임 ---------------------------------------------------------
update public.sichal_churches set pastor = '김영창', updated_at = now(), updated_by = '118 sql (제20회 정기노회 결의)' where name = '경기은목교회';
update public.sichal_churches set pastor = '손병민', updated_at = now(), updated_by = '118 sql (제20회 정기노회 결의)' where name = '노진교회';
update public.sichal_churches set pastor = '송지용', updated_at = now(), updated_by = '118 sql (제20회 정기노회 결의)' where name = '목자교회';

-- 2. 회원 명단 — 셋 다 지금은 시무목사 (같은 이름이 둘이면 손으로 확인할 것) ---------------
update public.roster set church = '경기은목교회', "position" = '시무목사' where name = '김영창' and active;
update public.roster set church = '노진교회',     "position" = '시무목사' where name = '손병민' and active and coalesce("position", '') <> '위임목사';
update public.roster set church = '목자교회',     "position" = '시무목사' where name = '송지용' and active and coalesce("position", '') <> '위임목사';

-- 3. 그분들의 홈페이지 계정 (가입할 때 적은 교회·직분) ---------------------------------
update public.profiles set church = '경기은목교회', "position" = '시무목사', updated_at = now() where name = '김영창' and role <> 'pending';
update public.profiles set church = '노진교회',     "position" = '시무목사', updated_at = now() where name = '손병민' and role <> 'pending' and coalesce("position", '') <> '위임목사';
update public.profiles set church = '목자교회',     "position" = '시무목사', updated_at = now() where name = '송지용' and role <> 'pending' and coalesce("position", '') <> '위임목사';

-- 확인
select name, sichal, pastor from public.sichal_churches where name in ('경기은목교회', '노진교회', '목자교회');
select name, church, "position", category from public.roster where name in ('김영창', '손병민', '송지용');

-- 101. 교회 가입일
--
--  그 교회가 본 노회에 가입한 날입니다. 교회 명부와 시찰 화면에 적어 두고,
--  가입한 지 얼마나 되었는지를 함께 보여 줍니다.
--
--  고치는 자리
--    회원 관리 > 교회 관리   노회 관리자
--    시찰 > 교회 정보         시찰장·서기 (노회 관리자 포함)
--  교회의 제 식구도 교회 정보를 고칠 수 있지만, 가입일은 노회의 기록이므로
--  그 칸은 시찰 임원에게만 보입니다.
--
--  ※ 실제 적용은 Supabase migration church_joined_on 으로 완료했습니다.
--     여러 번 실행해도 안전합니다.
-- =====================================================================

alter table public.sichal_churches add column if not exists joined_on date;

comment on column public.sichal_churches.joined_on is '본 노회 가입일';

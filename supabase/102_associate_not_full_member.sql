-- 102. 준회원도 서류 발급·청원서·보고서를 할 수 없다
--
--  준회원은 회의에서 언권만 가지므로 언권회원과 같이
--    · 서류 발급 신청
--    · 청원서 작성·제출
--    · 교회상황 보고서 작성
--  을 할 수 없습니다. 자료 열람은 그대로입니다(is_member 에는 그대로 듭니다).
--
--  is_full_member() 가 이 셋의 문지기이므로, 여기서 두 등급을 함께 뺍니다.
--  화면에서도 SHS.isLimitedMember() 로 같은 자리를 막습니다.
--
--  ※ 실제 적용은 Supabase migration associate_not_full_member 로 완료했습니다.
--     여러 번 실행해도 안전합니다.
-- =====================================================================

create or replace function public.is_full_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_member() and not exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role in ('advisory', 'associate'));
$$;

comment on function public.is_full_member() is
  '정회원 이상이되 언권회원·준회원은 아님 — 서류 발급·청원서·보고서 작성의 자격';

-- =====================================================================
-- 시화산노회 홈페이지 : 2026년 세례의무금 납입 내역 반영
--
-- 실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣고 Run
--
-- 「시화산노회 교회 헌금 납입현황」(110회기, 2026-11-17 현재) 그대로
-- 교회별 납입금액을 맞춥니다.
--   · 참여 24곳 / 36곳 · 납입 합계 14,000,000원 / 목표 16,924,000원 (82.7%)
--   · 목표금액·세례교인수·담임교역자는 건드리지 않습니다.
--   · 납입일이 비어 있던 교회는 2026-11-17 로 적습니다 (있던 날짜는 유지).
--   · 2026년은 이미 마감되어 있으므로, 마감 기록의 확정 실적(납입액·
--     납부 교회 수)도 함께 고칩니다. 마감일·마감한 사람은 그대로 둡니다.
--
--   ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

with src(church, paid) as (values
  ('경기은목교회',         0),
  ('나눔의교회',      128000),
  ('노진교회',        410000),
  ('동탄영광교회',    144000),
  ('목자교회',        336000),
  ('반석교회',             0),
  ('반월교회',       6640000),
  ('새날선교교회',         0),
  ('새누리교회',           0),
  ('새생명교회',       56000),
  ('새솔제일교회',    192000),
  ('새힘교회',             0),
  ('샘솟는교회',           0),
  ('서신영광교회',         0),
  ('서안문호교회',         0),
  ('섬기는교회',      968000),
  ('섬김의교회',      224000),
  ('성산교회',        176000),
  ('수암새권능교회',  248000),
  ('수암제일교회',    208000),
  ('시흥생수교회',    304000),
  ('시흥은혜교회',     80000),
  ('아름다운숲교회',  140000),
  ('안산상록교회',    344000),
  ('안산샬롬교회',         0),
  ('안산원곡동교회',  224000),
  ('연수교회',             0),
  ('운평장로교회',    375000),
  ('율리교회',        175000),
  ('은광교회',       1720000),
  ('주말씀교회',           0),
  ('주품에교회',           0),
  ('참된빛교회',       32000),
  ('한숲우리교회',    420000),
  ('행복한교회',      168000),
  ('힘찬교회',        288000)
)
update public.bapdues b
   set paid       = s.paid,
       paid_on    = case when s.paid > 0 then coalesce(b.paid_on, date '2026-11-17') else null end,
       updated_at = now()
  from src s
 where b.year = 2026
   and regexp_replace(b.church, '\s', '', 'g') = s.church
   and (b.paid is distinct from s.paid
        or (s.paid > 0 and b.paid_on is null)
        or (s.paid = 0 and b.paid_on is not null));

-- 마감 기록의 확정 실적을 고친 금액에 맞춘다 (마감되어 있을 때만)
update public.site_settings st
   set value = jsonb_set(st.value, '{2026}',
         (st.value -> '2026') || (
           select jsonb_build_object(
                    'churches', count(*),
                    'join',     count(*) filter (where paid > 0),
                    'members',  coalesce(sum(members), 0),
                    'target',   coalesce(sum(target), 0),
                    'paid',     coalesce(sum(paid), 0))
             from public.bapdues where year = 2026))
 where st.key = 'bapdues_closed'
   and st.value ? '2026';

-- 확인: 36곳 · 참여 24곳 · 목표 16,924,000 · 납입 14,000,000 이 나와야 합니다.
select count(*)                         as churches,
       count(*) filter (where paid > 0) as joined,
       sum(target)                      as target,
       sum(paid)                        as paid
  from public.bapdues where year = 2026;

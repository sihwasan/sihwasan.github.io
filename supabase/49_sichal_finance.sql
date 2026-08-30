-- =====================================================================
--  49. 시찰별 납부 현황 (대시보드 나의 시찰)
--
--  상회비(dues_rates·dues_payments)와 세례의무금(bapdues)을 시찰별로
--  모아 정회원 대시보드에 보여 줍니다. 상회비 원자료는 임원만 읽을 수
--  있으므로, 여기서는 서버 함수(security definer)가 모아서 돌려 줍니다.
--
--    sichal_finance(연도)             — 시찰별 요약
--    sichal_finance_detail(연도, 시찰) — 그 시찰의 교회별 상세
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

create or replace function public.sichal_finance(p_year int)
returns table (
  out_sichal        text,
  out_dues_churches int,      -- 상회비 설정 교회 수
  out_dues_plan     bigint,   -- 연간 부과액 (만원)
  out_dues_paid     bigint,   -- 올해 납부액 (만원)
  out_bap_churches  int,      -- 세례의무금 배정 교회 수
  out_bap_join      int,      -- 세례의무금 참여 교회 수
  out_bap_target    bigint,   -- 목표금액 (원)
  out_bap_paid      bigint    -- 납입금액 (원)
) language sql stable security definer set search_path = public as $fn$
  with d as (
    select coalesce(nullif(btrim(r.sichal), ''), '기타') as sichal,
           count(*)::int as nch,
           (sum(coalesce(r.monthly_amount, 0)) * 12)::bigint as plan,
           coalesce(sum(pp.paid), 0)::bigint as paid
      from public.dues_rates r
      left join lateral (
        select sum(coalesce(p.amount, r.monthly_amount)) as paid
          from public.dues_payments p
         where p.year = r.year and p.church = r.church
      ) pp on true
     where r.year = p_year
     group by 1
  ),
  b as (
    select coalesce(sc.sichal, '기타') as sichal,
           count(*)::int as nch,
           (count(*) filter (where bb.paid > 0))::int as joined,
           coalesce(sum(bb.target), 0)::bigint as target,
           coalesce(sum(bb.paid), 0)::bigint as paid
      from public.bapdues bb
      left join lateral (
        select s.sichal from public.sichal_churches s
         where public._chkey(s.name) = public._chkey(bb.church) limit 1
      ) sc on true
     where bb.year = p_year
     group by 1
  )
  select coalesce(d.sichal, b.sichal),
         coalesce(d.nch, 0), coalesce(d.plan, 0), coalesce(d.paid, 0),
         coalesce(b.nch, 0), coalesce(b.joined, 0), coalesce(b.target, 0), coalesce(b.paid, 0)
    from d full join b on d.sichal = b.sichal
   where public.is_member();
$fn$;

create or replace function public.sichal_finance_detail(p_year int, p_sichal text)
returns table (
  out_church    text,
  out_monthly   int,      -- 월 상회비 (만원)
  out_months    int,      -- 납부한 달 수
  out_dues_paid bigint,   -- 상회비 납부액 (만원)
  out_bap_target bigint,  -- 세례의무금 목표 (원)
  out_bap_paid  bigint    -- 세례의무금 납입 (원)
) language sql stable security definer set search_path = public as $fn$
  with dr as (
    select r.church,
           coalesce(r.monthly_amount, 0)::int as monthly,
           (select count(*) from public.dues_payments p
             where p.year = r.year and p.church = r.church)::int as months,
           (select coalesce(sum(coalesce(p.amount, r.monthly_amount)), 0)
              from public.dues_payments p
             where p.year = r.year and p.church = r.church)::bigint as paid
      from public.dues_rates r
     where r.year = p_year
       and coalesce(nullif(btrim(r.sichal), ''), '기타') = p_sichal
  ),
  bp as (
    select bb.church, bb.target, bb.paid
      from public.bapdues bb
     where bb.year = p_year
       and coalesce((select s.sichal from public.sichal_churches s
                      where public._chkey(s.name) = public._chkey(bb.church) limit 1),
                    '기타') = p_sichal
  )
  select coalesce(dr.church, bp.church),
         coalesce(dr.monthly, 0), coalesce(dr.months, 0), coalesce(dr.paid, 0),
         coalesce(bp.target, 0), coalesce(bp.paid, 0)
    from dr full join bp on public._chkey(dr.church) = public._chkey(bp.church)
   where public.is_member()
   order by 1;
$fn$;

grant execute on function public.sichal_finance(int) to authenticated;
grant execute on function public.sichal_finance_detail(int, text) to authenticated;

-- 확인:  select * from public.sichal_finance(2026);

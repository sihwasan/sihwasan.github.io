-- =====================================================================
--  72. 시찰별 납부 현황 — 이번 달까지 부과분과 선납을 구분
--
--  49_sichal_finance 의 두 함수를 바꿉니다. 지금까지는 납부액에 다음 달
--  이후분 선납까지 섞여 "이번 달까지 부과액 대비" 비율이 부풀려 보였습니다.
--  임원방 상회비 화면과 같은 기준(연간 목표 대비 + 이번 달까지 부과분 대비)
--  으로 보여 주도록 다음 값을 더 돌려 줍니다.
--
--    sichal_finance(연도)
--      out_dues_due      이번 달까지 부과액 (만원)
--      out_dues_paid_due 이번 달까지 부과분만 센 납부액 (만원, 선납 제외)
--      out_dues_full     이번 달까지 모두 납부한 교회 수
--    sichal_finance_detail(연도, 시찰)
--      out_months_due    이번 달까지 부과분 가운데 납부한 달 수
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
--  ※ 반환 열이 늘어나므로 drop 뒤 다시 만듭니다. 여러 번 실행해도 안전합니다.
-- =====================================================================

-- 회기(4월 시작)에서 이번 달까지 몇 달째인지. 지난 회기는 12, 다음 회기는 0.
create or replace function public.fy_elapsed(p_year int)
returns int language sql stable as $fn$
  with now_kr as (
    select extract(month from (now() at time zone 'Asia/Seoul'))::int as m,
           extract(year  from (now() at time zone 'Asia/Seoul'))::int as y
  ),
  fy as (
    select case when m >= 4 then y else y - 1 end as fy, m from now_kr
  )
  select case
           when p_year < fy then 12
           when p_year > fy then 0
           else ((m + 8) % 12) + 1
         end
    from fy;
$fn$;

drop function if exists public.sichal_finance(int);
create function public.sichal_finance(p_year int)
returns table (
  out_sichal        text,
  out_dues_churches int,      -- 상회비 설정 교회 수
  out_dues_plan     bigint,   -- 연간 부과액 (만원)
  out_dues_paid     bigint,   -- 올해 납부액 (만원, 다음 달 이후분 선납 포함)
  out_dues_due      bigint,   -- 이번 달까지 부과액 (만원)
  out_dues_paid_due bigint,   -- 이번 달까지 부과분만 센 납부액 (만원)
  out_dues_full     int,      -- 이번 달까지 모두 납부한 교회 수
  out_bap_churches  int,      -- 세례의무금 배정 교회 수
  out_bap_join      int,      -- 세례의무금 참여 교회 수
  out_bap_target    bigint,   -- 목표금액 (원)
  out_bap_paid      bigint    -- 납입금액 (원)
) language sql stable security definer set search_path = public as $fn$
  with el as (
    select public.fy_elapsed(p_year) as n
  ),
  d as (
    select coalesce(nullif(btrim(r.sichal), ''), '기타') as sichal,
           count(*)::int as nch,
           (sum(coalesce(r.monthly_amount, 0)) * 12)::bigint as plan,
           (sum(coalesce(r.monthly_amount, 0)) * (select n from el))::bigint as due,
           coalesce(sum(pp.paid), 0)::bigint as paid,
           coalesce(sum(pp.paid_due), 0)::bigint as paid_due,
           (count(*) filter (where coalesce(pp.months_due, 0) >= (select n from el)))::int as full_cnt
      from public.dues_rates r
      left join lateral (
        select sum(coalesce(p.amount, r.monthly_amount)) as paid,
               sum(coalesce(p.amount, r.monthly_amount))
                 filter (where (p.month + 8) % 12 < (select n from el)) as paid_due,
               count(*) filter (where (p.month + 8) % 12 < (select n from el)) as months_due
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
         coalesce(d.due, 0), coalesce(d.paid_due, 0), coalesce(d.full_cnt, 0),
         coalesce(b.nch, 0), coalesce(b.joined, 0), coalesce(b.target, 0), coalesce(b.paid, 0)
    from d full join b on d.sichal = b.sichal
   where public.is_member();
$fn$;

drop function if exists public.sichal_finance_detail(int, text);
create function public.sichal_finance_detail(p_year int, p_sichal text)
returns table (
  out_church     text,
  out_monthly    int,      -- 월 상회비 (만원)
  out_months     int,      -- 납부한 달 수 (선납 포함)
  out_months_due int,      -- 이번 달까지 부과분 가운데 납부한 달 수
  out_dues_paid  bigint,   -- 상회비 납부액 (만원)
  out_bap_target bigint,   -- 세례의무금 목표 (원)
  out_bap_paid   bigint    -- 세례의무금 납입 (원)
) language sql stable security definer set search_path = public as $fn$
  with el as (
    select public.fy_elapsed(p_year) as n
  ),
  dr as (
    select r.church,
           coalesce(r.monthly_amount, 0)::int as monthly,
           (select count(*) from public.dues_payments p
             where p.year = r.year and p.church = r.church)::int as months,
           (select count(*) from public.dues_payments p
             where p.year = r.year and p.church = r.church
               and (p.month + 8) % 12 < (select n from el))::int as months_due,
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
         coalesce(dr.monthly, 0), coalesce(dr.months, 0), coalesce(dr.months_due, 0), coalesce(dr.paid, 0),
         coalesce(bp.target, 0), coalesce(bp.paid, 0)
    from dr full join bp on public._chkey(dr.church) = public._chkey(bp.church)
   where public.is_member()
   order by 1;
$fn$;

grant execute on function public.fy_elapsed(int) to authenticated;
grant execute on function public.sichal_finance(int) to authenticated;
grant execute on function public.sichal_finance_detail(int, text) to authenticated;

-- 확인:  select * from public.sichal_finance(2026);

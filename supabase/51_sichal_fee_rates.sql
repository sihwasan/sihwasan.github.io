-- =====================================================================
--  51. 시찰회비 금액 설정
--
--  시찰회비 금액은 시찰회가 정할 수 있습니다. 따로 정하지 않은 교회는
--  노회 상회비 한 달치를 기준액으로 씁니다.
--
--    · 보기   : 정회원 전체
--    · 입력·수정 : 노회 관리자, 그 시찰의 시찰장·서기, 시찰 회계
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

create table if not exists public.sichal_fee_rates (
  id          bigserial primary key,
  year        int  not null,
  sichal      text not null,
  church      text not null,
  amount      int  not null default 0,   -- 1회분 시찰회비 (만원)
  updated_by  text,
  updated_at  timestamptz not null default now(),
  unique (year, sichal, church)
);

alter table public.sichal_fee_rates enable row level security;

drop policy if exists sichal_fee_rates_read  on public.sichal_fee_rates;
drop policy if exists sichal_fee_rates_write on public.sichal_fee_rates;
create policy sichal_fee_rates_read on public.sichal_fee_rates for select
  using (public.is_member());
create policy sichal_fee_rates_write on public.sichal_fee_rates for all
  using (public.can_manage() or public.is_sichal_officer(sichal) or public.is_sichal_treasurer(sichal))
  with check (public.can_manage() or public.is_sichal_officer(sichal) or public.is_sichal_treasurer(sichal));

-- 확인:  select year, sichal, church, amount from public.sichal_fee_rates order by year, sichal, church;

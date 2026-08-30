-- =====================================================================
--  50. 시찰회비 납부 현황
--
--  시찰회비는 1년에 두 차례(상반기·하반기) 냅니다.
--  1회분은 노회 상회비 한 달치(dues_rates.monthly_amount)와 같습니다.
--
--    · 보기   : 정회원 전체
--    · 입력·수정 : 노회 관리자, 그 시찰의 시찰장·서기, 시찰 회계
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

create table if not exists public.sichal_fees (
  id          bigserial primary key,
  year        int  not null,
  sichal      text not null,
  church      text not null,
  half        int  not null check (half in (1, 2)),   -- 1=상반기, 2=하반기
  amount      int  not null default 0,               -- 납부액 (만원)
  paid_on     date,
  entered_by  text,
  created_at  timestamptz not null default now(),
  unique (year, sichal, church, half)
);

alter table public.sichal_fees enable row level security;

-- 시찰 회계인가 (시찰 명부의 회계 이름과 내 이름이 같으면)
create or replace function public.is_sichal_treasurer(p_sichal text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.sichals s
    join public.profiles p on p.id = auth.uid()
   where s.name = p_sichal
     and split_part(btrim(coalesce(s.treasurer, '')), ' ', 1) = p.name
  );
$fn$;

drop policy if exists sichal_fees_read  on public.sichal_fees;
drop policy if exists sichal_fees_write on public.sichal_fees;
create policy sichal_fees_read on public.sichal_fees for select
  using (public.is_member());
create policy sichal_fees_write on public.sichal_fees for all
  using (public.can_manage() or public.is_sichal_officer(sichal) or public.is_sichal_treasurer(sichal))
  with check (public.can_manage() or public.is_sichal_officer(sichal) or public.is_sichal_treasurer(sichal));

-- 확인:  select year, sichal, church, half, amount from public.sichal_fees order by year, sichal, church, half;

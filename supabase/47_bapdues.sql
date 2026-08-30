-- =====================================================================
-- 시화산노회 홈페이지 : 세례의무금(세례교인헌금) 관리
--
-- 실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣고 Run
--
-- 총회에 해마다 한 번 내는 세례교인헌금입니다. 총회 공문으로 그 해
-- 교회별 목표액(세례교인수 기준)이 배정되며, 노회는 교회별 납입을
-- 관리합니다. 지난해 배정을 새해에 복사해 두고 공문이 오면 고칩니다.
--
--   · 보기   : 정회원 전체 (대시보드·시찰 화면에서 진행률을 보여 준다)
--   · 고치기 : 노회 관리자와 회계·부회계 (상회비와 같은 권한)
--
--   ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

create table if not exists public.bapdues (
  id          bigserial primary key,
  year        int  not null,             -- 연도
  church      text not null,             -- 교회명
  pastor      text,                      -- 담임교역자
  members     int  not null default 0,   -- 세례교인수
  target      bigint not null default 0, -- 목표금액(원)
  paid        bigint not null default 0, -- 납입금액(원)
  paid_on     date,                      -- 납입일
  memo        text,
  sort        int not null default 0,
  updated_at  timestamptz not null default now(),
  unique (year, church)
);

alter table public.bapdues enable row level security;

drop policy if exists bapdues_read  on public.bapdues;
drop policy if exists bapdues_write on public.bapdues;
create policy bapdues_read on public.bapdues for select
  using (public.is_member());
create policy bapdues_write on public.bapdues for all
  using (public.is_dues_manager()) with check (public.is_dues_manager());

-- 납부 계좌 등 안내 (관리 화면에서 고친다)
insert into public.site_settings (key, value)
values ('bapdues_pay', '{"bank":"","account":"","holder":"시화산노회","per_person":8000}'::jsonb)
on conflict (key) do nothing;

-- 확인:  select year, church, members, target, paid from public.bapdues order by year desc, sort;

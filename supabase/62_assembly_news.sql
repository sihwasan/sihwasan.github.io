-- =====================================================================
--  62. 총회 활동 현황 — 기사 스크랩
--
--  대시보드 <총회 활동 현황>에 관리자가 기사 주소(URL)를 등록하면
--  제목·사진·요약이 자동으로 채워져 갤러리 형태로 보입니다.
--  (제목·사진 수집은 Edge Function og-meta 가 한다)
--
--  활동 사진은 따로 저장하지 않고 메인 갤러리(gallery_items)의
--  '총회 활동' 갈래에 올려 자동으로 연동한다.
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

create table if not exists public.assembly_news (
  id          bigserial primary key,
  url         text not null,
  title       text not null,
  image_url   text,
  description text,
  source      text,                          -- 예: gapck.org, kidok.com
  news_date   date,
  sort        int not null default 0,
  created_by  text,
  created_at  timestamptz not null default now()
);

alter table public.assembly_news enable row level security;

drop policy if exists assembly_news_read  on public.assembly_news;
drop policy if exists assembly_news_write on public.assembly_news;
create policy assembly_news_read on public.assembly_news for select
  using (public.is_member());
create policy assembly_news_write on public.assembly_news for all
  using (public.can_manage()) with check (public.can_manage());

-- 메인 갤러리에 '총회 활동' 갈래를 마련해 둔다
insert into public.gallery_categories (name, sort)
select '총회 활동', coalesce((select max(sort) from public.gallery_categories), 0) + 10
 where not exists (select 1 from public.gallery_categories where name = '총회 활동');

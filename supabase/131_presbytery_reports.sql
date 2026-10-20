-- =====================================================================
--  131. 노회 보고서(정기노회 회의자료 책자) — 쪽 단위 글로 보관해 찾아보기 (2026-10-21)
--
--  총회 보고서처럼 노회도 회의자료(촬요) PDF 를 올려 두고 찾아볼 수 있게 한다.
--  PDF 는 글자 정보가 없는 그림이라(CorelDRAW 출력), 관리자가 홈페이지에서 올리면
--  브라우저가 쪽마다 그림으로 바꿔 AI 창구(/ocr)에 보내 글로 받아 적고 여기에 담는다.
--
--   · presbytery_reports       책자 한 권 (회기·종류·날짜·PDF 파일·차례)
--   · presbytery_report_pages  책자의 인쇄 쪽 하나 (PDF 쪽 번호, 인쇄 쪽 번호, 제목, 글)
--   · 파일은 storage 'archive-files' 의 reports/ 아래 (정회원 열람, 관리자 올리기 — 17 sql 정책 그대로)
--
--  열람: 정회원 이상 (is_member)  /  올리기·고치기: 관리자 (can_manage)
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
-- =====================================================================

create table if not exists public.presbytery_reports (
  id          bigserial primary key,
  session     integer,                       -- 회기 (20)
  kind        text not null default '정기노회',   -- 정기노회 / 임시노회 / 임원회 …
  title       text not null,                 -- 제20회 정기노회 회의자료 (2026 가을)
  meet_on     date,                          -- 회의 날짜
  pdf_pages   integer,                       -- PDF 쪽 수
  file_path   text,                          -- archive-files 안의 경로 (reports/r20-….pdf)
  file_name   text,                          -- 원래 파일 이름
  toc         jsonb not null default '[]'::jsonb,   -- 차례 [{title, page}]
  status      text not null default '읽는 중',      -- 읽는 중 / 완료
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.presbytery_report_pages (
  id          bigserial primary key,
  report_id   bigint not null references public.presbytery_reports(id) on delete cascade,
  pdf_page    integer not null,              -- PDF 의 몇 번째 쪽(펼침면)
  page_no     integer,                       -- 인쇄된 쪽 번호 (없으면 null)
  heading     text,                          -- 그 면의 제목
  text        text not null default '',
  created_at  timestamptz not null default now()
);
create unique index if not exists presbytery_report_pages_uq
  on public.presbytery_report_pages (report_id, pdf_page, coalesce(page_no, -1));
create index if not exists presbytery_report_pages_rep_idx on public.presbytery_report_pages (report_id, page_no);

-- 한글 부분 일치 검색을 빠르게
create extension if not exists pg_trgm;
create index if not exists presbytery_report_pages_text_trgm on public.presbytery_report_pages using gin (text gin_trgm_ops);

alter table public.presbytery_reports       enable row level security;
alter table public.presbytery_report_pages  enable row level security;

drop policy if exists presbytery_reports_read  on public.presbytery_reports;
drop policy if exists presbytery_reports_write on public.presbytery_reports;
create policy presbytery_reports_read  on public.presbytery_reports for select using (public.is_member());
create policy presbytery_reports_write on public.presbytery_reports for all
  using (public.can_manage()) with check (public.can_manage());

drop policy if exists presbytery_report_pages_read  on public.presbytery_report_pages;
drop policy if exists presbytery_report_pages_write on public.presbytery_report_pages;
create policy presbytery_report_pages_read  on public.presbytery_report_pages for select using (public.is_member());
create policy presbytery_report_pages_write on public.presbytery_report_pages for all
  using (public.can_manage()) with check (public.can_manage());

-- 확인:  select id, session, title, status, pdf_pages, (select count(*) from public.presbytery_report_pages p where p.report_id = r.id) as 읽은_면 from public.presbytery_reports r order by id desc;

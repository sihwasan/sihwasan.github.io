-- =====================================================================
--  17. 자료실 정비
--
--  자료실을 분류(회의록·회의자료·결의사항·규칙·내규·서식)로 나누고,
--  노회 회의결의를 회기별로 정회원이 열람할 수 있게 합니다.
--  자료 등록·수정·삭제는 관리자(노회장·서기·간사)가 합니다.
--
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 자료 목록
--    section : 회의록 / 회의자료 / 결의사항 / 규칙 / 내규 / 서식
--    access  : public(누구나) / member(정회원) / officer(임원)
-- ---------------------------------------------------------------------
create table if not exists public.archive_items (
  id          bigserial primary key,
  section     text not null default '회의자료',
  title       text not null,
  description text,
  doc_date    date,
  access      text not null default 'member',
  link_url    text,
  file_path   text,
  file_name   text,
  sort        numeric not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists archive_items_sec_idx on public.archive_items (section, sort desc, id desc);

alter table public.archive_items enable row level security;

-- 목록 자체는 누구나 볼 수 있게 하고, 실제 파일 내려받기에서 등급을 가린다.
-- (제목만 보이고 열람 권한이 없으면 안내가 뜨는 방식)
drop policy if exists archive_items_read  on public.archive_items;
drop policy if exists archive_items_write on public.archive_items;
create policy archive_items_read  on public.archive_items for select using (true);
create policy archive_items_write on public.archive_items for all
  using (public.can_manage()) with check (public.can_manage());


-- ---------------------------------------------------------------------
-- 2. 노회 회의결의 (회기별)
--    정회원만 열람할 수 있습니다.
-- ---------------------------------------------------------------------
create table if not exists public.resolutions (
  id         bigserial primary key,
  seq        integer,               -- 회기 번호 (19, 18 …)
  kind       text not null default '정기노회',   -- 정기노회 / 임원회 / 임시노회
  session    text not null,         -- 제19회 정기노회(봄)
  year       integer,
  president  text,                  -- 그때의 노회장
  place      text,                  -- 회집 장소
  held_on    date,
  items      text not null default '',   -- 결의 내용. 한 줄에 한 항목
  sort       numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);
create index if not exists resolutions_sort_idx on public.resolutions (sort desc, id desc);

alter table public.resolutions enable row level security;

drop policy if exists resolutions_read  on public.resolutions;
drop policy if exists resolutions_write on public.resolutions;
create policy resolutions_read  on public.resolutions for select using (public.is_member());
create policy resolutions_write on public.resolutions for all
  using (public.can_manage()) with check (public.can_manage());


-- ---------------------------------------------------------------------
-- 3. 자료 파일 보관함 (비공개)
--    정회원만 내려받을 수 있고, 올리고 지우는 것은 관리자가 합니다.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('archive-files', 'archive-files', false)
on conflict (id) do nothing;

drop policy if exists archive_files_read   on storage.objects;
drop policy if exists archive_files_write  on storage.objects;
drop policy if exists archive_files_delete on storage.objects;

create policy archive_files_read on storage.objects for select
  using (bucket_id = 'archive-files' and public.is_member());
create policy archive_files_write on storage.objects for insert
  with check (bucket_id = 'archive-files' and public.can_manage());
create policy archive_files_delete on storage.objects for delete
  using (bucket_id = 'archive-files' and public.can_manage());


-- ---------------------------------------------------------------------
-- 4. 지금 자료실에 실려 있는 목록을 옮겨 담는다 (처음 한 번)
-- ---------------------------------------------------------------------
insert into public.archive_items (section, title, description, doc_date, access, link_url, sort)
select * from (values
  ('회의록',   '노회 회의록 (제19회기 봄 정기노회 외)', '역대 정기노회 회의록입니다. 노회 임원만 열람할 수 있습니다.', date '2026-04-13', 'officer', 'minutes.html', 100::numeric),
  ('회의자료', '제19회 정기노회(봄) 회의자료', '제19회 정기노회 회의순서, 회원명단, 각 부 보고서, 노회규칙 전문이 수록된 회의자료입니다.', date '2026-04-13', 'member', null, 90::numeric),
  ('결의사항', '제19회기 임원회 결의사항 모음', '제19회기 제1차부터 제7차까지 임원회의 주요 결의사항입니다.', date '2026-04-13', 'member', 'archive.html#sec-결의사항', 80::numeric),
  ('결의사항', '제19회 정기노회 헌의안건', '감사헌의부가 본회에 상정한 제19회 정기노회 헌의안건 목록입니다.', date '2026-04-13', 'member', 'archive.html#sec-결의사항', 70::numeric),
  ('규칙',     '노회규칙 (2025. 10. 13. 개정)', '시화산노회 규칙 전문(제12장 제41조)입니다.', date '2025-10-13', 'public', 'rules-presbytery.html', 60::numeric),
  ('내규',     '미래교회자립위원회 내규', '미자립교회 지원과 관련한 제반 정책 및 시행 사항을 정한 내규입니다.', date '2025-10-13', 'public', 'rules-presbytery.html#rule-jarip', 50::numeric),
  ('내규',     '선거관리위원회 내규', '노회 임원과 총대 선출에 관한 선거 규약입니다.', date '2025-04-21', 'public', 'rules-presbytery.html#rule-sunguh', 40::numeric),
  ('내규',     '사회복지부 내규 (장례에 관한 내규)', '회원 예우와 장례에 관한 사회복지부 내규입니다.', date '2023-10-10', 'public', 'rules-presbytery.html#rule-bokji', 30::numeric),
  ('서식',     '구비서류 및 사무규정', '청빙·고시·추천·이명 등 각종 청원 시 구비서류 안내입니다.', date '2026-04-13', 'public', 'archive.html#sec-구비서류-안내', 20::numeric),
  ('서식',     '각종 청원 서식 모음', '청빙청원서, 고시청원서, 이명 청원서 등 노회 행정 서식 모음입니다.', date '2026-04-13', 'member', null, 10::numeric)
) as v(section, title, description, doc_date, access, link_url, sort)
where not exists (select 1 from public.archive_items);

select (select count(*) from public.archive_items) as "자료",
       (select count(*) from public.resolutions)   as "결의";

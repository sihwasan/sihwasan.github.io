-- 132. 노회 주소록 (presbytery_directory)
--  회의자료 책자 끝의 주소록(원로목사·각 시찰 교회·각 연합회 임원)을 표로 두고,
--  새 책자가 올라오면 directory.html 의 「책자와 대조」로 달라진 것만 고친다.
--  열람: 정회원 이상 (is_member)  /  고치기: 관리자 (can_manage)
--  실행: Supabase SQL Editor 에 붙여 넣고 실행. (여러 번 실행해도 안전)

create table if not exists public.presbytery_directory (
  id          bigserial primary key,
  section     text not null,              -- 원로목사 / 북부시찰 / 상록시찰 / 남부시찰 / 장로회 연합회 / 남전도회 연합회 / 여전도회 연합회 / 주일학교 연합회 …
  kind        text not null default 'church' check (kind in ('church', 'person')),
  no          int,                        -- 책자의 NO
  name        text not null,              -- 교회명(church) / 성명(person)
  role        text,                       -- 직책 (person)
  church      text,                       -- 교회명 (person)
  postcode    text,
  address     text,
  address2    text,                       -- 지번·건물 (괄호 안)
  website     text,
  email       text,
  pastor      text,                       -- 교역자 ("⊙임동준 / (부) 김하진")
  elders      text,                       -- 시무장로 ("류춘수·김성훈")
  phone       text,                       -- "(교) 417-0264 / (휴) 010-3872-9919"
  sort        int not null default 0,
  source_report_id bigint references public.presbytery_reports(id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists presbytery_directory_sec_idx on public.presbytery_directory (section, sort, no, id);

alter table public.presbytery_directory enable row level security;
drop policy if exists presbytery_directory_read  on public.presbytery_directory;
drop policy if exists presbytery_directory_write on public.presbytery_directory;
create policy presbytery_directory_read  on public.presbytery_directory for select using (public.is_member());
create policy presbytery_directory_write on public.presbytery_directory for all
  using (public.can_manage()) with check (public.can_manage());

-- 처음 한 번: 제20회 정기노회 회의자료(2026 가을) 주소록 102~112쪽
-- (이미 항목이 있으면 넣지 않는다)
-- @@ROWS@@

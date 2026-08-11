-- =====================================================================
--  16. 조직 명단·시찰 관리
--
--  지금까지 조직 페이지에 보이는 목사·장로 명단과 시찰 구성은
--  홈페이지 파일에 박혀 있어 관리자가 고칠 수 없었습니다.
--  이 자료를 서버로 옮겨, 회원 관리 화면에서 고치면
--  조직 페이지에 바로 반영되도록 합니다.
--
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 명단에 조직 페이지에서 쓰는 항목을 더한다
--    category : 목사 / 원로목사 / 은퇴목사 / 부목사 / 무임목사 / 장로
--    sichal   : 소속 시찰
--    note     : 원로목사 추대일 등 덧붙일 말
-- ---------------------------------------------------------------------
alter table public.roster add column if not exists category text;
alter table public.roster add column if not exists sichal   text;
alter table public.roster add column if not exists note     text;
alter table public.roster add column if not exists sort     numeric not null default 0;

create index if not exists roster_category_idx on public.roster (category, sort);


-- ---------------------------------------------------------------------
-- 2. 시찰회
--    churches : 소속 교회를 한 줄에 하나씩 적는다
-- ---------------------------------------------------------------------
create table if not exists public.sichals (
  id         bigserial primary key,
  name       text not null,
  area       text,
  head       text,
  clerk      text,
  treasurer  text,
  churches   text,
  sort       numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);
create unique index if not exists sichals_name_idx on public.sichals (name);

alter table public.sichals enable row level security;

-- 시찰 구성은 회원가입 화면의 교회 목록으로도 쓰이므로 누구나 읽을 수 있다
drop policy if exists sichals_read  on public.sichals;
drop policy if exists sichals_write on public.sichals;
create policy sichals_read  on public.sichals for select using (true);
create policy sichals_write on public.sichals for all
  using (public.can_manage()) with check (public.can_manage());


-- ---------------------------------------------------------------------
-- 3. 명단 열람 범위는 바꾸지 않는다
--    실명 명단은 예전대로 정회원만 볼 수 있다. (개인정보처리방침 제4조)
--    조직 페이지의 회원명단도 정회원에게만 보이므로 그대로 두면 된다.
-- ---------------------------------------------------------------------


-- =====================================================================
--  여기서부터 '씨앗 자료' — 지금 홈페이지에 실려 있는 명단입니다.
--  이미 있는 사람은 덮어쓰지 않고 분류만 채웁니다.
-- =====================================================================
insert into public.roster (name, church, position, category, sichal, note, sort) values ('박현정', '율리교회', '목사', '목사', '남부시찰', null, 10) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('강명우', '반석교회', '목사', '목사', '남부시찰', null, 20) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('임동준', '새힘교회', '목사', '목사', '북부시찰', null, 30) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('서용호', '수암제일교회', '목사', '목사', '상록시찰', null, 40) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('문광선', '새누리교회', '목사', '목사', '북부시찰', null, 50) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('박재완', '수암새권능교회', '목사', '목사', '북부시찰', null, 60) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('박양수', '힘찬교회', '목사', '목사', '상록시찰', null, 70) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('송기태', '새날선교교회', '목사', '목사', '북부시찰', null, 80) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('박흥열', '시흥생수교회', '목사', '목사', '북부시찰', null, 90) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('주강완', '서신영광교회', '목사', '목사', '상록시찰', null, 100) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('이재용', '안산상록교회', '목사', '목사', '북부시찰', null, 110) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김선민', '나눔의교회', '목사', '목사', '남부시찰', null, 120) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('전종호', '동탄인랜드교회', '목사', '목사', '남부시찰', null, 130) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김성중', '한숲우리교회', '목사', '목사', '남부시찰', null, 140) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('권병렬', '섬김의교회', '목사', '목사', '북부시찰', null, 150) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('안상천', '참된빛교회', '목사', '목사', '북부시찰', null, 160) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('이성대', '새생명교회', '목사', '목사', '북부시찰', null, 170) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('명영석', '행복한교회', '목사', '목사', '남부시찰', null, 180) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김지수', '반월교회', '목사', '목사', '상록시찰', null, 190) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('백용선', '노진교회', '목사', '목사', '남부시찰', null, 200) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김종수', '섬기는교회', '목사', '목사', '북부시찰', null, 210) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('이동진', '동탄영광교회', '목사', '목사', '남부시찰', null, 220) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('유성준', '주품에교회', '목사', '목사', '남부시찰', null, 230) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김영돈', '안산원곡동교회', '목사', '목사', '북부시찰', null, 240) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김운갑', '시흥은혜교회', '목사', '목사', '북부시찰', null, 250) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('장정훈', '아름다운숲교회', '목사', '목사', '남부시찰', null, 260) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('한동준', '은광교회', '목사', '목사', '상록시찰', null, 270) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김동석', '운평장로교회', '목사', '목사', '남부시찰', null, 280) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('손영득', '새솔제일교회', '목사', '목사', '상록시찰', null, 290) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('송요한', '안산샬롬교회', '목사', '목사', '북부시찰', null, 300) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김성신', '연수교회', '목사', '목사', '남부시찰', null, 310) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('정주원', '주말씀교회', '목사', '목사', '상록시찰', null, 320) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('제갈광철', '예전교회', '목사', '목사', '북부시찰', null, 330) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('문태환', '성산교회', '목사', '목사', '남부시찰', null, 340) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('이세용', '반월교회', '목사', '원로목사', '상록시찰', '추대 2017. 10. 30', 350) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('신동열', '노진교회', '목사', '원로목사', '남부시찰', '추대 2020. 12. 12', 360) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김충현', '운평장로교회', '목사', '원로목사', '남부시찰', '추대 2023. 06. 17', 370) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김삼성', '새솔제일교회', '목사', '원로목사', '상록시찰', '추대 2023. 10. 28', 380) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김해수', '목자교회', '목사', '은퇴목사', '북부시찰', null, 390) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('박규태', '반월교회', '부목사', '부목사', '상록시찰', null, 400) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('조능', '반월교회', '부목사', '부목사', '상록시찰', null, 410) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김하진', '섬기는교회', '부목사', '부목사', '북부시찰', null, 420) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('박상우', '시흥생수교회', '부목사', '부목사', '북부시찰', null, 430) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('오윤석', '안산상록교회', '부목사', '부목사', '북부시찰', null, 440) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('박희원', '반월교회', '부목사', '부목사', '상록시찰', null, 450) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('유충근', '무임', '목사', '무임목사', null, null, 460) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('박지만', '무임', '목사', '무임목사', null, null, 470) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('이병준', '무임', '목사', '무임목사', null, null, 480) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('이현철', '무임', '목사', '무임목사', null, null, 490) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('서기영', '무임', '목사', '무임목사', null, null, 500) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('정해정', '무임', '목사', '무임목사', null, null, 510) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김익환', '무임', '목사', '무임목사', null, null, 520) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('안상환', '무임', '목사', '무임목사', null, null, 530) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김영창', '무임', '목사', '무임목사', null, null, 540) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('안창선', '무임', '목사', '무임목사', null, null, 550) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('주재경', '무임', '목사', '무임목사', null, null, 560) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('박영수', '안산샬롬교회', '장로', '장로', '북부시찰', null, 570) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('유승열', '시흥생수교회', '장로', '장로', '북부시찰', null, 580) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('장경환', '새날선교교회', '장로', '장로', '북부시찰', null, 590) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('이재복', '안산상록교회', '장로', '장로', '북부시찰', null, 600) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김성훈', '목자교회', '장로', '장로', '북부시찰', null, 610) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('박아론', '수암새권능교회', '장로', '장로', '북부시찰', null, 620) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('윤성복', '섬기는교회', '장로', '장로', '북부시찰', null, 630) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('고동욱', '섬기는교회', '장로', '장로', '북부시찰', null, 640) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김완수', '섬김의교회', '장로', '장로', '북부시찰', null, 650) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김성조', '새힘교회', '장로', '장로', '북부시찰', null, 660) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('장명국', '안산원곡동교회', '장로', '장로', '북부시찰', null, 670) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김창룡', '반월교회', '장로', '장로', '상록시찰', null, 680) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('정재영', '반월교회', '장로', '장로', '상록시찰', null, 690) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김상진', '반월교회', '장로', '장로', '상록시찰', null, 700) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김영우', '새솔제일교회', '장로', '장로', '상록시찰', null, 710) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('윤위석', '은광교회', '장로', '장로', '상록시찰', null, 720) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김득철', '은광교회', '장로', '장로', '상록시찰', null, 730) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김종서', '힘찬교회', '장로', '장로', '상록시찰', null, 740) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('이신영', '수암제일교회', '장로', '장로', '상록시찰', null, 750) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('송언빈', '서안문호교회', '장로', '장로', '상록시찰', null, 760) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('문명수', '노진교회', '장로', '장로', '남부시찰', null, 770) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('안태성', '반석교회', '장로', '장로', '남부시찰', null, 780) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('백윤복', '성산교회', '장로', '장로', '남부시찰', null, 790) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('김종관', '연수교회', '장로', '장로', '남부시찰', null, 800) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('신용화', '운평장로교회', '장로', '장로', '남부시찰', null, 810) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;
insert into public.roster (name, church, position, category, sichal, note, sort) values ('허경하', '한숲우리교회', '장로', '장로', '남부시찰', null, 820) on conflict (name, church) do update set category = excluded.category, sichal = excluded.sichal, note = excluded.note, sort = excluded.sort;

insert into public.sichals (name, area, head, clerk, treasurer, churches, sort) values ('북부시찰', '안산시 단원구와 시흥시 일부 지역', '김종수 목사(섬기는교회)', '김영돈 목사', '김운갑 목사', '목자교회
새날선교교회
새누리교회
새생명교회
새힘교회
섬기는교회
섬김의교회
수암새권능교회
시흥생수교회
시흥은혜교회
안산샬롬교회
안산상록교회
안산원곡동교회
참된빛교회
예전교회', 10) on conflict (name) do update set area=excluded.area, head=excluded.head, clerk=excluded.clerk, treasurer=excluded.treasurer, churches=excluded.churches, sort=excluded.sort;
insert into public.sichals (name, area, head, clerk, treasurer, churches, sort) values ('상록시찰', '안산시 상록구와 수원시 일부 지역', '한동준 목사(은광교회)', '정주원 목사', '김득철 장로', '반월교회
새솔제일교회
서신영광교회
수암제일교회
은광교회
힘찬교회
서안문호교회
주말씀교회', 20) on conflict (name) do update set area=excluded.area, head=excluded.head, clerk=excluded.clerk, treasurer=excluded.treasurer, churches=excluded.churches, sort=excluded.sort;
insert into public.sichals (name, area, head, clerk, treasurer, churches, sort) values ('남부시찰', '화성시 지역과 오산시 일부, 용인시 일부 지역', '김성중 목사(한숲우리교회)', '이동진 목사', '장정훈 목사', '나눔의교회
노진교회
동탄영광교회
동탄인랜드교회
반석교회
성산교회
아름다운숲교회
연수교회
운평장로교회
율리교회
주품에교회
한숲우리교회
행복한교회
경기은목교회
꿈꾸는작은교회', 30) on conflict (name) do update set area=excluded.area, head=excluded.head, clerk=excluded.clerk, treasurer=excluded.treasurer, churches=excluded.churches, sort=excluded.sort;
select (select count(*) from public.roster)  as "명단",
       (select count(*) from public.sichals) as "시찰";

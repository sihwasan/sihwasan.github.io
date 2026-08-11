-- =====================================================================
-- 시화산노회 홈페이지 : 사이트 콘텐츠 관리 (간사용 웹 편집)
--
-- 실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣고 Run
-- 편집 권한: 노회장·서기·간사·최고관리자 (서버가 강제)
-- =====================================================================

-- 사이트 설정 (히어로 문구, 임원 명부, 정기노회 결과 등)
create table if not exists public.site_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- 공지사항
create table if not exists public.site_notices (
  id         bigserial primary key,
  cat        text not null default '공지',
  title      text not null,
  body       text,
  date       date not null default current_date,
  created_at timestamptz not null default now()
);

-- 노회 일정
create table if not exists public.site_schedule (
  id         bigserial primary key,
  date_label text not null,
  title      text not null,
  sort       int  not null default 0
);

-- 갤러리
create table if not exists public.gallery_items (
  id         bigserial primary key,
  title      text not null,
  taken      text,
  image_url  text not null,
  thumb_url  text not null,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

alter table public.site_settings  enable row level security;
alter table public.site_notices   enable row level security;
alter table public.site_schedule  enable row level security;
alter table public.gallery_items  enable row level security;

-- 공개 콘텐츠: 누구나 열람, 관리자만 수정
do $$
declare t text;
begin
  foreach t in array array['site_settings','site_notices','site_schedule','gallery_items'] loop
    execute format('drop policy if exists %I_read  on public.%I', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_read  on public.%I for select using (true)', t, t);
    execute format('create policy %I_write on public.%I for all using (public.can_manage()) with check (public.can_manage())', t, t);
  end loop;
end
$$;

-- 갤러리 사진 저장소
insert into storage.buckets (id, name, public) values ('gallery', 'gallery', true)
on conflict (id) do nothing;

drop policy if exists gallery_storage_read   on storage.objects;
drop policy if exists gallery_storage_insert on storage.objects;
drop policy if exists gallery_storage_delete on storage.objects;
create policy gallery_storage_read   on storage.objects for select using (bucket_id = 'gallery');
create policy gallery_storage_insert on storage.objects for insert with check (bucket_id = 'gallery' and public.can_manage());
create policy gallery_storage_delete on storage.objects for delete using (bucket_id = 'gallery' and public.can_manage());

-- ---------------------------------------------------------------------
-- 초기 내용 등록 (이미 있으면 갱신하지 않음 — 관리 화면 수정 내용 보호)
-- ---------------------------------------------------------------------
insert into public.site_settings (key, value) values
  ('hero', '{"kicker":"대한예수교장로회(합동)","line1":"시화산노회가 하나 됨을 이루고","line2":"함께 지어져 가는 교회를 세웁니다","desc":"화성, 안산, 시흥, 수원, 용인, 오산 지역의 교회들이 그리스도 안에서 한 몸을 이루어 복음 전파와 교회 섬김의 사명을 감당하고 있습니다.","verse":"\"그의 안에서 건물마다 서로 연결하여 주 안에서 성전이 되어 가고\" (엡 2:21)"}'::jsonb),
  ('meeting_result', '{"title":"제19회 정기노회 결과","lines":["일시: 2026년 4월 13일(월)","장소: 섬기는교회 (화성특례시 수노을2로 15)","신임 노회장: 박흥열 목사 (시흥생수교회)","서기: 권병렬 목사 / 회계: 김득철 장로"]}'::jsonb),
  ('officers', '[{"role":"노회장","name":"박흥열","position":"목사","church":"시흥생수교회"},{"role":"부노회장","name":"이재용","position":"목사","church":"안산상록교회"},{"role":"부노회장","name":"이신영","position":"장로","church":"수암제일교회"},{"role":"서기","name":"권병렬","position":"목사","church":"섬김의교회"},{"role":"부서기","name":"김동석","position":"목사","church":"운평장로교회"},{"role":"회록서기","name":"김지수","position":"목사","church":"반월교회"},{"role":"부회록서기","name":"손영득","position":"목사","church":"새솔제일교회"},{"role":"회계","name":"김득철","position":"장로","church":"은광교회"},{"role":"부회계","name":"고동욱","position":"장로","church":"섬기는교회"}]'::jsonb),
  ('delegates', '{"pastorMain":["박흥열 (노회장)","김종수","서용호"],"pastorSub":["박재완","김성중","박양수"],"elderMain":["이신영 (부노회장)","윤성복","정재영"],"elderSub":["김창룡","백윤복","이재복"]}'::jsonb)
on conflict (key) do nothing;

insert into public.site_notices (cat, title, body, date)
select cat, title, body, date::date from (values
  ('소식', '제19회 정기노회 폐회 및 신임 임원 선출 (노회장 박흥열 목사)', '제19회 정기노회가 2026년 4월 13일(월) 섬기는교회에서 회집되어 은혜 가운데 폐회하였습니다. 신임 임원으로 노회장 박흥열 목사, 부노회장 이재용 목사·이신영 장로, 서기 권병렬 목사, 부서기 김동석 목사, 회록서기 김지수 목사, 부회록서기 손영득 목사, 회계 김득철 장로, 부회계 고동욱 장로가 선출되었습니다. 회의록은 임원방에서 열람할 수 있습니다.', '2026-04-13'),
  ('공지', '제19회 정기노회 소집 안내 (2026. 4. 13. 섬기는교회)', '제19회 정기노회를 2026년 4월 13일(월) 오전 10시 섬기는교회(화성특례시 수노을2로 15)에서 소집합니다. 각종 청원서는 서식대로 당회장이 각 시찰회의 진단을 거쳐 제출해 주시기 바라며, 각 시찰 서기는 청원서를 3월 25일(수)까지 노회 서기에게 접수해 주시기 바랍니다.', '2026-03-16'),
  ('공지', '상회비 및 세례교인헌금 납부 안내', '각 지교회 상회비와 세례교인헌금은 3월 25일(수)까지 납부해 주시기 바랍니다. 노회규칙 제9장 제29조에 따라 미납교회는 서류 접수 및 발급이 보류됩니다. 상회비 입금계좌: 농협 351-1015-8676-63 (시화산노회)', '2026-03-16'),
  ('안내', '상비부 사전모임 일정 안내', '고시규칙부 3월 30일(월) 오전 9:30, 감사헌의부 3월 30일(월) 오후 1시~4시, 정치부 3월 30일(월) 오후 3시, 공천부 3월 30일(월) 오전 11시, 재정부 4월 6일(월) 오전 11시. 장소는 모두 노회사무실입니다.', '2026-03-16'),
  ('안내', '2026년 교세통계보고서 제출 안내', '총회 홈페이지를 통해 2026년 교세통계보고서를 각 지교회별로 보고해 주시기 바랍니다.', '2026-03-16'),
  ('소식', '장로고시 합격자 발표', '2025년 12월 12일(금) 노회사무실에서 실시한 장로고시에 2명이 응시하여 다음과 같이 합격하였습니다. 합격자: 안태성(반석교회), 김명관(반석교회)', '2025-12-12'),
  ('소식', '안산샬롬교회 송요한 목사 위임식 안내', '안산샬롬교회 송요한 목사 위임식이 2026년 4월 25일(토) 오전 11시에 거행됩니다. 노회원 여러분의 축하와 기도를 부탁드립니다.', '2026-03-20')
) as v(cat, title, body, date)
where not exists (select 1 from public.site_notices);

insert into public.site_schedule (date_label, title, sort)
select date_label, title, sort::int from (values
  ('3.25', '청원서 접수 마감 · 상회비 납부 기한', 1),
  ('3.30', '상비부 사전모임 (노회사무실)', 2),
  ('4.6', '재정부 모임 (노회사무실)', 3),
  ('4.13', '제19회 정기노회 (섬기는교회)', 4),
  ('4.25', '안산샬롬교회 송요한 목사 위임식', 5)
) as v(date_label, title, sort)
where not exists (select 1 from public.site_schedule);

insert into public.gallery_items (title, taken, image_url, thumb_url, sort)
select title, taken, image_url, thumb_url, sort::int from (values
  ('노회원 수련회', '2024년 6월', 'images/gallery/photo01.jpg', 'images/gallery/thumb01.jpg', 1),
  ('노회원 수련회', '2024년 6월', 'images/gallery/photo02.jpg', 'images/gallery/thumb02.jpg', 2),
  ('노회원 수련회', '2024년 6월', 'images/gallery/photo03.jpg', 'images/gallery/thumb03.jpg', 3),
  ('노회원 수련회', '2024년 6월', 'images/gallery/photo04.jpg', 'images/gallery/thumb04.jpg', 4),
  ('노회원 수련회', '2024년 6월', 'images/gallery/photo05.jpg', 'images/gallery/thumb05.jpg', 5),
  ('노회원 수련회', '2024년 6월', 'images/gallery/photo06.jpg', 'images/gallery/thumb06.jpg', 6),
  ('노회원 수련회', '2024년 6월', 'images/gallery/photo07.jpg', 'images/gallery/thumb07.jpg', 7),
  ('노회원 수련회', '2024년 6월', 'images/gallery/photo08.jpg', 'images/gallery/thumb08.jpg', 8),
  ('노회원 수련회', '2024년 6월', 'images/gallery/photo09.jpg', 'images/gallery/thumb09.jpg', 9),
  ('노회원 수련회', '2024년 6월', 'images/gallery/photo10.jpg', 'images/gallery/thumb10.jpg', 10),
  ('노회원 수련회', '2024년 6월', 'images/gallery/photo11.jpg', 'images/gallery/thumb11.jpg', 11),
  ('노회원 수련회', '2024년 6월', 'images/gallery/photo12.jpg', 'images/gallery/thumb12.jpg', 12)
) as v(title, taken, image_url, thumb_url, sort)
where not exists (select 1 from public.gallery_items);

-- 확인:  select key from public.site_settings;

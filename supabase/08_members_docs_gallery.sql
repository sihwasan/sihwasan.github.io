-- =====================================================================
-- 시화산노회 홈페이지 : 회원 정보 확장 · 서류 신청 · 갤러리 개편
--
-- 실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣고 Run
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 회원 정보 확장 (생년월일·주소·자격 관리)
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists birth_date   date;
alter table public.profiles add column if not exists address      text;
alter table public.profiles add column if not exists suspended    boolean not null default false;
alter table public.profiles add column if not exists member_until date;   -- 총대 자격 만료일

-- ---------------------------------------------------------------------
-- 2. 서류 신청
-- ---------------------------------------------------------------------
create table if not exists public.doc_requests (
  id          bigserial primary key,
  user_id     uuid references auth.users on delete set null,
  email       text,
  name        text not null,
  position    text,
  church      text,
  doc_type    text not null,
  purpose     text,
  copies      int not null default 1,
  memo        text,
  status      text not null default '신청' check (status in ('신청','발급완료','반려')),
  handled_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.doc_requests enable row level security;

drop policy if exists doc_requests_insert on public.doc_requests;
drop policy if exists doc_requests_self   on public.doc_requests;
drop policy if exists doc_requests_admin  on public.doc_requests;

-- 정회원은 본인 신청을 등록하고 본인 것만 조회
create policy doc_requests_insert on public.doc_requests for insert
  with check (auth.uid() = user_id and public.is_member());
create policy doc_requests_self on public.doc_requests for select
  using (auth.uid() = user_id);
-- 관리자는 전체 조회·처리
create policy doc_requests_admin on public.doc_requests for all
  using (public.can_manage()) with check (public.can_manage());

-- ---------------------------------------------------------------------
-- 3. 갤러리 개편 (소식 피드)
-- ---------------------------------------------------------------------
alter table public.gallery_items add column if not exists category    text;
alter table public.gallery_items add column if not exists caption     text;
alter table public.gallery_items add column if not exists link_url    text;
alter table public.gallery_items add column if not exists author_id   uuid references auth.users on delete set null;
alter table public.gallery_items add column if not exists author_name text;

-- 갤러리 카테고리
create table if not exists public.gallery_categories (
  id    bigserial primary key,
  name  text not null unique,
  sort  int not null default 0
);

-- 좋아요
create table if not exists public.gallery_likes (
  item_id  bigint not null references public.gallery_items on delete cascade,
  user_id  uuid   not null references auth.users on delete cascade,
  primary key (item_id, user_id)
);

-- 댓글
create table if not exists public.gallery_comments (
  id          bigserial primary key,
  item_id     bigint not null references public.gallery_items on delete cascade,
  user_id     uuid references auth.users on delete set null,
  author_name text,
  body        text not null,
  created_at  timestamptz not null default now()
);

alter table public.gallery_categories enable row level security;
alter table public.gallery_likes      enable row level security;
alter table public.gallery_comments   enable row level security;

drop policy if exists gallery_categories_read  on public.gallery_categories;
drop policy if exists gallery_categories_write on public.gallery_categories;
create policy gallery_categories_read  on public.gallery_categories for select using (true);
create policy gallery_categories_write on public.gallery_categories for all
  using (public.can_manage()) with check (public.can_manage());

drop policy if exists gallery_likes_read on public.gallery_likes;
drop policy if exists gallery_likes_self on public.gallery_likes;
create policy gallery_likes_read on public.gallery_likes for select using (true);
create policy gallery_likes_self on public.gallery_likes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id and public.is_member());

drop policy if exists gallery_comments_read  on public.gallery_comments;
drop policy if exists gallery_comments_write on public.gallery_comments;
drop policy if exists gallery_comments_admin on public.gallery_comments;
create policy gallery_comments_read  on public.gallery_comments for select using (true);
create policy gallery_comments_write on public.gallery_comments for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id and public.is_member());
create policy gallery_comments_admin on public.gallery_comments for delete
  using (public.can_manage());

-- 갤러리 사진 등록·수정·삭제 권한을 정회원까지 확대 (본인 글 기준)
drop policy if exists gallery_items_write  on public.gallery_items;
drop policy if exists gallery_items_read   on public.gallery_items;
drop policy if exists gallery_items_insert on public.gallery_items;
drop policy if exists gallery_items_own    on public.gallery_items;
drop policy if exists gallery_items_admin  on public.gallery_items;
create policy gallery_items_read   on public.gallery_items for select using (true);
create policy gallery_items_insert on public.gallery_items for insert
  with check (public.is_member() and auth.uid() = author_id);
create policy gallery_items_own    on public.gallery_items for update
  using (auth.uid() = author_id) with check (auth.uid() = author_id);
create policy gallery_items_owndel on public.gallery_items for delete
  using (auth.uid() = author_id);
create policy gallery_items_admin  on public.gallery_items for all
  using (public.can_manage()) with check (public.can_manage());

-- 사진 저장소: 정회원이 올릴 수 있도록 조정
drop policy if exists gallery_storage_insert on storage.objects;
drop policy if exists gallery_storage_delete on storage.objects;
create policy gallery_storage_insert on storage.objects for insert
  with check (bucket_id = 'gallery' and public.is_member());
create policy gallery_storage_delete on storage.objects for delete
  using (bucket_id = 'gallery' and (public.can_manage() or owner = auth.uid()));

-- 기본 카테고리
insert into public.gallery_categories (name, sort) values
  ('정기노회', 1), ('노회 행사', 2), ('임원회', 3), ('수련회', 4), ('교회 소식', 5), ('기타', 9)
on conflict (name) do nothing;

-- 기존 사진의 분류 채우기
update public.gallery_items set category = '노회 행사' where category is null;

-- 확인:
--   select column_name from information_schema.columns where table_name='profiles';
--   select * from public.gallery_categories order by sort;

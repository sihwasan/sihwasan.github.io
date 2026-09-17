/* 95 — 시찰방 사진첩·게시판, 자료실 개편
 *
 * 하는 일
 *   1) 시찰 사진첩 (sichal_photos)
 *      시찰마다 자기 사진을 앨범으로 모은다. 사진 자체는 노회 갤러리와 똑같이
 *      Cloudflare R2에 올리고, 여기에는 주소만 적어 둔다.
 *      고른 사진은 「노회 홈페이지에 게시하기」로 노회 갤러리(gallery_items)에
 *      그대로 옮겨 붙일 수 있다. 사진을 다시 올리지 않고 같은 주소를 함께 쓰므로
 *      보관 용량이 두 배로 늘지 않는다. 옮겨 붙인 뒤에는 gallery_item_id 로 이어 둔다.
 *
 *   2) 시찰 게시판 (sichal_posts · sichal_post_comments)
 *      공지사항·건의사항·하고 싶은 말을 나누어 적는다. 사진은 R2에 올리고
 *      영상은 노회 갤러리와 같은 방식으로 유튜브 주소를 적는다.
 *
 *   3) 시찰 자료실 (sichal_docs) 을 게시판 모양으로
 *      본문(body)과 여러 개의 첨부파일(files)을 담을 수 있게 넓힌다.
 *      청원서류는 자료실에서 빼내어 따로 관리하므로 표는 손대지 않는다.
 *
 *   4) 쓰기 권한
 *      지금까지 시찰 자료실은 시찰장·서기만 쓸 수 있었다.
 *      이제 그 시찰에 속한 정회원이면 누구나 사진·글·자료를 올릴 수 있고,
 *      자기가 올린 것은 자기가 고치고 지운다. 시찰 임원은 모두 관리한다.
 */

/* ---------- 1) 시찰 사진첩 ---------- */
create table if not exists public.sichal_photos (
  id              bigserial primary key,
  sichal          text not null,
  album           text not null default '행사 사진',
  taken           text,
  caption         text,
  image_url       text not null,
  thumb_url       text,
  sort            integer not null default 0,
  author_id       uuid default auth.uid(),
  author_name     text,
  gallery_item_id bigint references public.gallery_items(id) on delete set null,
  published_at    timestamptz,
  published_by    text,
  created_at      timestamptz not null default now()
);
create index if not exists sichal_photos_sichal_idx on public.sichal_photos (sichal, album, sort, id);
alter table public.sichal_photos enable row level security;

/* ---------- 2) 시찰 게시판 ---------- */
create table if not exists public.sichal_posts (
  id          bigserial primary key,
  sichal      text not null,
  cat         text not null default '하고 싶은 말',
  title       text not null,
  body        text,
  link_url    text,
  images      jsonb not null default '[]'::jsonb,
  pinned      boolean not null default false,
  author_id   uuid default auth.uid(),
  author_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  text
);
create index if not exists sichal_posts_sichal_idx on public.sichal_posts (sichal, cat, id desc);
alter table public.sichal_posts enable row level security;

create table if not exists public.sichal_post_comments (
  id          bigserial primary key,
  post_id     bigint not null references public.sichal_posts(id) on delete cascade,
  user_id     uuid default auth.uid(),
  author_name text,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists sichal_post_comments_post_idx on public.sichal_post_comments (post_id, id);
alter table public.sichal_post_comments enable row level security;

/* ---------- 3) 시찰 자료실을 게시판 모양으로 ---------- */
alter table public.sichal_docs add column if not exists author_id uuid;
alter table public.sichal_docs add column if not exists body      text;
alter table public.sichal_docs add column if not exists files     jsonb not null default '[]'::jsonb;

/* ---------- 4) 누가 보고 쓸 수 있는가 ----------
 * 보기  : 그 시찰 소속 정회원, 시찰 임원, 노회 임원
 * 쓰기  : 그 시찰 소속 정회원 (자기 글만 고치고 지운다), 시찰 임원은 모두 */
create or replace function public.in_my_sichal(p_sichal text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $fn$
  select public.is_sichal_officer(p_sichal)
      or (public.is_member() and public.my_sichal_name() = p_sichal);
$fn$;

create or replace function public.can_see_sichal(p_sichal text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $fn$
  select public.in_my_sichal(p_sichal) or public.is_officer();
$fn$;

/* 사진첩 */
drop policy if exists sichal_photos_read   on public.sichal_photos;
drop policy if exists sichal_photos_insert on public.sichal_photos;
drop policy if exists sichal_photos_update on public.sichal_photos;
drop policy if exists sichal_photos_delete on public.sichal_photos;
create policy sichal_photos_read on public.sichal_photos
  for select using (public.can_see_sichal(sichal));
create policy sichal_photos_insert on public.sichal_photos
  for insert with check (public.in_my_sichal(sichal) and author_id = auth.uid());
create policy sichal_photos_update on public.sichal_photos
  for update using (public.is_sichal_officer(sichal) or author_id = auth.uid())
              with check (public.is_sichal_officer(sichal) or author_id = auth.uid());
create policy sichal_photos_delete on public.sichal_photos
  for delete using (public.is_sichal_officer(sichal) or author_id = auth.uid());

/* 게시판 */
drop policy if exists sichal_posts_read   on public.sichal_posts;
drop policy if exists sichal_posts_insert on public.sichal_posts;
drop policy if exists sichal_posts_update on public.sichal_posts;
drop policy if exists sichal_posts_delete on public.sichal_posts;
create policy sichal_posts_read on public.sichal_posts
  for select using (public.can_see_sichal(sichal));
create policy sichal_posts_insert on public.sichal_posts
  for insert with check (public.in_my_sichal(sichal) and author_id = auth.uid());
create policy sichal_posts_update on public.sichal_posts
  for update using (public.is_sichal_officer(sichal) or author_id = auth.uid())
              with check (public.is_sichal_officer(sichal) or author_id = auth.uid());
create policy sichal_posts_delete on public.sichal_posts
  for delete using (public.is_sichal_officer(sichal) or author_id = auth.uid());

/* 댓글 */
drop policy if exists sichal_post_comments_read   on public.sichal_post_comments;
drop policy if exists sichal_post_comments_insert on public.sichal_post_comments;
drop policy if exists sichal_post_comments_delete on public.sichal_post_comments;
create policy sichal_post_comments_read on public.sichal_post_comments
  for select using (exists (
    select 1 from public.sichal_posts p
     where p.id = post_id and public.can_see_sichal(p.sichal)));
create policy sichal_post_comments_insert on public.sichal_post_comments
  for insert with check (user_id = auth.uid() and exists (
    select 1 from public.sichal_posts p
     where p.id = post_id and public.in_my_sichal(p.sichal)));
create policy sichal_post_comments_delete on public.sichal_post_comments
  for delete using (user_id = auth.uid() or exists (
    select 1 from public.sichal_posts p
     where p.id = post_id and public.is_sichal_officer(p.sichal)));

/* 자료실 — 시찰 소속 회원도 올릴 수 있게 넓힌다 */
drop policy if exists sichal_docs_write  on public.sichal_docs;
drop policy if exists sichal_docs_insert on public.sichal_docs;
drop policy if exists sichal_docs_update on public.sichal_docs;
drop policy if exists sichal_docs_delete on public.sichal_docs;
create policy sichal_docs_insert on public.sichal_docs
  for insert with check (public.in_my_sichal(sichal));
create policy sichal_docs_update on public.sichal_docs
  for update using (public.is_sichal_officer(sichal) or author_id = auth.uid())
              with check (public.is_sichal_officer(sichal) or author_id = auth.uid());
create policy sichal_docs_delete on public.sichal_docs
  for delete using (public.is_sichal_officer(sichal) or author_id = auth.uid());

/* 첨부파일 보관함 — 시찰 소속 회원이 올리고, 자기가 올린 것은 자기가 지운다 */
drop policy if exists sichal_files_insert on storage.objects;
create policy sichal_files_insert on storage.objects
  for insert with check (
    bucket_id = 'sichal-files' and public.in_my_sichal(split_part(name, '/', 1)));
drop policy if exists sichal_files_delete on storage.objects;
create policy sichal_files_delete on storage.objects
  for delete using (
    bucket_id = 'sichal-files' and (
      public.is_sichal_officer(split_part(name, '/', 1)) or owner = auth.uid()));

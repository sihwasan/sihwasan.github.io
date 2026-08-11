-- =====================================================================
-- 시화산노회 홈페이지 : 임원 자료실 아카이브 (보안 등급 3단계)
--
-- 실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣고 Run
--
-- 열람 권한
--   일반자료 · 대외비자료 : 노회 임원 (노회장·부노회장·서기·부서기·회록서기·
--                          부회록서기·회계·부회계) 및 간사
--   기밀자료             : 노회장 · 부노회장 · 서기 · 간사
--   최고관리자는 모든 자료에 접근합니다.
--
-- ※ 이미 실행하셨더라도 이 파일을 다시 실행하면 권한만 갱신됩니다.
--    (자료는 그대로 유지됩니다)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 권한 판정 함수
-- ---------------------------------------------------------------------

-- 임원 이상 (일반·대외비 열람)
create or replace function public.is_exec()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() in
    ('superadmin','president','clerk','staff','officer'), false)
$fn$;

-- 기밀 열람 : 노회장 · 부노회장 · 서기 · 간사 · 최고관리자
--             (간사는 기밀자료의 등록·수정 실무를 담당한다)
create or replace function public.can_view_secret()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(
    public.my_role() in ('superadmin','president','clerk','staff')
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and p.role = 'officer'
         and p.title like '%부노회장%'
    ), false)
$fn$;

-- 등급별 열람 가능 여부
create or replace function public.can_view_level(p_level text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case
           when p_level = '기밀' then public.can_view_secret()
           else public.is_exec()
         end
$fn$;


-- ---------------------------------------------------------------------
-- 2. 임원 자료실 아카이브
-- ---------------------------------------------------------------------
create table if not exists public.officer_docs (
  id          bigserial primary key,
  level       text not null default '일반' check (level in ('일반','대외비','기밀')),
  category    text,
  title       text not null,
  body        text,
  file_path   text,          -- 저장소 내 경로 (첨부파일이 있는 경우)
  file_name   text,
  doc_date    date,
  author_id   uuid references auth.users on delete set null,
  author_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists officer_docs_level_idx on public.officer_docs (level, doc_date desc);

alter table public.officer_docs enable row level security;

drop policy if exists officer_docs_read   on public.officer_docs;
drop policy if exists officer_docs_write  on public.officer_docs;
drop policy if exists officer_docs_update on public.officer_docs;
drop policy if exists officer_docs_delete on public.officer_docs;

-- 열람 : 등급에 맞는 사람만
create policy officer_docs_read on public.officer_docs for select
  using (public.can_view_level(level));

-- 등록·수정·삭제 : 관리자(노회장·서기·간사·최고관리자)이면서 그 등급을 볼 수 있는 사람
create policy officer_docs_write on public.officer_docs for insert
  with check (public.can_manage() and public.can_view_level(level));
create policy officer_docs_update on public.officer_docs for update
  using (public.can_manage() and public.can_view_level(level))
  with check (public.can_manage() and public.can_view_level(level));
create policy officer_docs_delete on public.officer_docs for delete
  using (public.can_manage() and public.can_view_level(level));


-- ---------------------------------------------------------------------
-- 3. 첨부파일 저장소 (비공개)
--    경로 규칙 : general/…  confidential/…  secret/…
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('officer-docs', 'officer-docs', false)
on conflict (id) do nothing;

drop policy if exists officer_docs_obj_read   on storage.objects;
drop policy if exists officer_docs_obj_insert on storage.objects;
drop policy if exists officer_docs_obj_delete on storage.objects;

create policy officer_docs_obj_read on storage.objects for select using (
  bucket_id = 'officer-docs' and (
    case when name like 'secret/%' then public.can_view_secret()
         else public.is_exec() end
  )
);
create policy officer_docs_obj_insert on storage.objects for insert with check (
  bucket_id = 'officer-docs' and public.can_manage() and (
    case when name like 'secret/%' then public.can_view_secret()
         else true end
  )
);
create policy officer_docs_obj_delete on storage.objects for delete using (
  bucket_id = 'officer-docs' and public.can_manage()
);


-- ---------------------------------------------------------------------
-- 4. 안내용 기본 자료 (이미 있으면 건너뜀)
-- ---------------------------------------------------------------------
insert into public.officer_docs (level, category, title, body, doc_date, author_name)
select * from (values
  ('일반', '안내',
   '임원 자료실 이용 안내',
   E'임원 자료실은 보안 등급에 따라 세 가지로 구분됩니다.\n\n' ||
   E'· 일반자료 : 임원이 함께 보는 일반 문서입니다.\n' ||
   E'· 대외비자료 : 노회 밖으로 나가서는 안 되는 문서입니다. 임원만 열람합니다.\n' ||
   E'· 기밀자료 : 노회장·부노회장·서기만 열람합니다. 재판·징계·개인 신상 등 민감한 문서를 보관합니다.\n\n' ||
   E'자료의 등록·수정·삭제는 관리자(노회장·서기·간사)가 할 수 있으며, 모든 열람과 변경은 감사 기록에 남습니다.',
   current_date, '노회 사무실')
) as v(level, category, title, body, doc_date, author_name)
where not exists (select 1 from public.officer_docs);

-- 확인:  select level, count(*) from public.officer_docs group by level;

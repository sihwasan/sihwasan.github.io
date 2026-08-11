-- =====================================================================
-- 시화산노회 홈페이지 : 직인·도장 관리
--
-- 실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣고 Run
--
-- 직인 이미지는 비공개 저장소에 보관되며, 관리자(노회장·서기·간사)만
-- 등록·열람할 수 있습니다. 모든 등록·열람은 감사 기록에 남습니다.
-- =====================================================================

create table if not exists public.seals (
  key         text primary key,          -- 노회직인 / 노회장 / 서기 / 회록서기
  label       text not null,
  holder      text,                      -- 도장 주인 (예: 박흥열)
  file_path   text,                      -- 저장소 경로
  sort        int not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table public.seals enable row level security;

drop policy if exists seals_read  on public.seals;
drop policy if exists seals_write on public.seals;
create policy seals_read  on public.seals for select using (public.can_manage());
create policy seals_write on public.seals for all
  using (public.can_manage()) with check (public.can_manage());

-- 직인 이미지 저장소 (비공개)
insert into storage.buckets (id, name, public) values ('seals', 'seals', false)
on conflict (id) do nothing;

drop policy if exists seals_obj_read   on storage.objects;
drop policy if exists seals_obj_insert on storage.objects;
drop policy if exists seals_obj_delete on storage.objects;
create policy seals_obj_read   on storage.objects for select
  using (bucket_id = 'seals' and public.can_manage());
create policy seals_obj_insert on storage.objects for insert
  with check (bucket_id = 'seals' and public.can_manage());
create policy seals_obj_delete on storage.objects for delete
  using (bucket_id = 'seals' and public.can_manage());

-- 기본 항목 등록 (이미 있으면 유지)
insert into public.seals (key, label, sort) values
  ('노회직인', '노회 직인', 1),
  ('노회장',   '노회장 도장', 2),
  ('서기',     '서기 도장', 3),
  ('회록서기', '회록서기 도장', 4)
on conflict (key) do nothing;

-- 확인:  select key, label, holder, file_path from public.seals order by sort;

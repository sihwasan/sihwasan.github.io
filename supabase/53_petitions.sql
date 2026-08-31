-- 53. 내가 쓴 청원서 저장 (청원서 작성 페이지에서 저장·열람·수정·삭제)
create table if not exists public.petitions (
  id         bigserial primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  form_id    text not null,
  form_title text not null,
  title      text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists petitions_user_idx on public.petitions (user_id, updated_at desc);

alter table public.petitions enable row level security;
drop policy if exists petitions_self on public.petitions;
create policy petitions_self on public.petitions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- (추가) 도장 종류: church(교회 직인) / pastor(목사·당회장 도장)
-- alter table member_seals add column kind text not null default 'church';
-- 기본키를 (user_id, kind)로 변경. 실제 적용은 migration member_seals_kind.

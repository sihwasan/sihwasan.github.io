-- =====================================================================
-- 시화산노회 홈페이지 : Supabase 초기 설정
--
-- 실행 방법
--   Supabase 대시보드 → 왼쪽 메뉴 SQL Editor → New query →
--   이 파일 전체를 붙여넣고 오른쪽 아래 Run 클릭
--
--   ※ 여러 번 실행해도 안전합니다. 이미 등록된 자료는 그대로 유지됩니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 노회 명단 (임원·회원) : 가입 시 등급 자동 판정에 사용
-- ---------------------------------------------------------------------
create table if not exists public.roster (
  id             bigserial primary key,
  name           text not null,
  church         text not null,
  position       text,
  role           text not null default 'member',
  officer_title  text,
  created_at     timestamptz not null default now()
);

create unique index if not exists roster_name_church_idx on public.roster (name, church);


-- ---------------------------------------------------------------------
-- 2. 회원 프로필 (구글 로그인 사용자와 1:1)
--    role : superadmin / president / clerk / staff / officer / member / pending
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text not null,
  name        text,
  church      text,
  position    text,
  phone       text,
  role        text not null default 'pending',
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 3. 감사 로그 : 열람·추가·수정·삭제 기록
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          bigserial primary key,
  user_id     uuid references auth.users on delete set null,
  user_email  text,
  user_name   text,
  role        text,
  type        text not null,
  action      text not null,
  detail      text,
  created_at  timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);


-- ---------------------------------------------------------------------
-- 4. 권한 판정 함수
-- ---------------------------------------------------------------------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $fn$
  select role from public.profiles where id = auth.uid()
$fn$;

-- 임원 이상 (임원방·회의록 열람)
create or replace function public.is_officer()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() in
    ('superadmin','president','clerk','staff','officer'), false)
$fn$;

-- 회원 관리·서류 발급 권한 (노회장·서기·간사·최고관리자)
create or replace function public.can_manage()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() in
    ('superadmin','president','clerk','staff'), false)
$fn$;

-- 정회원 이상 (승인대기 제외)
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() <> 'pending', false)
$fn$;


-- ---------------------------------------------------------------------
-- 5. 구글 로그인 시 프로필 자동 생성
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', ''),
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 6. 본인 정보 등록 → 노회 명단과 대조하여 등급 자동 부여
--    교회명은 공백과 끝의 '교회'를 무시하고 비교한다.
-- ---------------------------------------------------------------------
create or replace function public.claim_membership(
  p_name text, p_church text, p_position text, p_phone text)
returns table (out_role text, out_title text)
language plpgsql security definer set search_path = public as $fn$
declare
  v_role  text;
  v_title text;
  v_norm  text := regexp_replace(regexp_replace(p_church, '\s', '', 'g'), '교회$', '');
  v_name  text := regexp_replace(p_name, '\s', '', 'g');
  v_cur   text;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select r.role, r.officer_title into v_role, v_title
    from public.roster r
   where regexp_replace(r.name, '\s', '', 'g') = v_name
     and regexp_replace(regexp_replace(r.church, '\s', '', 'g'), '교회$', '') = v_norm
   limit 1;

  if v_role is null then
    v_role := 'pending';
    v_title := null;
  end if;

  select p.role into v_cur from public.profiles p where p.id = auth.uid();

  update public.profiles p
     set name = p_name,
         church = p_church,
         position = p_position,
         phone = p_phone,
         updated_at = now(),
         -- 최고관리자와 관리자가 직접 지정한 등급은 낮추지 않는다
         role  = case when p.role = 'superadmin' then p.role else v_role end,
         title = case when p.role = 'superadmin' then p.title else v_title end
   where p.id = auth.uid();

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select auth.uid(), p.email, p_name, p.role, 'update', '회원정보 등록',
         p_name || ' / ' || p_church || ' → ' || p.role
    from public.profiles p where p.id = auth.uid();

  return query
    select p.role, p.title from public.profiles p where p.id = auth.uid();
end;
$fn$;


-- ---------------------------------------------------------------------
-- 7. 접근 제어 (RLS) : 서버에서 강제되므로 브라우저에서 우회할 수 없다
-- ---------------------------------------------------------------------
alter table public.roster      enable row level security;
alter table public.profiles    enable row level security;
alter table public.audit_logs  enable row level security;

-- 명단 : 정회원 이상 열람, 관리자만 수정
drop policy if exists roster_read  on public.roster;
drop policy if exists roster_write on public.roster;
create policy roster_read  on public.roster for select using (public.is_member());
create policy roster_write on public.roster for all
  using (public.can_manage()) with check (public.can_manage());

-- 프로필 : 본인 것은 본인이, 전체 열람은 임원, 등급 수정은 관리자
drop policy if exists profiles_self_read   on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_self_delete on public.profiles;
drop policy if exists profiles_admin_read  on public.profiles;
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_self_read   on public.profiles for select using (id = auth.uid());
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_self_delete on public.profiles for delete using (id = auth.uid());
create policy profiles_admin_read  on public.profiles for select using (public.is_officer());
create policy profiles_admin_write on public.profiles for update
  using (public.can_manage()) with check (public.can_manage());

-- 감사 로그 : 로그인 사용자는 기록만 남길 수 있고 열람은 최고관리자만.
--             수정·삭제 정책이 없으므로 누구도 고치거나 지울 수 없다.
drop policy if exists audit_insert on public.audit_logs;
drop policy if exists audit_read   on public.audit_logs;
create policy audit_insert on public.audit_logs for insert with check (auth.uid() is not null);
create policy audit_read   on public.audit_logs for select using (public.my_role() = 'superadmin');


-- ---------------------------------------------------------------------
-- 8. 노회 명단 등록 (제19회 정기노회 기준, 71명)
-- ---------------------------------------------------------------------
-- 재실행해도 직접 추가하신 명단은 지워지지 않습니다 (같은 사람은 건너뜁니다)
insert into public.roster (name, church, position, role, officer_title) values
  ('박흥열', '시흥생수교회', '목사', 'president', '노회장'),
  ('이재용', '안산상록교회', '목사', 'officer', '부노회장'),
  ('이신영', '수암제일교회', '장로', 'officer', '부노회장'),
  ('권병렬', '섬김의교회', '목사', 'clerk', '서기'),
  ('김동석', '운평장로교회', '목사', 'officer', '부서기'),
  ('김지수', '반월교회', '목사', 'officer', '회록서기'),
  ('손영득', '새솔제일교회', '목사', 'officer', '부회록서기'),
  ('김득철', '은광교회', '장로', 'officer', '회계'),
  ('고동욱', '섬기는교회', '장로', 'officer', '부회계'),
  ('박현정', '율리교회', '목사', 'member', null),
  ('강명우', '반석교회', '목사', 'member', null),
  ('임동준', '새힘교회', '목사', 'member', null),
  ('서용호', '수암제일교회', '목사', 'member', null),
  ('문광선', '새누리교회', '목사', 'member', null),
  ('박재완', '수암새권능교회', '목사', 'member', null),
  ('박양수', '힘찬교회', '목사', 'member', null),
  ('송기태', '새날선교교회', '목사', 'member', null),
  ('주강완', '서신영광교회', '목사', 'member', null),
  ('김선민', '나눔의교회', '목사', 'member', null),
  ('전종호', '동탄인랜드교회', '목사', 'member', null),
  ('김성중', '한숲우리교회', '목사', 'member', null),
  ('안상천', '참된빛교회', '목사', 'member', null),
  ('이성대', '새생명교회', '목사', 'member', null),
  ('명영석', '행복한교회', '목사', 'member', null),
  ('백용선', '노진교회', '목사', 'member', null),
  ('김종수', '섬기는교회', '목사', 'member', null),
  ('이동진', '동탄영광교회', '목사', 'member', null),
  ('유성준', '주품에교회', '목사', 'member', null),
  ('김영돈', '안산원곡동교회', '목사', 'member', null),
  ('김운갑', '시흥은혜교회', '목사', 'member', null),
  ('장정훈', '아름다운숲교회', '목사', 'member', null),
  ('한동준', '은광교회', '목사', 'member', null),
  ('송요한', '안산샬롬교회', '목사', 'member', null),
  ('김성신', '연수교회', '목사', 'member', null),
  ('정주원', '주말씀교회', '목사', 'member', null),
  ('제갈광철', '예전교회', '목사', 'member', null),
  ('문태환', '성산교회', '목사', 'member', null),
  ('박규태', '반월교회', '부목사', 'member', null),
  ('조능', '반월교회', '부목사', 'member', null),
  ('김하진', '섬기는교회', '부목사', 'member', null),
  ('박상우', '시흥생수교회', '부목사', 'member', null),
  ('오윤석', '안산상록교회', '부목사', 'member', null),
  ('박희원', '반월교회', '부목사', 'member', null),
  ('이세용', '반월교회', '원로목사', 'member', null),
  ('신동열', '노진교회', '원로목사', 'member', null),
  ('김충현', '운평장로교회', '원로목사', 'member', null),
  ('김삼성', '새솔제일교회', '원로목사', 'member', null),
  ('김해수', '목자교회', '은퇴목사', 'member', null),
  ('박영수', '안산샬롬교회', '장로', 'member', null),
  ('유승열', '시흥생수교회', '장로', 'member', null),
  ('장경환', '새날선교교회', '장로', 'member', null),
  ('이재복', '안산상록교회', '장로', 'member', null),
  ('김성훈', '목자교회', '장로', 'member', null),
  ('박아론', '수암새권능교회', '장로', 'member', null),
  ('윤성복', '섬기는교회', '장로', 'member', null),
  ('김완수', '섬김의교회', '장로', 'member', null),
  ('김성조', '새힘교회', '장로', 'member', null),
  ('장명국', '안산원곡동교회', '장로', 'member', null),
  ('김창룡', '반월교회', '장로', 'member', null),
  ('정재영', '반월교회', '장로', 'member', null),
  ('김상진', '반월교회', '장로', 'member', null),
  ('김영우', '새솔제일교회', '장로', 'member', null),
  ('윤위석', '은광교회', '장로', 'member', null),
  ('김종서', '힘찬교회', '장로', 'member', null),
  ('송언빈', '서안문호교회', '장로', 'member', null),
  ('문명수', '노진교회', '장로', 'member', null),
  ('안태성', '반석교회', '장로', 'member', null),
  ('백윤복', '성산교회', '장로', 'member', null),
  ('김종관', '연수교회', '장로', 'member', null),
  ('신용화', '운평장로교회', '장로', 'member', null),
  ('허경하', '한숲우리교회', '장로', 'member', null)
on conflict (name, church) do nothing;


-- =====================================================================
-- 완료. 아래 쿼리로 등록 결과를 확인할 수 있습니다.
--   select role, count(*) from public.roster group by role order by 1;
-- =====================================================================

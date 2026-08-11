-- =====================================================================
-- 시화산노회 홈페이지 : 알림함 · 노회장 권한 이양 · 관리자 임명
--
-- 실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣고 Run
--
-- · 노회장은 서기·간사를 임명하고 변경할 수 있습니다.
-- · 다음 노회장은 현 노회장만 임명할 수 있으며, 이양하는 즉시
--   전임 노회장은 정회원으로 내려가고 관리자 권한을 잃습니다.
--
--   ※ 여러 번 실행해도 안전합니다. 이미 등록된 자료는 그대로 유지됩니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 알림함
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id         bigserial primary key,
  user_id    uuid not null references auth.users on delete cascade,
  kind       text not null default '안내',
  title      text not null,
  body       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_self   on public.notifications;
drop policy if exists notifications_update on public.notifications;
drop policy if exists notifications_admin  on public.notifications;

-- 본인 알림만 열람·읽음 처리
create policy notifications_self   on public.notifications for select
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- 관리자는 회원에게 알림을 보낼 수 있다
create policy notifications_admin  on public.notifications for insert
  with check (public.can_manage());


-- ---------------------------------------------------------------------
-- 2. 관리자 임명
--    · 노회장    : 서기·간사 등 관리자를 임명·변경 (노회장 등급은 이양 절차로만)
--    · 최고관리자 : 비상시 노회장을 포함해 모든 등급을 임명
-- ---------------------------------------------------------------------
create or replace function public.set_member_role(p_id uuid, p_role text, p_title text)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_me    text := public.my_role();
  v_name  text;
  v_old   text;
begin
  if v_me not in ('president','superadmin') then
    raise exception '등급 지정은 노회장만 할 수 있습니다.';
  end if;
  -- 노회장·최고관리자 등급은 최고관리자만 직접 부여할 수 있다 (비상시 임명)
  if p_role in ('president','superadmin') and v_me <> 'superadmin' then
    raise exception '노회장 등급은 권한 이양 절차로만 변경할 수 있습니다.';
  end if;

  select name, role into v_name, v_old from public.profiles where id = p_id;
  if v_name is null then
    raise exception '대상 회원을 찾을 수 없습니다.';
  end if;
  if v_old = 'superadmin' and v_me <> 'superadmin' then
    raise exception '변경할 수 없는 계정입니다.';
  end if;

  -- 최고관리자가 새 노회장을 세우면 기존 노회장은 정회원으로 내린다
  if p_role = 'president' then
    update public.profiles
       set role = 'member', title = null, updated_at = now()
     where role = 'president' and id <> p_id;
  end if;

  update public.profiles
     set role = p_role, title = p_title, updated_at = now()
   where id = p_id;

  if p_role = 'president' then
    insert into public.notifications (user_id, kind, title, body)
    values (p_id, '임명', '노회장으로 임명되었습니다',
      v_name || ' 님, 시화산노회 노회장으로 세워지심을 축하드립니다.' || chr(10) || chr(10) ||
      '노회장께서는 다음을 하실 수 있습니다.' || chr(10) ||
      '1. 관리자 임명 : 회원 관리에서 서기와 간사를 임명하고 변경하십니다.' || chr(10) ||
      '2. 다음 노회장 임명 : 임기를 마치실 때 내 정보에서 차기 노회장에게 권한을 이양하십니다.' || chr(10) ||
      '3. 홈페이지 설정 : 직인·도장을 관리하고 각종 관리 메뉴를 사용하십니다.' || chr(10) ||
      '4. 사이트 관리 : 공지사항·노회 일정·메인 문구·임원 명부·갤러리를 수정하십니다.' || chr(10) ||
      '5. 회원 관리 : 회원 승인과 자격, 노회 명단, 상비부 배정을 관리하십니다.' || chr(10) ||
      '6. 서류 발급 : 증명서 발급을 승인하시고 서류 신청을 처리하십니다.' || chr(10) ||
      '7. 임원 자료실 : 일반·대외비·기밀 자료를 모두 열람하십니다.' || chr(10) || chr(10) ||
      '모든 열람과 변경은 감사 기록에 남습니다.');
  end if;

  -- 임명 사실을 본인에게 알린다
  if p_role in ('clerk','staff') then
    insert into public.notifications (user_id, kind, title, body)
    values (p_id, '임명',
      (case p_role when 'clerk' then '서기' else '간사' end) || '로 임명되었습니다',
      '노회장께서 회원님을 ' || (case p_role when 'clerk' then '서기' else '간사' end) ||
      '로 임명하셨습니다.' || chr(10) || chr(10) ||
      '이제 임원방에서 다음 업무를 하실 수 있습니다.' || chr(10) ||
      '· 홈페이지 설정 : 직인 관리와 각종 관리 메뉴' || chr(10) ||
      '· 사이트 관리 : 공지사항·노회 일정·메인 문구·임원 명부·갤러리 수정' || chr(10) ||
      '· 회원 관리 : 회원 승인, 노회 명단과 상비부 배정 관리' || chr(10) ||
      '· 서류 발급 : 증명서 발급과 서류 신청 처리' || chr(10) ||
      '· 임원 자료실 : 일반·대외비·기밀 자료 열람과 등록' || chr(10) || chr(10) ||
      '모든 열람과 변경은 감사 기록에 남습니다.');
  end if;

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select auth.uid(), p.email, p.name, v_me, 'update', '등급 지정',
         v_name || ' → ' || p_role
    from public.profiles p where p.id = auth.uid();

  return p_role;
end;
$fn$;


-- ---------------------------------------------------------------------
-- 3. 승인대기 → 정회원 (관리자 전원)
-- ---------------------------------------------------------------------
create or replace function public.approve_member(p_id uuid)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_name text; v_role text;
begin
  if not public.can_manage() then
    raise exception '승인 권한이 없습니다.';
  end if;
  select name, role into v_name, v_role from public.profiles where id = p_id;
  if v_name is null then raise exception '대상 회원을 찾을 수 없습니다.'; end if;
  if v_role <> 'pending' then raise exception '승인대기 상태의 회원이 아닙니다.'; end if;

  update public.profiles set role = 'member', updated_at = now() where id = p_id;

  insert into public.notifications (user_id, kind, title, body)
  values (p_id, '안내', '정회원으로 승인되었습니다',
    '노회 명단 확인이 끝나 정회원으로 승인되었습니다.' || chr(10) ||
    '이제 자료실·회칙·조직 명단을 열람하시고 서류를 신청하실 수 있습니다.');

  return 'member';
end;
$fn$;


-- ---------------------------------------------------------------------
-- 4. 노회장 권한 이양
--    현 노회장만 실행할 수 있으며, 이양 즉시 전임 노회장은 정회원이 됩니다.
-- ---------------------------------------------------------------------
create or replace function public.transfer_presidency(p_target_id uuid, p_confirm_name text)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_me     uuid := auth.uid();
  v_myrole text := public.my_role();
  v_myname text;
  v_tname  text;
begin
  if v_myrole <> 'president' then
    raise exception '노회장만 권한을 이양할 수 있습니다.';
  end if;
  if p_target_id = v_me then
    raise exception '본인에게는 이양할 수 없습니다.';
  end if;

  select name into v_myname from public.profiles where id = v_me;
  select name into v_tname  from public.profiles where id = p_target_id;
  if v_tname is null then
    raise exception '대상 회원을 찾을 수 없습니다.';
  end if;
  -- 확인 입력한 이름이 대상과 일치해야 한다
  if replace(v_tname, ' ', '') <> replace(coalesce(p_confirm_name, ''), ' ', '') then
    raise exception '입력하신 이름이 대상 회원과 일치하지 않습니다.';
  end if;

  -- 신임 노회장
  update public.profiles
     set role = 'president', title = '노회장', suspended = false, updated_at = now()
   where id = p_target_id;

  -- 전임 노회장은 정회원으로 내려간다
  update public.profiles
     set role = 'member', title = null, updated_at = now()
   where id = v_me;

  -- 신임 노회장에게 축하와 권한 안내
  insert into public.notifications (user_id, kind, title, body)
  values (p_target_id, '임명', '노회장 취임을 축하드립니다',
    v_tname || ' 목사님, 시화산노회 노회장으로 세워지심을 축하드립니다.' || chr(10) ||
    '전임 ' || coalesce(v_myname, '') || ' 노회장께서 홈페이지 관리 권한을 이양하셨습니다.' || chr(10) || chr(10) ||
    '노회장께서는 다음을 하실 수 있습니다.' || chr(10) ||
    '1. 관리자 임명 : 회원 관리에서 서기와 간사를 임명하고 변경하실 수 있습니다.' || chr(10) ||
    '2. 다음 노회장 임명 : 임기를 마치실 때 내 정보에서 차기 노회장에게 권한을 이양하십니다.' || chr(10) ||
    '3. 홈페이지 설정 : 직인·도장을 관리하고 각종 관리 메뉴를 사용하십니다.' || chr(10) ||
    '4. 사이트 관리 : 공지사항·노회 일정·메인 문구·임원 명부·갤러리를 수정하십니다.' || chr(10) ||
    '5. 회원 관리 : 회원 승인과 자격, 노회 명단, 상비부 배정을 관리하십니다.' || chr(10) ||
    '6. 서류 발급 : 증명서 발급을 승인하시고 서류 신청을 처리하십니다.' || chr(10) ||
    '7. 임원 자료실 : 일반·대외비·기밀 자료를 모두 열람하십니다.' || chr(10) || chr(10) ||
    '권한 이양은 되돌릴 수 없으며, 모든 변경은 감사 기록에 남습니다.' || chr(10) ||
    '주님의 은혜 가운데 노회를 잘 섬기시기를 기도합니다.');

  -- 전임 노회장에게도 안내
  insert into public.notifications (user_id, kind, title, body)
  values (v_me, '안내', '노회장 권한을 이양하셨습니다',
    v_tname || ' 님에게 노회장 권한을 이양하셨습니다.' || chr(10) ||
    '지금부터 회원님의 등급은 정회원이며, 관리자 기능은 사용하실 수 없습니다.' || chr(10) ||
    '그동안 노회를 섬겨 주셔서 감사합니다.');

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select v_me, p.email, p.name, 'president', 'update', '노회장 권한 이양',
         coalesce(v_myname,'') || ' → ' || v_tname
    from public.profiles p where p.id = v_me;

  return v_tname;
end;
$fn$;

-- 확인:  select proname from pg_proc where proname in
--          ('set_member_role','approve_member','transfer_presidency');

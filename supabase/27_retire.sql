-- =====================================================================
--  27. 정년(만 70세) 적용
--
--  근거 : 대한예수교장로회 총회 정년 규정 (만 70세)
--
--  · 모든 회원의 생년월일로 정년일을 계산해 화면에 표시합니다.
--  · 정년이 지난 분은 정회원 자격을 갖지 못합니다.
--    등급과 상관없이 적용되며, 정회원 전용 자료도 열람할 수 없습니다.
--  · 가입할 때 이미 정년이 지났으면 정회원 등급이 부여되지 않습니다.
--
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 정년일과 정년 경과 여부
-- ---------------------------------------------------------------------
create or replace function public.retire_date(p_birth date)
returns date language sql immutable as $fn$
  select case when p_birth is null then null
              else (p_birth + interval '70 years')::date end;
$fn$;

create or replace function public.is_retired(p_birth date)
returns boolean language sql stable as $fn$
  select p_birth is not null and (p_birth + interval '70 years')::date <= current_date;
$fn$;


-- ---------------------------------------------------------------------
-- 2. 정회원 판정에 정년을 반영한다
--    (자료 열람 권한을 정하는 is_member 에 그대로 걸린다)
-- ---------------------------------------------------------------------
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role <> 'pending'
       and coalesce(p.suspended, false) = false
       and not public.is_retired(p.birth_date)
  );
$fn$;


-- ---------------------------------------------------------------------
-- 3. 정년이 지난 분에게는 정회원 등급을 주지 않는다
-- ---------------------------------------------------------------------
create or replace function public.claim_membership(
  p_name text, p_church text, p_position text, p_phone text default null)
returns table (role text, title text)
language plpgsql security definer set search_path = public as $fn$
declare
  v_role  text := 'pending';
  v_title text;
  v_birth date;
begin
  select p.birth_date into v_birth from public.profiles p where p.id = auth.uid();

  -- 노회 명단과 이름·교회가 일치하면 그 등급을 준다
  select r.role, r.officer_title into v_role, v_title
    from public.roster r
   where replace(r.name, ' ', '') = replace(p_name, ' ', '')
     and replace(r.church, ' ', '') = replace(p_church, ' ', '')
   limit 1;

  if v_role is null then
    v_role := 'pending';
    v_title := null;
  end if;

  -- 정년이 지났으면 정회원 등급을 주지 않는다
  if public.is_retired(v_birth) and v_role in ('member', 'officer') then
    v_role := 'pending';
    v_title := null;
  end if;

  update public.profiles p
     set name = p_name, church = p_church, position = p_position,
         phone = coalesce(p_phone, p.phone),
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
-- 4. 확인 : 정년이 지났는데 정회원 등급인 분이 있는지
-- ---------------------------------------------------------------------
select name as "성명", church as "소속", role as "등급",
       birth_date as "생년월일",
       public.retire_date(birth_date) as "정년일"
  from public.profiles
 where public.is_retired(birth_date)
 order by birth_date;

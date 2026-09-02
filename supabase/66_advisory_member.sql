-- ---------------------------------------------------------------------
--  66. 언권회원 등급 — 정년이 지난 회원의 자동 등급
-- ---------------------------------------------------------------------
--  · 정년(만 70세가 되는 해 생일 하루 전)이 지난 정회원·임원은
--    <언권회원>(role = 'advisory') 이 됩니다. 발언권만 있고 열람 자격은
--    정회원 전용 자료에 미치지 않습니다.
--  · 관리자가 정년이 지난 분의 등급을 직접 고치면 그 등급이 우선합니다.
--    (retire_applied = true 로 표시해 두어 다시 자동으로 내리지 않습니다)
--  · 자동 처리는 apply_retirement() 가 맡습니다. 홈페이지가 하루 한 번
--    (run_reminders 와 같은 자리에서) 부르고, 회원 관리 화면에서도 부릅니다.
-- ---------------------------------------------------------------------

-- 1. 정년 처리 표시 열
alter table public.profiles add column if not exists retire_applied boolean not null default false;
alter table public.roster   add column if not exists retire_applied boolean not null default false;

comment on column public.profiles.retire_applied is
  '정년 처리 완료 — true 이면 정년이 지났어도 현재 등급을 그대로 둔다 (관리자 수정 포함)';
comment on column public.roster.retire_applied is
  '정년 처리 완료 — true 이면 정년이 지났어도 현재 등급을 그대로 둔다 (관리자 수정 포함)';

-- 2. 정년이 지난 분의 등급을 관리자가 고치면 그 결정을 지킨다
create or replace function public.mark_retire_applied()
returns trigger language plpgsql as $fn$
begin
  if public.is_retired(new.birth_date) then
    new.retire_applied := true;
  end if;
  return new;
end;
$fn$;

drop trigger if exists profiles_retire_applied_trg on public.profiles;
create trigger profiles_retire_applied_trg
  before update of role on public.profiles
  for each row execute function public.mark_retire_applied();

drop trigger if exists roster_retire_applied_trg on public.roster;
create trigger roster_retire_applied_trg
  before update of role on public.roster
  for each row execute function public.mark_retire_applied();

-- 3. 자동 처리 : 정년이 지났고 아직 처리하지 않은 정회원·임원 → 언권회원
create or replace function public.apply_retirement()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_n1 integer := 0;
  v_n2 integer := 0;
begin
  update public.roster
     set role = 'advisory', officer_title = null, retire_applied = true
   where public.is_retired(birth_date)
     and not retire_applied
     and role in ('member', 'officer', 'general');
  get diagnostics v_n1 = row_count;

  update public.profiles
     set role = 'advisory', title = null, retire_applied = true, updated_at = now()
   where public.is_retired(birth_date)
     and not retire_applied
     and role in ('member', 'officer', 'general');
  get diagnostics v_n2 = row_count;

  if v_n1 + v_n2 > 0 then
    begin
      insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
      values (auth.uid(), null, '시스템', 'system', 'update', '정년 자동 처리',
              '언권회원으로 변경 — 명단 ' || v_n1 || '명, 계정 ' || v_n2 || '명');
    exception when others then null;
    end;
  end if;
  return v_n1 + v_n2;
end;
$fn$;

grant execute on function public.apply_retirement() to authenticated, anon;

-- 4. 정회원 판정 : 언권회원·일반회원·승인대기는 제외.
--    정년이 지난 분은 관리자가 등급을 확정(retire_applied)한 경우에만 그 등급을 따른다.
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role not in ('pending', 'general', 'advisory')
       and coalesce(p.suspended, false) = false
       and (not public.is_retired(p.birth_date) or p.retire_applied)
  );
$fn$;

-- 5. 가입 때 : 정년이 지났으면 언권회원으로
create or replace function public.claim_membership(
  p_name text, p_church text, p_position text, p_phone text)
returns table (out_role text, out_title text)
language plpgsql security definer set search_path = public as $fn$
declare
  v_role  text;
  v_title text;
  v_norm  text := regexp_replace(regexp_replace(p_church, '\s', '', 'g'), '교회$', '');
  v_name  text := regexp_replace(p_name, '\s', '', 'g');
  v_birth date;
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

  -- 정년이 지났으면 정회원·임원 대신 언권회원으로 둔다
  select p.birth_date into v_birth from public.profiles p where p.id = auth.uid();
  if public.is_retired(v_birth) and v_role in ('member', 'officer', 'general') then
    v_role := 'advisory';
    v_title := null;
  end if;

  update public.profiles p
     set name = p_name,
         church = p_church,
         position = p_position,
         phone = p_phone,
         updated_at = now(),
         retire_applied = public.is_retired(p.birth_date),
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

create or replace function public.register_member(
  p_name text, p_church text, p_position text, p_phone text)
returns table (out_role text, out_title text)
language plpgsql security definer set search_path = public as $fn$
begin
  return query select * from public.claim_membership(p_name, p_church, p_position, p_phone);
end;
$fn$;

-- 6. 지금 명단·계정에서 정년이 지난 정회원·임원·일반회원은 언권회원으로
select public.apply_retirement();

-- 7. 확인
select 'roster' as tbl, role, count(*) from public.roster group by role
union all
select 'profiles', role, count(*) from public.profiles group by role
order by 1, 2;

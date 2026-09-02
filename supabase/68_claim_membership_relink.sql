-- ---------------------------------------------------------------------
--  68. 회원정보 등록의 명단 연결 복구 + 언권회원 로직 병합
-- ---------------------------------------------------------------------
--  2026-08-28의 claim_membership 은 계정(profiles)을 노회 명단(roster)과
--  이어 주고(roster_id), 연락처·이메일을 명단에 남기는 버전이었다.
--  66_advisory_member.sql 이 그 사실을 모르고 파일 기준의 구버전 위에
--  언권회원 로직을 얹으면서 연결 기능이 사라졌다. 여기서 두 가지를 합친다.
--
--  · 명단에서 이름·교회로 사람을 찾아 roster_id 로 잇는다
--  · 명단이 원본: 연락처·생년월일·이메일을 명단에 남긴다
--  · 정년(만 70세)이 지났으면 정회원·임원 대신 언권회원(advisory)으로
--  · 아울러 아직 이어지지 않은 기존 계정을 명단과 다시 잇는다
-- ---------------------------------------------------------------------

create or replace function public.claim_membership(
  p_name text, p_church text, p_position text, p_phone text)
returns table (out_role text, out_title text)
language plpgsql security definer set search_path = public as $fn$
declare
  v_rid   bigint;
  v_role  text;
  v_title text;
  v_norm  text := regexp_replace(regexp_replace(coalesce(p_church, ''), '\s', '', 'g'), '교회$', '');
  v_name  text := regexp_replace(coalesce(p_name, ''), '\s', '', 'g');
  v_birth date;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  -- 명단에서 같은 이름·교회를 찾는다
  select r.id, r.role, r.officer_title, r.birth_date
    into v_rid, v_role, v_title, v_birth
    from public.roster r
   where regexp_replace(coalesce(r.name, ''), '\s', '', 'g') = v_name
     and regexp_replace(regexp_replace(coalesce(r.church, ''), '\s', '', 'g'), '교회$', '') = v_norm
   limit 1;

  if v_rid is null then
    v_role := 'pending';
    v_title := null;
  end if;

  -- 명단에 생년월일이 없으면 계정에 적힌 것을 쓴다
  if v_birth is null then
    select p.birth_date into v_birth from public.profiles p where p.id = auth.uid();
  end if;

  -- 정년(만 70세)이 지났으면 정회원·임원 대신 언권회원으로 둔다
  if public.is_retired(v_birth) and v_role in ('member', 'officer', 'general') then
    v_role := 'advisory';
    v_title := null;
  end if;

  -- 계정을 명단에 잇고, 등급은 명단이 정한 것을 따른다
  update public.profiles p
     set roster_id  = coalesce(v_rid, p.roster_id),
         name       = p_name,
         church     = p_church,
         position   = p_position,
         phone      = p_phone,
         updated_at = now(),
         retire_applied = public.is_retired(v_birth),
         role  = case when p.role = 'superadmin' then p.role else v_role end,
         title = case when p.role = 'superadmin' then p.title else v_title end
   where p.id = auth.uid();

  -- 적어 넣은 연락처와 이메일은 명단에 남긴다 (명단이 원본이다)
  if v_rid is not null then
    update public.roster r
       set phone      = coalesce(nullif(btrim(p_phone), ''), r.phone),
           birth_date = coalesce(r.birth_date, v_birth),
           email      = coalesce((select p.email from public.profiles p where p.id = auth.uid()), r.email)
     where r.id = v_rid;
  end if;

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select auth.uid(), p.email, p_name, p.role, 'update', '회원정보 등록',
         p_name || ' / ' || coalesce(p_church, '') || ' → ' || p.role ||
         case when v_rid is null then ' (명단에 없어 승인대기)' else ' (명단 ' || v_rid || '번과 연결)' end
    from public.profiles p where p.id = auth.uid();

  return query select p.role, p.title from public.profiles p where p.id = auth.uid();
end;
$fn$;

-- ---------------------------------------------------------------------
-- 아직 명단과 이어지지 않은 계정을 다시 잇는다.
-- 이름이 명단에서 한 사람에게만 있으면 그 사람으로 잇고,
-- 계정에 교회가 적혀 있으면 교회도 함께 맞춘다.
-- ---------------------------------------------------------------------
update public.profiles p
   set roster_id = m.rid
  from (
    select p2.id as pid, min(r.id) as rid
      from public.profiles p2
      join public.roster r
        on regexp_replace(coalesce(r.name, ''), '\s', '', 'g')
           = regexp_replace(coalesce(p2.name, ''), '\s', '', 'g')
       and (coalesce(p2.church, '') = ''
            or regexp_replace(regexp_replace(coalesce(r.church, ''), '\s', '', 'g'), '교회$', '')
               = regexp_replace(regexp_replace(p2.church, '\s', '', 'g'), '교회$', ''))
     where p2.roster_id is null
       and p2.role <> 'superadmin'
     group by p2.id
    having count(distinct r.id) = 1
  ) m
 where p.id = m.pid;

-- 계정에만 있던 정보를 명단으로 옮긴다 (명단이 비어 있는 칸만 채운다)
update public.roster r
   set phone      = coalesce(r.phone, p.phone),
       address    = coalesce(r.address, p.address),
       birth_date = coalesce(r.birth_date, p.birth_date),
       email      = coalesce(r.email, p.email)
  from public.profiles p
 where p.roster_id = r.id;

-- 명단에 있는 기본 정보를 계정의 빈칸에도 채워 준다
-- (회원 관리의 홈페이지 회원 목록은 계정 칸을 그대로 보여 주기 때문)
update public.profiles p
   set church     = coalesce(p.church, r.church),
       position   = coalesce(p.position, r.position),
       phone      = coalesce(p.phone, r.phone),
       birth_date = coalesce(p.birth_date, r.birth_date),
       address    = coalesce(p.address, r.address)
  from public.roster r
 where p.roster_id = r.id;

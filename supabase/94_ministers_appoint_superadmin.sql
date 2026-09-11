-- =====================================================================
--  94. 교역자회 임원 임명 권한 — 시찰장에 더해 최고관리자도 (2026-09-11 사용자 지시)
--
--  93 에서는 시찰장만 교역자회 임원(회장·서기·회계)을 임명할 수 있었다.
--  최고관리자(superadmin)도 설정할 수 있게 한다. 노회장·서기·간사 등 다른 관리자는 여전히 못 한다.
--    · can_appoint_ministers(시찰) = 시찰장(is_sichal_head_strict) 또는 최고관리자
--    · set_ministers_officer 가 이 판정을 쓴다. 화면(sichal.html)도 같은 함수를 물어본다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run
--  ※ 93_ministers_officers.sql 을 먼저 실행하셔야 합니다. 여러 번 실행해도 안전합니다.
-- =====================================================================

create or replace function public.can_appoint_ministers(p_sichal text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_sichal_head_strict(p_sichal)
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin');
$fn$;
grant execute on function public.can_appoint_ministers(text) to authenticated;

create or replace function public.set_ministers_officer(p_sichal text, p_position text, p_roster_id bigint default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  r      public.roster%rowtype;
  v_uid  uuid;
  v_me   text;
  v_mail text;
  v_role text;
  v_old  text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if not public.can_appoint_ministers(p_sichal) then
    raise exception '교역자회 임원 임명은 그 시찰의 시찰장(또는 최고관리자)만 할 수 있습니다.';
  end if;
  if p_position not in ('회장', '서기', '회계') then
    raise exception '직책은 회장·서기·회계 가운데 하나여야 합니다.';
  end if;
  select name, email, role into v_me, v_mail, v_role from public.profiles where id = auth.uid();
  v_role := case when v_role = 'superadmin' then 'superadmin' else 'sichal_head' end;

  -- 해제
  if p_roster_id is null then
    select name into v_old from public.ministers_officers where sichal = p_sichal and position = p_position;
    delete from public.ministers_officers where sichal = p_sichal and position = p_position;
    insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
    values (auth.uid(), v_mail, v_me, v_role, 'update', '교역자회 임원 해제',
            p_sichal || ' ' || p_position || ' — ' || coalesce(v_old, '(없음)'));
    return;
  end if;

  select * into r from public.roster where id = p_roster_id;
  if r.id is null then raise exception '노회 명단에서 찾을 수 없습니다.'; end if;
  if r.sichal is distinct from p_sichal then
    raise exception '% 님은 % 소속이 아닙니다.', r.name, p_sichal;
  end if;
  if coalesce(r.category, '') not like '%목사%' then
    raise exception '교역자회 임원은 목사 회원만 될 수 있습니다.';
  end if;

  -- 계정 찾기: 명단 번호로 이어진 계정 → 같은 이름(같은 교회 우선)
  select p.id into v_uid from public.profiles p
   where p.roster_id = r.id and p.role not in ('pending', 'general') limit 1;
  if v_uid is null then
    select p.id into v_uid from public.profiles p
     where p.name = r.name and p.role not in ('pending', 'general')
       and (p.church is null or r.church is null or p.church = r.church)
     order by (p.church = r.church) desc nulls last
     limit 1;
  end if;

  -- 한 사람은 한 직책만
  delete from public.ministers_officers
   where sichal = p_sichal and roster_id = r.id and position <> p_position;

  insert into public.ministers_officers (sichal, position, roster_id, name, church, user_id, appointed_by)
  values (p_sichal, p_position, r.id, r.name, r.church, v_uid, v_me)
  on conflict (sichal, position) do update
    set roster_id = excluded.roster_id, name = excluded.name, church = excluded.church,
        user_id = excluded.user_id, appointed_by = excluded.appointed_by, appointed_at = now();

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  values (auth.uid(), v_mail, v_me, v_role, 'update', '교역자회 임원 임명',
          p_sichal || ' ' || p_position || ' ← ' || r.name || ' (' || coalesce(r.church, '') || ')');

  -- 본인 계정이 있으면 알린다 (알림이 안 되어도 임명은 된다)
  if v_uid is not null and v_uid <> auth.uid() then
    begin
      insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
      values (v_uid, '시찰',
              '[' || p_sichal || ' 교역자회] ' || p_position || '(으)로 임명되었습니다',
              coalesce(v_me, '시찰장') || ' 님이 ' || r.name || ' 님을 ' || p_sichal || ' 교역자회 ' || p_position ||
                '(으)로 임명했습니다. ' ||
                case when p_position = '회계' then '교역자회 회계장부와 교역자회비 납부 현황을 시찰회 화면의 회계 관리에서 적을 수 있습니다.'
                     else '교역자회 회계장부를 시찰회 화면의 회계 관리에서 볼 수 있습니다.' end,
              'minoff-' || p_sichal || '-' || p_position || '-' || r.id || '-' || to_char(now(), 'YYYYMMDDHH24MISS'),
              auth.uid(), v_me);
    exception when others then null;
    end;
  end if;
end
$fn$;
grant execute on function public.set_ministers_officer(text, text, bigint) to authenticated;

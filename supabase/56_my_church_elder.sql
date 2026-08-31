-- 56. 담임목사의 자기 교회 장로 관리 (추가·생년월일 입력)
--    실제 적용은 Supabase migration my_church_elder 로 완료. 내용 동일.
create or replace function public.upsert_my_church_elder(p_id bigint, p_name text, p_birth date)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  v_uid    uuid := auth.uid();
  v_name   text;
  v_church text;
  v_ok     boolean;
  v_id     bigint;
  v_sichal text;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  select pr.name, pr.church into v_name, v_church from public.profiles pr where pr.id = v_uid;
  if coalesce(v_church, '') = '' then raise exception '소속 교회가 없습니다.'; end if;
  select true, sc.sichal into v_ok, v_sichal
    from public.sichal_churches sc
   where sc.name = v_church
     and split_part(btrim(coalesce(sc.pastor, '')), ' ', 1) = v_name
   limit 1;
  if not coalesce(v_ok, false) and not public.can_manage() then
    raise exception '담임목사만 자기 교회의 장로를 관리할 수 있습니다.';
  end if;
  if p_id is not null then
    update public.roster r
       set birth_date = p_birth,
           name = coalesce(nullif(btrim(p_name), ''), r.name)
     where r.id = p_id and r.church = v_church and r.category = '장로'
     returning r.id into v_id;
    if v_id is null then raise exception '우리 교회 장로 명단에서 찾을 수 없습니다.'; end if;
    return v_id;
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception '장로 성명을 입력해 주세요.'; end if;
  insert into public.roster (name, church, sichal, category, position, birth_date, sort)
  values (btrim(p_name), v_church, coalesce(v_sichal, ''), '장로', '장로', p_birth,
          coalesce((select max(r2.sort) from public.roster r2 where r2.category = '장로'), 0) + 1)
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function public.upsert_my_church_elder(bigint, text, date) from public;
grant execute on function public.upsert_my_church_elder(bigint, text, date) to authenticated;

-- 104. 생년월일·정년은 관리자(can_manage: 노회장·서기·간사·최고관리자)만 열람
--     2026-09-28. Supabase MCP 로 운영 DB 에 적용 완료.
--
--  * roster.birth_date, church_staff.birth_date 열은 anon/authenticated 가 SELECT 할 수 없다
--    (열 단위 권한). 그래서 PostgREST 의 select('*') 는 이 두 표에서 더 이상 쓸 수 없고,
--    화면은 SHS.ROSTER_COLS / SHS.STAFF_COLS 로 열을 적어 읽는다.
--    새 열을 더할 때는 아래 grant 목록에도 넣어야 화면에서 읽힌다.
--  * 관리자는 roster_births() / church_staff_births() 로 (id, birth_date) 만 따로 받아 합친다.
--  * member_card 는 관리자이거나 본인일 때만 생년월일·정년일을 돌려준다.
--  * my_member(본인)는 그대로 — 내 정보에서 본인 정년은 볼 수 있다.
--  * 담임목사의 장로 생년월일 입력(upsert_my_church_elder)은 값을 비워 보내면 기존 값을 지우지 않는다.

-- 1. 열 단위 권한 ------------------------------------------------------------
revoke select on table public.roster from anon, authenticated;
grant select (id, name, church, "position", role, officer_title, created_at, category, sichal,
              note, sort, term_from, term_until, active, replaced_at, replaced_by, address,
              postcode, phone, church_addr, photo_path, email, served_from, ordained_on,
              ordained_by, licensed_on, licensed_by, retire_applied, call_on, call_until,
              call_acting, chongshin_grad, pyeonmok)
  on public.roster to anon, authenticated;

revoke select on table public.church_staff from anon, authenticated;
grant select (id, church, role, name, ordained_on, phone, is_chongdae, roster_id, note, sort,
              created_at, updated_at, updated_by, honored_on)
  on public.church_staff to anon, authenticated;

-- 2. 관리자용 생년월일 조회 ------------------------------------------------------
create or replace function public.roster_births()
returns table (id bigint, birth_date date)
language sql stable security definer set search_path = public as $fn$
  select r.id, r.birth_date from public.roster r
   where public.can_manage() and r.birth_date is not null;
$fn$;
revoke all on function public.roster_births() from public;
grant execute on function public.roster_births() to authenticated;

create or replace function public.church_staff_births()
returns table (id bigint, birth_date date)
language sql stable security definer set search_path = public as $fn$
  select s.id, s.birth_date from public.church_staff s
   where public.can_manage() and s.birth_date is not null;
$fn$;
revoke all on function public.church_staff_births() from public;
grant execute on function public.church_staff_births() to authenticated;

-- 3. member_card: 생년월일·정년일은 관리자 또는 본인만 -------------------------------
create or replace function public.member_card(p_name text, p_church text)
returns table (out_name text, out_church text, out_position text, out_category text,
               out_sichal text, out_officer_title text, out_church_addr text, out_address text,
               out_postcode text, out_phone text, out_birth_date date, out_retire_date date,
               out_photo_path text, out_has_account boolean, out_served_from date,
               out_call_on date, out_call_until date, out_call_acting text, out_role text,
               out_chongshin_grad boolean, out_pyeonmok boolean, out_church_joined_on date)
language sql stable security definer set search_path = public as $fn$
  select r.name, r.church, r.position, r.category,
         r.sichal, r.officer_title,
         r.church_addr, r.address, r.postcode,
         r.phone,
         case when public.can_manage()
                or exists (select 1 from public.profiles p
                            where p.id = auth.uid() and p.roster_id = r.id)
              then r.birth_date end,
         case when public.can_manage()
                or exists (select 1 from public.profiles p
                            where p.id = auth.uid() and p.roster_id = r.id)
              then public.retire_date(r.birth_date) end,
         r.photo_path,
         exists (select 1 from public.profiles p where p.roster_id = r.id),
         r.served_from,
         r.call_on, r.call_until, r.call_acting,
         r.role, r.chongshin_grad, r.pyeonmok,
         public.church_joined_on(r.church)
    from public.roster r
   where public.is_member()
     and regexp_replace(coalesce(r.name, ''), '\s', '', 'g')
         = regexp_replace(coalesce(p_name, ''), '\s', '', 'g')
     and (
       coalesce(p_church, '') = ''
       or regexp_replace(regexp_replace(coalesce(r.church, ''), '\s', '', 'g'), '교회$', '')
          = regexp_replace(regexp_replace(p_church, '\s', '', 'g'), '교회$', '')
     )
   order by r.id
   limit 1;
$fn$;

-- 4. 담임목사의 장로 생년월일 입력: 빈 값은 기존 값을 지우지 않는다 ------------------------
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
       set birth_date = coalesce(p_birth, r.birth_date),
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

-- =====================================================================
--  152. 수양회 — 사모님·권사님이 홈페이지에 가입해 바로 수양회 화면으로 (2026-11-01)
--
--  문제: · 가입 화면 직분에 사모·권사·집사가 없었다 (signup.html 에서 더한다).
--        · 가입한 사모님을 명단 줄에 잇는 길(142)은 명단 직분이 「사모·배우자」이고 임원이 생년월일을
--          적어 둔 줄만 찾았다. 명단의 사모님 생년월일은 아직 비어 있고, 권사·집사 줄은 아예 빠졌다.
--  해결: · 배우자 줄 = 남편에게 묶인 줄(companion_of) 이거나 직분이 사모·권사·집사·배우자인 줄.
--        · 가입한 분의 이름이 배우자 줄과 같고,
--            - 임원이 그 줄에 생년월일을 적어 두었으면 → 가입 때 적은 생년월일이 같을 때,
--            - 적어 두지 않았으면 → 가입 때 고른 교회가 남편(또는 그 줄)의 교회와 같을 때 («교회» 글자·빈칸·
--              「· 직책」 꼬리는 빼고 견준다)
--          그 줄로 알아본다. 처음 수양회 화면을 열면 retreat_link_me 가 계정을 그 줄에 잇고
--          승인대기 계정을 일반회원으로 바꾼다(142 그대로, 배우자 줄 판정만 넓힘).
--        · 회원(목사·장로) 줄은 142 그대로 — 정회원이고 이름이 같아야 한다.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--  ※ 151 sql 이후에 실행.
-- =====================================================================


-- 1. 도우미 -------------------------------------------------------------------
-- 교회 이름 견주기 열쇠: 「· 교육부장」 같은 꼬리, 빈칸, 끝의 「교회」를 뺀다
create or replace function public.retreat_church_key(p text)
returns text language sql immutable set search_path = public as $fn$
  select regexp_replace(regexp_replace(split_part(coalesce(p, ''), '·', 1), '\s', '', 'g'), '교회$', '')
$fn$;

-- 배우자 줄인가
create or replace function public.retreat_is_spouse_row(p_participant bigint)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.retreat_participants p
                  where p.id = p_participant
                    and (p.companion_of is not null or p.role in ('사모', '배우자', '권사', '집사')))
$fn$;

-- 가입한 분의 이름·교회 (프로필, 없으면 가입 때 적은 정보 — retreat_my_birth 와 같은 방식)
create or replace function public.retreat_my_signup(p_key text)
returns text language plpgsql stable security definer set search_path = public as $fn$
declare
  v text;
begin
  if auth.uid() is null then return null; end if;
  select case p_key when 'name' then pr.name when 'church' then pr.church end into v
    from public.profiles pr where pr.id = auth.uid();
  if coalesce(btrim(v), '') <> '' then return btrim(v); end if;
  select btrim(u.raw_user_meta_data->>p_key) into v from auth.users u where u.id = auth.uid();
  return nullif(v, '');
end
$fn$;


-- 2. 나는 명단의 어느 줄인가 (142 를 넓힘) ----------------------------------------------
create or replace function public.retreat_my_participant(p_retreat bigint)
returns bigint language sql stable security definer set search_path = public as $fn$
  select p.id
    from public.retreat_participants p
   where p.retreat_id = p_retreat
     and (p.user_id = auth.uid()
       /* 회원(목사·장로) 줄 — 정회원이고 이름이 같으면 (142 그대로) */
       or (p.companion_of is null and p.role not in ('사모', '배우자', '권사', '집사') and public.is_member()
           and exists (select 1 from public.profiles pr
                        where pr.id = auth.uid() and pr.name is not null and pr.name = p.name))
       /* 배우자 줄 — 이름이 같고, 생년월일(임원이 적었으면) 또는 교회(적지 않았으면)가 맞으면 */
       or (p.user_id is null
           and (p.companion_of is not null or p.role in ('사모', '배우자', '권사', '집사'))
           and public.retreat_my_signup('name') = p.name
           and (exists (select 1 from public.retreat_births b
                         where b.participant_id = p.id and b.birth_date = public.retreat_my_birth())
                or (not exists (select 1 from public.retreat_births b where b.participant_id = p.id)
                    and public.retreat_church_key(public.retreat_my_signup('church')) <> ''
                    and public.retreat_church_key(public.retreat_my_signup('church')) in (
                          public.retreat_church_key(p.church),
                          public.retreat_church_key((select h.church from public.retreat_participants h
                                                      where h.id = p.companion_of)))))))
   order by (p.user_id = auth.uid()) desc nulls last, p.id
   limit 1
$fn$;


-- 3. 처음 들어온 날 명단 줄에 잇기 (142 그대로, 배우자 줄 판정만 바꿈) --------------------------
create or replace function public.retreat_link_me(p_retreat bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  r      public.retreats%rowtype;
  p      public.retreat_participants%rowtype;
  v_me   bigint;
  v_gen  boolean := false;
begin
  if auth.uid() is null then return null; end if;
  r := public.retreat_pick(p_retreat);
  if r.id is null then return null; end if;
  v_me := public.retreat_my_participant(r.id);
  if v_me is null then return jsonb_build_object('linked', false); end if;

  select * into p from public.retreat_participants where id = v_me;
  if p.user_id is not null then
    return jsonb_build_object('linked', p.user_id = auth.uid(), 'participant', p.id);
  end if;
  /* 이 계정이 이미 다른 줄에 이어져 있으면 두 번 잇지 않는다 */
  if exists (select 1 from public.retreat_participants x where x.retreat_id = r.id and x.user_id = auth.uid()) then
    return jsonb_build_object('linked', false);
  end if;

  update public.retreat_participants set user_id = auth.uid(), updated_at = now()
   where id = p.id and user_id is null;

  if public.retreat_is_spouse_row(p.id) then   -- 사모·권사·집사·배우자 또는 남편에게 묶인 줄 (152)
    update public.profiles set role = 'general' where id = auth.uid() and role = 'pending';
    v_gen := found;
  end if;

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select auth.uid(), pr.email, pr.name, pr.role, 'update', '수양회 참가자 연결',
         r.title || ' / ' || p.seq || '. ' || p.name || ' ' || p.role ||
         case when v_gen then ' · 승인대기 → 일반회원' else '' end
    from public.profiles pr where pr.id = auth.uid();

  return jsonb_build_object('linked', true, 'participant', p.id, 'general', v_gen);
end
$fn$;


-- 확인: 배우자 줄과 그 줄을 찾을 교회 열쇠 (사모님이 가입할 때 고를 교회)
select p.seq as "번호", p.name as "성명", p.role as "직분",
       coalesce(nullif(public.retreat_church_key(p.church), ''),
                public.retreat_church_key((select h.church from public.retreat_participants h where h.id = p.companion_of))) as "가입 때 고를 교회",
       exists (select 1 from public.retreat_births b where b.participant_id = p.id) as "생년월일 적힘",
       p.user_id is not null as "연결됨"
  from public.retreat_participants p
  join public.retreats r on r.id = p.retreat_id and r.title = '2026 제주 부부수양회'
 where public.retreat_is_spouse_row(p.id)
 order by p.seq;

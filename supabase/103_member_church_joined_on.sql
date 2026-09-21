-- 103. 회원 정보에 소속 교회의 노회 가입일을 함께 돌려줍니다
--
--  교회 명부(sichal_churches)와 노회 명단(roster)은 소속 교회 이름으로 이어집니다.
--  회원의 노회 살림은 그 교회가 노회에 들어온 날부터 시작되므로,
--  내 정보와 회원 정보 카드, 명단의 정보 보기에 교회의 가입일을 함께 보여 줍니다.
--
--  교회 이름은 띄어쓰기와 끝의 '교회'가 달리 적히는 일이 있어,
--  회원 카드에서 쓰던 방식 그대로 다듬어 맞춥니다.
--  (지금 명단의 목사 34분이 모두 교회 명부와 이어집니다)
--
--  ※ 실제 적용은 Supabase migration member_church_joined_on 으로 완료했습니다.
--     여러 번 실행해도 안전합니다.
-- =====================================================================

create or replace function public.church_joined_on(p_church text)
returns date
language sql stable security definer set search_path = public
as $$
  select sc.joined_on
    from public.sichal_churches sc
   where coalesce(p_church, '') <> ''
     and regexp_replace(regexp_replace(coalesce(sc.name, ''), '\s', '', 'g'), '교회$', '')
         = regexp_replace(regexp_replace(p_church, '\s', '', 'g'), '교회$', '')
   order by sc.id
   limit 1;
$$;

comment on function public.church_joined_on(text) is
  '교회 이름으로 그 교회의 노회 가입일을 찾는다 (띄어쓰기·끝의 ''교회''는 견주지 않는다)';


-- ---------------------------------------------------------------------
-- 내 정보
-- ---------------------------------------------------------------------
drop function if exists public.my_member();
create function public.my_member()
returns table(
  out_id bigint, out_name text, out_church text, out_position text,
  out_category text, out_sichal text, out_officer_title text, out_role text,
  out_church_addr text, out_address text, out_postcode text, out_phone text,
  out_birth_date date, out_retire_date date, out_photo_path text,
  out_email text, out_served_from date,
  out_call_on date, out_call_until date, out_call_acting text,
  out_chongshin_grad boolean, out_pyeonmok boolean,
  out_church_joined_on date
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select r.id, r.name, r.church, r.position, r.category,
         r.sichal, r.officer_title, r.role,
         r.church_addr, r.address, r.postcode,
         r.phone, r.birth_date, public.retire_date(r.birth_date),
         r.photo_path, r.email, r.served_from,
         r.call_on, r.call_until, r.call_acting,
         r.chongshin_grad, r.pyeonmok,
         public.church_joined_on(r.church)
    from public.profiles p
    join public.roster r on r.id = p.roster_id
   where p.id = auth.uid();
$function$;

grant execute on function public.my_member() to anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- 회원 정보 카드
-- ---------------------------------------------------------------------
drop function if exists public.member_card(text, text);
create function public.member_card(p_name text, p_church text)
returns table(
  out_name text, out_church text, out_position text, out_category text,
  out_sichal text, out_officer_title text, out_church_addr text,
  out_address text, out_postcode text, out_phone text,
  out_birth_date date, out_retire_date date, out_photo_path text,
  out_has_account boolean, out_served_from date,
  out_call_on date, out_call_until date, out_call_acting text,
  out_role text, out_chongshin_grad boolean, out_pyeonmok boolean,
  out_church_joined_on date
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select r.name, r.church, r.position, r.category,
         r.sichal, r.officer_title,
         r.church_addr, r.address, r.postcode,
         r.phone, r.birth_date, public.retire_date(r.birth_date),
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
$function$;

grant execute on function public.member_card(text, text) to anon, authenticated, service_role;

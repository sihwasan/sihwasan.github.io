-- 100. 준회원 등급
--
--  회원 등급에 <준회원>(role = 'associate')을 더합니다.
--   · 정년이 지난 분,
--   · 총신대학교 신학대학원을 졸업하지 않고 편목 과정도 이수하지 않은 분
--  을 노회가 준회원으로 둡니다. 준회원은 회의에서 언권만 가지므로
--  상비부에 배정하지 않고, 총회 총대·노회 임원으로 세우지 않습니다.
--
--  등급을 주고 거두는 일은 관리자(최고관리자·노회장·서기·간사)만 할 수 있습니다.
--  명단(roster)과 회원(profiles) 모두 can_manage 만 쓸 수 있으므로 따로 문을
--  달지 않습니다. 학력 두 칸은 판단의 근거로 적어 둘 뿐, 저절로 등급을
--  바꾸지는 않습니다.
--
--  준회원도 노회 회원이므로 정회원 자료는 볼 수 있습니다(is_member).
--  다만 서류 발급·청원서·교회상황 보고서는 언권회원과 같이 할 수 없습니다
--  (102 에서 is_full_member 에 함께 넣었습니다).
--
--  ※ 실제 적용은 Supabase migration associate_member_grade 로 완료했습니다.
--     여러 번 실행해도 안전합니다.
-- =====================================================================

alter table public.roster add column if not exists chongshin_grad boolean;
alter table public.roster add column if not exists pyeonmok       boolean;

comment on column public.roster.chongshin_grad is '총신대학교 신학대학원 졸업 여부 (비어 있으면 확인 안 됨)';
comment on column public.roster.pyeonmok       is '편목 과정 이수 여부 (비어 있으면 확인 안 됨)';

-- 지금 로그인한 사람이 준회원인가
create or replace function public.is_associate()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'associate');
$$;

comment on function public.is_associate() is
  '준회원 — 회의에서 언권만 가진다. 상비부·총대·임원에 세우지 않는다';


-- ---------------------------------------------------------------------
-- 내 정보 : 학력 기록을 함께 돌려줍니다
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
  out_chongshin_grad boolean, out_pyeonmok boolean
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
         r.chongshin_grad, r.pyeonmok
    from public.profiles p
    join public.roster r on r.id = p.roster_id
   where p.id = auth.uid();
$function$;

grant execute on function public.my_member() to anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- 회원 정보 카드 : 등급과 학력 기록을 함께 돌려줍니다
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
  out_role text, out_chongshin_grad boolean, out_pyeonmok boolean
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
         r.role, r.chongshin_grad, r.pyeonmok
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

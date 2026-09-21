-- 98. 시무목사 청빙청원 (3년 임기)
--
--  당회가 없는 교회 — 곧 시무장로가 없어 당회를 이루지 못한 교회의 담임은
--  위임목사가 아니라 시무목사입니다. 시무목사는 노회의 허락을 받아 3년씩
--  시무하고, 3년이 지나기 전에 다시 시무목사 청빙청원을 해야 합니다.
--  위임목사는 임기가 없으므로 이 셈에 들지 않습니다.
--
--  명단(roster)에 세 칸을 더합니다.
--    call_on     노회가 시무목사 청빙을 허락한 날
--    call_until  시무가 끝나는 날 (비워 두면 허락일 + 3년으로 저절로 채워집니다)
--    call_acting 임시당회장 (당회가 없으므로 노회가 세워 줍니다)
--
--  내 정보(my_member)와 회원 정보 카드(member_card)가 이 세 칸을 함께
--  돌려주어, 홈페이지에서 허락일·만료일·남은 임기를 보여 줍니다.
--
--  ※ 실제 적용은 Supabase migration simu_pastor_call_term 으로 완료했습니다.
--     여러 번 실행해도 안전합니다.
-- =====================================================================

alter table public.roster add column if not exists call_on     date;
alter table public.roster add column if not exists call_until  date;
alter table public.roster add column if not exists call_acting text;

comment on column public.roster.call_on     is '시무목사 청빙청원을 노회가 허락한 날';
comment on column public.roster.call_until  is '시무 만료일 (기본 = 허락일 + 3년). 이 날 전에 다시 청원해야 한다';
comment on column public.roster.call_acting is '임시당회장';

-- 만료일을 비워 두면 허락일부터 3년 뒤로 채웁니다.
-- 노회가 기간을 달리 정한 때에는 서기가 직접 적어 넣을 수 있습니다.
create or replace function public.roster_call_term()
returns trigger
language plpgsql
as $$
begin
  if new.call_on is null then
    new.call_until := null;
  elsif new.call_until is null then
    new.call_until := (new.call_on + interval '3 years')::date;
  end if;
  return new;
end;
$$;

drop trigger if exists roster_call_term_trg on public.roster;
create trigger roster_call_term_trg
  before insert or update on public.roster
  for each row execute function public.roster_call_term();


-- ---------------------------------------------------------------------
-- 내 정보 : 시무목사 청빙 기록을 함께 돌려줍니다
-- ---------------------------------------------------------------------
drop function if exists public.my_member();
create function public.my_member()
returns table(
  out_id bigint, out_name text, out_church text, out_position text,
  out_category text, out_sichal text, out_officer_title text, out_role text,
  out_church_addr text, out_address text, out_postcode text, out_phone text,
  out_birth_date date, out_retire_date date, out_photo_path text,
  out_email text, out_served_from date,
  out_call_on date, out_call_until date, out_call_acting text
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
         r.call_on, r.call_until, r.call_acting
    from public.profiles p
    join public.roster r on r.id = p.roster_id
   where p.id = auth.uid();
$function$;

grant execute on function public.my_member() to anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- 회원 정보 카드 : 시무목사 청빙 기록을 함께 돌려줍니다
-- ---------------------------------------------------------------------
drop function if exists public.member_card(text, text);
create function public.member_card(p_name text, p_church text)
returns table(
  out_name text, out_church text, out_position text, out_category text,
  out_sichal text, out_officer_title text, out_church_addr text,
  out_address text, out_postcode text, out_phone text,
  out_birth_date date, out_retire_date date, out_photo_path text,
  out_has_account boolean, out_served_from date,
  out_call_on date, out_call_until date, out_call_acting text
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
         r.call_on, r.call_until, r.call_acting
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


-- ---------------------------------------------------------------------
-- 지금까지 허락받은 시무목사 청빙 기록
--   2023-09-05 / 2024-03-12 / 2024-09-05 / 2024-09-20 / 2025-04-21 노회
--   만료일은 위 트리거가 허락일 + 3년으로 채웁니다.
-- ---------------------------------------------------------------------
with given(cname, pname, con, acting) as (
  values
    ('예전교회',       '제갈광철', date '2023-09-05', null),   -- 2026-09-05 만료
    ('율리교회',       '박현정', date '2024-03-12', '강명우'),
    ('아름다운숲교회', '장정훈', date '2024-03-12', '강명우'),
    ('새누리교회',     '문광선', date '2024-09-20', '박재완'),
    ('새생명교회',     '이성대', date '2024-09-20', '이재용'),
    ('참된빛교회',     '안상천', date '2024-09-20', '박흥열'),
    ('시흥은혜교회',   '김운갑', date '2024-09-20', '박흥열'),
    ('나눔의교회',     '김선민', date '2024-09-05', '강명우'),
    ('동탄인랜드교회', '전종호', date '2024-09-05', '강명우'),
    ('주품에교회',     '유성준', date '2024-09-05', '강명우'),
    ('행복한교회',     '명영석', date '2024-09-05', '강명우'),
    ('동탄영광교회',   '이동진', date '2024-09-05', '강명우'),
    ('서신영광교회',   '주강완', date '2025-04-21', null),
    ('주말씀교회',     '정주원', date '2025-04-21', null),
    ('안산샬롬교회',   '송요한', date '2025-04-21', null)   -- 2026-04-25 위임목사로 위임
)
update public.roster r
   set call_on = g.con, call_until = null, call_acting = g.acting
  from given g
 where r.church = g.cname and r.name = g.pname;

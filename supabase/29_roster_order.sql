-- =====================================================================
--  29. 명단 순서 자동 배치
--
--  회원을 새로 넣거나 직위가 바뀌면, 그 직위 무리의 맨 뒤에 자동으로
--  들어갑니다. 명단 전체의 맨 뒤로 밀려나지 않습니다.
--
--  직위 순서
--    1. 위임목사      (조직교회 담임)
--    2. 시무목사      (미조직교회 담임)
--    3. 부목사
--    4. 원로목사
--    5. 은퇴목사
--    6. 무임목사
--    7. 장로
--
--  같은 직위 안에서는 지금까지의 명단 순서를 그대로 지킵니다.
--  (노회 회의자료의 명단 순서를 흐트러뜨리지 않기 위함입니다)
--
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 직위 순위
-- ---------------------------------------------------------------------
create or replace function public.roster_rank(p_category text, p_position text)
returns integer language sql immutable as $fn$
  select case
    when p_category = '장로'     then 7
    when p_category = '무임목사' then 6
    when p_category = '은퇴목사' then 5
    when p_category = '원로목사' then 4
    when p_category = '부목사'   then 3
    when p_category = '목사' and coalesce(p_position, '') = '위임목사' then 1
    when p_category = '목사'     then 2
    else 9
  end;
$fn$;


-- ---------------------------------------------------------------------
-- 2. 자동 배치
--    새로 넣거나 직위가 바뀌면 그 무리의 맨 뒤로 보낸다.
--    직위가 그대로면 순서를 건드리지 않는다.
-- ---------------------------------------------------------------------
create or replace function public.roster_place()
returns trigger language plpgsql set search_path = public as $fn$
declare
  v_rank integer := public.roster_rank(new.category, new.position);
  v_max  numeric;
begin
  if tg_op = 'UPDATE'
     and public.roster_rank(old.category, old.position) = v_rank
     and new.sort is not distinct from old.sort then
    return new;                      -- 직위가 그대로면 순서를 그대로 둔다
  end if;

  select max(r.sort) into v_max
    from public.roster r
   where public.roster_rank(r.category, r.position) = v_rank
     and (tg_op = 'INSERT' or r.id <> new.id);

  new.sort := coalesce(v_max, v_rank * 1000) + 5;
  return new;
end;
$fn$;

drop trigger if exists roster_place_trg on public.roster;
create trigger roster_place_trg
  before insert or update of category, position on public.roster
  for each row execute function public.roster_place();


-- ---------------------------------------------------------------------
-- 3. 전체 다시 정렬
--    직위 순서로 무리를 나누되, 무리 안에서는 지금 순서를 그대로 지킨다.
-- ---------------------------------------------------------------------
create or replace function public.reorder_roster()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_n integer := 0;
begin
  if not public.can_manage() then
    raise exception '명단 순서 정리는 관리자(노회장·서기·간사)만 할 수 있습니다.';
  end if;

  with ordered as (
    select r.id,
           row_number() over (
             order by public.roster_rank(r.category, r.position),
                      r.sort,
                      r.id
           ) * 10 as new_sort
      from public.roster r
     where coalesce(r.active, true)
  )
  update public.roster r
     set sort = o.new_sort
    from ordered o
   where r.id = o.id
     and r.sort is distinct from o.new_sort;

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.reorder_roster() from public;
grant execute on function public.reorder_roster() to authenticated;

comment on function public.reorder_roster() is
  '명단을 직위 순서로 나누되, 같은 직위 안에서는 지금 순서를 그대로 지킨다.';


-- ---------------------------------------------------------------------
-- 4. 시무 교회가 없는 분들의 교회 칸을 상태로 채운다
-- ---------------------------------------------------------------------
update public.roster
   set church = case category
                  when '무임목사' then '무임'
                  when '은퇴목사' then '은퇴'
                  when '원로목사' then '원로'
                end
 where category in ('무임목사', '은퇴목사', '원로목사')
   and coalesce(btrim(church), '') = '';


-- ---------------------------------------------------------------------
-- 5. 지금 명단을 한 번 정렬해 둔다
-- ---------------------------------------------------------------------
with ordered as (
  select r.id,
         row_number() over (
           order by public.roster_rank(r.category, r.position), r.sort, r.id
         ) * 10 as new_sort
    from public.roster r
   where coalesce(r.active, true)
)
update public.roster r
   set sort = o.new_sort
  from ordered o
 where r.id = o.id;


select public.roster_rank(category, position) as "순위",
       category as "분류", coalesce(position, '') as "직분", count(*) as "인원",
       min(sort) as "첫 순서", max(sort) as "끝 순서"
  from public.roster
 where coalesce(active, true)
 group by 1, 2, 3
 order by 1, 2;

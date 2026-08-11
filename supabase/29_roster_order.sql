-- =====================================================================
--  29. 명단 순서 정리
--
--  회원을 새로 넣으면 맨 뒤에 붙어, 직위 순서가 흐트러집니다.
--  아래 순서대로 다시 정렬합니다.
--
--    1. 위임목사      (조직교회 담임)
--    2. 시무목사      (미조직교회 담임)
--    3. 부목사
--    4. 원로목사
--    5. 은퇴목사
--    6. 무임목사
--    7. 장로
--
--  같은 직위 안에서는 시찰 → 교회 → 성명 순으로 정렬합니다.
--
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

create or replace function public.roster_rank(p_category text, p_position text)
returns integer language sql immutable as $fn$
  select case
    when p_category = '장로'     then 70
    when p_category = '무임목사' then 60
    when p_category = '은퇴목사' then 50
    when p_category = '원로목사' then 40
    when p_category = '부목사'   then 30
    when p_category = '목사' and coalesce(p_position, '') = '위임목사' then 10
    when p_category = '목사'     then 20
    else 90
  end;
$fn$;

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
                      coalesce(r.sichal, 'ㅎ'),
                      r.church,
                      r.name
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
  '명단을 위임목사·시무목사·부목사·원로목사·은퇴목사·무임목사·장로 순으로 다시 정렬한다.';


-- ---------------------------------------------------------------------
-- 시무 교회가 없는 분들의 교회 칸을 상태로 채운다
--   (교회 칸은 비워 둘 수 없으므로 '무임'·'은퇴'·'원로'로 적어 둔다)
-- ---------------------------------------------------------------------
update public.roster
   set church = case category
                  when '무임목사' then '무임'
                  when '은퇴목사' then '은퇴'
                  when '원로목사' then '원로'
                end
 where category in ('무임목사', '은퇴목사', '원로목사')
   and coalesce(btrim(church), '') = '';


select public.roster_rank(category, position) as "순위",
       category as "분류", position as "직분", count(*) as "인원"
  from public.roster
 where coalesce(active, true)
 group by 1, 2, 3
 order by 1, 2;

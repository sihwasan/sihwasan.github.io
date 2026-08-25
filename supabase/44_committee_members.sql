-- =====================================================================
--  44. 위원회는 년조 없이 위원 명단으로
--
--  상비부는 임기가 3년이고 해마다 3분의 1씩 개선하므로 1·2·3년조로
--  나누어 적습니다. (노회규칙 제11조)
--  그러나 위원회는 그렇게 나누지 않고 위원들로만 구성됩니다.
--    예) 미래교회자립위원회 — 위원장·서기·회계와 위원 명단
--
--  그래서 committees 에 <위원> 칸(members)을 따로 둡니다.
--    · 상비부   : y1 · y2 · y3 (1·2·3년조)  — 그대로
--    · 위원회   : members (위원)            — 새로 둠
--
--  이름이 위원 명단에 있으면 그 위원회가 <내 상비부>로 잡히고,
--  그 위원회의 일정 알림도 받습니다. 맡은 것은 <위원>으로 나옵니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 위원 칸
-- ---------------------------------------------------------------------
alter table public.committees add column if not exists members text;

-- 위원회에 년조로 적혀 있던 이름이 있으면 위원 명단으로 옮긴다.
-- (한 번 옮긴 뒤에는 년조가 비므로 다시 실행해도 그대로다)
update public.committees c
   set members = concat_ws(', ',
         nullif(btrim(coalesce(c.members, '')), ''),
         nullif(btrim(coalesce(c.y1, '')), ''),
         nullif(btrim(coalesce(c.y2, '')), ''),
         nullif(btrim(coalesce(c.y3, '')), '')),
       y1 = '', y2 = '', y3 = ''
 where c.name like '%위원회'
   and btrim(concat_ws('', coalesce(c.y1, ''), coalesce(c.y2, ''), coalesce(c.y3, ''))) <> '';


-- ---------------------------------------------------------------------
-- 2. 내가 속한 상비부 — 위원 명단도 함께 본다
-- ---------------------------------------------------------------------
drop function if exists public.my_committees();

create function public.my_committees()
returns table (committee text, duty_name text, is_officer boolean)
language sql stable security definer set search_path = public as $fn$
  with me as (
    select p.name from public.profiles p where p.id = auth.uid()
  ),
  raw (committee, duty_name, is_officer) as (
    -- 1) 따로 지정해 둔 임원
    select o.committee, o.position as duty_name, true as is_officer
      from public.committee_officers o
     where o.user_id = auth.uid()

    union all

    -- 2) 명부에 적힌 부장(위원장)·서기·회계
    select c.name,
           case
             when split_part(btrim(coalesce(c.head, '')), ' ', 1) = me.name
               then case when c.name like '%위원회' then '위원장' else '부장' end
             when split_part(btrim(coalesce(c.clerk, '')), ' ', 1) = me.name then '서기'
             else '회계'
           end,
           true
      from public.committees c, me
     where me.name is not null
       and (split_part(btrim(coalesce(c.head, '')),      ' ', 1) = me.name
         or split_part(btrim(coalesce(c.clerk, '')),     ' ', 1) = me.name
         or split_part(btrim(coalesce(c.treasurer, '')), ' ', 1) = me.name)

    union all

    -- 3) 상비부 1·2·3년조, 위원회 위원 명단
    select c.name, t.label, false
      from public.committees c, me,
           lateral (values (c.y1, '1년조'), (c.y2, '2년조'), (c.y3, '3년조'),
                           (c.members, '위원')) as t(names, label)
     where me.name is not null
       and public.name_in_list(t.names, me.name)
  )
  -- 한 부서에서 임원이면서 부원인 경우 임원 쪽 이름을 앞세운다
  select raw.committee,
         coalesce(max(raw.duty_name) filter (where raw.is_officer),
                  max(raw.duty_name)) as duty_name,
         bool_or(raw.is_officer) as is_officer
    from raw
   group by raw.committee;
$fn$;

grant execute on function public.my_committees() to authenticated;


-- ---------------------------------------------------------------------
-- 3. 부서 알림 — 위원에게도 간다
--    20_committees.sql 의 notify_committee 를 위원 명단까지 보도록 고친다.
--    (달라진 곳은 이름 목록을 만드는 줄 하나뿐이다)
-- ---------------------------------------------------------------------
create or replace function public.notify_committee(p_event bigint)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  ev   public.committee_events%rowtype;
  com  public.committees%rowtype;
  v_n  integer := 0;
  v_names text[];
begin
  select * into ev from public.committee_events where id = p_event;
  if ev.id is null then raise exception '알릴 내용을 찾을 수 없습니다.'; end if;
  if not public.is_committee_officer(ev.committee) then
    raise exception '이 부서의 임원만 알림을 보낼 수 있습니다.';
  end if;

  select * into com from public.committees where name = ev.committee;

  -- 1·2·3년조와 위원 명단, 그리고 임원을 쉼표로 나누어 이름 목록을 만든다
  select array_agg(btrim(x)) into v_names
    from unnest(string_to_array(
           concat_ws(',', com.y1, com.y2, com.y3, com.members,
                          com.head, com.clerk, com.treasurer), ',')) x
   where btrim(x) <> '';

  insert into public.notifications (user_id, kind, title, body, dedupe_key)
  select p.id, '상비부',
         '[' || ev.committee || '] ' || ev.title,
         coalesce(ev.body, '') ||
         case when ev.event_date is not null
              then chr(10) || '일시 : ' || to_char(ev.event_date, 'FMYYYY년 FMMM월 FMDD일')
                   || coalesce(' · ' || ev.place, '')
              else '' end,
         'com-ev-' || ev.id
    from public.profiles p
   where p.name is not null
     and p.name = any(v_names)
     and not exists (
           select 1 from public.notifications n
            where n.user_id = p.id and n.dedupe_key = 'com-ev-' || ev.id
         );
  get diagnostics v_n = row_count;

  update public.committee_events set notify = true, updated_at = now() where id = p_event;
  return v_n;
end;
$fn$;

revoke all on function public.notify_committee(bigint) from public;
grant execute on function public.notify_committee(bigint) to authenticated;


-- 확인
select c.name as "부서",
       case when c.name like '%위원회' then '위원회' else '상비부' end as "갈래",
       coalesce(nullif(c.members, ''), '-') as "위원",
       coalesce(nullif(concat_ws(' / ', nullif(c.y1,''), nullif(c.y2,''), nullif(c.y3,'')), ''), '-') as "1·2·3년조"
  from public.committees c
 order by c.sort;

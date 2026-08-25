-- =====================================================================
--  42. 상비부 명단(1·2·3년조)과 회원을 잇는다
--
--  그동안 '내 상비부'는 부장·서기·회계만 알아보았습니다.
--  1·2·3년조 명단에 이름이 있어도 자기 부서로 잡히지 않아,
--  상단 <내 상비부> 메뉴에도 <상비부 대시보드>에도 나오지 않았습니다.
--    예) 김동석 목사 — 교육친교부 2년조인데 나오지 않음
--
--  이제 명단에 이름이 있으면 그 부서가 내 부서로 잡힙니다.
--
--  다만 <부원>과 <임원>은 구분합니다.
--    · 임원(부장·서기·회계) → 일정·공지·회의록·회계 장부를 쓸 수 있다
--    · 부원(1·2·3년조)      → 자기 부서 화면을 볼 수 있다 (쓰기는 못 한다)
--  그래서 돌려주는 값에 is_officer 를 함께 담습니다.
--  쓰기 권한을 정하는 is_committee_officer() 는 손대지 않았으므로,
--  부원이 남의 자료를 고치는 일은 생기지 않습니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 이름 하나가 쉼표 명단 안에 있는가
--   명단은 '강명우, 이동진, 장경환' 처럼 적혀 있다.
-- ---------------------------------------------------------------------
create or replace function public.name_in_list(p_list text, p_name text)
returns boolean language sql immutable set search_path = public as $fn$
  select coalesce(p_name, '') <> ''
     and exists (
           select 1 from unnest(string_to_array(coalesce(p_list, ''), ',')) x
            where btrim(x) = btrim(p_name)
         );
$fn$;

grant execute on function public.name_in_list(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 내가 속한 상비부
--   committee   부서 이름
--   duty_name   그 부서에서 맡은 것 (부장·위원장 / 서기 / 회계 / N년조)
--   is_officer  임원인가 (참이면 그 부서의 자료를 쓸 수 있다)
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

    -- 3) 1·2·3년조 명단에 이름이 있는 부원
    select c.name, t.label, false
      from public.committees c, me,
           lateral (values (c.y1, '1년조'), (c.y2, '2년조'), (c.y3, '3년조')) as t(names, label)
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
-- 확인 — 명단에 이름이 있는 회원이 몇 분이나 이어졌는지
-- ---------------------------------------------------------------------
select c.name as "상비부",
       coalesce(c.head, '-')  as "부장·위원장",
       coalesce(c.clerk, '-') as "서기",
       (select count(*) from public.profiles p
         where p.name is not null
           and (public.name_in_list(c.y1, p.name)
             or public.name_in_list(c.y2, p.name)
             or public.name_in_list(c.y3, p.name))) as "이어진 부원(가입 회원 중)"
  from public.committees c
 order by c.sort;

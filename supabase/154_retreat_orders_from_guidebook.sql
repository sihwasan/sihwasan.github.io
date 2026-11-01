-- =====================================================================
--  154. 가이드북(이동진 목사님 앱)에 기록된 식사·카페 주문을 홈페이지 주문으로 옮기기 (2026-11-01)
--
--  가이드북은 참가자 주문을 총무가 문자로 받아 적는 방식이었다. 거기 적힌 주문을 홈페이지
--  「내 안내」 주문(retreat_choices)으로 옮긴다. 홈페이지에서 이미 고른 분은 덮어쓰지 않는다.
--  메뉴는 가이드북 메뉴판의 같은 줄(retreat_options seq)로 맞춘다. 가이드북 11/1 최신본 기준 2건.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.  ※ 151·153 이후.
-- =====================================================================

with g (step_key, name, seq, opt_seq, variant, menu) as (values
    ('cafe3', '이동진', 29, '15', '차갑게 (ICE)', '말차라떼 ICE 9,000'),
    ('meal1', '이동진', 29, '1', null, '고사리육내탕(얼큰)')
),
m as (
  select s.id as step_id, p.id as pid, o.id as opt_id, o.label, g.variant, g.name, g.menu
    from g
    join public.retreats r on r.title = '2026 제주 부부수양회'
    join public.retreat_steps s on s.retreat_id = r.id and s.key = g.step_key
    join public.retreat_options o on o.step_id = s.id and o.seq = g.opt_seq::int and o.enabled
    join public.retreat_participants p on p.retreat_id = r.id and p.name = g.name
   where p.seq = g.seq
      or (select count(*) from public.retreat_participants x where x.retreat_id = r.id and x.name = g.name) = 1
),
ins as (
  insert into public.retreat_choices (step_id, participant_id, option_id, option_label, variant, note, chosen_by)
  select step_id, pid, opt_id, label, variant, null, null from m   -- 요청(메모)은 비운다 (주문서 「요청」에 섞이지 않게)
  on conflict (step_id, participant_id) do nothing
  returning participant_id, step_id
)
select g.step_key as "단계", g.name as "이름", g.menu as "가이드북 메뉴",
       case when exists (select 1 from m join ins on ins.participant_id = m.pid and ins.step_id = m.step_id where m.name = g.name and m.menu = g.menu) then '옮김'
            when exists (select 1 from m where m.name = g.name and m.menu = g.menu) then '이미 홈페이지에서 고름(그대로 둠)'
            else '명단·메뉴를 못 찾음' end as "결과"
  from g;

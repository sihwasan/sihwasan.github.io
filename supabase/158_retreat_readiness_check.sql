-- =====================================================================
--  158. 수양회 출발 전 확인 — 누가 홈페이지로 메뉴를 고를 수 있는가 (읽기만 합니다)
--  Supabase → SQL Editor → 붙여넣고 Run. 아무것도 바꾸지 않으니 몇 번이든 돌려도 됩니다.
--
--  상태 뜻
--   · 연결됨          : 수양회 화면을 한 번 열어 명단 줄과 이어졌습니다. 메뉴를 고를 수 있습니다.
--   · 가입함          : 홈페이지 계정은 있는데 아직 수양회 화면을 안 열어 봤습니다. 한 번 열면 이어집니다.
--                       (승인대기·일반회원이면 157 sql 이 이름+교회로 잇습니다)
--   · 남편 계정으로   : 사모님 계정이 없지만, 남편이 연결되어 있으면 두 분 몫을 함께 고를 수 있습니다.
--   · 가입 안 함      : 이분(과 배우자)은 아직 홈페이지로 고를 수 없습니다 — 가입을 돕거나 진행 담당이 대신 고릅니다.
-- =====================================================================
with r as (
  select id from public.retreats where title = '2026 제주 부부수양회'
), ps as (
  select p.id, p.seq, p.name, p.role, p.church, p.companion_of, p.user_id,
         h.name as husband, h.user_id as husband_user,
         (select string_agg(distinct pr.role, ',') from public.profiles pr where pr.name = p.name) as acct
    from public.retreat_participants p
    join r on r.id = p.retreat_id
    left join public.retreat_participants h on h.id = p.companion_of
)
select seq as "번호", name as "성명", role as "직분", coalesce(husband, '') as "배우자(남편)",
       case
         when user_id is not null then '연결됨'
         when acct is not null then '가입함 (' || acct || ') — 수양회 화면을 한 번 열면 이어짐'
         when companion_of is not null and husband_user is not null then '남편 계정으로 고를 수 있음'
         when companion_of is not null then '가입 안 함 — 남편도 아직 연결 전'
         else '가입 안 함'
       end as "상태"
  from ps
 order by case when user_id is not null then 4
               when acct is not null then 2
               when companion_of is not null and husband_user is not null then 3
               else 1 end,
          seq;

-- =====================================================================
--  157. 승인 전(승인대기)·일반회원인 참가자도 수양회 화면과 수양회 AI 검색을 쓰게 (2026-11-01)
--
--  문제: 회원 줄(목사·장로)인 참가자가 홈페이지에 가입했지만 아직 「승인대기」거나 일반회원이면
--        is_member() 가 아니어서 명단 줄과 이어지지 않았다 → 수양회 화면도, 수양회 AI 검색도 안 나왔다
--        (신용화 장로님). 배우자 줄(사모님)은 152 가 이름+교회(또는 생년월일)로 이어 주고 있었다.
--  고침: 회원 줄도 사모님과 같은 기준으로 잇는다 — 가입 때 적은 이름이 명단 이름과 같고,
--        임원이 생년월일을 적어 두었으면 생년월일이, 아니면 교회가 맞으면 된다.
--        교회는 「운평교회」와 「운평장로교회」처럼 한쪽이 다른 쪽의 앞부분이면 같은 교회로 본다.
--  여러 번 실행해도 같다. retreat_my_participant 만 바꾸므로 이를 부르는 함수(retreat_state,
--  retreat_can_view, retreat_my_info, retreat_choose …)는 그대로 새 기준을 쓴다.
-- =====================================================================
-- 「운평교회」·「운평장로교회」·「운평 장로교회」를 같은 교회로 (한쪽이 다른 쪽의 앞부분, 두 글자 이상)
create or replace function public.retreat_church_same(a text, b text)
returns boolean language sql immutable set search_path = public as $fn$
  select case
           when length(public.retreat_church_key(a)) < 2 or length(public.retreat_church_key(b)) < 2 then false
           else public.retreat_church_key(a) like public.retreat_church_key(b) || '%'
             or public.retreat_church_key(b) like public.retreat_church_key(a) || '%'
         end
$fn$;
revoke all on function public.retreat_church_same(text, text) from public;
grant execute on function public.retreat_church_same(text, text) to authenticated;

create or replace function public.retreat_my_participant(p_retreat bigint)
returns bigint language sql stable security definer set search_path = public as $fn$
  select p.id
    from public.retreat_participants p
   where p.retreat_id = p_retreat
     and (p.user_id = auth.uid()
       /* 정회원이고 이름이 같으면 (142 그대로) */
       or (p.companion_of is null and p.role not in ('사모', '배우자', '권사', '집사') and public.is_member()
           and exists (select 1 from public.profiles pr
                        where pr.id = auth.uid() and pr.name is not null and pr.name = p.name))
       /* 아직 안 이어진 줄(배우자 줄, 또는 승인 전·일반회원의 회원 줄) — 이름이 같고,
          생년월일(임원이 적었으면) 또는 교회(적지 않았으면)가 맞으면 */
       or (p.user_id is null
           and public.retreat_my_signup('name') = p.name
           and (exists (select 1 from public.retreat_births b
                         where b.participant_id = p.id and b.birth_date = public.retreat_my_birth())
                or (not exists (select 1 from public.retreat_births b where b.participant_id = p.id)
                    and public.retreat_church_same(public.retreat_my_signup('church'), p.church)
                    or (not exists (select 1 from public.retreat_births b where b.participant_id = p.id)
                        and p.companion_of is not null
                        and public.retreat_church_same(public.retreat_my_signup('church'),
                              (select h.church from public.retreat_participants h where h.id = p.companion_of)))))))
   order by (p.user_id = auth.uid()) desc nulls last, p.id
   limit 1
$fn$;

-- 확인 1: 신용화 장로님의 가입 상태와 명단 줄 — role 이 pending/general 이면 승인 전이고,
--         user_id 가 비어 있으면 아직 안 이어진 것 (이 SQL 뒤에는 이름·교회로 이어진다)
select 'profile' as what, pr.name, pr.role, pr.church, coalesce(to_jsonb(pr)->>'suspended', 'false') as suspended
  from public.profiles pr where pr.name like '신용화%'
union all
select 'participant', p.name, p.role, p.church, (p.user_id is not null)::text
  from public.retreat_participants p where p.name like '신용화%';
-- 확인 2: 같은 교회 판정
select public.retreat_church_same('운평교회', '운평장로교회') as same1,
       public.retreat_church_same('운평장로교회', '운평 장로교회') as same2,
       public.retreat_church_same('동탄영광교회', '동탄시온교회') as diff1;

-- =====================================================================
--  153. 수양회 — 스태프가 「종료」를 누르면 다음 일정이 저절로 열린다 · 지금 1일차 조식 메뉴 열기 (2026-11-01)
--
--  · 진행 차례: 항공·집결 안내 → 1일차 조식 → 비양도 카페 → 플로이스트 → 델문도 → 폴 바셋 → 마무리 설문
--    (단계 순서 seq 대로, 좌석·숙소 같은 「배정」 단계는 빼고 따로 연다).
--  · 진행 담당·임원이 열린 단계를 「종료」(= 마감)하면 바로 다음 단계가 열리고, 참가자에게
--    「다음 일정 안내 · …」 알림이 간다 (retreat_set_step — 148 최신본에 덧붙임). 손으로 여닫는 것은 그대로 된다.
--  · 지금 1일차 조식(해장국) 메뉴 고르기를 연다. 항공·집결 안내는 내일 새벽까지 열어 둔다.
--  · 주문 취합 알림: 식사·카페 주문에서 고른 분이 10명 찰 때마다(10·20·30·40명), 그리고 모두 고르면
--    메뉴별 집계를 진행 담당(148 retreat_staff)과 부서 지정 임원(committee_officers)의 홈페이지 알림함으로 보낸다.
--  · 스태프 김동석 목사님을 진행 담당에 더한다 (이동진 목사님은 148 에서).
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다 (알림은 한 번만 간다).
--  ※ 152 sql 이후에 실행.
-- =====================================================================


-- 1. 단계 바꾸기 (148 의 retreat_set_step 에 「종료하면 다음 열기」를 더함) ---------------------
create or replace function public.retreat_set_step(p_step bigint, p_status text, p_notify boolean default false)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  s   public.retreat_steps%rowtype;
  r   public.retreats%rowtype;
  v_n integer := 0;
  nx  public.retreat_steps%rowtype;
begin
  if auth.uid() is null then raise exception '로그인해 주세요.'; end if;
  select * into s from public.retreat_steps where id = p_step;
  if s.id is null then raise exception '단계를 찾을 수 없습니다.'; end if;
  select * into r from public.retreats where id = s.retreat_id;
  if not public.retreat_is_officer(r.id) then
    raise exception '이 부서의 임원만 단계를 바꿀 수 있습니다.';
  end if;
  if p_status not in ('닫힘', '열림', '마감') then raise exception '상태가 맞지 않습니다.'; end if;

  update public.retreat_steps
     set status = p_status,
         opened_at = case when p_status = '열림' then coalesce(opened_at, now()) else opened_at end,
         updated_at = now()
   where id = s.id;

  if p_status = '열림' and p_notify then
    v_n := public.retreat_notify_participants(
             r.id,
             '[' || r.title || '] ' || s.title,
             coalesce(s.body, '') ||
             case when s.kind = '선택' then chr(10) || '홈페이지 → 수양회 → 내 안내에서 골라 주세요.' else '' end ||
             case when s.due is not null then chr(10) || '기한 : ' || to_char(s.due, 'FMMM월 FMDD일') else '' end,
             'retreat-step-' || s.id);
    update public.retreat_steps set notify = true where id = s.id;
  end if;
  /* 종료(마감)하면 진행 차례의 바로 다음 단계를 연다 — 좌석·숙소 같은 「배정」은 차례에 넣지 않는다 (153).
   * 다음 단계가 이미 열렸거나 끝났으면 아무것도 하지 않는다. 열면 참가자에게 「다음 일정 안내」로 알린다. */
  if p_status = '마감' and s.kind <> '배정' then
    select * into nx from public.retreat_steps
     where retreat_id = s.retreat_id and kind <> '배정' and (seq > s.seq or (seq = s.seq and id > s.id))
     order by seq, id limit 1;
    if nx.id is not null and nx.status = '닫힘' then
      update public.retreat_steps set status = '열림', opened_at = coalesce(opened_at, now()), updated_at = now()
       where id = nx.id;
      v_n := public.retreat_notify_participants(
               r.id,
               '[' || r.title || '] 다음 일정 안내 · ' || nx.title,
               coalesce(nx.body, '') ||
               case when nx.kind = '선택' then chr(10) || '홈페이지 → 수양회 → 내 안내에서 골라 주세요. (부부는 한 분이 두 분 몫을 고르셔도 됩니다)' else '' end,
               'retreat-step-' || nx.id);
      update public.retreat_steps set notify = true where id = nx.id;
    end if;
  end if;
  return v_n;
end
$fn$;


-- 2. 지금 1일차 조식 메뉴 고르기 열기 + 참가자 알림 --------------------------------------
do $open$
declare
  r public.retreats%rowtype;
  s public.retreat_steps%rowtype;
begin
  select * into r from public.retreats where title = '2026 제주 부부수양회' order by id limit 1;
  if r.id is null then return; end if;
  update public.retreat_steps set due = date '2026-11-02' where retreat_id = r.id and key = 'meal1';
  select * into s from public.retreat_steps where retreat_id = r.id and key = 'meal1';
  if s.id is null then raise notice '1일차 조식 단계(meal1)가 없습니다 — 151 sql 먼저'; return; end if;
  if s.status = '닫힘' then
    update public.retreat_steps set status = '열림', opened_at = coalesce(opened_at, now()), updated_at = now() where id = s.id;
  end if;
  perform public.retreat_notify_participants(
            r.id,
            '[' || r.title || '] 다음 일정 안내 · ' || s.title,
            coalesce(s.body, '') || chr(10) || '홈페이지 → 수양회 → 내 안내에서 골라 주세요. (부부는 한 분이 두 분 몫을 고르셔도 됩니다)' ||
            chr(10) || '기한 : 11월 2일 아침',
            'retreat-step-' || s.id);
  update public.retreat_steps set notify = true where id = s.id;
end
$open$;


-- 3. 주문 취합 알림 — 10명마다, 그리고 모두 고르면 ------------------------------------------
create or replace function public.retreat_order_digest(p_step bigint)
returns text language sql stable security definer set search_path = public as $fn$
  select coalesce(string_agg(k || ' ' || n, ' · ' order by sq, k), '')
    from (select coalesce(c.option_label, '(요청만)') || coalesce(' (' || c.variant || ')', '') as k,
                 count(*) as n, min(coalesce(o.seq, 9999)) as sq
            from public.retreat_choices c
            left join public.retreat_options o on o.id = c.option_id
           where c.step_id = p_step
           group by 1) t
$fn$;

create or replace function public.retreat_order_tally()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  s     public.retreat_steps%rowtype;
  r     public.retreats%rowtype;
  v_n   integer;
  v_all integer;
begin
  select * into s from public.retreat_steps where id = new.step_id;
  if s.id is null or s.kind <> '선택' then return new; end if;
  select * into r from public.retreats where id = s.retreat_id;
  select count(*) into v_n from public.retreat_choices where step_id = s.id;
  select count(*) into v_all from public.retreat_participants where retreat_id = r.id;
  if v_n % 10 <> 0 and v_n <> v_all then return new; end if;

  insert into public.notifications (user_id, kind, title, body, dedupe_key)
  select u.user_id, '수양회',
         '[' || r.title || '] ' || s.title || ' — ' || v_n || '명 고름' || case when v_n >= v_all then ' (모두)' else '' end,
         public.retreat_order_digest(s.id) || chr(10) || '고른 분 ' || v_n || ' / ' || v_all || '명' ||
           chr(10) || '홈페이지 → 수양회 → 진행 관리 → 현황 · 주문서에서 이름별로 보실 수 있습니다.',
         'retreat-order-' || s.id || '-' || v_n
    from (select t.user_id from public.retreat_staff t where t.retreat_id = r.id
          union
          select o.user_id from public.committee_officers o where o.committee = r.committee) u
   where not exists (select 1 from public.notifications n
                      where n.user_id = u.user_id and n.dedupe_key = 'retreat-order-' || s.id || '-' || v_n);
  return new;
end
$fn$;

drop trigger if exists retreat_order_tally on public.retreat_choices;
create trigger retreat_order_tally after insert on public.retreat_choices
  for each row execute function public.retreat_order_tally();

-- 4. 스태프 김동석 목사님(운평장로교회)도 진행 담당으로 — 종료·다음 열기와 주문 취합 알림 ----------------
insert into public.retreat_staff (retreat_id, user_id, role, created_by)
select r.id, p.id, '스태프', '153 sql'
  from public.retreats r
  join public.profiles p on p.name = '김동석'
 where r.title = '2026 제주 부부수양회'
   and ((select count(*) from public.profiles x where x.name = '김동석') = 1
        or (p.church like '%운평%'
            and (select count(*) from public.profiles x where x.name = '김동석' and x.church like '%운평%') = 1))
on conflict (retreat_id, user_id) do nothing;

-- 확인: 단계 상태와 진행 차례
select s.seq as "순서", s.title as "단계", s.kind as "종류", s.status as "상태", s.notify as "알림"
  from public.retreat_steps s join public.retreats r on r.id = s.retreat_id and r.title = '2026 제주 부부수양회'
 order by s.seq, s.id;

select p.name as "진행 담당", p.church as "교회", t.role as "역할"
  from public.retreat_staff t join public.profiles p on p.id = t.user_id
  join public.retreats r on r.id = t.retreat_id and r.title = '2026 제주 부부수양회'
 order by p.name;

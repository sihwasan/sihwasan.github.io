-- =====================================================================
--  149. 수양회는 참가자와 진행 임원만 본다 · 사모님 참가자도 AI 검색으로 수양회만 묻는다 (2026-10-30)
--
--  문제: 140 은 「정회원이면 누구나」 수양회 화면(일정·사진·명단·메뉴)을 열 수 있게 했다.
--        수양회는 참가자만의 일이고, AI 검색도 참가자에게만 수양회를 답해야 한다.
--  해결: · retreat_can_view(수양회) = 참가자 명단에 있는 본인(사모님 포함 — 140·142 의 retreat_my_participant)
--          이거나 진행 임원(부서 임원·148 의 진행 담당).
--        · retreat_state(148 그대로)·retreat_today(146 그대로)와 수양회 표 8개의 열람 규칙을 그것으로 좁힌다.
--          참가자 전체 명단과 얼굴 사진은 지금처럼 「정회원인 참가자」에게만 (사모님은 자기·배우자 줄만,
--          retreat_state 가 준다).
--        · retreat_my_info() — 지금 수양회에 참가하는지(또는 진행 임원인지)만 알려 준다. 홈페이지 AI 검색창이
--          정회원이 아닌 참가자(사모님)에게 「수양회 질문 전용」으로 열리고, AI 창구도 이것으로 다시 확인한다.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--  ※ 148_retreat_staff.sql 이후에 실행.
-- =====================================================================


-- 1. 볼 수 있는가 --------------------------------------------------------------
create or replace function public.retreat_can_view(p_retreat bigint)
returns boolean language sql stable security definer set search_path = public as $fn$
  select auth.uid() is not null
     and (public.retreat_my_participant(p_retreat) is not null or public.retreat_is_officer(p_retreat))
$fn$;
grant execute on function public.retreat_can_view(bigint) to authenticated;

-- AI 검색창·창구가 쓰는 짧은 확인: 지금 수양회(retreat_pick)에 참가하거나 진행하면 그 수양회, 아니면 null
create or replace function public.retreat_my_info()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  r public.retreats%rowtype;
begin
  if auth.uid() is null then return null; end if;
  r := public.retreat_pick(null);
  if r.id is null or not public.retreat_can_view(r.id) then return null; end if;
  return jsonb_build_object('id', r.id, 'title', r.title, 'start_date', r.start_date, 'end_date', r.end_date,
                            'participant', public.retreat_my_participant(r.id) is not null);
end
$fn$;
revoke all on function public.retreat_my_info() from public;
grant execute on function public.retreat_my_info() to authenticated;


-- 2. 수양회 화면 자료 (148 의 retreat_state 에서 첫 관문만 바꿈) ---------------------------
create or replace function public.retreat_state(p_retreat bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  r       public.retreats%rowtype;
  v_me    bigint;
  v_mate  bigint;   -- 내가 배우자(사모님)이면 남편 줄
  v_off   boolean;
  v_mem   boolean;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if auth.uid() is null then return jsonb_build_object('login', false); end if;
  v_mem := public.is_member();

  r := public.retreat_pick(p_retreat);
  if r.id is null then return jsonb_build_object('login', true, 'member', v_mem, 'retreat', null); end if;

  v_me := public.retreat_my_participant(r.id);
  /* 참가자(본인·배우자 줄)와 진행 임원(부서 임원·진행 담당)에게만 준다 — 정회원이라도 참가하지 않으면 주지 않는다 (149) */
  if v_me is null and not public.retreat_is_officer(r.id) then
    return jsonb_build_object('login', true, 'member', v_mem, 'retreat', null, 'not_participant', true);
  end if;
  v_off := v_mem and public.retreat_is_officer(r.id);
  select companion_of into v_mate from public.retreat_participants where id = v_me;

  return jsonb_build_object(
    'login', true, 'member', v_mem, 'officer', v_off, 'today', v_today,
    'retreat', to_jsonb(r),
    'me', (select to_jsonb(p) from public.retreat_participants p where p.id = v_me),
    'companions', (select coalesce(jsonb_agg(to_jsonb(p) order by p.seq), '[]'::jsonb)
                     from public.retreat_participants p where p.companion_of = v_me or p.id = v_mate),
    'roommates', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'role', q.role, 'church', q.church)
                                            order by q.seq), '[]'::jsonb)
                    from public.retreat_participants p
                    join public.retreat_participants q
                      on q.retreat_id = p.retreat_id and q.room_group = p.room_group and q.id <> p.id
                   where p.id = v_me and p.room_group is not null),
    'steps', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', s.id, 'seq', s.seq, 'key', s.key, 'title', s.title, 'body', s.body,
                         'kind', s.kind, 'status', s.status, 'due', s.due, 'variants', s.variants,
                         'notify', s.notify, 'opened_at', s.opened_at,
                         'options', (select coalesce(jsonb_agg(jsonb_build_object(
                                                  'id', o.id, 'seq', o.seq, 'label', o.label, 'note', o.note)
                                                  order by o.seq), '[]'::jsonb)
                                       from public.retreat_options o
                                      where o.step_id = s.id and o.enabled))
                       order by s.seq, s.id), '[]'::jsonb)
                from public.retreat_steps s
               where s.retreat_id = r.id and (v_off or s.status <> '닫힘')),
    'choices', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                  from public.retreat_choices c
                  join public.retreat_participants p on p.id = c.participant_id
                 where p.retreat_id = r.id
                   and (v_off or p.id = v_me or p.companion_of = v_me or p.id = v_mate)),
    /* 참가자 전체 명단은 정회원에게만 (생년월일은 임원에게만) */
    'participants', case when not v_mem then '[]'::jsonb else
                      (select coalesce(jsonb_agg(
                          jsonb_build_object('id', p.id, 'seq', p.seq, 'name', p.name, 'role', p.role,
                                             'church', p.church, 'companion_of', p.companion_of,
                                             'bus_seat', p.bus_seat, 'van_seat', p.van_seat,
                                             'room_group', p.room_group, 'room_no', p.room_no,
                                             'present', p.present, 'linked', p.user_id is not null)
                          || case when v_off
                                  then jsonb_build_object('paid', p.paid, 'fee', p.fee, 'note', p.note,
                                         'birth_date', (select b.birth_date from public.retreat_births b where b.participant_id = p.id))
                                  else '{}'::jsonb end
                          order by p.seq), '[]'::jsonb)
                         from public.retreat_participants p where p.retreat_id = r.id) end,
    'program', (select coalesce(jsonb_agg(to_jsonb(g) order by g.day_no, g.seq), '[]'::jsonb)
                  from public.retreat_program g where g.retreat_id = r.id)
  );
end
$fn$;


-- 3. 메인 화면 수양회 창 (146 의 retreat_today 에 참가자·진행 임원 조건만 더함) ---------------
create or replace function public.retreat_today()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object('id', r.id, 'title', r.title, 'place', r.place,
                            'start_date', r.start_date, 'end_date', r.end_date, 'stage', r.stage,
                            'day_no', ((now() at time zone 'Asia/Seoul')::date - r.start_date) + 1,
                            'days', (coalesce(r.end_date, r.start_date) - r.start_date) + 1,
                            'guide_url', case when auth.uid() is not null then r.guide_url end,
                            'worship', case when auth.uid() is not null then
                                         (select jsonb_build_object('id', w.id, 'title', w.title)
                                            from public.retreat_worship w
                                           where w.retreat_id = r.id and w.live
                                           order by w.updated_at desc limit 1) end)
    from public.retreats r
   where r.status = 'open' and r.stage <> '마침'
     and public.retreat_can_view(r.id)   -- 참가자·진행 임원에게만 (149)
     and (now() at time zone 'Asia/Seoul')::date between r.start_date and coalesce(r.end_date, r.start_date)
   order by r.id desc
   limit 1
$fn$;
grant execute on function public.retreat_today() to anon, authenticated;


-- 4. 수양회 표 열람 규칙 -------------------------------------------------------------
drop policy if exists retreats_read on public.retreats;
create policy retreats_read on public.retreats for select
  using (public.retreat_can_view(id));
drop policy if exists retreat_participants_read on public.retreat_participants;
create policy retreat_participants_read on public.retreat_participants for select
  using (public.is_member() and public.retreat_can_view(retreat_id));
drop policy if exists retreat_steps_read on public.retreat_steps;
create policy retreat_steps_read on public.retreat_steps for select
  using (public.retreat_can_view(retreat_id));
drop policy if exists retreat_options_read on public.retreat_options;
create policy retreat_options_read on public.retreat_options for select
  using (exists (select 1 from public.retreat_steps s where s.id = step_id and public.retreat_can_view(s.retreat_id)));
drop policy if exists retreat_program_read on public.retreat_program;
create policy retreat_program_read on public.retreat_program for select
  using (public.retreat_can_view(retreat_id));
drop policy if exists retreat_media_read on public.retreat_media;
create policy retreat_media_read on public.retreat_media for select
  using (public.retreat_can_view(retreat_id));
drop policy if exists retreat_photos_read on public.retreat_photos;
create policy retreat_photos_read on public.retreat_photos for select
  using (public.is_member() and exists (select 1 from public.retreat_participants p where p.id = participant_id and public.retreat_can_view(p.retreat_id)));
drop policy if exists retreat_worship_read on public.retreat_worship;
create policy retreat_worship_read on public.retreat_worship for select
  using (public.retreat_can_view(retreat_id));


-- 확인: 아래 8줄이 모두 「참가자만 = true」여야 한다
select tablename as "표", policyname as "열람 규칙", (qual like '%retreat_can_view%') as "참가자만"
  from pg_policies
 where schemaname = 'public'
   and policyname in ('retreats_read', 'retreat_participants_read', 'retreat_steps_read', 'retreat_options_read',
                      'retreat_program_read', 'retreat_media_read', 'retreat_photos_read', 'retreat_worship_read')
 order by 1;

-- =====================================================================
--  150. 수양회 회비 납부는 관리자·임원만 본다 (2026-10-30)
--
--  문제: 회원 화면 「내 안내 → 내 자리」에 회비 납부액이 보였고, retreat_state 가 회원 본인·배우자 줄을
--        통째로(to_jsonb) 보내 납부액(paid)·회비(fee)·임원 메모(note)가 함께 갔다. 참가자 표를 직접
--        읽어도 이 칸들이 보였다 (열람 규칙은 줄 단위라 칸을 가리지 못한다).
--  해결: · retreat_state(149 그대로) — 임원(부서 임원·진행 담당·관리자)이 아니면 me·companions 에서
--          paid·fee·note 를 뺀다. 명단(participants)은 140 부터 임원에게만 이 칸을 주었다.
--        · retreat_participants 를 직접 읽을 때 paid·fee·note 칸은 읽지 못하게 칸 권한을 거둔다.
--          임원 화면은 retreat_state(관리자 권한 함수)로 읽으므로 그대로 보인다. 고치기·넣기는 그대로다.
--        · 화면(retreat.html)은 회비 칸을 임원에게만 그린다.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--  ※ 149_retreat_participants_only.sql 이후에 실행.
-- =====================================================================


-- 1. 수양회 화면 자료 (149 의 retreat_state 에서 me·companions 만 바꿈) -----------------------
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
    'me', (select case when v_off then to_jsonb(p) else to_jsonb(p) - array['paid', 'fee', 'note'] end
           from public.retreat_participants p where p.id = v_me),
    'companions', (select coalesce(jsonb_agg(case when v_off then to_jsonb(p) else to_jsonb(p) - array['paid', 'fee', 'note'] end
                                            order by p.seq), '[]'::jsonb)
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


-- 2. 참가자 표의 칸 권한 — 납부액·회비·임원 메모는 직접 읽지 못한다 ---------------------------
revoke select on public.retreat_participants from anon, authenticated;
grant select (id, retreat_id, seq, name, role, church, user_id, companion_of, bus_seat, van_seat, room_group, room_no, present, created_at, updated_at)
  on public.retreat_participants to authenticated;


-- 확인: 회원이 읽을 수 있는 칸 (paid·fee·note 가 없어야 한다)
select string_agg(column_name, ', ' order by column_name) as "회원이 읽는 칸"
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'retreat_participants'
   and grantee = 'authenticated' and privilege_type = 'SELECT';

-- =====================================================================
--  155. 수양회 메뉴 사진 — 고르기 칸에 메뉴 사진을 함께 보인다 (2026-11-01)
--
--  · retreat_options 에 사진 주소(image_url)를 둔다. 사진이 있는 메뉴는 「내 안내」 카드에 사진과 이름이
--    함께 나오고, 누르면 크게 보인다.
--  · 가이드북(이동진 목사님 앱)에 사진이 있는 메뉴는 1일차 조식(순풍삼대해장국) 4가지뿐이다.
--    그 사진을 홈페이지 images/retreat/jeju-2026/ 에 옮겨 두고 가리킨다 (가이드북 사진 파일 이름은
--    앱을 다시 만들 때 바뀔 수 있어서 옮겨 둔다).
--  · retreat_state 는 150 최신본 그대로에 선택지의 image_url 만 더한다.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.  ※ 150·151 이후.
-- =====================================================================

alter table public.retreat_options add column if not exists image_url text;

update public.retreat_options o
   set image_url = v.url
  from (values
    ('고사리육내탕(얼큰)',     'images/retreat/jeju-2026/meal1-1.jpg'),
    ('소고기해장국(선지 O)',   'images/retreat/jeju-2026/meal1-2.jpg'),
    ('소고기해장국(선지 X)',   'images/retreat/jeju-2026/meal1-3.jpg'),
    ('돼지국밥',               'images/retreat/jeju-2026/meal1-4.jpg')
  ) as v(label, url),
       public.retreat_steps s, public.retreats r
 where o.step_id = s.id and s.key = 'meal1' and s.retreat_id = r.id and r.title = '2026 제주 부부수양회'
   and o.label = v.label;


-- 수양회 화면 자료 (150 의 retreat_state 에 선택지 사진 주소만 더함)
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
                                                  'id', o.id, 'seq', o.seq, 'label', o.label, 'note', o.note,
                                                  'image_url', o.image_url)
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


-- 확인: 사진이 붙은 메뉴 (4줄)
select s.title as "단계", o.label as "메뉴", o.image_url as "사진"
  from public.retreat_options o join public.retreat_steps s on s.id = o.step_id
 where o.image_url is not null order by s.seq, o.seq;

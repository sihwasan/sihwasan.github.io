-- =====================================================================
--  148. 수양회 진행 담당 — 부서 임원이 아니어도 그 수양회만 관리한다 (2026-10-30)
--
--  문제: 147 이 교육친교부 총무(이동진 목사님)를 부서 지정 임원(committee_officers)으로
--        넣었는데, 부서 임원은 수양회뿐 아니라 부서 일정·공지·회의록·자료실·회계 장부까지 쓴다.
--        총무에게 필요한 것은 수양회 관리(단계 열기·명단·주문 현황표·예배 진행)뿐이다.
--  해결: · retreat_staff(수양회 × 회원) — 그 수양회만 관리하는 「진행 담당」. 최고관리자만 넣고 뺀다.
--        · retreat_is_officer(수양회) = 그 부서 임원 이거나 진행 담당.
--        · 수양회 함수 5개(최신 정의 그대로)와 열람 규칙 13개에서 「부서 임원」 검사만
--          retreat_is_officer 로 바꾼다. 그 밖의 부서 권한(장부·회의록 등)은 그대로다.
--        · 147 이 넣은 부서 지정 임원 줄(created_by = '147 sql')을 지우고, 이동진 목사님을
--          「2026 제주 부부수양회」의 진행 담당으로 넣는다 (같은 이름 계정이 여럿이면 동탄영광교회
--          계정만, 그래도 여럿이면 넣지 않는다).
--  진행 담당은 다른 사람을 담당·임원·관리자로 지정할 수 없다.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--  ※ 147_retreat_cafe_spouse.sql 이후에 실행.
-- =====================================================================


-- 1. 진행 담당 ----------------------------------------------------------------
create table if not exists public.retreat_staff (
  retreat_id bigint not null references public.retreats on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  role       text not null default '진행',
  created_at timestamptz not null default now(),
  created_by text,
  primary key (retreat_id, user_id)
);
alter table public.retreat_staff enable row level security;
drop policy if exists retreat_staff_read  on public.retreat_staff;
drop policy if exists retreat_staff_write on public.retreat_staff;
create policy retreat_staff_read  on public.retreat_staff for select using (user_id = auth.uid() or public.can_manage());
create policy retreat_staff_write on public.retreat_staff for all using (public.can_manage()) with check (public.can_manage());

create or replace function public.retreat_is_officer(p_retreat bigint)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.retreats r
     where r.id = p_retreat
       and (public.is_committee_officer(r.committee)
            or exists (select 1 from public.retreat_staff t where t.retreat_id = r.id and t.user_id = auth.uid()))
  )
$fn$;
grant execute on function public.retreat_is_officer(bigint) to authenticated;


-- 2. 수양회 함수 — 최신 정의에서 부서 임원 검사만 retreat_is_officer 로 -------------------

-- retreat_can_act (147 sql 기준)
create or replace function public.retreat_can_act(p_participant bigint)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from public.retreat_participants p
      join public.retreats r on r.id = p.retreat_id
     where p.id = p_participant
       and (p.id = public.retreat_my_participant(p.retreat_id)
         or p.companion_of = public.retreat_my_participant(p.retreat_id)
         or p.id = (select m.companion_of from public.retreat_participants m
                     where m.id = public.retreat_my_participant(p.retreat_id))
         or public.retreat_is_officer(r.id))
  )
$fn$;

-- retreat_state (147 sql 기준)
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
  /* 정회원도 참가자도 아니면 아무것도 주지 않는다 */
  if not v_mem and v_me is null then
    return jsonb_build_object('login', true, 'member', false, 'retreat', null);
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

-- retreat_choose (140 sql 기준)
create or replace function public.retreat_choose(p_step bigint, p_participant bigint,
                                                 p_option bigint default null,
                                                 p_variant text default null,
                                                 p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  s     public.retreat_steps%rowtype;
  p     public.retreat_participants%rowtype;
  r     public.retreats%rowtype;
  v_lbl text;
  v_id  bigint;
  v_off boolean;
begin
  if auth.uid() is null then raise exception '로그인해 주세요.'; end if;
  select * into s from public.retreat_steps where id = p_step;
  if s.id is null then raise exception '단계를 찾을 수 없습니다.'; end if;
  select * into p from public.retreat_participants where id = p_participant;
  if p.id is null or p.retreat_id <> s.retreat_id then raise exception '참가자를 찾을 수 없습니다.'; end if;
  select * into r from public.retreats where id = s.retreat_id;
  v_off := public.retreat_is_officer(r.id);

  if not public.retreat_can_act(p.id) then
    raise exception '본인과 배우자 몫만 고르실 수 있습니다.';
  end if;
  if s.kind <> '선택' then raise exception '고르는 단계가 아닙니다.'; end if;
  if s.status <> '열림' and not v_off then
    if s.status = '마감' then
      raise exception '이 단계는 마감되었습니다. 바꾸시려면 임원에게 말씀해 주세요.';
    end if;
    raise exception '아직 열리지 않은 단계입니다.';
  end if;

  if p_option is null and btrim(coalesce(p_note, '')) = '' then
    delete from public.retreat_choices where step_id = s.id and participant_id = p.id;
    return null;
  end if;

  if p_option is not null then
    select label into v_lbl from public.retreat_options where id = p_option and step_id = s.id and enabled;
    if v_lbl is null then raise exception '선택지가 맞지 않습니다.'; end if;
  end if;
  if p_variant is not null and s.variants is not null and not (p_variant = any(s.variants)) then
    raise exception '갈래가 맞지 않습니다.';
  end if;

  insert into public.retreat_choices (step_id, participant_id, option_id, option_label, variant, note, chosen_by)
  values (s.id, p.id, p_option, v_lbl, nullif(btrim(coalesce(p_variant, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (step_id, participant_id) do update
     set option_id = excluded.option_id, option_label = excluded.option_label,
         variant = excluded.variant, note = excluded.note,
         chosen_by = excluded.chosen_by, updated_at = now()
  returning id into v_id;
  return v_id;
end
$fn$;

-- retreat_set_step (140 sql 기준)
create or replace function public.retreat_set_step(p_step bigint, p_status text, p_notify boolean default false)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  s   public.retreat_steps%rowtype;
  r   public.retreats%rowtype;
  v_n integer := 0;
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
  return v_n;
end
$fn$;

-- retreat_notify (140 sql 기준)
create or replace function public.retreat_notify(p_retreat bigint, p_title text, p_body text default null)
returns integer language plpgsql security definer set search_path = public as $fn$
declare r public.retreats%rowtype;
begin
  if auth.uid() is null then raise exception '로그인해 주세요.'; end if;
  select * into r from public.retreats where id = p_retreat;
  if r.id is null then raise exception '수양회를 찾을 수 없습니다.'; end if;
  if not public.retreat_is_officer(r.id) then
    raise exception '이 부서의 임원만 공지를 보낼 수 있습니다.';
  end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception '제목을 적어 주세요.'; end if;
  return public.retreat_notify_participants(
           r.id, '[' || r.title || '] ' || btrim(p_title), p_body,
           'retreat-notice-' || r.id || '-' || md5(btrim(p_title) || coalesce(p_body, '')));
end
$fn$;


-- 3. 열람·쓰기 규칙 ----------------------------------------------------------
drop policy if exists retreats_write on public.retreats;   -- 140 sql 기준
create policy retreats_write on public.retreats for all
  using ((public.is_committee_officer(committee) or public.retreat_is_officer(id))) with check ((public.is_committee_officer(committee) or public.retreat_is_officer(id)));
drop policy if exists retreat_participants_write on public.retreat_participants;   -- 140 sql 기준
create policy retreat_participants_write on public.retreat_participants for all
  using (exists (select 1 from public.retreats r where r.id = retreat_id and public.retreat_is_officer(r.id)))
  with check (exists (select 1 from public.retreats r where r.id = retreat_id and public.retreat_is_officer(r.id)));
drop policy if exists retreat_steps_write on public.retreat_steps;   -- 140 sql 기준
create policy retreat_steps_write on public.retreat_steps for all
  using (exists (select 1 from public.retreats r where r.id = retreat_id and public.retreat_is_officer(r.id)))
  with check (exists (select 1 from public.retreats r where r.id = retreat_id and public.retreat_is_officer(r.id)));
drop policy if exists retreat_options_write on public.retreat_options;   -- 140 sql 기준
create policy retreat_options_write on public.retreat_options for all
  using (exists (select 1 from public.retreat_steps s join public.retreats r on r.id = s.retreat_id
                  where s.id = step_id and public.retreat_is_officer(r.id)))
  with check (exists (select 1 from public.retreat_steps s join public.retreats r on r.id = s.retreat_id
                       where s.id = step_id and public.retreat_is_officer(r.id)));
drop policy if exists retreat_choices_read on public.retreat_choices;   -- 140 sql 기준
create policy retreat_choices_read on public.retreat_choices for select
  using (exists (select 1 from public.retreat_participants p
                  join public.retreats r on r.id = p.retreat_id
                 where p.id = participant_id
                   and (p.user_id = auth.uid()
                     or exists (select 1 from public.retreat_participants m
                                 where m.id = p.companion_of and m.user_id = auth.uid())
                     or public.retreat_is_officer(r.id))));
drop policy if exists retreat_choices_write on public.retreat_choices;   -- 140 sql 기준
create policy retreat_choices_write on public.retreat_choices for all
  using (exists (select 1 from public.retreat_participants p join public.retreats r on r.id = p.retreat_id
                  where p.id = participant_id and public.retreat_is_officer(r.id)))
  with check (exists (select 1 from public.retreat_participants p join public.retreats r on r.id = p.retreat_id
                       where p.id = participant_id and public.retreat_is_officer(r.id)));
drop policy if exists retreat_program_write on public.retreat_program;   -- 140 sql 기준
create policy retreat_program_write on public.retreat_program for all
  using (exists (select 1 from public.retreats r where r.id = retreat_id and public.retreat_is_officer(r.id)))
  with check (exists (select 1 from public.retreats r where r.id = retreat_id and public.retreat_is_officer(r.id)));
drop policy if exists retreat_births_officer on public.retreat_births;   -- 142 sql 기준
create policy retreat_births_officer on public.retreat_births for all
  using (exists (select 1 from public.retreat_participants p join public.retreats r on r.id = p.retreat_id
                  where p.id = participant_id and public.retreat_is_officer(r.id)))
  with check (exists (select 1 from public.retreat_participants p join public.retreats r on r.id = p.retreat_id
                       where p.id = participant_id and public.retreat_is_officer(r.id)));
drop policy if exists retreat_media_insert on public.retreat_media;   -- 143 sql 기준
create policy retreat_media_insert on public.retreat_media for insert
  with check (public.is_member()
              and author_id = auth.uid()
              and exists (select 1 from public.retreats r where r.id = retreat_id
                           and (public.retreat_is_officer(r.id)
                             or public.retreat_my_participant(r.id) is not null)));
drop policy if exists retreat_media_update on public.retreat_media;   -- 143 sql 기준
create policy retreat_media_update on public.retreat_media for update
  using (author_id = auth.uid()
         or exists (select 1 from public.retreats r where r.id = retreat_id and public.retreat_is_officer(r.id)))
  with check (author_id = auth.uid()
         or exists (select 1 from public.retreats r where r.id = retreat_id and public.retreat_is_officer(r.id)));
drop policy if exists retreat_media_delete on public.retreat_media;   -- 143 sql 기준
create policy retreat_media_delete on public.retreat_media for delete
  using (author_id = auth.uid()
         or exists (select 1 from public.retreats r where r.id = retreat_id and public.retreat_is_officer(r.id)));
drop policy if exists retreat_photos_write on public.retreat_photos;   -- 144 sql 기준
create policy retreat_photos_write on public.retreat_photos for all
  using (exists (select 1 from public.retreat_participants p
                   join public.retreats r on r.id = p.retreat_id
                  where p.id = participant_id and public.retreat_is_officer(r.id)))
  with check (exists (select 1 from public.retreat_participants p
                        join public.retreats r on r.id = p.retreat_id
                       where p.id = participant_id and public.retreat_is_officer(r.id)));
drop policy if exists retreat_worship_write on public.retreat_worship;   -- 146 sql 기준
create policy retreat_worship_write on public.retreat_worship for all
  using (exists (select 1 from public.retreats r where r.id = retreat_id and public.retreat_is_officer(r.id)))
  with check (exists (select 1 from public.retreats r where r.id = retreat_id and public.retreat_is_officer(r.id)));


-- 4. 147 의 부서 지정 임원 줄을 거두고, 진행 담당으로 ------------------------------------
delete from public.committee_officers where committee = '교육친교부' and created_by = '147 sql';

insert into public.retreat_staff (retreat_id, user_id, role, created_by)
select r.id, p.id, '총무', '148 sql'
  from public.retreats r
  join public.profiles p on p.name = '이동진'
 where r.title = '2026 제주 부부수양회'
   and ((select count(*) from public.profiles x where x.name = '이동진') = 1
        or (p.church like '%동탄영광%'
            and (select count(*) from public.profiles x where x.name = '이동진' and x.church like '%동탄영광%') = 1))
on conflict (retreat_id, user_id) do nothing;


-- 확인
select r.title as "수양회", p.name as "진행 담당", p.church as "교회", t.role as "역할"
  from public.retreat_staff t
  join public.retreats r on r.id = t.retreat_id
  join public.profiles p on p.id = t.user_id
 order by r.id, p.name;

select count(*) as "147 이 넣은 교육친교부 지정 임원 (0 이어야 함)"
  from public.committee_officers where committee = '교육친교부' and created_by = '147 sql';

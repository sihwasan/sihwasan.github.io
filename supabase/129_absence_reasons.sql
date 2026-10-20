-- =====================================================================
--  129. 노회 불참 이유서 (노회규칙 제35조) — 2026-10-21
--
--  「본회 회원은 노회 회집 불참 시에는 서기에게 그 이유서를 제출하여야 한다.」
--
--  · 정기노회(임시노회 포함)가 공지되면 — 노회 일정 설정에서 날짜를 「확정」하고
--    알림 기간(meetings.lead_days, 기본 40일) 안에 들어오면 — 그날부터 회의 당일까지
--    정회원(언권회원·최고관리자 제외)이 대시보드에서 불참 이유서를 낸다. 한 회의에 한 번,
--    접수 기간 안에는 고치거나 거둘 수 있다.
--  · 서기(와 최고관리자)는 임원방에서 모두 보고 「확인」 표시를 한다. 부서기는 열람만.
--    이유서가 들어오면 서기에게 알림이 간다.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
-- =====================================================================

-- 2단계 인증 확인 함수 — 124_admin_mfa.sql 과 똑같은 내용. 124 를 아직 실행하지 않은 DB 에서도 돌도록 여기서도 만든다.
-- (can_manage()·is_officer() 의 서버 잠금은 124 가 건다. 여기서는 건드리지 않는다)
create or replace function public.mfa_ok()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$fn$;
grant execute on function public.mfa_ok() to anon, authenticated;

create table if not exists public.absence_reasons (
  id          bigserial primary key,
  meeting_id  bigint not null references public.meetings (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text,
  church      text,
  position    text,
  reason_kind text not null default '기타'
              check (reason_kind in ('질병·입원', '교회 사정', '경조사', '해외 체류', '개인 사정', '기타')),
  reason      text not null check (char_length(reason) between 2 and 1000),
  status      text not null default '접수' check (status in ('접수', '확인')),
  checked_by  text,
  checked_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (meeting_id, user_id)
);
create index if not exists absence_reasons_meeting_idx on public.absence_reasons (meeting_id, created_at);

-- 접수 기간: 확정된 회의, 오늘(한국)이 [회의일 - 알림 기간, 회의일] 안
create or replace function public.absence_open(p_meeting bigint)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.meetings m
     where m.id = p_meeting and m.confirmed and m.meet_date is not null
       and (now() at time zone 'Asia/Seoul')::date between m.meet_date - coalesce(m.lead_days, 40) and m.meet_date)
$fn$;
grant execute on function public.absence_open(bigint) to authenticated;

-- 보는 분: 서기·최고관리자·부서기 / 확인 표시: 서기·최고관리자 (2단계 인증을 마친 로그인)
create or replace function public.absence_reader()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.mfa_ok() and exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role in ('clerk', 'superadmin') or (p.role = 'officer' and btrim(coalesce(p.title, '')) = '부서기')))
$fn$;
create or replace function public.absence_checker()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.mfa_ok() and coalesce(public.my_role() in ('clerk', 'superadmin'), false)
$fn$;
grant execute on function public.absence_reader() to authenticated;
grant execute on function public.absence_checker() to authenticated;

alter table public.absence_reasons enable row level security;
revoke all on public.absence_reasons from anon;
grant select, insert, update, delete on public.absence_reasons to authenticated;
grant usage, select on sequence public.absence_reasons_id_seq to authenticated;

drop policy if exists absence_read   on public.absence_reasons;
drop policy if exists absence_insert on public.absence_reasons;
drop policy if exists absence_update on public.absence_reasons;
drop policy if exists absence_delete on public.absence_reasons;
create policy absence_read on public.absence_reasons for select to authenticated
  using (user_id = auth.uid() or public.absence_reader());
-- 본인이, 정회원으로, 접수 기간에 (최고관리자는 노회 사무실 계정이라 내지 않는다)
create policy absence_insert on public.absence_reasons for insert to authenticated
  with check (user_id = auth.uid() and public.is_full_member()
              and coalesce(public.my_role(), '') <> 'superadmin' and public.absence_open(meeting_id));
-- 본인은 접수 기간에 고치고, 서기는 확인 표시를 한다
create policy absence_update on public.absence_reasons for update to authenticated
  using ((user_id = auth.uid() and public.absence_open(meeting_id)) or public.absence_checker())
  with check ((user_id = auth.uid() and public.absence_open(meeting_id)) or public.absence_checker());
-- 본인이 접수 기간에 거둔다 (서기가 확인한 뒤에는 거두지 않는다)
create policy absence_delete on public.absence_reasons for delete to authenticated
  using (user_id = auth.uid() and public.absence_open(meeting_id) and status = '접수');

create or replace function public.absence_reasons_before()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_p public.profiles%rowtype;
begin
  select * into v_p from public.profiles where id = auth.uid();
  new.reason := btrim(new.reason);
  if tg_op = 'INSERT' then
    -- 이름·교회·직분은 계정에서 채운다 (남의 이름으로 낼 수 없다)
    new.name := v_p.name; new.church := v_p.church; new.position := v_p.position;
    new.status := '접수'; new.checked_by := null; new.checked_at := null;
    new.created_at := now();
  else
    new.meeting_id := old.meeting_id; new.user_id := old.user_id;
    new.name := old.name; new.church := old.church; new.position := old.position; new.created_at := old.created_at;
    if public.absence_checker() and auth.uid() is distinct from old.user_id then
      -- 서기는 확인 표시만 바꾼다 (내용은 본인이 쓴 그대로)
      new.reason := old.reason; new.reason_kind := old.reason_kind;
      if new.status = '확인' and old.status <> '확인' then
        new.checked_by := v_p.name; new.checked_at := now();
      elsif new.status = '접수' then
        new.checked_by := null; new.checked_at := null;
      else
        new.checked_by := old.checked_by; new.checked_at := old.checked_at;
      end if;
    else
      -- 본인이 고치면 다시 「접수」 (확인 표시는 스스로 못 한다)
      new.status := '접수'; new.checked_by := null; new.checked_at := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$fn$;
drop trigger if exists absence_reasons_before_trg on public.absence_reasons;
create trigger absence_reasons_before_trg before insert or update on public.absence_reasons
  for each row execute function public.absence_reasons_before();

-- 이유서가 들어오면 서기에게 알림 (임원방 → 불참 이유서)
create or replace function public.absence_reasons_notify()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  m public.meetings%rowtype;
begin
  select * into m from public.meetings where id = new.meeting_id;
  insert into public.notifications (user_id, kind, title, body, dedupe_key)
  select p.id, '불참',
         '[불참 이유서] ' || coalesce(new.name, '') || coalesce(' ' || nullif(new.position, ''), '') ||
           coalesce(' (' || nullif(new.church, '') || ')', ''),
         coalesce(m.kind, '노회') || ' ' || coalesce(to_char(m.meet_date, 'FMYYYY년 FMMM월 FMDD일'), '') || chr(10) ||
           '사유: ' || new.reason_kind || ' — ' || left(new.reason, 300) || chr(10) || chr(10) ||
           '임원방 → 불참 이유서에서 볼 수 있습니다.',
         'absence-' || new.id
    from public.profiles p
   where p.role = 'clerk' and not coalesce(p.suspended, false)
     and not exists (select 1 from public.notifications n where n.user_id = p.id and n.dedupe_key = 'absence-' || new.id);
  return null;
end
$fn$;
drop trigger if exists absence_reasons_notify_trg on public.absence_reasons;
create trigger absence_reasons_notify_trg after insert on public.absence_reasons
  for each row execute function public.absence_reasons_notify();

-- 확인:
--   select m.kind, m.meet_date, a.name, a.church, a.reason_kind, a.reason, a.status
--     from public.absence_reasons a join public.meetings m on m.id = a.meeting_id order by a.id desc;

-- =====================================================================
--  18. 정기노회 서류 알림
--
--  근거 : 시화산노회 규칙
--    제36조 (서류 제출) 모든 청원서류나 제출서류 등은 노회에서 규정한
--           서식대로 당회장이 시찰회에 제출하여 진단받고 서기에게 접수시켜야 한다.
--    제28조 (상회비 납부) 일시납일 경우 노회 개회 2주 전까지 완납하여야 한다.
--    제29조 (상회비 미납 규정) 미납 시 각종 서류·증명서의 발급과 접수가 중지된다.
--
--  정기노회 날짜와 장소가 확정되면, 그 날로부터 40일 전부터
--    · 시찰장과 서기에게 : 이번 회기에 접수해야 할 서류 안내
--    · 부목사가 있는 교회의 담임목사에게 : 부목사 계속 청빙 청원 안내
--  를 알림함으로 보냅니다.
--
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 정기노회 일정
-- ---------------------------------------------------------------------
create table if not exists public.meetings (
  id          bigserial primary key,
  kind        text not null default '봄 정기노회',   -- 봄 정기노회 / 가을 정기노회 / 임시노회
  year        integer,
  meet_date   date,
  place       text,
  confirmed   boolean not null default false,        -- 날짜와 장소가 확정되었는가
  lead_days   integer not null default 40,           -- 며칠 전부터 알릴 것인가
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists meetings_date_idx on public.meetings (meet_date);

alter table public.meetings enable row level security;

-- 일정은 회원 누구나 보고, 등록·수정은 관리자가 한다
drop policy if exists meetings_read  on public.meetings;
drop policy if exists meetings_write on public.meetings;
create policy meetings_read  on public.meetings for select using (true);
create policy meetings_write on public.meetings for all
  using (public.can_manage()) with check (public.can_manage());


-- ---------------------------------------------------------------------
-- 2. 같은 알림이 두 번 가지 않도록 표식을 둔다
-- ---------------------------------------------------------------------
alter table public.notifications add column if not exists dedupe_key text;
create index if not exists notifications_dedupe_idx
  on public.notifications (user_id, dedupe_key);


-- ---------------------------------------------------------------------
-- 3. 알림 보내기
--    홈페이지에 누가 들어오든 하루에 한 번꼴로 조용히 실행되며,
--    이미 보낸 알림은 다시 보내지 않는다.
-- ---------------------------------------------------------------------
create or replace function public.run_reminders()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  m           record;
  v_sent      integer := 0;
  v_docs      text;
  v_assoc     text;
  v_when      text;
begin
  if auth.uid() is null then
    return 0;
  end if;

  for m in
    select * from public.meetings
     where confirmed
       and meet_date is not null
       and meet_date >= current_date
       and meet_date <= current_date + coalesce(lead_days, 40)
  loop
    v_when := to_char(m.meet_date, 'YYYY년 M월 D일') ||
              coalesce(' · ' || m.place, '') ||
              ' (' || (m.meet_date - current_date) || '일 남음)';

    -- ---------------------------------------------------------------
    -- (1) 시찰장·서기에게 : 이번 회기 접수 서류 안내
    -- ---------------------------------------------------------------
    v_docs :=
      m.kind || ' 일정이 확정되었습니다.' || chr(10) ||
      '일시·장소 : ' || v_when || chr(10) || chr(10) ||
      '노회규칙 제36조에 따라 모든 청원서류는 ' ||
      '당회장이 시찰회에 제출하여 진단받은 뒤 서기에게 접수시켜야 합니다. ' ||
      '시찰회 진단에 걸리는 기간을 감안하여 미리 준비해 주시기 바랍니다.' || chr(10) || chr(10) ||
      '[이번 회기에 접수될 수 있는 주요 청원]' || chr(10) ||
      '· 청빙 청원 (위임·시무목사 / 부목사·부목사 계속)' || chr(10) ||
      '· 목사고시 · 장로고시 · 전도사고시 청원' || chr(10) ||
      '· 신학입학 추천 청원' || chr(10) ||
      '· 당회조직 · 장로증원 청원' || chr(10) ||
      '· 교회가입 · 교회주소 · 명칭 변경 청원' || chr(10) ||
      '· 이명이래 · 이명이거 청원' || chr(10) ||
      '· 각종 연기 청원 (한 노회기에 한하여 가능)' || chr(10) ||
      '· 목사 시무 사면 청원' || chr(10) || chr(10) ||
      '청원별 구비서류는 자료실 → 서식 → 구비서류 안내에서 확인하실 수 있습니다.' || chr(10) ||
      '상회비를 일시납하는 교회는 노회 개회 2주 전까지 완납해야 합니다. ' ||
      '미납 시 규칙 제29조에 따라 서류의 발급과 접수가 중지됩니다.';

    insert into public.notifications (user_id, kind, title, body, dedupe_key)
    select p.id, '서류 안내',
           '[' || m.kind || '] 접수 서류를 준비해 주세요 (' || (m.meet_date - current_date) || '일 전)',
           v_docs,
           'meet-docs-' || m.id
      from public.profiles p
     where (
             p.role in ('president', 'clerk', 'staff')
             or exists (                       -- 시찰장 (시찰 정보의 맨 앞 이름으로 찾는다)
               select 1 from public.sichals s
                where s.head is not null
                  and split_part(btrim(s.head), ' ', 1) = p.name
             )
           )
       and not exists (
             select 1 from public.notifications n
              where n.user_id = p.id and n.dedupe_key = 'meet-docs-' || m.id
           );
    get diagnostics v_sent = row_count;

    -- ---------------------------------------------------------------
    -- (2) 부목사가 있는 교회의 담임목사에게 : 부목사 계속 청빙 청원 안내
    -- ---------------------------------------------------------------
    v_assoc :=
      m.kind || '가 다가옵니다.' || chr(10) ||
      '일시·장소 : ' || v_when || chr(10) || chr(10) ||
      '귀 교회에 부목사가 시무하고 있습니다. ' ||
      '부목사는 위임목사와 달리 시무 기간이 정해져 있어, ' ||
      '기간이 끝나기 전에 노회에 <계속 청빙 청원>을 올려야 시무 근거가 이어집니다.' || chr(10) || chr(10) ||
      '[부목사 청빙(계속) 청원 구비서류]' || chr(10) ||
      '· 당회장 청원서 1통' || chr(10) ||
      '· 당회록 사본 1통' || chr(10) || chr(10) ||
      '노회규칙 제36조에 따라 당회장이 시찰회에 제출하여 진단받은 뒤 ' ||
      '서기에게 접수시켜야 하므로, 시찰회 일정을 먼저 확인해 주시기 바랍니다.';

    insert into public.notifications (user_id, kind, title, body, dedupe_key)
    select p.id, '청원 안내',
           '[' || m.kind || '] 부목사 계속 청빙 청원을 준비해 주세요 (' || (m.meet_date - current_date) || '일 전)',
           v_assoc,
           'assoc-call-' || m.id
      from public.profiles p
     where exists (
             select 1
               from public.roster senior
               join public.roster assoc
                 on assoc.church = senior.church
                and assoc.category = '부목사'
              where senior.category = '목사'
                and senior.name = p.name
                and senior.church = p.church
           )
       and not exists (
             select 1 from public.notifications n
              where n.user_id = p.id and n.dedupe_key = 'assoc-call-' || m.id
           );
    get diagnostics v_sent = v_sent + row_count;
  end loop;

  return v_sent;
end;
$fn$;

revoke all on function public.run_reminders() from public;
grant execute on function public.run_reminders() to authenticated;

comment on function public.run_reminders() is
  '정기노회 40일 전부터 시찰장·서기에게 접수 서류를, 부목사가 있는 교회의 담임목사에게 계속 청빙 청원을 알린다. 이미 보낸 알림은 다시 보내지 않는다.';


-- ---------------------------------------------------------------------
-- 4. 다음 정기노회 자리를 미리 만들어 둔다 (날짜·장소는 관리자가 채운다)
-- ---------------------------------------------------------------------
insert into public.meetings (kind, year, confirmed, note)
select * from (values
  ('봄 정기노회',   extract(year from current_date)::int, false, '날짜와 장소를 확정하시면 40일 전부터 알림이 나갑니다.'),
  ('가을 정기노회', extract(year from current_date)::int, false, '날짜와 장소를 확정하시면 40일 전부터 알림이 나갑니다.')
) as v(kind, year, confirmed, note)
where not exists (select 1 from public.meetings);

select count(*) as "등록된 정기노회 일정" from public.meetings;

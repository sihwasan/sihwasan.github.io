-- =====================================================================
--  45. 명단 정리(직분 통합·생년월일·일반회원)와 보고서 노회 제출
--
--  (1) 직분과 조직 분류를 하나로
--      두 칸이 거의 같은 말을 담고 있어 헷갈렸습니다. 이제 조직 분류의
--      항목(목사·부목사·원로목사·은퇴목사·무임목사·장로)만 씁니다.
--      담아 두는 자리는 그대로 두되(다른 화면이 position 을 읽습니다)
--      두 칸이 늘 같은 값을 갖도록 맞춥니다.
--
--  (2) 일반회원
--      총회 정년은 만 70세입니다. 정년이 지나면 정회원이 아니라
--      <일반회원>이 됩니다. 그동안은 <승인대기>로 떨어져 마치 가입이
--      덜 끝난 것처럼 보였는데, 이제 제 이름으로 부릅니다.
--      열람 범위는 예전과 같습니다(정회원 전용 자료는 보이지 않습니다).
--
--  (3) 관내 교회의 장로
--      교회마다 장로를 적어 둡니다. 노회 명단에 올라 있으면 <총대장로>로,
--      명단에 없으면 그냥 <장로>로 보여 주고, 총대는 남은 임기도 함께
--      알려 줍니다.
--
--  (4) 시찰 보고서를 노회 서기에게 제출
--      각 교회가 시찰에 낸 교회상황 보고서를, 시찰장·서기가 한 해치를
--      모아 노회 서기에게 제출합니다. 언제 누가 몇 곳을 냈는지 남습니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 직분 = 조직 분류
--    조직 분류가 정해진 분은 직분을 거기에 맞춥니다.
--    (조직 분류가 비어 있으면 예전 직분을 그대로 조직 분류로 옮깁니다)
-- ---------------------------------------------------------------------
update public.roster
   set category = position
 where coalesce(btrim(category), '') = ''
   and coalesce(btrim(position), '') <> '';

update public.roster
   set position = category
 where coalesce(btrim(category), '') <> ''
   and coalesce(position, '') is distinct from category;


-- 직위 순서는 이제 조직 분류만 보면 된다.
-- (자리 표시는 그대로 두 칸을 받아 다른 곳에서 부르던 방식을 지킨다)
create or replace function public.roster_rank(p_category text, p_position text)
returns integer language sql immutable as $fn$
  select case coalesce(nullif(btrim(p_category), ''), btrim(coalesce(p_position, '')))
    when '목사'     then 1
    when '부목사'   then 2
    when '원로목사' then 3
    when '은퇴목사' then 4
    when '무임목사' then 5
    when '장로'     then 6
    else 9
  end;
$fn$;


-- ---------------------------------------------------------------------
-- 2. 일반회원 (정년이 지난 회원)
-- ---------------------------------------------------------------------

-- 정회원 열람 자격에서 일반회원을 뺀다.
-- (정년 검사는 이미 걸려 있으므로 등급 이름만 더한다)
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role not in ('pending', 'general')
       and coalesce(p.suspended, false) = false
       and not public.is_retired(p.birth_date)
  );
$fn$;

-- 가입할 때 : 정년이 지났으면 <승인대기>가 아니라 <일반회원>으로
create or replace function public.register_member(
  p_name text, p_church text, p_position text, p_phone text)
returns table (out_role text, out_title text)
language plpgsql security definer set search_path = public as $fn$
declare
  v_role  text;
  v_title text;
  v_norm  text := regexp_replace(regexp_replace(p_church, '\s', '', 'g'), '교회$', '');
  v_name  text := regexp_replace(p_name, '\s', '', 'g');
  v_birth date;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select r.role, r.officer_title into v_role, v_title
    from public.roster r
   where regexp_replace(r.name, '\s', '', 'g') = v_name
     and regexp_replace(regexp_replace(r.church, '\s', '', 'g'), '교회$', '') = v_norm
   limit 1;

  if v_role is null then
    v_role := 'pending';
    v_title := null;
  end if;

  -- 정년(만 70세)이 지났으면 정회원·임원 등급 대신 일반회원으로 둔다
  select p.birth_date into v_birth from public.profiles p where p.id = auth.uid();
  if public.is_retired(v_birth) and v_role in ('member', 'officer') then
    v_role := 'general';
    v_title := null;
  end if;

  update public.profiles p
     set name = p_name,
         church = p_church,
         position = p_position,
         phone = p_phone,
         updated_at = now(),
         -- 최고관리자와 관리자가 직접 지정한 등급은 낮추지 않는다
         role  = case when p.role = 'superadmin' then p.role else v_role end,
         title = case when p.role = 'superadmin' then p.title else v_title end
   where p.id = auth.uid();

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select auth.uid(), p.email, p_name, p.role, 'update', '회원정보 등록',
         p_name || ' / ' || p_church || ' → ' || p.role
    from public.profiles p where p.id = auth.uid();

  return query
    select p.role, p.title from public.profiles p where p.id = auth.uid();
end;
$fn$;

-- 명단에 이미 생년월일이 적혀 있고 정년이 지난 분은 일반회원으로 옮긴다
update public.roster
   set role = 'general', officer_title = null
 where public.is_retired(birth_date)
   and role in ('member', 'officer');


-- ---------------------------------------------------------------------
-- 3. 관내 교회의 장로
--    교회마다 장로를 적어 둡니다. 이름은 쉼표로 나눕니다.
--    노회 명단(roster)에 장로로 올라 있는 분은 <총대장로>,
--    명단에 없는 분은 그냥 <장로>로 보여 줍니다. (화면에서 대조합니다)
-- ---------------------------------------------------------------------
alter table public.sichal_churches add column if not exists elders text;


-- ---------------------------------------------------------------------
-- 4. 시찰 보고서를 노회 서기에게 제출
-- ---------------------------------------------------------------------
create table if not exists public.sichal_report_submissions (
  id            bigserial primary key,
  year          integer not null,
  sichal        text not null,
  churches      integer not null default 0,   -- 낸 교회 수
  note          text,
  submitted_by  text,
  user_id       uuid references auth.users on delete set null,
  submitted_at  timestamptz not null default now()
);
create unique index if not exists sichal_report_sub_idx
  on public.sichal_report_submissions (year, sichal);

alter table public.sichal_report_submissions enable row level security;

drop policy if exists sichal_report_sub_read   on public.sichal_report_submissions;
drop policy if exists sichal_report_sub_write  on public.sichal_report_submissions;

-- 노회 임원과 그 시찰 사람은 볼 수 있다
create policy sichal_report_sub_read on public.sichal_report_submissions for select
  using (public.is_officer() or public.is_member());
-- 넣고 빼는 일은 아래 함수로만 한다
create policy sichal_report_sub_write on public.sichal_report_submissions for all
  using (public.can_manage()) with check (public.can_manage());


-- 제출하기 — 시찰장·서기(그리고 노회 관리자)
create or replace function public.submit_sichal_reports(
  p_year integer, p_sichal text, p_note text default null)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_cnt  integer;
  v_who  text;
begin
  if not (public.is_sichal_officer(p_sichal) or public.can_manage()) then
    raise exception '시찰장·서기만 노회에 제출할 수 있습니다.';
  end if;

  select count(*) into v_cnt
    from public.church_reports r
   where r.year = p_year and r.sichal = p_sichal;

  if v_cnt = 0 then
    raise exception '제출할 보고서가 없습니다. 교회들이 먼저 보고서를 올려야 합니다.';
  end if;

  select btrim(coalesce(p.name, '') || ' ' ||
               coalesce(nullif(p.title, ''), coalesce(p.position, '')))
    into v_who
    from public.profiles p where p.id = auth.uid();

  insert into public.sichal_report_submissions
         (year, sichal, churches, note, submitted_by, user_id, submitted_at)
  values (p_year, p_sichal, v_cnt, nullif(btrim(coalesce(p_note, '')), ''),
          nullif(btrim(coalesce(v_who, '')), ''), auth.uid(), now())
  on conflict (year, sichal) do update
     set churches = excluded.churches,
         note = excluded.note,
         submitted_by = excluded.submitted_by,
         user_id = excluded.user_id,
         submitted_at = now();

  -- 노회 서기·노회장·간사에게 알린다
  insert into public.notifications (user_id, kind, title, body, dedupe_key)
  select p.id, '보고서',
         '[' || p_sichal || '] ' || p_year || '년 교회상황 보고서를 제출했습니다',
         '교회 ' || v_cnt || '곳' ||
         coalesce(' · ' || nullif(btrim(coalesce(p_note, '')), ''), ''),
         'sic-rep-' || p_year || '-' || p_sichal || '-' || to_char(now(), 'YYYYMMDDHH24MI')
    from public.profiles p
   where p.role in ('president', 'clerk', 'staff');

  return v_cnt;
end;
$fn$;

grant execute on function public.submit_sichal_reports(integer, text, text) to authenticated;


-- 제출 취소 — 잘못 눌렀을 때
create or replace function public.unsubmit_sichal_reports(p_year integer, p_sichal text)
returns integer language plpgsql security definer set search_path = public as $fn$
declare v_n integer := 0;
begin
  if not (public.is_sichal_officer(p_sichal) or public.can_manage()) then
    raise exception '시찰장·서기만 제출을 취소할 수 있습니다.';
  end if;
  delete from public.sichal_report_submissions
   where year = p_year and sichal = p_sichal;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

grant execute on function public.unsubmit_sichal_reports(integer, text) to authenticated;


-- 확인
select (select count(*) from information_schema.columns
         where table_schema='public' and table_name='sichal_churches'
           and column_name='elders')                                    as "장로 칸",
       (select count(*) from public.roster
         where coalesce(position,'') is distinct from coalesce(category,'')) as "직분≠조직분류 (0이어야 정상)",
       (select count(*) from public.roster where role = 'general')           as "일반회원",
       (select count(*) from public.sichal_report_submissions)               as "제출 기록";

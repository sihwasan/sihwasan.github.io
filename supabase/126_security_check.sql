-- =====================================================================
--  126. 보안 점검 — 매일 스스로 점검하고 최고관리자 알림함으로 보고 (2026-10-20)
--
--  서버(DB) 안에서 의심스러운 일과 허술한 설정을 찾아 기록하고 알린다.
--    · 매일 오전 7시(한국 시각) 점검 — pg_cron 예약.  예약을 못 하면 홈페이지에 누가 들어올 때
--      하루 한 번 점검한다 (security_check_due, js/main.js).
--    · 알림: 「위험」이 나오면 그날 바로, 그리고 매주 월요일에 한 주 요약 (이상이 없어도) — 최고관리자에게.
--    · 결과는 시스템 운영 → 「보안 점검」 탭에서 본다 (지금 점검 단추도 있다).
--
--  점검 항목
--    [위험] 보호(RLS)가 꺼진 표 — 누구나 읽고 고칠 수 있음
--    [위험/주의] OTP 숫자를 여러 번 틀린 계정 (하루 10번 이상 위험, 5번 이상 주의) — 비밀번호가 새어 나갔을 수 있음
--    [주의] 아무나(로그인 없이도) 쓰기·고치기·지우기가 열린 규칙
--    [주의] 임원 등급인데 2단계 인증(OTP)을 등록하지 않은 계정
--    [주의] 서버 잠금(124)이 걸려 있지 않음
--    [주의] 최고관리자 계정이 둘 이상
--    [주의] 최근 7일 새로 생긴 임원 등급 계정
--    [주의] 관리자·임원의 비밀번호 재설정 요청, 하루 4곳 이상에서 로그인 (로그인 기록이 DB 에 남는 경우)
--    [주의] 하루 가입 15건 이상 (가짜 가입 의심), 한 사람이 하루 30건 이상 삭제
--    [주의] 검색 경로(search_path)가 고정되지 않은 SECURITY DEFINER 함수
--    [참고] 최근 7일 등급·권한 변경 기록, 공개 저장소(버킷), 승인 대기 가입자 수
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--        마지막에 첫 점검 결과가 표로 보이고, 최고관리자 알림함에도 첫 보고가 갑니다.
-- =====================================================================

-- 1) 점검 기록
create table if not exists public.security_reports (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  level      text not null check (level in ('정상', '주의', '위험')),
  danger     integer not null default 0,
  warn       integer not null default 0,
  items      jsonb not null default '[]'::jsonb,   -- [{level, title, detail}]
  trigger    text                                  -- cron · visit · manual · first
);
create index if not exists security_reports_created_idx on public.security_reports (created_at desc);
alter table public.security_reports enable row level security;
drop policy if exists security_reports_read on public.security_reports;
create policy security_reports_read on public.security_reports for select
  using (public.my_role() = 'superadmin');

-- 2) 점검 본체 — 사람이 직접 부르지 못한다 (예약·아래 두 함수만 부른다)
create or replace function public.security_check_run(p_trigger text default 'cron')
returns bigint language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_items jsonb := '[]'::jsonb;
  r record;
  t text;
  n integer;
  v_danger integer := 0;
  v_warn integer := 0;
  v_level text;
  v_id bigint;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_has_auth_log boolean := false;
  v_title text;
  v_body text;
  v_key text;
  v_notify boolean := false;
  v_admin text[] := array['superadmin', 'president', 'clerk', 'staff', 'officer'];
begin
  -- [위험] 보호(RLS)가 꺼진 표
  select string_agg(c.relname, ', ' order by c.relname), count(*) into t, n
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if n > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object('level', '위험',
      'title', '보호(RLS)가 꺼진 표 ' || n || '개',
      'detail', left(t, 400) || ' — 로그인하지 않은 사람도 읽고 고칠 수 있습니다. alter table … enable row level security 로 켜야 합니다.'));
  end if;

  -- [위험/주의] OTP 숫자를 여러 번 틀린 계정 (최근 24시간)
  begin
    for r in
      select f.user_id, count(*) as cnt
        from auth.mfa_challenges ch join auth.mfa_factors f on f.id = ch.factor_id
       where ch.created_at > now() - interval '1 day' and ch.verified_at is null
       group by f.user_id having count(*) >= 5
    loop
      select coalesce(pr.name, '') || ' (' || coalesce(u.email, '') || ')' into t
        from auth.users u left join public.profiles pr on pr.id = u.id where u.id = r.user_id;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'level', case when r.cnt >= 10 then '위험' else '주의' end,
        'title', 'OTP 숫자를 하루 ' || r.cnt || '번 틀린 계정',
        'detail', coalesce(t, r.user_id::text) || ' — 본인이 아니라면 비밀번호가 새어 나간 것일 수 있습니다. 비밀번호를 바꾸게 해 주세요.'));
    end loop;
  exception when others then null;
  end;

  -- [주의] 아무나 쓰기·고치기·지우기가 열린 규칙
  select string_agg(distinct p.tablename || '(' || p.cmd || ')', ', '), count(*) into t, n
    from pg_policies p
   where p.schemaname = 'public'
     and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and p.roles && array['public', 'anon']::name[]
     and ((p.cmd = 'INSERT' and coalesce(p.with_check, 'true') = 'true')
       or (p.cmd <> 'INSERT' and coalesce(p.qual, 'true') = 'true'));
  if n > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object('level', '주의',
      'title', '아무나 쓸 수 있게 열린 규칙 ' || n || '개',
      'detail', left(t, 400) || ' — 로그인 확인 없이 쓰기가 열려 있습니다. 의도한 것(예: 문의 남기기)인지 확인해 주세요.'));
  end if;

  -- [주의] 임원 등급인데 OTP 를 등록하지 않은 계정
  begin
    select string_agg(coalesce(pr.name, '?') || '(' || pr.role || ')', ', ' order by pr.name), count(*) into t, n
      from public.profiles pr
     where pr.role = any (v_admin)
       and not exists (select 1 from auth.mfa_factors f where f.user_id = pr.id and f.status = 'verified');
    if n > 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object('level', '주의',
        'title', '2단계 인증(OTP)을 등록하지 않은 임원 ' || n || '명',
        'detail', left(t, 400) || ' — 다음 로그인 때 홈페이지가 등록을 안내합니다.'));
    end if;
  exception when others then null;
  end;

  -- [주의] 서버 잠금(124)
  begin
    if position('mfa_ok' in pg_get_functiondef('public.can_manage()'::regprocedure)) = 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object('level', '주의',
        'title', '관리 권한에 OTP 확인 조건(서버 잠금)이 없습니다',
        'detail', 'supabase/124_admin_mfa.sql 을 실행하면 OTP 확인을 마친 로그인에만 관리 권한이 열립니다.'));
    end if;
  exception when others then null;
  end;

  -- [주의] 최고관리자 계정이 둘 이상
  select count(*), string_agg(coalesce(pr.name, '') || ' ' || coalesce(u.email, ''), ', ') into n, t
    from public.profiles pr left join auth.users u on u.id = pr.id
   where pr.role = 'superadmin';
  if n > 1 then
    v_items := v_items || jsonb_build_array(jsonb_build_object('level', '주의',
      'title', '최고관리자 계정이 ' || n || '개',
      'detail', left(t, 400) || ' — 모르는 계정이 있으면 바로 등급을 내려 주세요.'));
  end if;

  -- [주의] 최근 7일 새로 생긴 임원 등급 계정
  select string_agg(coalesce(pr.name, '?') || '(' || pr.role || ', ' ||
                    to_char(u.created_at at time zone 'Asia/Seoul', 'MM-DD') || ' 가입)', ', '), count(*) into t, n
    from public.profiles pr join auth.users u on u.id = pr.id
   where pr.role = any (v_admin) and u.created_at > now() - interval '7 days';
  if n > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object('level', '주의',
      'title', '최근 7일 새로 생긴 임원 등급 계정 ' || n || '개',
      'detail', left(t, 400) || ' — 아는 분인지 확인해 주세요.'));
  end if;

  -- [주의] 관리자·임원의 비밀번호 재설정 요청·여러 곳 로그인 (로그인 기록이 DB 에 남는 경우만)
  begin
    select exists (select 1 from auth.audit_log_entries where created_at > now() - interval '7 days') into v_has_auth_log;
    if v_has_auth_log then
      select string_agg(distinct coalesce(pr.name, '?'), ', '), count(*) into t, n
        from auth.audit_log_entries a join public.profiles pr on pr.id::text = a.payload ->> 'actor_id'
       where a.created_at > now() - interval '1 day'
         and a.payload ->> 'action' in ('user_recovery_requested', 'user_updated_password')
         and pr.role = any (v_admin);
      if n > 0 then
        v_items := v_items || jsonb_build_array(jsonb_build_object('level', '주의',
          'title', '임원 계정의 비밀번호 재설정·변경 ' || n || '건 (24시간)',
          'detail', t || ' — 본인이 한 일인지 확인해 주세요.'));
      end if;
      for r in
        select pr.name, count(distinct a.ip_address) as ips
          from auth.audit_log_entries a join public.profiles pr on pr.id::text = a.payload ->> 'actor_id'
         where a.created_at > now() - interval '1 day'
           and a.payload ->> 'action' = 'login'
           and pr.role = any (v_admin)
         group by pr.name having count(distinct a.ip_address) >= 4
      loop
        v_items := v_items || jsonb_build_array(jsonb_build_object('level', '주의',
          'title', coalesce(r.name, '?') || ' — 하루 ' || r.ips || '곳에서 로그인',
          'detail', '휴대전화·집·사무실 말고 모르는 곳이 섞였을 수 있습니다. 본인에게 확인해 주세요.'));
      end loop;
    end if;
  exception when others then null;
  end;

  -- [주의] 하루 가입 15건 이상
  select count(*) into n from auth.users where created_at > now() - interval '1 day';
  if n >= 15 then
    v_items := v_items || jsonb_build_array(jsonb_build_object('level', '주의',
      'title', '하루 가입 ' || n || '건',
      'detail', '평소보다 많습니다. 회원 관리에서 승인 대기 가입자를 확인해 주세요 (가짜 가입 의심).'));
  end if;

  -- [주의] 한 사람이 하루 30건 이상 삭제
  for r in
    select coalesce(a.user_name, '?') as who, count(*) as cnt
      from public.audit_logs a
     where a.created_at > now() - interval '1 day' and a.type = 'delete'
     group by coalesce(a.user_name, '?') having count(*) >= 30
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object('level', '주의',
      'title', r.who || ' — 하루 ' || r.cnt || '건 삭제',
      'detail', '감사 기록에서 무엇을 지웠는지 확인해 주세요.'));
  end loop;

  -- [주의] 검색 경로가 고정되지 않은 SECURITY DEFINER 함수
  select string_agg(p.proname, ', ' order by p.proname), count(*) into t, n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%');
  if n > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object('level', '주의',
      'title', '검색 경로가 고정되지 않은 관리자 권한 함수 ' || n || '개',
      'detail', left(t, 400) || ' — 각 함수에 set search_path = public 을 붙이면 됩니다.'));
  end if;

  -- [참고] 최근 7일 등급·권한 변경 기록
  select string_agg(to_char(a.created_at at time zone 'Asia/Seoul', 'MM-DD') || ' ' || coalesce(a.user_name, '?') ||
                    ': ' || a.action || coalesce(' ' || nullif(a.detail, ''), ''), ' / ' order by a.created_at), count(*) into t, n
    from public.audit_logs a
   where a.created_at > now() - interval '7 days'
     and (a.action like '%등급%' or a.action like '%권한%' or a.action like '%임명%' or a.action like '%2단계 인증%');
  if n > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object('level', '참고',
      'title', '최근 7일 등급·권한 관련 기록 ' || n || '건', 'detail', left(t, 600)));
  end if;

  -- [참고] 공개 저장소(버킷)
  begin
    select string_agg(b.name, ', ' order by b.name), count(*) into t, n from storage.buckets b where b.public;
    if n > 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object('level', '참고',
        'title', '누구나 주소만 알면 볼 수 있는 저장소 ' || n || '개',
        'detail', t || ' — 사진·공개 자료 외의 파일(개인 서류 등)이 들어 있지 않은지 가끔 확인해 주세요.'));
    end if;
  exception when others then null;
  end;

  -- [참고] 승인 대기 가입자
  select count(*) into n from public.profiles where role = 'pending';
  if n > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object('level', '참고',
      'title', '승인 대기 가입자 ' || n || '명', 'detail', '회원 관리에서 아는 분인지 확인한 뒤 승인하거나 지워 주세요.'));
  end if;

  -- 결과 정리
  select count(*) filter (where x ->> 'level' = '위험'), count(*) filter (where x ->> 'level' = '주의')
    into v_danger, v_warn
    from jsonb_array_elements(v_items) x;
  v_level := case when v_danger > 0 then '위험' when v_warn > 0 then '주의' else '정상' end;

  insert into public.security_reports (level, danger, warn, items, trigger)
  values (v_level, v_danger, v_warn, v_items, p_trigger)
  returning id into v_id;
  delete from public.security_reports where created_at < now() - interval '180 days';

  -- 알림: 위험이면 그날 바로, 월요일에는 한 주 요약, 처음 실행 때는 첫 보고 (지금 점검 단추는 화면으로 본다)
  if p_trigger in ('cron', 'visit') and v_danger > 0 then
    v_notify := true; v_key := 'sec-danger-' || v_today;
  end if;
  if p_trigger in ('cron', 'visit') and extract(isodow from v_today) = 1 then
    v_notify := true; v_key := 'sec-week-' || v_today;
  end if;
  if p_trigger = 'first' then
    v_notify := true; v_key := 'sec-first-' || v_id;
  end if;

  if v_notify then
    v_title := '[보안 점검] ' || case when v_level = '정상' then '이상 없음'
                                       else concat_ws(' · ', nullif('위험 ' || v_danger || '건', '위험 0건'),
                                                             nullif('주의 ' || v_warn || '건', '주의 0건')) end ||
               ' (' || to_char(v_today, 'MM-DD') || case when v_key like 'sec-week-%' then ' 주간 보고' else '' end || ')';
    select string_agg('· [' || (x ->> 'level') || '] ' || (x ->> 'title'), chr(10)) into v_body
      from (select x from jsonb_array_elements(v_items) x where x ->> 'level' in ('위험', '주의') limit 10) q;
    v_body := coalesce(v_body, '점검한 항목에서 이상한 점을 찾지 못했습니다.') || chr(10) || chr(10) ||
              '자세한 내용은 시스템 운영 → 보안 점검에서 보실 수 있습니다.';
    insert into public.notifications (user_id, kind, title, body, dedupe_key)
    select p.id, '보안', v_title, v_body, v_key
      from public.profiles p
     where p.role = 'superadmin'
       and not exists (select 1 from public.notifications n2 where n2.user_id = p.id and n2.dedupe_key = v_key);
  end if;

  return v_id;
end
$fn$;
revoke all on function public.security_check_run(text) from public, anon, authenticated;

-- 3) 최고관리자의 「지금 점검」 (알림은 보내지 않고 화면에 결과를 보인다)
create or replace function public.run_security_check_now()
returns bigint language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(public.my_role(), '') <> 'superadmin' then
    raise exception '최고관리자만 보안 점검을 실행할 수 있습니다.';
  end if;
  return public.security_check_run('manual');
end
$fn$;
revoke all on function public.run_security_check_now() from public, anon;
grant execute on function public.run_security_check_now() to authenticated;

-- 4) 예약이 안 될 때의 대비 — 홈페이지 방문 때 하루 한 번 (20시간 안에 점검했으면 건너뛴다)
create or replace function public.security_check_due()
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not pg_try_advisory_xact_lock(hashtext('shs-security-check')) then return; end if;
  if exists (select 1 from public.security_reports where created_at > now() - interval '20 hours') then return; end if;
  perform public.security_check_run('visit');
end
$fn$;
revoke all on function public.security_check_due() from public, anon;
grant execute on function public.security_check_due() to authenticated;

-- 5) 매일 오전 7시(한국 시각 = 22:00 UTC) 예약 — pg_cron 이 없으면 4) 로 대신한다
do $do$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron 을 켤 수 없습니다 (%). 홈페이지 방문 때 하루 한 번 점검합니다.', sqlerrm;
    return;
  end;
  perform cron.schedule('shs-security-check', '0 22 * * *', $c$select public.security_check_run('cron')$c$);
  raise notice '매일 오전 7시(한국 시각)에 보안 점검을 예약했습니다.';
exception when others then
  raise notice '예약하지 못했습니다 (%). 홈페이지 방문 때 하루 한 번 점검합니다.', sqlerrm;
end
$do$;

-- 6) 첫 점검 — 최고관리자 알림함에 첫 보고를 보내고, 아래에 결과를 보인다
select public.security_check_run('first') as "점검 번호";

select r.level as "결과", x ->> 'level' as "구분", x ->> 'title' as "항목", x ->> 'detail' as "내용"
  from public.security_reports r
  left join lateral jsonb_array_elements(r.items) x on true
 where r.id = (select max(id) from public.security_reports);

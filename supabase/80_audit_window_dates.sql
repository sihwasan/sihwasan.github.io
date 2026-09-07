-- =====================================================================
--  80. 감사 기간을 날짜로 정한다 (시작일 ~ 종료일, 보통 2주)
--
--  전에는 3월·9월 한 달 내내 저절로 감사 기간이 열려, 감사부에게 장부가
--  필요 이상으로 오래 보였다. 이제는 노회 관리자가 <사이트 관리 → 감사 기간>
--  에서 정한 시작일~종료일 안에만 열린다. 이 날짜 하나가
--    · 감사부장·서기의 장부 열람 (can_read_ledger)
--    · 감사필 처리 (set_audit_mark)
--    · 회기 마감 승인 (approve_ledger_close)
--    · 대시보드 <감사> 카드
--  를 모두 같이 켜고 끈다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 79_committee_treasurer_audit_box.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 지금이 감사 기간인가 — 정해 둔 날짜 안에만 (한국 시각 기준)
--    site_settings.audit_window = { from, until, year, period, note, by, at }
-- ---------------------------------------------------------------------
create or replace function public.audit_window_open()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select (value->>'from')::date <= (now() at time zone 'Asia/Seoul')::date
       and (now() at time zone 'Asia/Seoul')::date <= (value->>'until')::date
      from public.site_settings
     where key = 'audit_window'
       and value->>'from'  ~ '^\d{4}-\d{2}-\d{2}$'
       and value->>'until' ~ '^\d{4}-\d{2}-\d{2}$'
  ), false);
$fn$;
grant execute on function public.audit_window_open() to authenticated;


-- ---------------------------------------------------------------------
-- 2. 예전 설정(켜짐/꺼짐 스위치)을 날짜로 바꿔 둔다
--    켜져 있었으면 오늘부터 2주로, 꺼져 있었으면 어제로(닫힌 채) 옮긴다.
-- ---------------------------------------------------------------------
do $mig$
declare
  cur date := (now() at time zone 'Asia/Seoul')::date;
  v   jsonb;
begin
  select value into v from public.site_settings where key = 'audit_window';
  if v is null then
    insert into public.site_settings (key, value) values ('audit_window', '{}'::jsonb)
    on conflict (key) do nothing;
    v := '{}'::jsonb;
  end if;
  if (v->>'from') is null or (v->>'until') is null then
    update public.site_settings
       set value = (v - 'open') || jsonb_build_object(
             'from',   to_char(case when coalesce((v->>'open')::boolean, false) then cur else cur - 14 end, 'YYYY-MM-DD'),
             'until',  to_char(case when coalesce((v->>'open')::boolean, false) then cur + 13 else cur - 1 end, 'YYYY-MM-DD'),
             'year',   coalesce((v->>'year')::integer, extract(year from cur)::integer),
             'period', coalesce(v->>'period', case when extract(month from cur) >= 7 then '가을' else '봄' end),
             'note',   coalesce(v->>'note', '')),
           updated_at = now()
     where key = 'audit_window';
  end if;
end
$mig$;


-- ---------------------------------------------------------------------
-- 3. 관리자가 감사 기간을 정한다 — 감사부장·서기와 노회 회계에게 알림
-- ---------------------------------------------------------------------
create or replace function public.set_audit_window(
  p_from date, p_until date, p_year integer, p_period text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_me  text;
  cur   date := (now() at time zone 'Asia/Seoul')::date;
  v_val jsonb;
  v_ttl text;
  v_bdy text;
begin
  if not public.can_manage() then
    raise exception '감사 기간은 노회 관리자(노회장·서기·간사)가 정합니다.';
  end if;
  if p_from is null or p_until is null then raise exception '시작일과 종료일을 정해 주세요.'; end if;
  if p_from > p_until then raise exception '종료일이 시작일보다 앞설 수 없습니다.'; end if;
  if p_period not in ('봄', '가을') then raise exception '봄 또는 가을을 골라 주세요.'; end if;

  select name into v_me from public.profiles where id = auth.uid();
  v_val := jsonb_build_object(
    'from', to_char(p_from, 'YYYY-MM-DD'), 'until', to_char(p_until, 'YYYY-MM-DD'),
    'year', p_year, 'period', p_period, 'note', coalesce(btrim(p_note), ''),
    'by', coalesce(v_me, ''), 'at', now());
  insert into public.site_settings (key, value, updated_at)
  values ('audit_window', v_val, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  if p_until < cur then
    v_ttl := '[감사] ' || p_year || '년 ' || p_period || ' 감사 기간이 끝났습니다';
    v_bdy := coalesce(v_me, '노회 관리자') || ' 님이 감사 기간을 ' || to_char(p_until, 'YYYY.MM.DD') ||
             ' 로 마쳤습니다. 이제 감사부에게 장부가 보이지 않습니다.';
  else
    v_ttl := '[감사] ' || p_year || '년 ' || p_period || ' 감사 기간: ' ||
             to_char(p_from, 'MM.DD') || ' ~ ' || to_char(p_until, 'MM.DD');
    v_bdy := coalesce(v_me, '노회 관리자') || ' 님이 감사 기간을 ' || to_char(p_from, 'YYYY.MM.DD') || ' ~ ' ||
             to_char(p_until, 'YYYY.MM.DD') || ' 로 정했습니다. 이 기간에 대시보드의 <감사> 카드에서 ' ||
             '재정부·상비부·시찰 회계 장부를 살펴 감사필 처리와 회기 마감 승인을 할 수 있습니다.' ||
             (case when coalesce(btrim(p_note), '') <> '' then ' 메모: ' || btrim(p_note) else '' end);
  end if;

  insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
  select u, '회계', v_ttl, v_bdy,
         'audit-window-' || to_char(p_from, 'YYYYMMDD') || '-' || to_char(p_until, 'YYYYMMDD'),
         auth.uid(), v_me
    from (
      select u from public.audit_reviewer_ids() as u
      union
      select p.id from public.profiles p
       where p.role = 'officer' and btrim(coalesce(p.title, '')) in ('회계', '부회계')
         and coalesce(p.suspended, false) = false
    ) t;
end
$fn$;
grant execute on function public.set_audit_window(date, date, integer, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 감사필 처리도 감사 기간에만 (화면뿐 아니라 데이터베이스에서 막는다)
-- ---------------------------------------------------------------------
create or replace function public.set_audit_mark(
  p_kind       text,
  p_id         bigint,
  p_done       boolean,
  p_year       integer  default null,
  p_period     text     default null,
  p_opinion    text     default null,
  p_head       text     default null,
  p_clerk      text     default null,
  p_head_seal  text     default null,
  p_clerk_seal text     default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_me   text;
  v_what text;
begin
  if p_kind not in ('sichal_minutes', 'committee_minutes', 'ledger_books') then
    raise exception '감사할 수 없는 자료입니다.';
  end if;
  if not public.is_audit_officer() then
    raise exception '감사 처리는 감사부(감사헌의부)만 할 수 있습니다.';
  end if;
  if p_done and not public.audit_window_open() and public.my_role() <> 'superadmin' then
    raise exception '감사 기간이 아닙니다. 노회 관리자가 사이트 관리 → 감사 기간에서 날짜를 정하면 감사필 처리를 할 수 있습니다.';
  end if;

  select name into v_me from public.profiles where id = auth.uid();

  if p_done then
    execute format($f$
      update public.%I
         set audited_yn = true, audit_year = $1, audit_period = $2, audit_opinion = $3,
             audit_head = $4, audit_clerk = $5,
             audit_head_seal = $6, audit_clerk_seal = $7,
             audited_at = now(), audited_by = $8
       where id = $9
    $f$, p_kind)
    using p_year, p_period, p_opinion, p_head, p_clerk,
          p_head_seal, p_clerk_seal, coalesce(v_me, '감사부'), p_id;
    v_what := '감사필 처리';
  else
    execute format($f$
      update public.%I
         set audited_yn = false, audit_opinion = null,
             audit_head_seal = null, audit_clerk_seal = null,
             audited_at = null, audited_by = null
       where id = $1
    $f$, p_kind)
    using p_id;
    v_what := '감사 표시 해제';
  end if;

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select auth.uid(), p.email, p.name, p.role, 'update', v_what,
         p_kind || ' #' || p_id ||
         coalesce(' / ' || p_year || '년 ' || p_period, '')
    from public.profiles p where p.id = auth.uid();
end
$fn$;

grant execute on function public.set_audit_mark(
  text, bigint, boolean, integer, text, text, text, text, text, text) to authenticated;

-- 확인:
--   select value from public.site_settings where key = 'audit_window';
--   select public.audit_window_open();

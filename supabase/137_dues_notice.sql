-- =====================================================================
--  137. 상회비 3개월 이상 미납 — 납부촉구 공문 · 월례회 보고 (2026-10-21)
--
--  노회규칙 제28조(상회비 납부)·제29조(상회비 미납 규정)에 이어서
--   · 기한 지난 미납(135 의 dues29_late_months)이 3개월 이상인 교회에
--     납부촉구 공문을 보낸다. 공문은 임원방 → 상회비 관리 → 「납부촉구 공문」에서
--     교회를 누르면 저절로 만들어지고, 인쇄·PDF 저장과 받는 곳 주소를 본다.
--   · 회계가 월례회 때 「3개월 이상 미납 보고서」를 만들어 보고하면(dues_reports)
--     회계·서기·노회장이 알림으로 보고를 받고, 서기가 공문을 발송한다.
--   · 서기가 발송을 기록하면(dues_notices) 회계·노회장에게 알림이 간다.
--   · 임원 업무 보고서(월례)가 발송 기록을 읽을 수 있게 ai_report_dues_notices(열쇠)를 둔다.
--
--  누가
--    보기          관리자(노회장·서기·간사·최고관리자)·회계·부회계
--    보고서 쓰기    관리자·회계 (is_dues_manager — 77 sql)
--    발송 기록      서기·최고관리자 (노회 공문은 서기가 발송한다)
--
--  알림 바로 가기: dedupe_key 가 'dues29-sum-' 로 시작하면 main.js 가 임원방 상회비 관리로 보낸다.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--  (drop policy · revoke 가 있어 「Potential issue detected」 창이 뜨면 Run query 를 한 번 더 누릅니다)
-- =====================================================================

-- 0. 누가 -------------------------------------------------------------------
-- 상회비를 볼 수 있는 임원 (관리자·회계·부회계)
create or replace function public.dues_notice_viewer()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.can_manage() or public.is_presbytery_treasurer() or public.is_presbytery_vice_treasurer();
$fn$;
grant execute on function public.dues_notice_viewer() to authenticated;

-- 공문을 발송(기록)하는 분 — 서기와 최고관리자
create or replace function public.dues_notice_sender()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role in ('clerk', 'superadmin'));
$fn$;
grant execute on function public.dues_notice_sender() to authenticated;

-- 상회비 납부 계좌 (공문에 적는다 — 관리자가 사이트 설정에서 고친다)
insert into public.site_settings (key, value)
values ('dues_pay', '{"bank": "", "account": "", "holder": "시화산노회"}'::jsonb)
on conflict (key) do nothing;


-- 1. 공문 발송 기록 ---------------------------------------------------------
create table if not exists public.dues_notices (
  id          bigserial primary key,
  fy          int  not null,                      -- 상회비 회기 (4월 시작)
  church      text not null,                      -- dues_rates.church 와 같은 이름
  doc_no      text,                               -- 문서번호 (예: 시화산노 제 20-12 호)
  late_months int[] not null default '{}',        -- 공문에 적은 미납 달 (달력 월)
  late_amount int  not null default 0,            -- 미납액 (만원)
  recipient   text,                               -- 수신 (예: 반석교회 당회장 강명우 목사)
  address     text,                               -- 받는 곳 주소
  sent_on     date not null default ((now() at time zone 'Asia/Seoul')::date),
  sent_by     text,
  sent_uid    uuid default auth.uid(),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists dues_notices_fy_idx on public.dues_notices (fy, church, sent_on desc);

alter table public.dues_notices enable row level security;
drop policy if exists dues_notices_read  on public.dues_notices;
drop policy if exists dues_notices_write on public.dues_notices;
create policy dues_notices_read  on public.dues_notices for select using (public.dues_notice_viewer());
create policy dues_notices_write on public.dues_notices for all
  using (public.dues_notice_sender()) with check (public.dues_notice_sender());

-- 받는 분들: 회계(부회계 제외)·서기·노회장 (최고관리자는 받지 않는다)
create or replace function public.dues_notice_people(p_with_clerk boolean)
returns table(uid uuid) language sql stable security definer set search_path = public as $fn$
  select p.id from public.profiles p
   where coalesce(p.suspended, false) = false
     and (p.role = 'president'
          or (p_with_clerk and p.role = 'clerk')
          or (p.role = 'officer' and btrim(coalesce(p.title, '')) = '회계'));
$fn$;
revoke all on function public.dues_notice_people(boolean) from public, anon, authenticated;

-- 발송을 기록하면 회계·노회장에게 알린다
create or replace function public.dues_notice_after()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_months text := array_to_string(new.late_months, '·') || '월';
begin
  insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
  select x.uid, '상회비',
         left('[상회비] ' || new.church || ' 납부촉구 공문 발송' || coalesce(' (' || nullif(new.doc_no, '') || ')', ''), 200),
         coalesce(nullif(new.sent_by, ''), '서기') || '께서 ' || to_char(new.sent_on, 'YYYY년 FMMM월 FMDD일') || ' ' ||
         coalesce(nullif(new.recipient, ''), new.church) || '께 상회비 납부촉구 공문을 발송했습니다.' || chr(10) ||
         '미납: ' || new.fy || '년 회기 ' || v_months || '분 ' || coalesce(array_length(new.late_months, 1), 0) || '개월, ' ||
         new.late_amount || '만원' ||
         coalesce(chr(10) || '받는 곳: ' || nullif(new.address, ''), '') || chr(10) || chr(10) ||
         '입금되면 회계께서 상회비 관리에 납부를 기록해 주세요.',
         'dues29-sum-notice-' || new.id, new.sent_uid, coalesce(nullif(new.sent_by, ''), '서기')
    from public.dues_notice_people(false) x
   where x.uid is distinct from new.sent_uid;
  return new;
end
$fn$;
drop trigger if exists dues_notice_after_trg on public.dues_notices;
create trigger dues_notice_after_trg
  after insert on public.dues_notices
  for each row execute function public.dues_notice_after();


-- 2. 월례회 보고 -------------------------------------------------------------
create table if not exists public.dues_reports (
  id            bigserial primary key,
  month         text not null,                    -- 보고하는 달 'YYYY-MM' (월례회)
  fy            int  not null,
  rows          jsonb not null default '[]'::jsonb, -- [{church, sichal, pastor, months, count, amount, sent}]
  churches      int  not null default 0,
  total_amount  int  not null default 0,          -- 만원
  reported_by   text,
  reported_uid  uuid default auth.uid(),
  reported_at   timestamptz not null default now(),
  note          text
);
create unique index if not exists dues_reports_month_idx on public.dues_reports (month);

alter table public.dues_reports enable row level security;
drop policy if exists dues_reports_read  on public.dues_reports;
drop policy if exists dues_reports_write on public.dues_reports;
create policy dues_reports_read  on public.dues_reports for select using (public.dues_notice_viewer());
create policy dues_reports_write on public.dues_reports for all
  using (public.is_dues_manager()) with check (public.is_dues_manager());

-- 보고 알림 — 회계·서기·노회장. 서기에게는 공문 발송을 부탁한다.
create or replace function public.dues_report_notify(p_id bigint)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_r    public.dues_reports%rowtype;
  v_list text := '';
  v_x    jsonb;
  v_left int := 0;
  v_n    int := 0;
  v_key  text;
begin
  if not public.is_dues_manager() then
    raise exception '상회비 보고는 노회 관리자와 노회 회계만 보낼 수 있습니다.';
  end if;
  select * into v_r from public.dues_reports where id = p_id;
  if v_r.id is null then raise exception '보고서를 찾을 수 없습니다.'; end if;

  for v_x in select * from jsonb_array_elements(v_r.rows) loop
    v_list := v_list || '· ' || (v_x->>'church') || coalesce(' (' || nullif(v_x->>'sichal', '') || ')', '') || ' — ' ||
              coalesce(v_x->>'months_label', '') || ' ' || coalesce(v_x->>'count', '?') || '개월, ' ||
              coalesce(v_x->>'amount', '0') || '만원' ||
              case when coalesce(v_x->>'sent', '') <> '' then ' · 공문 발송 ' || (v_x->>'sent') else ' · 공문 미발송' end || chr(10);
    if coalesce(v_x->>'sent', '') = '' then v_left := v_left + 1; end if;
  end loop;

  v_key := 'dues29-sum-rep-' || v_r.id || '-' || to_char(v_r.reported_at at time zone 'Asia/Seoul', 'YYYYMMDDHH24MI');
  insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
  select x.uid, '상회비',
         left('[상회비] ' || v_r.month || ' 월례회 보고 — 3개월 이상 미납 ' || v_r.churches || '곳 (' || v_r.total_amount || '만원)', 200),
         coalesce(nullif(v_r.reported_by, ''), '회계') || '께서 ' || v_r.month || ' 월례회 상회비 미납 보고를 올렸습니다.' || chr(10) ||
         v_r.fy || '년 회기 · 기한 지난 미납이 3개월 이상인 교회 ' || v_r.churches || '곳 · 미납 합계 ' || v_r.total_amount || '만원' ||
         chr(10) || chr(10) || v_list ||
         case when v_left > 0
              then chr(10) || '서기께서는 임원방 → 상회비 관리 → 「납부촉구 공문」에서 아직 공문을 보내지 않은 ' || v_left ||
                   '곳에 공문을 발송해 주세요. (교회를 누르면 공문이 만들어지고, 인쇄·PDF 저장·받는 곳 주소를 볼 수 있습니다)'
              else chr(10) || '모든 교회에 납부촉구 공문을 보냈습니다.' end ||
         case when coalesce(v_r.note, '') <> '' then chr(10) || chr(10) || '덧붙임: ' || v_r.note else '' end,
         v_key, auth.uid(), coalesce(nullif(v_r.reported_by, ''), '회계')
    from public.dues_notice_people(true) x
   where not exists (select 1 from public.notifications n where n.user_id = x.uid and n.dedupe_key = v_key);
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;
revoke all on function public.dues_report_notify(bigint) from public, anon;
grant execute on function public.dues_report_notify(bigint) to authenticated;


-- 3. 임원 업무 보고서(월례)가 읽는 자리 — 128 의 열쇠로만 연다 ---------------------
create or replace function public.ai_report_dues_notices(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_fy int := public.fy_now();
begin
  if not public.ai_report_key_ok(p_key) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'fy', v_fy,
    'grace_days', public.dues29_grace_days(),
    'notices', coalesce((select jsonb_agg(jsonb_build_object(
        'church', n.church, 'doc_no', n.doc_no, 'sent_on', n.sent_on, 'sent_by', n.sent_by,
        'months', n.late_months, 'amount', n.late_amount) order by n.sent_on desc, n.id desc)
      from public.dues_notices n where n.fy = v_fy), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object(
        'month', r.month, 'churches', r.churches, 'amount', r.total_amount,
        'by', r.reported_by, 'at', r.reported_at) order by r.month desc)
      from (select * from public.dues_reports order by month desc limit 3) r), '[]'::jsonb)
  );
end
$fn$;
revoke all on function public.ai_report_dues_notices(text) from public, authenticated;
grant execute on function public.ai_report_dues_notices(text) to anon;


-- 확인
select (select count(*) from public.dues_notices) as "공문 기록",
       (select count(*) from public.dues_reports) as "보고서",
       (select value from public.site_settings where key = 'dues_pay') as "납부 계좌";

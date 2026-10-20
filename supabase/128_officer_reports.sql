-- =====================================================================
--  128. 임원 업무 보고서 — 매일 아침 6시 AI 가 노회 자료로 임원마다 보고서를 쓴다 (2026-10-20)
--
--  · ai_reports  : 임원 한 분의 하루치 보고서 (직책별 내용). 본인 것만 읽고,
--                  노회장·서기(와 최고관리자)는 모든 임원의 보고서를 읽는다. 쓰기는 창구만.
--  · ai_tasks    : 회의록·결의·회칙에서 나온 「해야 할 일」 — 부서(상비부·시찰·기관)별로,
--                  맡을 임원(노회장·서기·회계·회록서기·간사)을 정해 끝날 때까지 이어서 챙긴다.
--  · ai_report_bundle(열쇠) : 창구(cloudflare/ai)가 새벽에 로그인 없이 노회 자료를 한 번에 받는 문.
--  · ai_report_save(열쇠, 자료) : 창구가 만든 보고서·할 일을 저장하는 문.
--      두 문은 창구의 비밀 열쇠(REPORT_KEY)로만 열린다 — DB 에는 열쇠의 SHA-256 지문만 둔다 (126 과 같은 방식).
--  · ai_task_notify(...) : 임원이 할 일 상대(상비부장·시찰장 등)에게 홈페이지 알림을 보낸다.
--
--  can_manage()·is_officer() 는 124 sql 의 2단계 인증 잠금을 그대로 쓴다 (여기서 다시 만들지 않는다).
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
-- =====================================================================

-- 0) 비밀 열쇠 지문·실행 상태 (규칙이 없으므로 아무도 직접 못 읽는다) -------------------
create table if not exists public.ai_report_config (k text primary key, v jsonb not null);
alter table public.ai_report_config enable row level security;
revoke all on public.ai_report_config from anon, authenticated;
insert into public.ai_report_config (k, v)
values ('key_sha256', to_jsonb('83da7110c941e506e057e93e8517e5413edc2e857afd09d91641cb51ea9a0180'::text))
on conflict (k) do update set v = excluded.v;
insert into public.ai_report_config (k, v) values ('state', '{"minutes_done": []}'::jsonb)
on conflict (k) do nothing;

create or replace function public.ai_report_key_ok(p_key text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select v #>> '{}' from public.ai_report_config where k = 'key_sha256')
                  = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex'), false)
$fn$;
revoke all on function public.ai_report_key_ok(text) from public, anon, authenticated;


-- 1) 누가 무엇을 -------------------------------------------------------------
-- 모든 임원의 보고서를 읽는 분: 노회장·서기·최고관리자 (2단계 인증을 마친 로그인)
create or replace function public.ai_report_reader()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() in ('president', 'clerk', 'superadmin'), false) and public.mfa_ok()
$fn$;
grant execute on function public.ai_report_reader() to authenticated;

-- 할 일을 고칠 수 있는 분: 노회장·서기·최고관리자는 모두, 그 밖의 임원은 자기 직무의 할 일만
create or replace function public.ai_task_can_edit(p_owner text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.ai_report_reader()
      or (public.is_officer() and exists (
            select 1 from public.profiles p
             where p.id = auth.uid()
               and (   (p_owner = 'treasurer' and btrim(coalesce(p.title, '')) in ('회계', '부회계'))
                    or (p_owner = 'minutes'   and btrim(coalesce(p.title, '')) in ('회록서기', '회록부서기', '부회록서기'))
                    or (p_owner = 'staff'     and p.role = 'staff')
                    or (p_owner = 'clerk'     and btrim(coalesce(p.title, '')) = '부서기')
                    or (p_owner = 'president' and btrim(coalesce(p.title, '')) = '부노회장')
                    or  p_owner = 'officer')))
$fn$;
grant execute on function public.ai_task_can_edit(text) to authenticated;


-- 2) 보고서 ------------------------------------------------------------------
create table if not exists public.ai_reports (
  id            bigserial primary key,
  report_date   date not null,
  user_id       uuid not null references auth.users on delete cascade,
  name          text,
  role          text,
  title         text,
  duty          text,          -- 보고서 갈래: president / clerk / treasurer / minutes / staff / vice_president / vice_clerk / officer
  headline      text,
  content       jsonb not null default '{}'::jsonb,   -- { headline, sections[], todos[], checks[] }
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (user_id, report_date),
  check (pg_column_size(content) <= 200000)
);
create index if not exists ai_reports_date_idx on public.ai_reports (report_date desc);

alter table public.ai_reports enable row level security;
revoke all on public.ai_reports from anon;
revoke insert, update, delete on public.ai_reports from authenticated;
grant select on public.ai_reports to authenticated;
drop policy if exists ai_reports_read on public.ai_reports;
create policy ai_reports_read on public.ai_reports for select to authenticated
  using ((user_id = auth.uid() and public.is_officer()) or public.ai_report_reader());


-- 3) 할 일 -------------------------------------------------------------------
create table if not exists public.ai_tasks (
  id           bigserial primary key,
  owner        text not null default 'clerk'
               check (owner in ('president', 'clerk', 'treasurer', 'minutes', 'staff', 'officer')),
  dept_kind    text,           -- 상비부 / 시찰 / 기관 / 교회 / 임원 / 기타
  dept_name    text,           -- 정치부 / 북부시찰 / 총신대 운영이사 …
  title        text not null check (char_length(title) between 2 and 300),
  detail       text check (detail is null or char_length(detail) <= 3000),
  due_date     date,
  status       text not null default '할 일' check (status in ('할 일', '진행 중', '연락함', '완료', '해당 없음')),
  contact_name text check (contact_name is null or char_length(contact_name) <= 100),
  source       text,           -- 제20회기 가을 정기노회 회의록 / 노회규칙 제9조 / 직접 등록
  source_ref   text,           -- minutes:2 …
  note         text check (note is null or char_length(note) <= 2000),
  created_by   text,
  updated_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  done_at      timestamptz
);
create index if not exists ai_tasks_open_idx on public.ai_tasks (owner, status) where status not in ('완료', '해당 없음');

alter table public.ai_tasks enable row level security;
revoke all on public.ai_tasks from anon;
grant select, insert, update, delete on public.ai_tasks to authenticated;
grant usage, select on sequence public.ai_tasks_id_seq to authenticated;
drop policy if exists ai_tasks_read   on public.ai_tasks;
drop policy if exists ai_tasks_insert on public.ai_tasks;
drop policy if exists ai_tasks_update on public.ai_tasks;
drop policy if exists ai_tasks_delete on public.ai_tasks;
create policy ai_tasks_read on public.ai_tasks for select to authenticated
  using (public.is_officer());
create policy ai_tasks_insert on public.ai_tasks for insert to authenticated
  with check (public.ai_task_can_edit(owner));
create policy ai_tasks_update on public.ai_tasks for update to authenticated
  using (public.ai_task_can_edit(owner)) with check (public.ai_task_can_edit(owner));
create policy ai_tasks_delete on public.ai_tasks for delete to authenticated
  using (public.ai_report_reader());

create or replace function public.ai_tasks_before()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_name text := (select p.name from public.profiles p where p.id = auth.uid());
begin
  new.title := btrim(new.title);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_name, new.created_by, 'AI 보고서');
    new.created_at := now();
  else
    new.created_by := old.created_by; new.created_at := old.created_at;
    new.source := old.source; new.source_ref := old.source_ref;
  end if;
  new.updated_by := coalesce(v_name, new.updated_by);
  new.updated_at := now();
  if new.status = '완료' and (tg_op = 'INSERT' or old.status <> '완료') then new.done_at := now(); end if;
  if new.status <> '완료' then new.done_at := null; end if;
  return new;
end
$fn$;
drop trigger if exists ai_tasks_before_trg on public.ai_tasks;
create trigger ai_tasks_before_trg before insert or update on public.ai_tasks
  for each row execute function public.ai_tasks_before();


-- 4) 할 일 상대에게 홈페이지 알림 보내기 -----------------------------------------
--    상비부장·시찰장 등 이름으로 계정을 찾아 알림함에 넣는다. 임원(2단계 인증)만, 한 번에 20명까지.
create or replace function public.ai_task_notify(p_names text[], p_title text, p_body text, p_task bigint default null)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_me   public.profiles%rowtype;
  v_n    integer := 0;
  v_names text[];
  v_got  text;
begin
  if not public.is_officer() then raise exception '임원만 보낼 수 있습니다 (2단계 인증 확인).'; end if;
  select * into v_me from public.profiles where id = auth.uid();
  select array_agg(distinct btrim(x)) into v_names from unnest(coalesce(p_names, '{}')) x where btrim(x) <> '';
  if v_names is null or array_length(v_names, 1) = 0 then raise exception '받는 분 이름을 적어 주세요.'; end if;
  if array_length(v_names, 1) > 20 then raise exception '한 번에 20명까지 보낼 수 있습니다.'; end if;
  if char_length(coalesce(btrim(p_title), '')) < 2 or char_length(p_title) > 120 then raise exception '제목은 2~120자입니다.'; end if;
  if char_length(coalesce(p_body, '')) > 2000 then raise exception '내용은 2,000자까지입니다.'; end if;

  with ins as (
    insert into public.notifications (user_id, kind, title, body, sent_by, sent_by_name)
    select p.id, '업무', btrim(p_title),
           coalesce(p_body, '') || chr(10) || chr(10) || '보낸 분: ' || coalesce(v_me.name, '') ||
           coalesce(' ' || nullif(btrim(coalesce(v_me.title, '')), ''), ''),
           auth.uid(), v_me.name
      from public.profiles p
     where p.name = any(v_names) and p.role <> 'pending' and not coalesce(p.suspended, false)
    returning user_id)
  select count(*), string_agg(distinct p.name, ', ') into v_n, v_got
    from ins join public.profiles p on p.id = ins.user_id;

  if v_n > 0 and p_task is not null then
    update public.ai_tasks
       set status = case when status in ('할 일', '진행 중') then '연락함' else status end,
           note = left(concat_ws(chr(10), note, to_char(now() at time zone 'Asia/Seoul', 'MM-DD HH24:MI') || ' 알림: ' ||
                                 v_got || ' (' || coalesce(v_me.name, '') || ')'), 2000)
     where id = p_task and public.ai_task_can_edit(owner);
  end if;
  return v_n;
end
$fn$;
revoke all on function public.ai_task_notify(text[], text, text, bigint) from public, anon;
grant execute on function public.ai_task_notify(text[], text, text, bigint) to authenticated;


-- 5) 창구가 받는 노회 자료 묶음 ---------------------------------------------------
--    표가 아직 없거나 칸 이름이 달라도 그 부분만 {"error": …} 로 비우고 나머지는 준다.
create or replace function public.ai_report_bundle(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_fy    integer;
  v_out   jsonb := '{}'::jsonb;
  v       jsonb;
begin
  if not public.ai_report_key_ok(p_key) then raise exception 'not allowed'; end if;
  v_fy := case when extract(month from v_today) >= 4 then extract(year from v_today)::int else extract(year from v_today)::int - 1 end;
  v_out := jsonb_build_object('today', v_today, 'fiscal_year', v_fy,
    'state', coalesce((select c.v from public.ai_report_config c where c.k = 'state'), '{}'::jsonb));

  -- 보고서를 받을 임원 (최고관리자는 노회 사무실 계정이라 받지 않는다)
  begin
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'title', p.title, 'church', p.church)
                              order by p.role, p.title, p.name), '[]') into v
      from public.profiles p
     where p.role in ('president', 'clerk', 'staff', 'officer') and not coalesce(p.suspended, false);
    v_out := v_out || jsonb_build_object('officers', v);
  exception when others then v_out := v_out || jsonb_build_object('officers', '[]'::jsonb, 'officers_error', sqlerrm); end;

  begin
    select coalesce(jsonb_object_agg(s.key, s.value), '{}') into v
      from public.site_settings s where s.key in ('officers', 'sessions', 'delegates', 'veterans');
    v_out := v_out || jsonb_build_object('settings', v);
  exception when others then v_out := v_out || jsonb_build_object('settings', jsonb_build_object('error', sqlerrm)); end;

  begin
    select coalesce(jsonb_agg(to_jsonb(m) - 'created_at' - 'updated_at' - 'updated_by' order by m.meet_date desc nulls last), '[]') into v
      from (select * from public.meetings order by meet_date desc nulls last limit 6) m;
    v_out := v_out || jsonb_build_object('meetings', v);
  exception when others then v_out := v_out || jsonb_build_object('meetings', jsonb_build_object('error', sqlerrm)); end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object('date', s.event_date, 'title', s.title, 'label', s.date_label) order by s.event_date), '[]') into v
      from public.site_schedule s where s.event_date between v_today - 7 and v_today + 60;
    v_out := v_out || jsonb_build_object('schedule', v);
  exception when others then v_out := v_out || jsonb_build_object('schedule', jsonb_build_object('error', sqlerrm)); end;

  -- 회의록: 최근 3건 (본문은 할 일을 뽑을 때만 쓴다)
  begin
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'meeting_date', m.meeting_date,
             'created_at', m.created_at, 'text', left(m.txt, 90000)) order by m.id desc), '[]') into v
      from (select b.id, b.title, b.meeting_date, b.created_at,
                   regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                     coalesce(nullif(b.body, ''), b.html, ''),
                     '<(br|/p|/div|/li|/tr|/h[1-6])[^>]*>', E'\n', 'gi'), '<[^>]+>', ' ', 'g'),
                     '&nbsp;', ' ', 'g'), '[ \t]+', ' ', 'g') as txt
              from public.minutes_board b order by b.id desc limit 3) m;
    v_out := v_out || jsonb_build_object('minutes', v);
  exception when others then v_out := v_out || jsonb_build_object('minutes', '[]'::jsonb, 'minutes_error', sqlerrm); end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object('session', r.session, 'kind', r.kind, 'held_on', r.held_on, 'items', left(r.items, 12000))), '[]') into v
      from (select * from public.resolutions order by sort desc, id desc limit 2) r;
    v_out := v_out || jsonb_build_object('resolutions', v);
  exception when others then v_out := v_out || jsonb_build_object('resolutions', jsonb_build_object('error', sqlerrm)); end;

  -- 노회규칙·내규 (임원 직무와 때마다 할 일의 근거)
  begin
    select coalesce(jsonb_agg(jsonb_build_object('doc', a.doc_key, 'chapter', a.chapter, 'title', a.title, 'body', a.body) order by a.sort), '[]') into v
      from public.rule_articles a where a.book = 'presbytery';
    v_out := v_out || jsonb_build_object('rules', v);
  exception when others then v_out := v_out || jsonb_build_object('rules', jsonb_build_object('error', sqlerrm)); end;

  -- 연락할 곳: 상비부·시찰·기관(이사)·회원 연락처
  begin
    select coalesce(jsonb_agg(to_jsonb(c) - 'updated_at' - 'sort' order by c.sort), '[]') into v from public.committees c;
    v_out := v_out || jsonb_build_object('committees', v);
  exception when others then v_out := v_out || jsonb_build_object('committees', jsonb_build_object('error', sqlerrm)); end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('committee', e.committee, 'kind', e.kind, 'title', e.title, 'date', e.event_date,
             'done', e.done, 'body', left(coalesce(e.body, ''), 300)) order by e.event_date nulls last), '[]') into v
      from public.committee_events e
     where (e.kind = '할일' and not e.done) or e.event_date between v_today - 3 and v_today + 30;
    v_out := v_out || jsonb_build_object('committee_events', v);
  exception when others then v_out := v_out || jsonb_build_object('committee_events', jsonb_build_object('error', sqlerrm)); end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'head', s.head, 'clerk', s.clerk, 'treasurer', s.treasurer, 'churches', s.churches) order by s.sort), '[]') into v
      from public.sichals s;
    v_out := v_out || jsonb_build_object('sichals', v);
  exception when others then v_out := v_out || jsonb_build_object('sichals', jsonb_build_object('error', sqlerrm)); end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('kind', b.kind, 'name', b.name, 'position', b.position, 'church', b.church, 'title', b.title) order by b.sort), '[]') into v
      from public.board_members b where b.active;
    v_out := v_out || jsonb_build_object('boards', v);
  exception when others then v_out := v_out || jsonb_build_object('boards', jsonb_build_object('error', sqlerrm)); end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'church', r.church, 'position', r.position, 'phone', r.phone,
             'officer_title', r.officer_title, 'sichal', r.sichal) order by r.sort, r.id), '[]') into v
      from public.roster r where coalesce(r.active, true);
    v_out := v_out || jsonb_build_object('contacts', v);
  exception when others then v_out := v_out || jsonb_build_object('contacts', jsonb_build_object('error', sqlerrm)); end;

  -- 회계: 상회비(회기 4월~3월)·세례의무금·노회 장부·지급 확인 대기·영수증 없는 지출
  begin
    select coalesce(jsonb_agg(jsonb_build_object('church', d.church, 'sichal', d.sichal, 'pastor', d.pastor, 'monthly', d.monthly_amount) order by d.sort, d.id), '[]') into v
      from public.dues_rates d where d.year = v_fy;
    v_out := v_out || jsonb_build_object('dues_rates', v);
  exception when others then v_out := v_out || jsonb_build_object('dues_rates', jsonb_build_object('error', sqlerrm)); end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('church', d.church, 'month', d.month, 'amount', d.amount, 'paid_on', d.paid_on) order by d.paid_on), '[]') into v
      from public.dues_payments d where d.year = v_fy;
    v_out := v_out || jsonb_build_object('dues_payments', v);
  exception when others then v_out := v_out || jsonb_build_object('dues_payments', jsonb_build_object('error', sqlerrm)); end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('church', b.church, 'pastor', b.pastor, 'target', b.target, 'paid', b.paid, 'paid_on', b.paid_on) order by b.sort), '[]') into v
      from public.bapdues b where b.year = extract(year from v_today)::int;
    v_out := v_out || jsonb_build_object('bapdues', v);
  exception when others then v_out := v_out || jsonb_build_object('bapdues', jsonb_build_object('error', sqlerrm)); end;
  begin
    select coalesce(jsonb_build_object(
             'books', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'owner', k.owner, 'year', k.year, 'opening', k.opening_balance)), '[]')
                         from public.ledger_books k where k.owner_kind = 'presbytery' and k.year >= v_fy - 1),
             'totals', (select coalesce(jsonb_agg(jsonb_build_object('book', t.book_id, 'kind', t.kind, 'sum', t.s, 'n', t.n)), '[]')
                          from (select e.book_id, e.kind, sum(e.amount) s, count(*) n from public.ledger_entries e
                                  join public.ledger_books k on k.id = e.book_id
                                 where k.owner_kind = 'presbytery' and k.year >= v_fy - 1 group by e.book_id, e.kind) t),
             'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'date', e.entry_date, 'kind', e.kind, 'category', e.category,
                                 'title', e.title, 'amount', e.amount, 'created', e.created_at,
                                 'receipt', exists (select 1 from public.ledger_receipts r where r.entry_id = e.id)) order by e.entry_date desc, e.id desc), '[]')
                          from (select e.* from public.ledger_entries e join public.ledger_books k on k.id = e.book_id
                                 where k.owner_kind = 'presbytery' and k.year >= v_fy - 1
                                 order by e.entry_date desc nulls last, e.id desc limit 40) e),
             'payouts_waiting', (select coalesce(jsonb_agg(jsonb_build_object('recipient', p.recipient, 'church', p.recipient_church, 'amount', p.amount,
                                 'title', p.entry_title, 'date', p.entry_date, 'owner', p.owner_label) order by p.entry_date), '[]')
                          from public.ledger_payouts p join public.ledger_books k on k.id = p.book_id
                         where k.owner_kind = 'presbytery' and p.status = '대기')), '{}') into v;
    v_out := v_out || jsonb_build_object('ledger', v);
  exception when others then v_out := v_out || jsonb_build_object('ledger', jsonb_build_object('error', sqlerrm)); end;

  -- 서류 신청·청원서 (처리 중인 것)
  begin
    select coalesce(jsonb_agg(to_jsonb(d) - array['email', 'memo', 'purpose', 'church_seal', 'seal', 'user_id', 'data'] order by d.created_at), '[]') into v
      from public.doc_requests d where d.created_at > now() - interval '90 days' and d.status not in ('발급완료', '반려');
    v_out := v_out || jsonb_build_object('doc_requests', v);
  exception when others then v_out := v_out || jsonb_build_object('doc_requests', jsonb_build_object('error', sqlerrm)); end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('sichal', s.sichal, 'form', s.form_title, 'title', s.title, 'status', s.status,
             'by', s.user_name, 'at', s.created_at) order by s.created_at), '[]') into v
      from public.petition_submissions s where s.created_at > now() - interval '90 days' and s.deleted_at is null;
    v_out := v_out || jsonb_build_object('petitions', v);
  exception when others then v_out := v_out || jsonb_build_object('petitions', jsonb_build_object('error', sqlerrm)); end;

  -- 할 일 (진행 중 전부 + 최근 14일에 끝낸 것)
  begin
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'owner', t.owner, 'dept_kind', t.dept_kind, 'dept_name', t.dept_name,
             'title', t.title, 'detail', t.detail, 'due', t.due_date, 'status', t.status, 'contact', t.contact_name,
             'source', t.source, 'note', right(coalesce(t.note, ''), 400), 'updated', t.updated_at) order by t.due_date nulls last, t.id), '[]') into v
      from public.ai_tasks t
     where t.status not in ('완료', '해당 없음') or t.updated_at > now() - interval '14 days';
    v_out := v_out || jsonb_build_object('tasks', v);
  exception when others then v_out := v_out || jsonb_build_object('tasks', jsonb_build_object('error', sqlerrm)); end;

  return v_out;
end
$fn$;
revoke all on function public.ai_report_bundle(text) from public;
grant execute on function public.ai_report_bundle(text) to anon, authenticated;


-- 6) 창구가 만든 보고서·할 일을 저장 ------------------------------------------------
--    p_data = { reports:[{user_id, report_date, name, role, title, duty, headline, content, model, input_tokens, output_tokens}],
--               tasks:[{owner, dept_kind, dept_name, title, detail, due_date, contact_name, source, source_ref}],
--               minutes_done:[회의록 번호], run:{…} }
create or replace function public.ai_report_save(p_key text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_r   jsonb;
  v_n   integer := 0;
  v_ids bigint[] := '{}';
  v_id  bigint;
  v_state jsonb;
begin
  if not public.ai_report_key_ok(p_key) then raise exception 'not allowed'; end if;

  for v_r in select * from jsonb_array_elements(coalesce(p_data -> 'reports', '[]')) loop
    if not exists (select 1 from public.profiles p where p.id = (v_r ->> 'user_id')::uuid) then continue; end if;
    insert into public.ai_reports (report_date, user_id, name, role, title, duty, headline, content, model, input_tokens, output_tokens)
    values ((v_r ->> 'report_date')::date, (v_r ->> 'user_id')::uuid, left(v_r ->> 'name', 100), left(v_r ->> 'role', 40),
            left(v_r ->> 'title', 60), left(v_r ->> 'duty', 40), left(v_r ->> 'headline', 500), coalesce(v_r -> 'content', '{}'),
            left(v_r ->> 'model', 60), coalesce((v_r ->> 'input_tokens')::int, 0), coalesce((v_r ->> 'output_tokens')::int, 0))
    on conflict (user_id, report_date) do update
       set name = excluded.name, role = excluded.role, title = excluded.title, duty = excluded.duty, headline = excluded.headline,
           content = excluded.content, model = excluded.model, input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens, created_at = now();
    v_n := v_n + 1;
  end loop;

  for v_r in select * from jsonb_array_elements(coalesce(p_data -> 'tasks', '[]')) loop
    if char_length(coalesce(btrim(v_r ->> 'title'), '')) < 2 then continue; end if;
    if exists (select 1 from public.ai_tasks t where t.source_ref is not distinct from (v_r ->> 'source_ref')
                                                  and t.title = left(btrim(v_r ->> 'title'), 300)) then continue; end if;
    insert into public.ai_tasks (owner, dept_kind, dept_name, title, detail, due_date, contact_name, source, source_ref, created_by)
    values (case when v_r ->> 'owner' in ('president', 'clerk', 'treasurer', 'minutes', 'staff', 'officer') then v_r ->> 'owner' else 'clerk' end,
            left(v_r ->> 'dept_kind', 40), left(v_r ->> 'dept_name', 80), left(btrim(v_r ->> 'title'), 300), left(v_r ->> 'detail', 3000),
            case when (v_r ->> 'due_date') ~ '^\d{4}-\d{2}-\d{2}$' then (v_r ->> 'due_date')::date end,
            nullif(left(v_r ->> 'contact_name', 100), ''), left(v_r ->> 'source', 200), left(v_r ->> 'source_ref', 80), 'AI 보고서')
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  select c.v into v_state from public.ai_report_config c where c.k = 'state';
  v_state := coalesce(v_state, '{}'::jsonb);
  if p_data ? 'minutes_done' then
    v_state := jsonb_set(v_state, '{minutes_done}',
      (select coalesce(jsonb_agg(distinct x), '[]') from (
         select jsonb_array_elements(coalesce(v_state -> 'minutes_done', '[]')) x
         union all select jsonb_array_elements(p_data -> 'minutes_done')) q));
  end if;
  if p_data ? 'run' then v_state := jsonb_set(v_state, '{last_run}', p_data -> 'run'); end if;
  insert into public.ai_report_config (k, v) values ('state', v_state) on conflict (k) do update set v = excluded.v;

  -- 오래된 보고서는 180일 뒤 지운다
  delete from public.ai_reports where report_date < (now() at time zone 'Asia/Seoul')::date - 180;
  return jsonb_build_object('reports', v_n, 'tasks', to_jsonb(v_ids));
end
$fn$;
revoke all on function public.ai_report_save(text, jsonb) from public;
grant execute on function public.ai_report_save(text, jsonb) to anon, authenticated;

-- 마지막 실행 기록 (노회장·서기·최고관리자 화면용)
create or replace function public.ai_report_last_run()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select case when public.ai_report_reader()
              then (select v -> 'last_run' from public.ai_report_config where k = 'state') end
$fn$;
grant execute on function public.ai_report_last_run() to authenticated;

-- 확인:
--   select report_date, name, title, duty, headline from public.ai_reports order by report_date desc, id limit 20;
--   select id, owner, dept_name, title, status, due_date from public.ai_tasks order by id desc limit 30;

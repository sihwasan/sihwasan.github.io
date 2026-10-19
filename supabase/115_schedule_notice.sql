-- =====================================================================
--  115. 노회 일정 ↔ 공지사항 ↔ 정기노회(meetings) 자동 연동 (2026-10-20)
--
--  문제: 노회 일정(site_schedule)에 「노진교회 위임식」을 넣어도 공지사항(site_notices)에는
--        따로 써야 보였고, 정기노회 날짜도 meetings 표에 또 넣어야 40일 전 알림이 갔다.
--  해결: 일정을 넣고 고치고 지우면 공지가 저절로 따라가고(post_notice 가 켜진 줄),
--        정기노회 일정은 meetings 표에도 저절로 맞춰진다.
--
--   · site_schedule.post_notice (기본 true) — 일정 화면의 「공지사항에도 올리기」
--   · site_notices.schedule_id / source     — 어느 일정에서 온 공지인지
--   · 일정 삭제 → 공지도 삭제 (on delete cascade)
--   · 공지 날짜(date)는 처음 올린 날로 두어 NEW 표시와 순서가 자연스럽다
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
-- =====================================================================

-- 1. 칸 ---------------------------------------------------------------
alter table public.site_schedule add column if not exists post_notice boolean not null default true;
alter table public.site_notices  add column if not exists schedule_id bigint references public.site_schedule(id) on delete cascade;
alter table public.site_notices  add column if not exists source text;   -- 'schedule' | null(손으로 쓴 공지)
create unique index if not exists site_notices_schedule_idx on public.site_notices (schedule_id) where schedule_id is not null;

-- 2. 일정 한 줄을 공지 글로 ------------------------------------------------
create or replace function public.schedule_notice_body(r public.site_schedule)
returns text language plpgsql immutable as $fn$
declare
  m jsonb := coalesce(r.meta, '{}'::jsonb);
  b text := '';
  d text;
  t text;
begin
  d := to_char(r.event_date, 'YYYY년 FMMM월 FMDD일 (') || (array['일','월','화','수','목','금','토'])[extract(dow from r.event_date)::int + 1] || ')';
  if r.end_date is not null and r.end_date <> r.event_date then
    d := d || ' ~ ' || to_char(r.end_date, 'FMMM월 FMDD일 (') || (array['일','월','화','수','목','금','토'])[extract(dow from r.end_date)::int + 1] || ')';
  end if;
  b := '일시: ' || d;
  t := nullif(m->>'time', '');
  if t is not null then
    b := b || ' ' || (case when split_part(t, ':', 1)::int < 12 then '오전 ' else '오후 ' end) ||
         (case when split_part(t, ':', 1)::int % 12 = 0 then 12 else split_part(t, ':', 1)::int % 12 end) || '시' ||
         (case when split_part(t, ':', 2) <> '00' then ' ' || split_part(t, ':', 2)::int || '분' else '' end);
  end if;
  if nullif(coalesce(m->>'loc', m->>'place'), '') is not null then b := b || E'\n장소: ' || coalesce(m->>'loc', m->>'place'); end if;
  if nullif(m->>'person', '') is not null then
    b := b || E'\n대상: ' || (m->>'person') || coalesce(' (' || nullif(m->>'church', '') || ')', '') || coalesce(' · ' || nullif(m->>'sub', ''), '');
  end if;
  if nullif(m->>'target', '') is not null then b := b || E'\n대상: ' || (m->>'target'); end if;
  if nullif(m->>'fee', '') is not null then b := b || E'\n회비: ' || (m->>'fee'); end if;
  if nullif(m->>'dept', '') is not null then b := b || E'\n주관: ' || (m->>'dept'); end if;
  if nullif(m->>'contact', '') is not null then b := b || E'\n문의: ' || (m->>'contact'); end if;
  if nullif(coalesce(m->>'info', m->>'note'), '') is not null then b := b || E'\n' || coalesce(m->>'info', m->>'note'); end if;
  b := b || E'\n\n(노회 일정에서 자동으로 올린 공지입니다. 고치려면 노회 일정에서 고쳐 주세요.)';
  return b;
end
$fn$;

-- 3. 일정이 들어오거나 바뀌면 공지를 맞춘다 ---------------------------------------
create or replace function public.schedule_notice_sync()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  cat_v text;
begin
  if tg_op = 'DELETE' then
    delete from public.site_notices where schedule_id = old.id;
    return old;
  end if;
  if new.event_date is null or coalesce(new.post_notice, true) = false then
    delete from public.site_notices where schedule_id = new.id;
    return new;
  end if;
  cat_v := case when new.kind in ('임직식', '수양회', '사모위로회') then '소식'
                when new.kind in ('정기노회', '총회') then '공지'
                else '안내' end;
  insert into public.site_notices (cat, title, body, date, schedule_id, source)
  values (cat_v, new.title, public.schedule_notice_body(new), current_date, new.id, 'schedule')
  on conflict (schedule_id) where schedule_id is not null
  do update set cat = excluded.cat, title = excluded.title, body = excluded.body;
  return new;
end
$fn$;

drop trigger if exists schedule_notice_sync_trg on public.site_schedule;
create trigger schedule_notice_sync_trg
  after insert or update or delete on public.site_schedule
  for each row execute function public.schedule_notice_sync();

-- 4. 정기노회 일정 → meetings 표(40일 전 알림·총대 임기 알림의 기준) -----------------
create or replace function public.schedule_meeting_sync()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  k text;
  loc text;
begin
  if tg_op = 'DELETE' then return old; end if;
  if new.kind is distinct from '정기노회' or new.event_date is null then return new; end if;
  k := case when extract(month from new.event_date) between 1 and 6 then '봄 정기노회' else '가을 정기노회' end;
  loc := nullif(coalesce(new.meta->>'loc', new.meta->>'place'), '');
  if exists (select 1 from public.meetings m where m.kind = k and m.year = extract(year from new.event_date)::int) then
    update public.meetings
       set meet_date = new.event_date,
           place = coalesce(loc, place),
           confirmed = true,
           updated_at = now(), updated_by = '노회 일정 연동'
     where kind = k and year = extract(year from new.event_date)::int;
  else
    insert into public.meetings (kind, year, meet_date, place, confirmed, note, updated_by)
    values (k, extract(year from new.event_date)::int, new.event_date, loc, true, new.title, '노회 일정 연동');
  end if;
  return new;
end
$fn$;

drop trigger if exists schedule_meeting_sync_trg on public.site_schedule;
create trigger schedule_meeting_sync_trg
  after insert or update on public.site_schedule
  for each row execute function public.schedule_meeting_sync();

-- 5. 이미 등록된 앞으로의 일정은 지금 한 번 공지로 올린다 ------------------------------
do $$
declare r public.site_schedule;
begin
  for r in select * from public.site_schedule
            where event_date is not null and coalesce(end_date, event_date) >= current_date
              and coalesce(post_notice, true)
              and not exists (select 1 from public.site_notices n where n.schedule_id = site_schedule.id)
  loop
    insert into public.site_notices (cat, title, body, date, schedule_id, source)
    values (case when r.kind in ('임직식', '수양회', '사모위로회') then '소식'
                 when r.kind in ('정기노회', '총회') then '공지' else '안내' end,
            r.title, public.schedule_notice_body(r), current_date, r.id, 'schedule');
  end loop;
end
$$;

-- 확인:  select n.date, n.cat, n.title, n.schedule_id from public.site_notices n order by n.date desc, n.id desc limit 20;

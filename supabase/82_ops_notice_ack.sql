-- =====================================================================
--  82. 시스템 알림 규칙 — 대상에게 직접 보이고, <확인 완료>로 끌 수 있게
--
--  전에는 알림 규칙(ops_notices)이 관리자 화면에만 떴고, "읽음"은 그 컴퓨터의
--  브라우저에만 남았다. 이제는
--    1) 규칙의 대상(간사·시찰장·상비부장 … 명부 연동)에게 표시 기간에
--       홈페이지 상단 배너로 보이고,
--    2) 규칙에 <확인 완료 단추>를 켜 두면 받는 사람이 눌러 이번 회기에는
--       다시 보이지 않게 할 수 있다. (서버에 남아 어느 기기에서든 같다)
--    3) 관리자는 누가 확인했는지 본다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 48_notify_groups.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 규칙에 <확인 완료 단추> 칸
-- ---------------------------------------------------------------------
alter table public.ops_notices
  add column if not exists ack_enabled boolean not null default false,
  add column if not exists updated_at  timestamptz,
  add column if not exists updated_by  text;


-- ---------------------------------------------------------------------
-- 2. 누가 언제 확인했나 (회기마다 따로)
-- ---------------------------------------------------------------------
create table if not exists public.ops_notice_acks (
  notice_id  bigint not null references public.ops_notices on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  period_key text not null,                 -- 예: 2026 (그해 회기)
  user_name  text,
  done_at    timestamptz not null default now(),
  primary key (notice_id, user_id, period_key)
);
alter table public.ops_notice_acks enable row level security;

drop policy if exists ops_notice_acks_read   on public.ops_notice_acks;
drop policy if exists ops_notice_acks_insert on public.ops_notice_acks;
drop policy if exists ops_notice_acks_delete on public.ops_notice_acks;
create policy ops_notice_acks_read on public.ops_notice_acks for select
  using (user_id = auth.uid() or public.can_manage());
create policy ops_notice_acks_insert on public.ops_notice_acks for insert
  with check (user_id = auth.uid());
create policy ops_notice_acks_delete on public.ops_notice_acks for delete
  using (user_id = auth.uid());


-- ---------------------------------------------------------------------
-- 3. 정기노회 기준일 (n번째 월요일) 과 규칙의 올해 표시 기간
--    홈페이지(js/main.js 의 nthMonday·opsActive)와 같은 셈이다.
-- ---------------------------------------------------------------------
create or replace function public.nth_monday(p_year integer, p_month integer, p_week integer)
returns date language sql immutable as $fn$
  select make_date(p_year, p_month, 1)
       + (((8 - extract(dow from make_date(p_year, p_month, 1))::integer) % 7) + 7 * (p_week - 1));
$fn$;

create or replace function public.ops_notice_window(n public.ops_notices, p_today date)
returns table (start_on date, end_on date, period_key text)
language plpgsql stable security definer set search_path = public as $fn$
declare
  d    jsonb;
  y    integer := extract(year from p_today)::integer;
  base date;
begin
  select value into d from public.site_settings where key = 'ops_dates';
  d := coalesce(d, '{"springMonth":4,"springWeek":2,"fallMonth":10,"fallWeek":2}'::jsonb);
  if n.rule in ('spring', 'before_spring') then
    base := public.nth_monday(y, coalesce((d->>'springMonth')::integer, 4), coalesce((d->>'springWeek')::integer, 2));
  elsif n.rule in ('fall', 'before_fall') then
    base := public.nth_monday(y, coalesce((d->>'fallMonth')::integer, 10), coalesce((d->>'fallWeek')::integer, 2));
  elsif n.rule = 'fixed' and n.fixed_date is not null then
    base := n.fixed_date;
  else
    return;
  end if;
  start_on := base - coalesce(n.offset_days, 0);
  end_on := start_on + coalesce(n.window_days, 21);
  period_key := case when n.rule = 'fixed' then to_char(base, 'YYYY-MM-DD') else y::text end;
  return next;
end
$fn$;


-- ---------------------------------------------------------------------
-- 4. 내가 지금 봐야 할 시스템 알림
--    대상 그룹에 내가 들어 있거나(명부 연동) 관리자이면, 표시 기간 안의
--    규칙을 돌려준다. 이미 확인 완료한 것은 acked = true 로 표시된다.
-- ---------------------------------------------------------------------
create or replace function public.my_ops_notices()
returns table (
  id bigint, title text, message text, audience text, rule text,
  start_on date, end_on date, period_key text,
  ack_enabled boolean, acked boolean, for_me boolean, is_admin boolean
)
language sql stable security definer set search_path = public as $fn$
  with today as (select (now() at time zone 'Asia/Seoul')::date as d)
  select n.id, n.title, n.message, n.audience, n.rule,
         w.start_on, w.end_on, w.period_key, n.ack_enabled,
         exists (select 1 from public.ops_notice_acks a
                  where a.notice_id = n.id and a.user_id = auth.uid() and a.period_key = w.period_key),
         (auth.uid() in (select public.recipients_of_group(n.audience))),
         public.can_manage()
    from public.ops_notices n, today,
         lateral public.ops_notice_window(n, today.d) w
   where n.active
     and auth.uid() is not null
     and today.d between w.start_on and w.end_on
     and (public.can_manage() or auth.uid() in (select public.recipients_of_group(n.audience)))
   order by n.sort, n.id;
$fn$;
grant execute on function public.my_ops_notices() to authenticated;

-- 확인 완료 / 되돌리기
create or replace function public.ack_ops_notice(p_id bigint, p_period_key text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_me text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  select name into v_me from public.profiles where id = auth.uid();
  insert into public.ops_notice_acks (notice_id, user_id, period_key, user_name)
  values (p_id, auth.uid(), p_period_key, v_me)
  on conflict (notice_id, user_id, period_key) do nothing;
end
$fn$;
grant execute on function public.ack_ops_notice(bigint, text) to authenticated;

create or replace function public.unack_ops_notice(p_id bigint, p_period_key text)
returns void language sql security definer set search_path = public as $fn$
  delete from public.ops_notice_acks
   where notice_id = p_id and user_id = auth.uid() and period_key = p_period_key;
$fn$;
grant execute on function public.unack_ops_notice(bigint, text) to authenticated;

-- 관리자: 이 규칙을 확인 완료한 사람들
create or replace function public.ops_notice_acks_of(p_id bigint)
returns table (user_name text, period_key text, done_at timestamptz)
language sql stable security definer set search_path = public as $fn$
  select a.user_name, a.period_key, a.done_at
    from public.ops_notice_acks a
   where a.notice_id = p_id and public.can_manage()
   order by a.done_at desc;
$fn$;
grant execute on function public.ops_notice_acks_of(bigint) to authenticated;

-- 확인:
--   select * from public.my_ops_notices();

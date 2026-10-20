-- =====================================================================
--  121. 임직식(목사 위임·장로 장립)은 날짜가 지나야 회원 명단에 반영 (2026-10-20)
--
--  전에는 노회 일정에 임직식을 등록하는 순간 명단의 직분이 '위임목사'로 바뀌고 위임일이
--  적혔다(아직 위임식을 안 했는데도). 이제는 일정에 적어 두기만 하고, 임직식 날짜가 지난 뒤
--  처음 누군가 홈페이지에 들어올 때(하루 한 번 도는 일과) 또는 이 파일의 apply_ordinations()
--  를 손으로 돌릴 때 명단에 반영한다. 날짜가 이미 지난 임직식을 등록하면 그 자리에서 반영한다.
--
--   · 목사 위임: roster.position = '위임목사', served_from = 임직식 날짜 (계정 profiles 도 같이)
--   · 장로 장립: roster.ordained_on = 임직식 날짜, 교회 DB(church_staff)의 장립일도 맞춘다.
--               명단에 없는 새 장로는 교회 DB 에 시무장로로 올린다.
--   · 반영한 일정에는 meta.applied = 날짜 를 적어 두어 두 번 반영하지 않는다.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
-- =====================================================================

-- 1. 한 건 반영 (날짜가 안 됐거나 이미 반영했으면 false) ------------------------------
create or replace function public.apply_ordination(p_id bigint)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare
  r      public.site_schedule;
  m      jsonb;
  v_sub  text;
  v_rid  bigint;
  v_name text;
  v_ch   text;
begin
  select * into r from public.site_schedule where id = p_id;
  if not found or r.kind is distinct from '임직식' or r.event_date is null or r.event_date > current_date then
    return false;
  end if;
  m := coalesce(r.meta, '{}'::jsonb);
  if m ? 'applied' then return false; end if;
  v_sub  := m->>'sub';
  v_rid  := nullif(m->>'roster_id', '')::bigint;
  v_name := nullif(m->>'person', '');
  v_ch   := nullif(m->>'church', '');

  if v_sub = '목사 위임' then
    if v_rid is not null then
      update public.roster set "position" = '위임목사', served_from = r.event_date,
             church = coalesce(v_ch, church) where id = v_rid;
      update public.profiles set "position" = '위임목사', church = coalesce(v_ch, church), updated_at = now()
       where roster_id = v_rid;
    elsif v_name is not null then
      update public.roster set "position" = '위임목사', served_from = r.event_date
       where name = v_name and active and (v_ch is null or church = v_ch);
      update public.profiles set "position" = '위임목사', updated_at = now()
       where name = v_name and role <> 'pending' and (v_ch is null or church = v_ch);
    end if;
  elsif v_sub = '장로 장립' then
    if v_rid is not null then
      update public.roster set ordained_on = r.event_date where id = v_rid;
    end if;
    if to_regclass('public.church_staff') is not null and v_name is not null and v_ch is not null then
      update public.church_staff set ordained_on = r.event_date where name = v_name and church = v_ch;
      if not found and v_rid is null then
        insert into public.church_staff (church, name, role, ordained_on, sort)
        values (v_ch, v_name, '시무장로', r.event_date, 100000);
      end if;
    end if;
  else
    /* 그 밖의 임직(안수집사 등)은 명단에 적을 것이 없다 */
    null;
  end if;

  update public.site_schedule
     set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('applied', r.event_date::text)
   where id = p_id;
  return true;
end
$fn$;
revoke all on function public.apply_ordination(bigint) from public;
grant execute on function public.apply_ordination(bigint) to authenticated;

-- 2. 날짜가 지난 임직식을 모두 반영 (하루 한 번 홈페이지가 부른다) ------------------------
create or replace function public.apply_ordinations()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  n int := 0;
  rec record;
begin
  for rec in select id from public.site_schedule
              where kind = '임직식' and event_date is not null and event_date <= current_date
                and not (coalesce(meta, '{}'::jsonb) ? 'applied')
              order by event_date, id
  loop
    if public.apply_ordination(rec.id) then n := n + 1; end if;
  end loop;
  return n;
end
$fn$;
revoke all on function public.apply_ordinations() from public;
grant execute on function public.apply_ordinations() to authenticated;

-- 3. 날짜가 이미 지난 임직식을 등록·수정하면 그 자리에서 반영 ------------------------------
create or replace function public.schedule_ordination_trg()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.kind = '임직식' and new.event_date is not null and new.event_date <= current_date
     and not (coalesce(new.meta, '{}'::jsonb) ? 'applied') then
    perform public.apply_ordination(new.id);
  end if;
  return new;
end
$fn$;
drop trigger if exists schedule_ordination_trg on public.site_schedule;
create trigger schedule_ordination_trg
  after insert or update on public.site_schedule
  for each row execute function public.schedule_ordination_trg();

-- 4. 예전 방식으로 미리 바뀌어 버린 명단 되돌리기 ---------------------------------------
--    (임직식 날짜가 아직 안 지났는데 직분이 위임목사·위임일이 미래로 적힌 분 → 시무목사로)
update public.roster r
   set "position" = '시무목사', served_from = null
  from public.site_schedule s
 where s.kind = '임직식' and s.meta->>'sub' = '목사 위임' and s.event_date > current_date
   and r.id = nullif(s.meta->>'roster_id', '')::bigint
   and r."position" = '위임목사' and (r.served_from is null or r.served_from >= current_date);
update public.profiles p
   set "position" = '시무목사', updated_at = now()
  from public.site_schedule s
 where s.kind = '임직식' and s.meta->>'sub' = '목사 위임' and s.event_date > current_date
   and p.roster_id = nullif(s.meta->>'roster_id', '')::bigint
   and p."position" = '위임목사';

-- 지금 당장 날짜가 지난 것이 있으면 반영해 둔다
select public.apply_ordinations() as "반영한 임직식 수";

-- 확인
select id, event_date, title, meta->>'sub' as 구분, meta->>'person' as 대상, meta->>'applied' as 반영일
  from public.site_schedule where kind = '임직식' order by event_date desc limit 10;

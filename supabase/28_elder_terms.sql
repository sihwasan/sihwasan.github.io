-- =====================================================================
--  28. 장로 총대 자격 관리
--
--  근거 : 시화산노회 규칙 제16조 2항 (노회총대)
--    노회총대는 정치 제10장 제2조에 의거하여 당회장이 제출한다.
--
--  · 장로 총대에게 생년월일(정년 확인)과 자격 기간을 둡니다.
--  · 장로가 바뀌면 '교체'로 새 총대를 넣고, 이전 총대는 기록으로 남깁니다.
--  · 교체되지 않은 총대는 다음 회기에 자격이 1년 자동 연장됩니다.
--
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 명단에 생년월일과 자격 기간 칸을 더한다
-- ---------------------------------------------------------------------
alter table public.roster add column if not exists birth_date  date;
alter table public.roster add column if not exists term_from   date;
alter table public.roster add column if not exists term_until  date;
alter table public.roster add column if not exists active      boolean not null default true;
alter table public.roster add column if not exists replaced_at date;
alter table public.roster add column if not exists replaced_by text;

create index if not exists roster_term_idx on public.roster (category, active, term_until);


-- ---------------------------------------------------------------------
-- 2. 장로 총대 교체
--    이전 총대는 지우지 않고 '교체됨'으로 남겨 회기 기록을 보존합니다.
-- ---------------------------------------------------------------------
create or replace function public.replace_elder(
  p_id bigint, p_name text, p_church text, p_birth date default null)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  r     public.roster%rowtype;
  v_new bigint;
begin
  if not public.can_manage() then
    raise exception '총대 교체는 관리자(노회장·서기·간사)만 할 수 있습니다.';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception '새 총대의 성명을 입력해 주세요.';
  end if;

  select * into r from public.roster where id = p_id;
  if r.id is null then
    raise exception '교체할 총대를 찾을 수 없습니다.';
  end if;
  if not coalesce(r.active, true) then
    raise exception '이미 교체된 총대입니다.';
  end if;

  update public.roster
     set active = false, replaced_at = current_date, replaced_by = btrim(p_name)
   where id = p_id;

  insert into public.roster
        (name, church, position, role, officer_title, category, sichal, note,
         birth_date, term_from, term_until, active, sort)
  values (btrim(p_name),
          coalesce(nullif(btrim(coalesce(p_church, '')), ''), r.church),
          r.position, r.role, null, r.category, r.sichal,
          r.name || ' 총대 후임',
          p_birth, current_date, r.term_until, true, r.sort)
  on conflict (name, church) do update
     set category   = excluded.category,
         sichal     = excluded.sichal,
         note       = excluded.note,
         birth_date = coalesce(excluded.birth_date, public.roster.birth_date),
         term_from  = excluded.term_from,
         term_until = excluded.term_until,
         active     = true
  returning id into v_new;

  return v_new;
end;
$fn$;

revoke all on function public.replace_elder(bigint, text, text, date) from public;
grant execute on function public.replace_elder(bigint, text, text, date) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 자격 자동 연장
--    교체되지 않은 장로 총대는 자격 만료일이 지나면 1년씩 연장됩니다.
--    정년(만 70세)이 지난 분은 연장하지 않습니다.
-- ---------------------------------------------------------------------
create or replace function public.extend_elder_terms()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_n integer := 0;
begin
  if not public.can_manage() then
    return 0;
  end if;

  -- 만료일이 지난 총대의 기간을 앞으로 오도록 1년씩 밀어 준다
  update public.roster r
     set term_until = (
           select r.term_until + (make_interval(years => k))
             from generate_series(1, 20) k
            where r.term_until + (make_interval(years => k)) > current_date
            order by k limit 1
         )::date,
         note = case
           when coalesce(r.note, '') like '%자동 연장%' then r.note
           else btrim(coalesce(r.note, '') || ' 자동 연장')
         end
   where r.category = '장로'
     and coalesce(r.active, true)
     and r.term_until is not null
     and r.term_until <= current_date
     and not public.is_retired(r.birth_date);

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.extend_elder_terms() from public;
grant execute on function public.extend_elder_terms() to authenticated;

comment on function public.extend_elder_terms() is
  '교체되지 않은 장로 총대의 자격을 1년 단위로 자동 연장한다. 정년이 지난 분은 제외한다.';


-- ---------------------------------------------------------------------
-- 4. 아직 기간이 없는 장로 총대에게 기본 기간을 넣어 준다
--    (올해 봄 정기노회 ~ 내년 봄 정기노회)
-- ---------------------------------------------------------------------
update public.roster
   set term_from  = coalesce(term_from,  make_date(extract(year from current_date)::int, 4, 13)),
       term_until = coalesce(term_until, make_date(extract(year from current_date)::int + 1, 4, 12))
 where category = '장로'
   and coalesce(active, true)
   and term_until is null;


select count(*) filter (where coalesce(active, true))            as "현직 장로 총대",
       count(*) filter (where not coalesce(active, true))        as "교체된 총대",
       count(*) filter (where birth_date is null and coalesce(active, true)) as "생년월일 미등록"
  from public.roster
 where category = '장로';

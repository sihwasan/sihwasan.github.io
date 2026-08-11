-- =====================================================================
--  26. 총회 총대 관리
--
--  근거 : 시화산노회 규칙 제16조 (총대)
--    총회총대는 4월 정기노회에서 정치 제12장 제2조에 의거하여 선정하되
--    노회장과 장로부노회장은 자동총대가 되고, 그 외는 선거관리위원회 내규에
--    의하여 투표하여 종다수로 선정한다.
--
--  총대 명단에 소속 교회와 자격 기간을 함께 담고,
--  장로가 교체될 때 이전 총대를 남겨 둔 채 새 총대로 넘길 수 있게 합니다.
--
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

create table if not exists public.delegates (
  id          bigserial primary key,
  kind        text not null,              -- 목사 정총대 / 목사 부총대 / 장로 정총대 / 장로 부총대
  name        text not null,
  church      text,
  title       text,                       -- 노회장, 부노회장 등 (자동총대 표시)
  term_from   date,                       -- 자격 시작 (보통 봄 정기노회일)
  term_until  date,                       -- 자격 만료 (다음 봄 정기노회일)
  active      boolean not null default true,
  replaced_at date,                       -- 교체된 날
  replaced_by text,                       -- 누구로 교체되었는지
  note        text,
  sort        numeric not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists delegates_kind_idx on public.delegates (kind, sort);

alter table public.delegates enable row level security;

drop policy if exists delegates_read  on public.delegates;
drop policy if exists delegates_write on public.delegates;
-- 총대 명단은 정회원이 보고, 등록·수정은 관리자가 한다
create policy delegates_read  on public.delegates for select using (public.is_member());
create policy delegates_write on public.delegates for all
  using (public.can_manage()) with check (public.can_manage());


-- ---------------------------------------------------------------------
-- 총대 교체
--   이전 총대는 지우지 않고 '교체됨'으로 남겨 두어 회기 기록이 보존됩니다.
-- ---------------------------------------------------------------------
create or replace function public.replace_delegate(
  p_id bigint, p_name text, p_church text, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  d   public.delegates%rowtype;
  v_new bigint;
begin
  if not public.can_manage() then
    raise exception '총대 교체는 관리자(노회장·서기·간사)만 할 수 있습니다.';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception '새 총대의 성명을 입력해 주세요.';
  end if;

  select * into d from public.delegates where id = p_id;
  if d.id is null then
    raise exception '교체할 총대를 찾을 수 없습니다.';
  end if;
  if not d.active then
    raise exception '이미 교체된 총대입니다.';
  end if;

  update public.delegates
     set active = false, replaced_at = current_date, replaced_by = btrim(p_name),
         updated_at = now()
   where id = p_id;

  insert into public.delegates
        (kind, name, church, title, term_from, term_until, active, note, sort, updated_at)
  values (d.kind, btrim(p_name), nullif(btrim(coalesce(p_church, '')), ''), null,
          current_date, d.term_until, true,
          coalesce(p_note, d.name || ' 총대 후임'), d.sort, now())
  returning id into v_new;

  return v_new;
end;
$fn$;

revoke all on function public.replace_delegate(bigint, text, text, text) from public;
grant execute on function public.replace_delegate(bigint, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 지금 등록되어 있는 총대 명단을 옮겨 담는다 (처음 한 번)
--   · 이름 뒤의 '(노회장)' 같은 표시는 직책으로 분리합니다.
--   · 소속 교회는 노회 명단에서 찾아 채웁니다.
--   · 자격 기간은 올해 봄 정기노회 ~ 내년 봄 정기노회로 잡습니다.
--     (실제 날짜는 화면에서 고치실 수 있습니다)
-- ---------------------------------------------------------------------
insert into public.delegates (kind, name, church, title, term_from, term_until, sort)
select v.kind,
       btrim(split_part(v.raw, '(', 1))                                   as name,
       (select r.church from public.roster r
         where r.name = btrim(split_part(v.raw, '(', 1)) limit 1)         as church,
       nullif(btrim(replace(split_part(v.raw, '(', 2), ')', '')), '')     as title,
       make_date(extract(year from current_date)::int, 4, 13)             as term_from,
       make_date(extract(year from current_date)::int + 1, 4, 12)         as term_until,
       v.ord * 10
  from (
    select '목사 정총대' as kind, x.raw, x.ord from
      jsonb_array_elements_text(
        coalesce((select value -> 'pastorMain' from public.site_settings where key = 'delegates'), '[]'::jsonb)
      ) with ordinality as x(raw, ord)
    union all
    select '목사 부총대', x.raw, x.ord from
      jsonb_array_elements_text(
        coalesce((select value -> 'pastorSub' from public.site_settings where key = 'delegates'), '[]'::jsonb)
      ) with ordinality as x(raw, ord)
    union all
    select '장로 정총대', x.raw, x.ord from
      jsonb_array_elements_text(
        coalesce((select value -> 'elderMain' from public.site_settings where key = 'delegates'), '[]'::jsonb)
      ) with ordinality as x(raw, ord)
    union all
    select '장로 부총대', x.raw, x.ord from
      jsonb_array_elements_text(
        coalesce((select value -> 'elderSub' from public.site_settings where key = 'delegates'), '[]'::jsonb)
      ) with ordinality as x(raw, ord)
  ) v
 where not exists (select 1 from public.delegates);

select kind as "구분", name as "성명", coalesce(church, '(미확인)') as "소속 교회",
       coalesce(title, '') as "직책", term_from as "자격 시작", term_until as "자격 만료"
  from public.delegates
 where active
 order by sort, kind;

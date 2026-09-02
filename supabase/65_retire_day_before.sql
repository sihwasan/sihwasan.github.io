-- ---------------------------------------------------------------------
--  65. 정년일을 총회 규정대로 "만 70세가 되는 해 생일 하루 전"으로
-- ---------------------------------------------------------------------
--  근거 : 총회 정년 규정 — 만 70세가 되는 해 생일 하루 전까지 시무
--  · retire_date : 마지막 시무일(생일 하루 전)을 돌려준다. (전에는 생일 당일)
--  · is_retired  : 만 70세 생일 당일부터 참 (판정 자체는 전과 같다)
-- ---------------------------------------------------------------------

create or replace function public.retire_date(p_birth date)
returns date language sql immutable as $fn$
  select case when p_birth is null then null
              else (p_birth + interval '70 years' - interval '1 day')::date end;
$fn$;

create or replace function public.is_retired(p_birth date)
returns boolean language sql stable as $fn$
  select p_birth is not null and public.retire_date(p_birth) < current_date;
$fn$;

comment on function public.retire_date(date) is
  '정년일(마지막 시무일) = 만 70세가 되는 해 생일 하루 전 (총회 규정)';
comment on function public.is_retired(date) is
  '정년 경과 여부 — 만 70세 생일 당일부터 참';

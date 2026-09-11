-- =====================================================================
--  91. 정년 1년 연장 — 만 71세가 되는 생일 하루 전까지 시무
--
--  총회 결의로 정년이 1년 늘어(만 70세 → 만 71세), 정년일(마지막 시무일)을
--  "만 71세가 되는 생일 하루 전"으로 바꿉니다.
--    · retire_date(생년월일) = 생년월일 + 71년 - 1일
--    · is_retired 는 retire_date 를 그대로 쓰므로 함께 바뀝니다
--      (정회원 판정 is_member, 자동 처리 apply_retirement, 회원 카드,
--       총대 자격 연장 등 정년을 보는 모든 곳이 이 함수 하나를 씁니다).
--
--  옛 규정(만 70세)으로 이미 언권회원이 된 분 가운데 새 규정으로는 아직
--  정년 전인 분(만 70세 이상 71세 미만)은 정회원으로 되돌립니다.
--  임원 직책은 자동으로 되살리지 않으므로 필요하면 관리자가 다시 임명합니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

create or replace function public.retire_date(p_birth date)
returns date language sql immutable as $fn$
  select case when p_birth is null then null
              else (p_birth + interval '71 years' - interval '1 day')::date end;
$fn$;

create or replace function public.is_retired(p_birth date)
returns boolean language sql stable as $fn$
  select p_birth is not null and public.retire_date(p_birth) < current_date;
$fn$;

comment on function public.retire_date(date) is
  '정년일(마지막 시무일) = 만 71세가 되는 생일 하루 전 (총회 정년 1년 연장, 2026-09 적용)';
comment on function public.is_retired(date) is
  '정년 경과 여부 — 만 71세 생일 당일부터 참';

-- 옛 규정으로 언권회원이 되었으나 새 규정으로는 아직 정년 전인 분을 정회원으로 되돌린다
do $do$
declare
  v_n1 integer := 0;
  v_n2 integer := 0;
  v_names text;
begin
  select string_agg(name || '(' || coalesce(church, '') || ')', ', ') into v_names
    from public.roster
   where role = 'advisory' and retire_applied and birth_date is not null
     and not public.is_retired(birth_date);

  update public.roster
     set role = 'member', retire_applied = false
   where role = 'advisory' and retire_applied and birth_date is not null
     and not public.is_retired(birth_date);
  get diagnostics v_n1 = row_count;

  update public.profiles
     set role = 'member', retire_applied = false, updated_at = now()
   where role = 'advisory' and retire_applied and birth_date is not null
     and not public.is_retired(birth_date);
  get diagnostics v_n2 = row_count;

  if v_n1 + v_n2 > 0 then
    insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
    values (null, null, '시스템', 'system', 'update', '정년 연장 복원',
            '만 71세 규정 적용으로 정회원 복원 — 명단 ' || v_n1 || '명, 계정 ' || v_n2 || '명' ||
            coalesce(' (' || v_names || ')', ''));
  end if;
end
$do$;

-- 확인
-- select name, birth_date, public.retire_date(birth_date) as 정년일, public.is_retired(birth_date) as 경과, role
--   from public.roster where birth_date is not null order by 3;

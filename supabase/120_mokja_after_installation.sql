-- =====================================================================
--  120. 목자교회 송지용 목사 위임 반영 — 위임식 뒤에 실행 (2026-10-20 준비)
--
--  제20회 정기노회(2026. 10. 12.)에서 목자교회 송지용씨 위임목사 청빙을 가결했으나,
--  위임식을 마친 뒤에 반영한다(그 전까지는 시무목사, 118 sql). 아래 v_day 에 위임식 날짜를 적고 그날 이후에 실행한다.
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
-- =====================================================================

do $$
declare
  v_day date := null;   -- ← 위임식 날짜를 적는다. 예: date '2026-11-23'
begin
  if v_day is null then
    raise exception '위임식 날짜(v_day)를 먼저 적어 주세요. 바뀐 것은 없습니다.';
  end if;
  if current_date < v_day then
    raise exception '아직 위임식(%) 전입니다. 바뀐 것은 없습니다.', v_day;
  end if;
  update public.sichal_churches set pastor = '송지용', updated_at = now(), updated_by = '120 sql (위임식 반영)' where name = '목자교회';
  update public.roster set church = '목자교회', "position" = '위임목사', served_from = coalesce(served_from, v_day) where name = '송지용' and active;
  update public.profiles set church = '목자교회', "position" = '위임목사', updated_at = now() where name = '송지용' and role <> 'pending';
  raise notice '목자교회 담임 송지용 위임목사로 반영했습니다.';
end
$$;

-- 확인
select name, sichal, pastor from public.sichal_churches where name = '목자교회';
select name, church, "position", served_from from public.roster where name = '송지용';

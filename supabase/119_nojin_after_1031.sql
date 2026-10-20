-- =====================================================================
--  119. 노진교회 손병민 목사 위임 반영 — 위임식(2026. 10. 31.) 뒤에 실행 (2026-10-20 준비)
--
--  제20회 정기노회(2026. 10. 12.)에서 노진교회 손병민씨 위임목사 청빙을 가결했으나,
--  위임식은 10월 31일이므로 그날 이후에 이 파일을 실행한다. 그 전까지는 시무목사다(118 sql). (그 전에는 실행하지 말 것)
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
-- =====================================================================

-- 위임식 날짜가 지났을 때만 바꾼다 (실수로 미리 실행해도 아무것도 바뀌지 않는다)
do $$
begin
  if current_date < date '2026-10-31' then
    raise exception '아직 위임식(2026-10-31) 전입니다. 바뀐 것은 없습니다.';
  end if;
  update public.sichal_churches set pastor = '손병민', updated_at = now(), updated_by = '119 sql (위임식 반영)' where name = '노진교회';
  update public.roster set church = '노진교회', "position" = '위임목사', served_from = coalesce(served_from, date '2026-10-31') where name = '손병민' and active;
  update public.profiles set church = '노진교회', "position" = '위임목사', updated_at = now() where name = '손병민' and role <> 'pending';
  raise notice '노진교회 담임 손병민 위임목사로 반영했습니다.';
end
$$;

-- 확인
select name, sichal, pastor from public.sichal_churches where name = '노진교회';
select name, church, "position", served_from from public.roster where name = '손병민';

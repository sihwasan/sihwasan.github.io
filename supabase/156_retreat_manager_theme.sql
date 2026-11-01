-- =====================================================================
--  156. 수양회 담당자 표시 · 제주 테마 (2026-11-01)
--  · settings.manager : 「내 안내」의 「다음 일정 안내」 머리에 「담당 · …」로 보인다.
--  · settings.theme   : 'jeju' 면 수양회 화면에만 제주 테마(복숭아빛 노을·귤색·풀빛)를 입힌다.
--  여러 번 실행해도 같다.
-- =====================================================================
update public.retreats
   set settings = coalesce(settings, '{}'::jsonb)
                  || jsonb_build_object('manager', '이동진 목사 (교육친교부 총무)', 'theme', 'jeju')
 where title = '2026 제주 부부수양회';

-- 확인
select title, settings->>'manager' as manager, settings->>'theme' as theme
  from public.retreats where title = '2026 제주 부부수양회';

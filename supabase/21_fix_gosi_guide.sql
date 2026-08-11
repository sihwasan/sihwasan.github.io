-- =====================================================================
--  21. 고시가이드북 배포 정리
--
--  고시가이드북은 노회가 책자로 판매하는 자료이므로 홈페이지에서
--  내려받게 하지 않습니다. 자료실에는 안내만 남깁니다.
--
--  * 짧습니다. 그대로 붙여넣어 실행해 주세요.
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

update public.archive_items
   set title       = '시화산노회 고시부 목사장로 고시가이드 (책자)',
       description = '고시 과목·제출서류 안내와 과목별 예상 문제가 실린 고시집입니다. '
                     '(2025. 9. 고시부 발행) '
                     '노회에서 책자로 판매하는 자료이므로 홈페이지에서는 내려받으실 수 없습니다. '
                     '구입은 노회 사무실(031-486-9993) 또는 고시부로 문의해 주세요.',
       link_url    = null,
       file_path   = null,
       file_name   = null,
       access      = 'public'
 where title like '시화산노회 고시부 목사장로 고시가이드%';


-- 확인 : 파일 주소가 비어 있어야 정상입니다.
select title as "제목",
       coalesce(link_url, '(없음)')  as "파일 주소",
       coalesce(file_name, '(없음)') as "첨부"
  from public.archive_items
 where section = '고시';


-- 확인 : 모의고사 문제가 들어갔는지 (735문항이어야 합니다)
select coalesce(subject, '합계') as "과목", count(*) as "문항"
  from public.exam_questions
 group by rollup (subject)
 order by count(*) desc;

-- =====================================================================
--  24. 노회 일정에 날짜 칸 추가
--
--  일정을 등록하실 때 달력에서 날짜를 고르실 수 있도록,
--  실제 날짜를 담을 칸을 더합니다.
--  화면에 보이는 '3.25' 같은 표시는 이 날짜에서 자동으로 만들어집니다.
--
--  * 이 파일은 선택 사항입니다.
--    실행하지 않으셔도 달력으로 날짜를 고르실 수 있습니다.
--    실행하시면 연도까지 함께 보관되어 해가 바뀌어도 정확합니다.
--  * 여러 번 실행해도 안전합니다.
-- =====================================================================

alter table public.site_schedule add column if not exists event_date date;

-- 이미 들어 있는 '3.25' 같은 표시에서 날짜를 되살려 채운다.
-- (연도는 올해 기준. 다르면 화면에서 고쳐 주시면 됩니다)
update public.site_schedule
   set event_date = make_date(
         extract(year from current_date)::int,
         split_part(date_label, '.', 1)::int,
         split_part(date_label, '.', 2)::int)
 where event_date is null
   and date_label ~ '^[0-9]{1,2}\.[0-9]{1,2}$';

-- 날짜가 있는 일정은 날짜순으로 정렬되게 한다
update public.site_schedule
   set sort = to_char(event_date, 'YYYYMMDD')::int
 where event_date is not null;

create index if not exists site_schedule_date_idx on public.site_schedule (event_date);

select id, date_label as "표시", event_date as "날짜", title as "내용"
  from public.site_schedule
 order by sort;

-- =====================================================================
--  87. 세례의무금은 노회 수입이 아니다
--
--  세례의무금은 총회가 부과하고 총회로 넘어가는 돈이며 노회는 관리만 한다.
--  그래서 노회 재정부 장부의 수입에 넣지 않는다.
--    1) 세례의무금 납입 ↔ 노회 장부 자동 연동(74의 7절)을 끊는다.
--    2) 이미 연동되어 적힌 세례의무금 수입 줄을 지운다.
--    3) 노회 과목에서 '세례의무금'·'총회 세례의무금'을 뺀다(기록이 없을 때만).
--  세례의무금 납부 현황·마감은 임원방 <세례의무금 관리>에서 그대로 관리한다.
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run  (여러 번 실행해도 안전)
-- =====================================================================
drop trigger if exists sync_bapdues_to_ledger on public.bapdues;
drop function if exists public.sync_bapdues_to_ledger();

do $bap$
declare r record;
begin
  for r in select distinct link_id from public.ledger_entries where link_kind = 'bapdues' loop
    perform public.drop_linked_entry('bapdues', r.link_id);
  end loop;
end
$bap$;

delete from public.ledger_categories c
 where c.owner_kind = 'presbytery' and c.name in ('세례의무금', '총회 세례의무금')
   and not exists (select 1 from public.ledger_entries e
                     join public.ledger_books b on b.id = e.book_id
                    where b.owner_kind = 'presbytery' and e.kind = c.kind and e.category = c.name);

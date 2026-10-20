-- =====================================================================
--  122. 노회장·서기·간사에게 알림 — 목자교회 원로목사 추대식·위임식 날짜를 일정에 넣어 달라 (2026-10-20)
--
--  제20회 정기노회(2026. 10. 12.) 가결: 목자교회 김해수 목사 원로목사 추대, 송지용 목사 위임목사 청빙.
--  두 행사 날짜가 아직 노회 일정에 없다. 알림의 <바로 가기>를 누르면 노회 일정의 임직식 등록 창이
--  대상자·교회·구분이 채워진 채로 열린다. 날짜가 지나면 명단에 위임일이 자동으로 적힌다(121 sql).
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 같은 알림이 두 번 가지 않습니다.
-- =====================================================================

-- 1) 송지용 목사 위임식
insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by_name)
select p.id, '일정',
       '목자교회 송지용 목사 위임식 날짜를 노회 일정에 넣어 주세요',
       '제20회 정기노회에서 목자교회 송지용 목사의 위임목사 청빙을 가결했습니다. 위임식 날짜가 아직 노회 일정에 없습니다.' || E'\n' ||
       '아래 바로 가기를 누르면 임직식 등록 창이 미리 채워져 열립니다. 날짜만 고르고 저장하면 공지에도 올라가고, 그날이 지나면 회원 명단에 위임일이 자동으로 적힙니다.' || E'\n' ||
       '→ schedule.html#new=' || '임직식' || '&sub=' || '목사 위임' || '&person=' || '송지용' || '&church=' || '목자교회',
       'sched-mokja-install-2026', '홈페이지'
  from public.profiles p
 where p.role in ('president', 'clerk', 'staff')
   and not exists (select 1 from public.notifications n where n.user_id = p.id and n.dedupe_key = 'sched-mokja-install-2026');

-- 2) 김해수 목사 원로목사 추대식
insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by_name)
select p.id, '일정',
       '목자교회 김해수 목사 원로목사 추대식 날짜를 노회 일정에 넣어 주세요',
       '제20회 정기노회에서 목자교회 김해수 목사의 원로목사 추대를 조건부로 가결했습니다. 추대식 날짜가 아직 노회 일정에 없습니다.' || E'\n' ||
       '아래 바로 가기를 누르면 임직식 등록 창이 미리 채워져 열립니다. 날짜를 고르고 저장해 주세요.' || E'\n' ||
       '→ schedule.html#new=' || '임직식' || '&sub=' || '원로목사 추대' || '&person=' || '김해수' || '&church=' || '목자교회',
       'sched-mokja-emeritus-2026', '홈페이지'
  from public.profiles p
 where p.role in ('president', 'clerk', 'staff')
   and not exists (select 1 from public.notifications n where n.user_id = p.id and n.dedupe_key = 'sched-mokja-emeritus-2026');

-- 확인
select n.created_at, p.name, p.role, n.title from public.notifications n join public.profiles p on p.id = n.user_id
 where n.dedupe_key like 'sched-mokja-%' order by n.id desc;

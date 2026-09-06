-- =====================================================================
--  73. 청원서 알림에 <바로 가기> 붙이기
--
--  청원서가 제출되면 그 시찰의 시찰장·서기에게 알림이 갑니다. 지금까지는
--  알림에 어느 청원서인지 표시가 없어, 받은 사람이 알림함에서 시찰 화면을
--  직접 찾아 들어가야 했습니다.
--
--  알림에 dedupe_key 를 'petition-<번호>-<시찰>' 로 남겨, 알림함의
--  <바로 가기> 단추가 그 청원서의 서류 진단 화면을 곧바로 열도록 합니다.
--    → sichal.html?s=<시찰>&p=<번호>#review
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다. 이미 온 알림은 그대로 두고,
--    이 뒤에 오는 알림부터 바로 가기가 정확한 청원서를 가리킵니다.
--    (이전 알림도 제목의 [시찰명]을 읽어 그 시찰의 서류 진단으로 갑니다)
-- =====================================================================

create or replace function public.submit_petition(
  p_sichal text, p_form_id text, p_form_title text, p_title text, p_data jsonb, p_seal text)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_id   bigint;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  if not public.is_full_member() then
    raise exception '언권회원은 청원서를 제출할 수 없습니다.';
  end if;
  select p.name into v_name from public.profiles p where p.id = v_uid;

  insert into public.petition_submissions (user_id, user_name, sichal, form_id, form_title, title, data, seal)
  values (v_uid, v_name, p_sichal, p_form_id, p_form_title, p_title, coalesce(p_data, '{}'::jsonb), p_seal)
  returning id into v_id;

  -- 그 시찰의 시찰장·서기에게 알림 (dedupe_key 로 어느 청원서인지 남긴다)
  insert into public.notifications (user_id, kind, title, body, dedupe_key)
  select distinct t.uid, '시찰',
         '[' || p_sichal || '] 새 청원서가 제출되었습니다',
         coalesce(v_name, '회원') || ' 님이 「' || p_title || '」을(를) 제출했습니다. ' ||
         '아래 <바로 가기>를 누르면 그 청원서의 서류 진단 화면이 열립니다.',
         'petition-' || v_id || '-' || p_sichal
    from (
      select o.user_id as uid from public.sichal_officers o where o.sichal = p_sichal
      union
      select p.id from public.sichals s
        join public.profiles p
          on p.name is not null
         and (split_part(btrim(coalesce(s.head, '')),  ' ', 1) = p.name
           or split_part(btrim(coalesce(s.clerk, '')), ' ', 1) = p.name)
       where s.name = p_sichal
    ) t
   where t.uid is not null and t.uid <> v_uid;

  return v_id;
end;
$fn$;

revoke all on function public.submit_petition(text, text, text, text, jsonb, text) from public;
grant execute on function public.submit_petition(text, text, text, text, jsonb, text) to authenticated;

-- 확인
select count(*) as "청원서 알림", count(dedupe_key) as "바로 가기 있는 알림"
  from public.notifications
 where kind = '시찰' and title like '%새 청원서%';

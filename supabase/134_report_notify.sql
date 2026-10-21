-- 134. 임원 업무 보고서 → 간사에게 알림으로 지시 보내기
--  간사는 보고서를 받지 않고, 노회장·서기 보고서에서 간사가 할 일만 알림함(notifications)으로 받는다.
--  창구(cloudflare/ai)가 새벽에 로그인 없이 넣어야 하므로 보고서 열쇠(REPORT_KEY, 128 sql)로만 열리는 문을 둔다.
--  실행: Supabase SQL Editor 에 붙여 넣고 실행. (여러 번 실행해도 안전)

create or replace function public.ai_report_notify(p_key text, p_items jsonb)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v   jsonb;
  n   integer := 0;
  uid uuid;
begin
  if not public.ai_report_key_ok(p_key) then raise exception 'not allowed'; end if;
  for v in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    begin uid := (v ->> 'user_id')::uuid; exception when others then continue; end;
    if uid is null or not exists (select 1 from public.profiles p where p.id = uid) then continue; end if;
    if coalesce(v ->> 'title', '') = '' then continue; end if;
    /* 같은 날 같은 제목은 한 번만 */
    if exists (select 1 from public.notifications x
                where x.user_id = uid and x.title = (v ->> 'title') and x.created_at >= date_trunc('day', now() + interval '9 hours') - interval '9 hours') then continue; end if;
    insert into public.notifications (user_id, kind, title, body)
      values (uid, coalesce(nullif(v ->> 'kind', ''), '업무 지시'), left(v ->> 'title', 200), left(coalesce(v ->> 'body', ''), 2000));
    n := n + 1;
  end loop;
  return n;
end $fn$;

revoke all on function public.ai_report_notify(text, jsonb) from public;
grant execute on function public.ai_report_notify(text, jsonb) to anon, authenticated;

-- =====================================================================
--  117. AI 질문 기록 — 최고관리자의 활동은 남기지 않는다 (2026-10-20)
--
--  최고관리자는 홈페이지를 기술적으로 유지·보수하는 운영자 계정이라 그 행위는
--  감사 기록(audit_logs 의 audit_skip_superadmin_trg)에 남기지 않는다. AI 질문 기록(ai_logs)도 같다.
--  창구(cloudflare/ai)도 최고관리자의 질문은 보내지 않지만, 혹시 들어와도 여기서 버린다.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
-- =====================================================================

create or replace function public.ai_logs_skip_superadmin()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.role = 'superadmin'
     or exists (select 1 from public.profiles p where p.id = new.user_id and p.role = 'superadmin') then
    return null;   -- 기록하지 않는다
  end if;
  return new;
end
$fn$;

drop trigger if exists ai_logs_skip_superadmin_trg on public.ai_logs;
create trigger ai_logs_skip_superadmin_trg
  before insert on public.ai_logs
  for each row execute function public.ai_logs_skip_superadmin();

-- 이미 남은 최고관리자 기록은 지운다
delete from public.ai_logs
 where role = 'superadmin'
    or user_id in (select id from public.profiles where role = 'superadmin');

-- 확인:  select created_at, user_name, role, question from public.ai_logs order by id desc limit 20;

-- =====================================================================
--  83. 전자 도장 만들기 · 감사부 도장 등록
--
--  1) 정회원이 <내 정보>에서 이름·직책을 넣어 전자 도장(PNG)을 만들어
--     저장할 수 있다. 만들 때 동의한 내용과 시각을 함께 남긴다.
--  2) 감사부장·감사부 서기는 자기 도장을 <감사필 도장>으로 직접 등록한다.
--     (전에는 노회 관리자가 도장 관리 화면에서 파일로 올려 주어야 했다)
--     seals 표에 image 칸을 두어 본인이 만든 도장 그림을 담는다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 36_audit_ledger.sql, 78_ledger_close_approval.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 내 도장 — 만든 도장인지, 언제 무엇에 동의했는지
-- ---------------------------------------------------------------------
alter table public.member_seals
  add column if not exists generated   boolean not null default false,
  add column if not exists consent_at  timestamptz,
  add column if not exists consent_ver text,
  add column if not exists gen_meta    jsonb;


-- ---------------------------------------------------------------------
-- 2. 감사필 도장 — 본인이 만든 그림을 바로 담는 칸
-- ---------------------------------------------------------------------
alter table public.seals
  add column if not exists image text;      -- data:image/png;base64,…  (file_path 보다 먼저 쓴다)

-- 내가 감사부장이면 '감사부장', 감사부 서기면 '감사부서기', 아니면 null
create or replace function public.my_audit_seal_key()
returns text language sql stable security definer set search_path = public as $fn$
  select case
    when exists (select 1 from public.committee_officers o
                  where o.user_id = auth.uid() and o.committee = '감사헌의부' and o.position = '부장')
      or exists (select 1 from public.committees c join public.profiles p on p.id = auth.uid()
                  where c.name = '감사헌의부' and p.name is not null
                    and split_part(btrim(coalesce(c.head, '')), ' ', 1) = p.name)
      then '감사부장'
    when exists (select 1 from public.committee_officers o
                  where o.user_id = auth.uid() and o.committee = '감사헌의부' and o.position = '서기')
      or exists (select 1 from public.committees c join public.profiles p on p.id = auth.uid()
                  where c.name = '감사헌의부' and p.name is not null
                    and split_part(btrim(coalesce(c.clerk, '')), ' ', 1) = p.name)
      then '감사부서기'
    else null end;
$fn$;
grant execute on function public.my_audit_seal_key() to authenticated;

-- 감사부장·서기가 자기 도장을 감사필 도장으로 등록한다
create or replace function public.register_my_audit_seal(p_image text)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_key text := public.my_audit_seal_key();
  v_me  text;
begin
  if v_key is null then
    raise exception '감사부장·감사부 서기만 감사필 도장을 등록할 수 있습니다.';
  end if;
  if p_image is null or p_image not like 'data:image/png;base64,%' then
    raise exception '도장 그림(PNG)이 없습니다. 먼저 내 정보에서 도장을 만들거나 올려 주세요.';
  end if;
  if length(p_image) > 1200000 then
    raise exception '도장 그림이 너무 큽니다.';
  end if;
  select name into v_me from public.profiles where id = auth.uid();

  update public.seals
     set image = p_image, holder = coalesce(v_me, holder), updated_at = now(), updated_by = v_me
   where key = v_key;
  if not found then
    insert into public.seals (key, label, holder, image, sort, updated_at, updated_by)
    values (v_key, case v_key when '감사부장' then '감사부장 도장' else '감사부 서기 도장' end,
            v_me, p_image, 90, now(), v_me);
  end if;

  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select auth.uid(), p.email, p.name, p.role, 'update', '감사필 도장 등록', v_key
    from public.profiles p where p.id = auth.uid();
  return v_key;
end
$fn$;
grant execute on function public.register_my_audit_seal(text) to authenticated;

-- 감사필 도장이 갖추어졌는가 (감사부·관리자에게)
create or replace function public.audit_seal_status()
returns table (key text, holder text, has_seal boolean, mine boolean)
language sql stable security definer set search_path = public as $fn$
  select k.key, s.holder,
         (s.image is not null or s.file_path is not null) as has_seal,
         (k.key = public.my_audit_seal_key()) as mine
    from (values ('감사부장'), ('감사부서기')) as k(key)
    left join public.seals s on s.key = k.key
   where public.is_audit_officer() or public.can_manage();
$fn$;
grant execute on function public.audit_seal_status() to authenticated;

-- 확인:
--   select * from public.audit_seal_status();

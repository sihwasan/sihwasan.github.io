-- =====================================================================
--  90. 회원 삭제 (최고관리자 전용) — 잘못 가입된 회원의 계정을 지운다
--
--  지금까지는 <승인대기> 회원만 지울 수 있었습니다(67_delete_pending_member.sql).
--  노회와 관계없는 사람이 이미 정회원 등급까지 받았거나, 같은 사람이 계정을
--  두 번 만든 경우처럼 등급과 상관없이 지워야 할 때가 있어, 최고관리자가
--  어떤 등급의 회원이든 지울 수 있게 합니다.
--
--  하는 일
--    1) 지운 회원의 정보를 deleted_profiles 에 그대로 남긴다 (되살릴 때 참고).
--    2) 감사 기록(audit_logs)에 누가 누구를 왜 지웠는지 적는다.
--    3) 로그인 계정(auth.users)까지 지운다. profiles 와 알림·문의·도장 등은
--       외래키(on delete cascade)로 함께 지워지고, 글·발급 기록처럼 남겨야 할
--       것은 작성자만 비워진다(on delete set null).
--    4) 지급 확인(ledger_payouts)의 받는 사람 계정 연결만 끊는다 — 장부 기록은 남는다.
--
--  못 지우는 것
--    · 자기 자신,  · 다른 최고관리자 계정
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 지운 회원 보관 표 (최고관리자만 본다)
-- ---------------------------------------------------------------------
create table if not exists public.deleted_profiles (
  id               bigserial primary key,
  user_id          uuid not null,
  email            text,
  name             text,
  church           text,
  position         text,
  role             text,
  title            text,
  snapshot         jsonb,                 -- profiles 한 줄 전체
  reason           text,                  -- 삭제 사유
  deleted_by       uuid,
  deleted_by_name  text,
  deleted_at       timestamptz not null default now()
);
create index if not exists deleted_profiles_user_idx on public.deleted_profiles (user_id);
create index if not exists deleted_profiles_at_idx   on public.deleted_profiles (deleted_at desc);

alter table public.deleted_profiles enable row level security;
drop policy if exists deleted_profiles_read on public.deleted_profiles;
create policy deleted_profiles_read on public.deleted_profiles for select
  using (public.my_role() = 'superadmin');
-- 쓰기는 아래 함수(security definer)만 한다.

comment on table public.deleted_profiles is
  '최고관리자가 지운 회원의 정보 보관 — 잘못 지웠을 때 다시 가입·등급 부여에 참고';


-- ---------------------------------------------------------------------
-- 2. 회원 삭제 함수
-- ---------------------------------------------------------------------
create or replace function public.delete_member(p_id uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_target  public.profiles%rowtype;
  v_me_name text;
  v_me_mail text;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if public.my_role() <> 'superadmin' then
    raise exception '회원 삭제는 최고관리자만 할 수 있습니다.';
  end if;
  if p_id = auth.uid() then
    raise exception '자기 자신은 삭제할 수 없습니다.';
  end if;

  select * into v_target from public.profiles where id = p_id;
  if v_target.id is null then
    raise exception '대상 회원을 찾을 수 없습니다.';
  end if;
  if v_target.role = 'superadmin' then
    raise exception '최고관리자 계정은 삭제할 수 없습니다.';
  end if;

  select name, email into v_me_name, v_me_mail from public.profiles where id = auth.uid();

  -- 1) 보관
  insert into public.deleted_profiles
    (user_id, email, name, church, position, role, title, snapshot, reason, deleted_by, deleted_by_name)
  values
    (v_target.id, v_target.email, v_target.name, v_target.church, v_target.position,
     v_target.role, v_target.title, to_jsonb(v_target), v_reason, auth.uid(), v_me_name);

  -- 2) 감사 기록
  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  values (auth.uid(), v_me_mail, v_me_name, 'superadmin', 'delete', '회원 삭제(최고관리자)',
          coalesce(v_target.name, '') || ' <' || coalesce(v_target.email, '') || '> · ' ||
          coalesce(v_target.church, '-') || ' · 등급 ' || coalesce(v_target.role, '-') ||
          coalesce(' · 사유: ' || v_reason, ''));

  -- 3) 장부의 지급 확인은 남기고 계정 연결만 끊는다
  update public.ledger_payouts set recipient_user = null where recipient_user = p_id;

  -- 4) 로그인 계정까지 지운다 (profiles 등은 외래키로 함께 지워진다).
  --    계정을 지울 권한이 없는 환경이면 프로필만 지운다.
  begin
    delete from auth.users where id = p_id;
  exception when insufficient_privilege then
    delete from public.profiles where id = p_id;
    return 'profile_only';
  end;
  return 'deleted';
end;
$fn$;

grant execute on function public.delete_member(uuid, text) to authenticated;

comment on function public.delete_member(uuid, text) is
  '최고관리자 전용 회원 삭제 — 어떤 등급이든 지우되 자기 자신·다른 최고관리자는 제외, deleted_profiles 와 감사 기록에 남김';


-- ---------------------------------------------------------------------
-- 3. 확인
-- ---------------------------------------------------------------------
-- select user_id, name, email, role, reason, deleted_by_name, deleted_at
--   from public.deleted_profiles order by deleted_at desc limit 20;

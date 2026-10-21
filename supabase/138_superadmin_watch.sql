-- =====================================================================
--  138. 최고관리자 메뉴 — 감독 기록 감추기 · 회원 검색 내역 점검 (2026-10-22 사용자 지시)
--
--  1) audit_log_hides   감독 기록 감추기
--     오해를 부를 만한 감사 기록(audit_logs)을 최고관리자가 평소 감독 화면에서 뺀다.
--     · 원본 기록은 그대로 남는다 — audit_logs 는 여전히 누구도 고치거나 지울 수 없고 3년 보존한다
--       (노회규칙 제43조 3항).
--     · 감춘 사실(언제·왜)은 이 표에 남고, 관리자(노회장·서기·간사)도 읽을 수 있다.
--       감독 화면의 「감춘 기록도 보기」를 켜면 감춘 기록이 '감춤' 표시와 함께 모두 보인다.
--     · 감추기·되돌리기는 최고관리자만, 2단계 인증(OTP)을 마친 로그인에서만 한다.
--
--  2) watch_words       점검 낱말 (비속어·욕설·비방)
--     최고관리자가 고치는 낱말 목록. 아래 3) 에서 질문에 이 낱말이 들어 있으면 '걸린 질문'이 된다.
--
--  3) super_ai_logs()   회원 AI 검색 내역 (최고관리자)
--     질문·답은 모두 보되 물은 사람은 가린다. 점검 낱말에 걸린 질문만 누가 물었는지 돌려준다.
--     (개인정보처리방침 제2조 3항 「부정 이용 방지」 목적 안 — 처리방침은 고치지 않는다, 사용자 결정 2026-10-22)
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--  (drop policy 가 있어 「Potential issue detected」 창이 뜨면 Run query 를 한 번 더 누른다)
-- =====================================================================

-- 지금 로그인이 OTP 확인까지 마쳤는가 (124 와 같은 정의 — 124 를 아직 실행하지 않은 DB 에서도 돌게)
create or replace function public.mfa_ok()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$fn$;
grant execute on function public.mfa_ok() to anon, authenticated;

-- 최고관리자이며 OTP 확인을 마친 로그인인가
create or replace function public.super_ok()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() = 'superadmin', false) and public.mfa_ok()
$fn$;
revoke all on function public.super_ok() from public;
grant execute on function public.super_ok() to authenticated;


-- ---------------------------------------------------------------------
-- 1) 감독 기록 감추기
-- ---------------------------------------------------------------------
create table if not exists public.audit_log_hides (
  log_id    bigint primary key references public.audit_logs(id) on delete cascade,
  reason    text not null check (char_length(btrim(reason)) between 2 and 300),
  hidden_at timestamptz not null default now()
);
comment on table public.audit_log_hides is
  '최고관리자가 평소 감독 화면에서 뺀 감사 기록. 원본(audit_logs)은 그대로이며 관리자는 「감춘 기록도 보기」로 모두 본다.';

alter table public.audit_log_hides enable row level security;

drop policy if exists audit_hides_read on public.audit_log_hides;
create policy audit_hides_read on public.audit_log_hides
  for select using (public.can_manage());

drop policy if exists audit_hides_insert on public.audit_log_hides;
create policy audit_hides_insert on public.audit_log_hides
  for insert with check (public.super_ok());

drop policy if exists audit_hides_delete on public.audit_log_hides;
create policy audit_hides_delete on public.audit_log_hides
  for delete using (public.super_ok());

revoke all on public.audit_log_hides from anon;
grant select, insert, delete on public.audit_log_hides to authenticated;


-- ---------------------------------------------------------------------
-- 2) 점검 낱말
-- ---------------------------------------------------------------------
create table if not exists public.watch_words (
  word     text primary key check (char_length(btrim(word)) between 1 and 30),
  added_at timestamptz not null default now()
);
comment on table public.watch_words is '회원 AI 검색 내역에서 걸러 볼 낱말 (비속어·욕설·비방) — 최고관리자만';

alter table public.watch_words enable row level security;

drop policy if exists watch_words_all on public.watch_words;
create policy watch_words_all on public.watch_words
  for all using (public.super_ok()) with check (public.super_ok());

revoke all on public.watch_words from anon;
grant select, insert, delete on public.watch_words to authenticated;

-- 처음 목록 (최고관리자 메뉴에서 더하거나 뺄 수 있다)
-- 성경·회의 말에도 나오는 낱말(새끼 — 나귀 새끼, 죽여 — 옛 사람을 죽여 등)은 엉뚱하게 걸리므로 넣지 않는다
insert into public.watch_words (word) values
  ('씨발'), ('시발'), ('ㅅㅂ'), ('씨바'), ('개새끼'), ('개새'), ('병신'), ('ㅂㅅ'), ('븅신'),
  ('좆'), ('존나'), ('졸라'), ('지랄'), ('염병'), ('미친놈'), ('미친년'), ('미친새'), ('또라이'), ('등신'),
  ('닥쳐'), ('꺼져'), ('엿먹'), ('썅'), ('쌍놈'), ('개같'), ('사기꾼')
on conflict (word) do nothing;


-- ---------------------------------------------------------------------
-- 3) 회원 AI 검색 내역 — 물은 사람은 가리고, 걸린 질문만 밝힌다
--    p_limit   한 번에 가져올 줄 수 (1~300)
--    p_before  이 번호보다 앞선(오래된) 기록부터 — 「더 보기」에 쓴다 (null 이면 가장 최근부터)
--    p_flagged true 면 점검 낱말에 걸린 질문만
-- ---------------------------------------------------------------------
drop function if exists public.super_ai_logs(integer, bigint, boolean);
create function public.super_ai_logs(p_limit integer default 100, p_before bigint default null, p_flagged boolean default false)
returns table(
  out_id bigint, out_created_at timestamptz, out_role text, out_question text, out_answer text,
  out_no_answer boolean, out_fb_helpful boolean, out_fb_reason text,
  out_hits text[], out_asker text
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.super_ok() then
    raise exception '최고관리자(2단계 인증)만 볼 수 있습니다.' using errcode = '42501';
  end if;
  return query
    select l.id, l.created_at, l.role, l.question, left(coalesce(l.answer, ''), 800),
           l.no_answer, l.fb_helpful, l.fb_reason,
           h.hits,
           case when h.hits is not null then l.user_name else null end
      from public.ai_logs l
      left join lateral (
        select array_agg(w.word order by w.word) as hits
          from public.watch_words w
         where strpos(lower(l.question || ' ' || coalesce(l.fb_reason, '')), lower(w.word)) > 0
      ) h on true
     where (p_before is null or l.id < p_before)
       and (not coalesce(p_flagged, false) or h.hits is not null)
     order by l.id desc
     limit least(greatest(coalesce(p_limit, 100), 1), 300);
end
$fn$;
revoke all on function public.super_ai_logs(integer, bigint, boolean) from public;
grant execute on function public.super_ai_logs(integer, bigint, boolean) to authenticated;


-- 확인
select (select count(*) from public.watch_words) as watch_words,
       (select count(*) from public.audit_log_hides) as hidden_logs;

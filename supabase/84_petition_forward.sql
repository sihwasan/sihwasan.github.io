-- =====================================================================
--  84. 통과 청원서 — 시찰장 도장을 찍어 노회 서기에게 제출
--
--  흐름
--    교회(당회장) → 시찰 서기에게 제출(54) → 서류 진단 <적합>(70)
--    → 시찰장이 내 정보의 도장으로 서식의 "시 찰 장 (인)" 자리에 찍어
--      노회 서기에게 제출(forward_petition)
--    → 노회 서기(관리자)가 접수 또는 반려(noheo_petition)
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣고 Run
--  ※ 54·70·73 을 먼저 실행하셔야 합니다. 여러 번 실행해도 안전합니다.
-- =====================================================================

alter table public.petition_submissions
  add column if not exists forwarded_at     timestamptz,                                  -- 노회 제출 시각
  add column if not exists forwarded_by     uuid references auth.users on delete set null, -- 제출한 시찰장
  add column if not exists sichal_head_name text,                                         -- 찍힌 시찰장 이름
  add column if not exists sichal_seal      text,                                         -- 찍힌 도장 (data:image/png)
  add column if not exists noheo_status     text,                                         -- 전송됨 / 접수 / 반려
  add column if not exists noheo_note       text,
  add column if not exists noheo_at         timestamptz,
  add column if not exists noheo_by         text;

create index if not exists petition_sub_fwd_idx
  on public.petition_submissions (forwarded_at desc) where forwarded_at is not null;

-- 시찰장인가 (시찰 임원 표의 시찰장, 또는 시찰 소개의 시찰장 이름과 같은 회원, 총관리자)
create or replace function public.is_sichal_head(p_sichal text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.sichal_officers o
                  where o.user_id = auth.uid() and o.sichal = p_sichal and o.position = '시찰장')
      or exists (select 1 from public.sichals s join public.profiles p on p.id = auth.uid()
                  where s.name = p_sichal and p.name is not null
                    and split_part(btrim(coalesce(s.head, '')), ' ', 1) = p.name)
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin');
$fn$;
grant execute on function public.is_sichal_head(text) to authenticated;

-- 시찰장이 도장을 찍어 노회 서기에게 제출한다
create or replace function public.forward_petition(p_id bigint, p_seal text)
returns public.petition_submissions
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_me  text;
  r     public.petition_submissions;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  select * into r from public.petition_submissions where id = p_id;
  if not found then raise exception '청원서를 찾지 못했습니다.'; end if;
  if not public.is_sichal_head(r.sichal) then
    raise exception '시찰장만 노회 서기에게 제출할 수 있습니다.';
  end if;
  if r.status <> '적합' then
    raise exception '서류 진단에서 <적합>으로 통과한 청원서만 제출할 수 있습니다.';
  end if;
  if p_seal is null or p_seal not like 'data:image/png;base64,%' then
    raise exception '시찰장 도장이 없습니다. 내 정보에서 도장을 먼저 만들어 주세요.';
  end if;
  if length(p_seal) > 1200000 then raise exception '도장 그림이 너무 큽니다.'; end if;
  select name into v_me from public.profiles where id = v_uid;

  update public.petition_submissions
     set forwarded_at = now(), forwarded_by = v_uid, sichal_head_name = v_me, sichal_seal = p_seal,
         noheo_status = '전송됨', noheo_note = null, noheo_at = null, noheo_by = null, updated_at = now()
   where id = p_id
   returning * into r;

  -- 노회 관리자(서기·노회장·간사)에게
  insert into public.notifications (user_id, kind, title, body, dedupe_key)
  select g.uid, '시찰',
         '[' || r.sichal || '] 청원서가 노회 서기에게 제출되었습니다',
         '「' || r.title || '」 (' || coalesce(r.user_name, '') || ' · ' || r.form_title || ') — 시찰장 ' ||
         coalesce(v_me, '') || ' 도장으로 제출. 임원방의 <시찰 경유 청원서>에서 접수해 주세요.',
         'petfwd-' || r.id
    from public.recipients_of_group('관리자') as g(uid)
   where g.uid <> v_uid
  on conflict do nothing;
  -- 낸 사람에게
  if r.user_id <> v_uid then
    insert into public.notifications (user_id, kind, title, body, dedupe_key)
    values (r.user_id, '시찰', '[' || r.sichal || '] 청원서가 노회로 제출되었습니다',
            '「' || r.title || '」에 시찰장 ' || coalesce(v_me, '') || ' 도장이 찍혀 노회 서기에게 제출되었습니다.',
            'petfwd-' || r.id)
    on conflict do nothing;
  end if;
  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select v_uid, p.email, p.name, p.role, 'update', '청원서 노회 제출',
         r.sichal || ' / ' || r.title || ' (번호 ' || r.id || ')'
    from public.profiles p where p.id = v_uid;
  return r;
end
$fn$;
grant execute on function public.forward_petition(bigint, text) to authenticated;

-- 노회 서기(관리자)가 접수 또는 반려한다
create or replace function public.noheo_petition(p_id bigint, p_status text, p_note text)
returns public.petition_submissions
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_me  text;
  r     public.petition_submissions;
begin
  if not public.can_manage() then
    raise exception '노회 관리자(서기·노회장·간사)만 처리할 수 있습니다.';
  end if;
  if p_status not in ('접수', '반려') then raise exception '상태는 접수 또는 반려여야 합니다.'; end if;
  select * into r from public.petition_submissions where id = p_id;
  if not found then raise exception '청원서를 찾지 못했습니다.'; end if;
  if r.forwarded_at is null then raise exception '아직 시찰에서 제출하지 않은 청원서입니다.'; end if;
  if p_status = '반려' and btrim(coalesce(p_note, '')) = '' then raise exception '반려 사유를 적어 주세요.'; end if;
  select name into v_me from public.profiles where id = v_uid;

  update public.petition_submissions
     set noheo_status = p_status, noheo_note = nullif(btrim(coalesce(p_note, '')), ''),
         noheo_at = now(), noheo_by = v_me, updated_at = now()
   where id = p_id
   returning * into r;

  -- 낸 사람과 그 시찰의 시찰장·서기에게
  insert into public.notifications (user_id, kind, title, body, dedupe_key)
  select distinct t.uid, '시찰',
         '[' || r.sichal || '] 노회 서기 처리 결과 : ' || p_status,
         '「' || r.title || '」' || case when r.noheo_note is not null then E'\n' || r.noheo_note else '' end,
         'petnh-' || r.id || '-' || r.sichal
    from (
      select r.user_id as uid
      union select o.user_id from public.sichal_officers o where o.sichal = r.sichal
      union select p.id from public.sichals s
              join public.profiles p
                on p.name is not null
               and (split_part(btrim(coalesce(s.head, '')),  ' ', 1) = p.name
                 or split_part(btrim(coalesce(s.clerk, '')), ' ', 1) = p.name)
             where s.name = r.sichal
    ) t
   where t.uid is not null and t.uid <> v_uid
  on conflict do nothing;
  insert into public.audit_logs (user_id, user_email, user_name, role, type, action, detail)
  select v_uid, p.email, p.name, p.role, 'update', '청원서 노회 ' || p_status,
         r.sichal || ' / ' || r.title || ' (번호 ' || r.id || ')' || coalesce(' — ' || r.noheo_note, '')
    from public.profiles p where p.id = v_uid;
  return r;
end
$fn$;
grant execute on function public.noheo_petition(bigint, text, text) to authenticated;

-- 확인:
--   select id, title, status, forwarded_at, sichal_head_name, noheo_status from public.petition_submissions order by id desc limit 5;

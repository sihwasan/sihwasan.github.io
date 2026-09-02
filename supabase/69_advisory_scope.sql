-- ---------------------------------------------------------------------
--  69. 언권회원의 활동 범위
-- ---------------------------------------------------------------------
--  언권회원(advisory)은 정회원과 동일하게 활동하되, 다음 세 가지만 못한다.
--   · 서류 발급 신청  · 청원서 작성·제출  · 교회상황 보고서 작성
--  (교회상황보고서 양식 내려받기는 할 수 있다 — 화면에서 처리)
--
--  · is_member()      : 언권회원도 정회원 열람 자격에 포함시킨다
--  · is_full_member() : 언권회원을 뺀 "온전한 정회원" — 위 세 기능의 문지기
-- ---------------------------------------------------------------------

-- 1. 정회원 열람 자격에 언권회원을 포함
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role not in ('pending', 'general')
       and coalesce(p.suspended, false) = false
       and (not public.is_retired(p.birth_date) or p.retire_applied)
  );
$fn$;

-- 2. 온전한 정회원 (언권회원 제외)
create or replace function public.is_full_member()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_member() and not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'advisory');
$fn$;

comment on function public.is_full_member() is
  '정회원 이상이되 언권회원은 아님 — 서류 발급·청원서·보고서 작성의 자격';

-- 3. 서류 발급 신청은 온전한 정회원만
drop policy if exists doc_requests_insert on public.doc_requests;
create policy doc_requests_insert on public.doc_requests for insert
  with check (auth.uid() = user_id and public.is_full_member());

-- 4. 교회상황 보고서 작성·수정·삭제도 온전한 정회원만 (열람은 그대로)
drop policy if exists church_reports_insert on public.church_reports;
drop policy if exists church_reports_update on public.church_reports;
drop policy if exists church_reports_delete on public.church_reports;

create policy church_reports_insert on public.church_reports for insert with check (
  public.can_manage()
  or public.is_sichal_officer(sichal)
  or (public.is_full_member() and public.my_church() = church)
);
create policy church_reports_update on public.church_reports for update using (
  public.can_manage()
  or public.is_sichal_officer(sichal)
  or (public.is_full_member() and public.my_church() = church)
) with check (
  public.can_manage()
  or public.is_sichal_officer(sichal)
  or (public.is_full_member() and public.my_church() = church)
);
create policy church_reports_delete on public.church_reports for delete using (
  public.can_manage()
  or public.is_sichal_officer(sichal)
  or (public.is_full_member() and public.my_church() = church)
);

-- 5. 청원서: 저장(작성)은 온전한 정회원만, 이미 쓴 것의 열람·삭제는 본인이면 가능
drop policy if exists petitions_self on public.petitions;
create policy petitions_self on public.petitions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_full_member());

drop policy if exists petition_sub_insert on public.petition_submissions;
create policy petition_sub_insert on public.petition_submissions for insert
  with check (user_id = auth.uid() and public.is_full_member());

-- 6. 청원서 제출 함수(security definer)에도 같은 문지기를 세운다
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

  -- 그 시찰의 시찰장·서기에게 알림
  insert into public.notifications (user_id, kind, title, body)
  select distinct t.uid, '시찰',
         '[' || p_sichal || '] 새 청원서가 제출되었습니다',
         coalesce(v_name, '회원') || ' 님이 「' || p_title || '」을(를) 제출했습니다. 청원서 작성 페이지의 받은 청원서에서 확인해 주세요.'
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

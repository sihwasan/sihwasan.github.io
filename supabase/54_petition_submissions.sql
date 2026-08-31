-- 54. 청원서 시찰 제출 (petition.html "시찰 서기에게 전달하기")
--   실제 적용은 Supabase migration petition_submissions 로 완료. 내용 동일.
create table if not exists public.petition_submissions (
  id         bigserial primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  user_name  text,
  sichal     text not null,
  form_id    text not null,
  form_title text not null,
  title      text not null,
  data       jsonb not null default '{}'::jsonb,
  seal       text,
  status     text not null default '제출됨',
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists petition_sub_user_idx   on public.petition_submissions (user_id, created_at desc);
create index if not exists petition_sub_sichal_idx on public.petition_submissions (sichal, created_at desc);

alter table public.petition_submissions enable row level security;
create policy petition_sub_select on public.petition_submissions for select
  using (user_id = auth.uid() or public.is_sichal_officer(sichal));
create policy petition_sub_insert on public.petition_submissions for insert
  with check (user_id = auth.uid());
create policy petition_sub_update on public.petition_submissions for update
  using (public.is_sichal_officer(sichal)) with check (public.is_sichal_officer(sichal));
create policy petition_sub_delete on public.petition_submissions for delete
  using ((user_id = auth.uid() and status = '제출됨') or public.is_sichal_officer(sichal));

create or replace function public.submit_petition(
  p_sichal text, p_form_id text, p_form_title text, p_title text, p_data jsonb, p_seal text)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_id   bigint;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  select p.name into v_name from public.profiles p where p.id = v_uid;
  insert into public.petition_submissions (user_id, user_name, sichal, form_id, form_title, title, data, seal)
  values (v_uid, v_name, p_sichal, p_form_id, p_form_title, p_title, coalesce(p_data, '{}'::jsonb), p_seal)
  returning id into v_id;
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
revoke all on function public.submit_petition(text, text, text, text, jsonb, text) from public;
grant execute on function public.submit_petition(text, text, text, text, jsonb, text) to authenticated;

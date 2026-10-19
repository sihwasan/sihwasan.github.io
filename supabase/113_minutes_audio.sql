/* 113 — 회의록 녹음 파일
 *
 * 회의록마다 회의 녹음 파일을 붙여 둔다.
 * 녹음 파일 자체는 Cloudflare R2(sihwasan-audio, 공개 접근 꺼짐)에 두고,
 * 여기에는 보관 이름(file_key)과 누가 들을 수 있는지만 적는다.
 * 녹음 창구(cloudflare/audio)는 들으려는 사람의 로그인 증표로 이 표를 읽어 보고,
 * 읽히는 줄(= 들을 자격이 있는 줄)에 대해서만 몇 시간짜리 재생 주소를 내어 준다.
 *
 *   올리기·지우기   : 서기 · 회록서기 (· 최고관리자)
 *   늘 들을 수 있음 : 서기 · 회록서기 · 노회장 · 간사 (· 최고관리자)
 *   열람 허용 설정  : 서기 · 노회장 (· 최고관리자)
 *       기간(시작일~끝날)을 정해 모든 회원 또는 고른 회원이 듣게 한다.
 *       기간이 지나면 저절로 다시 막힌다. 허용하면 듣게 된 분께 알림이 간다.
 *
 * 여러 번 실행해도 안전하다.
 */

/* ---------- 1) 표 ---------- */
create table if not exists public.minutes_audio (
  id            bigserial primary key,
  minutes_id    bigint not null references public.minutes_board(id) on delete cascade,
  minutes_title text,                      /* 회의록 제목 — 회의록을 볼 수 없는 회원에게도 보이도록 따로 적는다 */
  file_key      text not null unique,      /* R2 보관 이름 (minutes/....m4a) */
  file_name     text,                      /* 올린 분 컴퓨터의 원래 이름 */
  mime          text,
  size_bytes    bigint,
  note          text,
  uploaded_by   uuid default auth.uid(),
  uploader_name text,
  created_at    timestamptz not null default now(),
  share_scope   text not null default 'none' check (share_scope in ('none', 'all', 'some')),
  share_from    date,
  share_until   date,
  share_users   uuid[] not null default '{}',
  share_by      text,
  share_at      timestamptz
);
create index if not exists minutes_audio_minutes_idx on public.minutes_audio (minutes_id, id);
alter table public.minutes_audio enable row level security;

/* ---------- 2) 누가 무엇을 할 수 있는가 ---------- */
/* 회록서기 — 임원(officer) 가운데 직책이 정확히 '회록서기'인 분 (회록부서기는 아님) */
create or replace function public.is_minutes_recorder()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and role = 'officer' and btrim(coalesce(title, '')) = '회록서기');
$fn$;

/* 올리기·지우기 */
create or replace function public.can_upload_minutes_audio()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() in ('clerk', 'superadmin'), false) or public.is_minutes_recorder();
$fn$;

/* 열람 허용 설정 */
create or replace function public.can_share_minutes_audio()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() in ('clerk', 'president', 'superadmin'), false);
$fn$;

/* 늘 들을 수 있는 분 */
create or replace function public.minutes_audio_staff()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.my_role() in ('clerk', 'president', 'staff', 'superadmin'), false)
      or public.is_minutes_recorder();
$fn$;

/* '모든 회원' — 승인 대기·일반회원·정지된 계정을 뺀 회원 계정 */
create or replace function public.minutes_audio_member()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid()
                    and p.role not in ('pending', 'general')
                    and coalesce(p.suspended, false) = false);
$fn$;

/* 이 녹음을 지금 들을 수 있는가 — 기간은 한국 날짜로 끝날까지 포함 */
create or replace function public.minutes_audio_can_hear(p_id bigint)
returns boolean language sql stable security definer set search_path = public as $fn$
  select auth.uid() is not null and (
    public.minutes_audio_staff()
    or exists (
      select 1 from public.minutes_audio a
       where a.id = p_id
         and a.share_scope <> 'none'
         and a.share_from is not null and a.share_until is not null
         and (now() at time zone 'Asia/Seoul')::date between a.share_from and a.share_until
         and ((a.share_scope = 'all'  and public.minutes_audio_member())
           or (a.share_scope = 'some' and auth.uid() = any (a.share_users)))
    )
  );
$fn$;

grant execute on function public.is_minutes_recorder()          to authenticated;
grant execute on function public.can_upload_minutes_audio()     to authenticated;
grant execute on function public.can_share_minutes_audio()      to authenticated;
grant execute on function public.minutes_audio_staff()          to authenticated;
grant execute on function public.minutes_audio_member()         to authenticated;
grant execute on function public.minutes_audio_can_hear(bigint) to authenticated;

/* ---------- 3) 표 보안 ----------
 * 읽기  : 들을 수 있는 줄만 보인다 (녹음 창구도 이 규칙으로 재생 주소를 내어 준다)
 * 쓰기  : 서기·회록서기가 올리고 지운다
 * 허용  : 표를 직접 고치지 않고 minutes_audio_set_share 로만 바꾼다 */
drop policy if exists minutes_audio_read   on public.minutes_audio;
drop policy if exists minutes_audio_insert on public.minutes_audio;
drop policy if exists minutes_audio_delete on public.minutes_audio;
create policy minutes_audio_read on public.minutes_audio
  for select using (public.minutes_audio_can_hear(id));
create policy minutes_audio_insert on public.minutes_audio
  for insert with check (public.can_upload_minutes_audio() and uploaded_by = auth.uid()
                         and share_scope = 'none');
create policy minutes_audio_delete on public.minutes_audio
  for delete using (public.can_upload_minutes_audio());

/* ---------- 4) 열람 허용 설정 ----------
 * p_scope : none(관리자만) / all(모든 회원) / some(고른 회원)
 * 새로 듣게 된 분께는 알림을 한 번 보낸다 (같은 녹음으로 두 번 보내지 않는다) */
create or replace function public.minutes_audio_set_share(
  p_id bigint, p_scope text, p_from date, p_until date, p_users uuid[])
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_row   public.minutes_audio;
  v_me    text;
  v_users uuid[] := coalesce(p_users, '{}');
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_title text;
  v_body  text;
begin
  if not public.can_share_minutes_audio() then
    raise exception '열람 허용은 서기·노회장만 정할 수 있습니다.';
  end if;
  select * into v_row from public.minutes_audio where id = p_id;
  if not found then raise exception '녹음 파일을 찾을 수 없습니다.'; end if;
  if p_scope not in ('none', 'all', 'some') then raise exception '열람 범위가 올바르지 않습니다.'; end if;

  if p_scope <> 'none' then
    if p_from is null or p_until is null then raise exception '들을 수 있는 기간(시작일·끝날)을 정해 주세요.'; end if;
    if p_until < p_from then raise exception '끝날이 시작일보다 앞섭니다.'; end if;
    if p_until < v_today then raise exception '끝날이 이미 지났습니다.'; end if;
    if p_scope = 'some' and coalesce(array_length(v_users, 1), 0) = 0 then
      raise exception '들을 회원을 한 분 이상 골라 주세요.';
    end if;
  end if;
  if p_scope <> 'some' then v_users := '{}'; end if;

  select name into v_me from public.profiles where id = auth.uid();

  update public.minutes_audio
     set share_scope = p_scope,
         share_from  = case when p_scope = 'none' then null else p_from end,
         share_until = case when p_scope = 'none' then null else p_until end,
         share_users = v_users,
         share_by    = v_me,
         share_at    = now()
   where id = p_id;

  if p_scope = 'none' then return; end if;

  v_title := '회의 녹음을 들으실 수 있습니다';
  v_body  := coalesce(v_row.minutes_title, '회의록') || ' 녹음을 ' ||
             to_char(p_from, 'FMMM"월" FMDD"일"') || '부터 ' ||
             to_char(p_until, 'FMMM"월" FMDD"일"') || '까지 들으실 수 있습니다. (' ||
             coalesce(v_me, '노회') || ' 허용)';

  insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
  select p.id, '안내', v_title, v_body, 'maudio-' || p_id, auth.uid(), v_me
    from public.profiles p
   where p.role not in ('pending', 'general')
     and coalesce(p.suspended, false) = false
     and p.id <> auth.uid()
     and (p_scope = 'all' or p.id = any (v_users))
     and not exists (select 1 from public.notifications n
                      where n.user_id = p.id and n.dedupe_key = 'maudio-' || p_id);
end;
$fn$;
grant execute on function public.minutes_audio_set_share(bigint, text, date, date, uuid[]) to authenticated;

/* ---------- 5) 고를 수 있는 회원 명단 (열람 허용 화면용) ---------- */
create or replace function public.minutes_audio_people()
returns table (id uuid, name text, church text, role text, title text)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.can_share_minutes_audio() then
    raise exception '열람 허용은 서기·노회장만 정할 수 있습니다.';
  end if;
  return query
    select p.id, p.name, p.church, p.role, p.title
      from public.profiles p
     where p.role not in ('pending', 'general')
       and coalesce(p.suspended, false) = false
     order by p.name;
end;
$fn$;
grant execute on function public.minutes_audio_people() to authenticated;

-- 99. 시무목사 청빙 허락 이력
--
--  시무목사는 3년마다 다시 청빙청원을 하므로 한 분에게 허락 기록이 여러 번
--  쌓입니다. 98 번까지는 가장 최근 것 하나만 명단에 적어 두어 지난 기록을
--  볼 수 없었습니다. 이제 허락받은 기록을 낱낱이 남기고, 명단(roster)의
--  call_on·call_until·call_acting 칸은 그 가운데 가장 최근 것을 비추는
--  거울로 삼습니다. (그래서 여태 만든 화면은 그대로 돌아갑니다)
--
--  누가 고칠 수 있나
--    읽기  정회원(is_member)
--    쓰기  관리자만 — 최고관리자·노회장·서기·간사 (can_manage)
--    본인은 내 정보에서 제 기록을 볼 수만 있고 고치지 못합니다.
--    (명단 자체도 can_manage 만 쓸 수 있고, update_my_member 는 연락처·주소·
--     생년월일·사진만 건드리므로 본인이 청빙 날짜를 바꿀 길은 없습니다)
--
--  ※ 실제 적용은 Supabase migration simu_call_history 로 완료했습니다.
--     여러 번 실행해도 안전합니다.
-- =====================================================================

create table if not exists public.roster_calls (
  id          bigserial primary key,
  roster_id   bigint not null references public.roster(id) on delete cascade,
  approved_on date not null,
  until_on    date,
  acting      text,
  note        text,
  created_at  timestamptz not null default now()
);

comment on table  public.roster_calls             is '시무목사 청빙 허락 이력';
comment on column public.roster_calls.approved_on is '노회가 시무목사 청빙을 허락한 날';
comment on column public.roster_calls.until_on    is '시무 만료일 (비우면 허락일 + 3년)';
comment on column public.roster_calls.acting      is '임시당회장';
comment on column public.roster_calls.note        is '비고 — 위임으로 마침 등';

create unique index if not exists roster_calls_uniq
  on public.roster_calls (roster_id, approved_on);
create index if not exists roster_calls_rid_idx
  on public.roster_calls (roster_id, approved_on desc);

alter table public.roster_calls enable row level security;

drop policy if exists roster_calls_read on public.roster_calls;
create policy roster_calls_read on public.roster_calls
  for select using (public.is_member());

drop policy if exists roster_calls_write on public.roster_calls;
create policy roster_calls_write on public.roster_calls
  for all using (public.can_manage()) with check (public.can_manage());


-- 만료일을 비워 두면 허락일부터 3년 뒤로 채웁니다
create or replace function public.roster_calls_fill()
returns trigger
language plpgsql
as $$
begin
  if new.until_on is null then
    new.until_on := (new.approved_on + interval '3 years')::date;
  end if;
  return new;
end;
$$;

drop trigger if exists roster_calls_fill_trg on public.roster_calls;
create trigger roster_calls_fill_trg
  before insert or update on public.roster_calls
  for each row execute function public.roster_calls_fill();


-- 명단의 call_* 칸을 가장 최근 허락 기록으로 맞춥니다
create or replace function public.roster_sync_call(p_rid bigint)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.roster r
     set call_on     = c.approved_on,
         call_until  = c.until_on,
         call_acting = c.acting
    from (
      select rc.approved_on, rc.until_on, rc.acting
        from public.roster_calls rc
       where rc.roster_id = p_rid
       order by rc.approved_on desc, rc.id desc
       limit 1
    ) c
   where r.id = p_rid;

  update public.roster r
     set call_on = null, call_until = null, call_acting = null
   where r.id = p_rid
     and not exists (select 1 from public.roster_calls rc where rc.roster_id = p_rid);
$$;

create or replace function public.roster_calls_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.roster_sync_call(coalesce(new.roster_id, old.roster_id));
  if tg_op = 'UPDATE' and new.roster_id is distinct from old.roster_id then
    perform public.roster_sync_call(old.roster_id);
  end if;
  return null;
end;
$$;

drop trigger if exists roster_calls_sync_trg on public.roster_calls;
create trigger roster_calls_sync_trg
  after insert or update or delete on public.roster_calls
  for each row execute function public.roster_calls_sync();


-- ---------------------------------------------------------------------
-- 내 청빙 기록 — 본인 것만 돌려줍니다 (읽기 전용)
-- ---------------------------------------------------------------------
drop function if exists public.my_calls();
create function public.my_calls()
returns table(out_approved_on date, out_until_on date, out_acting text, out_note text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select rc.approved_on, rc.until_on, rc.acting, rc.note
    from public.profiles p
    join public.roster_calls rc on rc.roster_id = p.roster_id
   where p.id = auth.uid()
   order by rc.approved_on desc, rc.id desc;
$function$;

grant execute on function public.my_calls() to anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- 98 에서 명단에 적어 둔 기록을 이력으로 옮겨 담습니다
-- ---------------------------------------------------------------------
insert into public.roster_calls (roster_id, approved_on, until_on, acting)
select r.id, r.call_on, r.call_until, r.call_acting
  from public.roster r
 where r.call_on is not null
on conflict (roster_id, approved_on) do nothing;

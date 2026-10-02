-- =====================================================================
--  107. 표결 기록 영구 보존
--
--  회의에서 표결된 기록(테스트 투표가 아닌 투표와 그 표)은 지울 수 없다.
--    · 본 투표가 하나라도 있는 노회(QR 코드)는 삭제할 수 없다.
--    · 본 투표와 표는 어떤 길로도(직접 삭제·노회 삭제의 연쇄 삭제) 지워지지 않는다.
--  테스트 투표만 있는 노회는 지금처럼 지울 수 있다.
--
--  실행 방법 : Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run
--  ※ 105, 106 다음에 실행합니다. 여러 번 실행해도 안전합니다.
-- =====================================================================


-- 1) 본 투표·표는 지워지지 않는다 (데이터베이스가 막는다)
create or replace function public.assembly_vote_keep()
returns trigger language plpgsql as $fn$
begin
  if tg_table_name = 'assembly_votes' then
    if not old.is_test then
      raise exception '표결 기록은 영구 보존되어 삭제할 수 없습니다.';
    end if;
  else
    if exists (select 1 from public.assembly_votes v where v.id = old.vote_id and not v.is_test) then
      raise exception '표결 기록은 영구 보존되어 삭제할 수 없습니다.';
    end if;
  end if;
  return old;
end
$fn$;

drop trigger if exists assembly_votes_keep on public.assembly_votes;
create trigger assembly_votes_keep
  before delete on public.assembly_votes
  for each row execute function public.assembly_vote_keep();

drop trigger if exists assembly_ballots_keep on public.assembly_ballots;
create trigger assembly_ballots_keep
  before delete on public.assembly_ballots
  for each row execute function public.assembly_vote_keep();

drop trigger if exists assembly_vote_voters_keep on public.assembly_vote_voters;
create trigger assembly_vote_voters_keep
  before delete on public.assembly_vote_voters
  for each row execute function public.assembly_vote_keep();

-- 표결이 있었던 노회의 입장 명단도 표결의 근거(재석 수)이므로 함께 남긴다
create or replace function public.assembly_meeting_keep()
returns trigger language plpgsql as $fn$
begin
  if exists (select 1 from public.assembly_votes v where v.meeting_id = old.id and not v.is_test) then
    raise exception '표결 기록이 있는 노회는 영구 보존되어 삭제할 수 없습니다.';
  end if;
  return old;
end
$fn$;

drop trigger if exists assembly_meetings_keep on public.assembly_meetings;
create trigger assembly_meetings_keep
  before delete on public.assembly_meetings
  for each row execute function public.assembly_meeting_keep();


-- 2) QR 코드 지우기 — 본 투표가 있으면 미리 막고 알기 쉬운 말로 알린다
create or replace function public.assembly_delete(p_meeting bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  r record;
begin
  if not exists (select 1 from public.profiles
                  where id = auth.uid() and role in ('clerk', 'superadmin')) then
    raise exception '서기만 QR 코드를 지울 수 있습니다.';
  end if;
  if exists (select 1 from public.assembly_votes where meeting_id = p_meeting and not is_test) then
    raise exception '회의에서 표결된 기록이 있어 이 노회는 삭제할 수 없습니다. 표결 기록은 영구 보존됩니다.';
  end if;
  for r in select id from public.assembly_attendees where meeting_id = p_meeting loop
    perform public.drop_linked_entry('allowance', r.id);
    delete from public.notifications where dedupe_key = 'allow-' || r.id;
  end loop;
  delete from public.notifications where dedupe_key = 'asmconf-' || p_meeting;
  delete from public.assembly_meetings where id = p_meeting;
end
$fn$;
revoke all on function public.assembly_delete(bigint) from public, anon;
grant execute on function public.assembly_delete(bigint) to authenticated;


-- 3) 표결이 있었던 노회에서는 입장자를 명단에서 뺄 수 없다 (재석 수 보존)
create or replace function public.assembly_attendee_remove(p_id bigint)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_manage() then raise exception '서기만 할 수 있습니다.'; end if;
  if exists (select 1 from public.assembly_attendees where id = p_id and allow_status is not null) then
    raise exception '거마비가 지급된 사람은 명단에서 뺄 수 없습니다.';
  end if;
  if exists (select 1 from public.assembly_attendees a
               join public.assembly_votes v on v.meeting_id = a.meeting_id and not v.is_test
              where a.id = p_id and a.entered_at <= coalesce(v.ended_at, now())) then
    raise exception '표결에 재석으로 계수된 사람은 명단에서 뺄 수 없습니다. 표결 기록은 영구 보존됩니다.';
  end if;
  delete from public.assembly_attendees where id = p_id;
end
$fn$;
revoke all on function public.assembly_attendee_remove(bigint) from public, anon;
grant execute on function public.assembly_attendee_remove(bigint) to authenticated;

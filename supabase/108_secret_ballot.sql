-- =====================================================================
--  108. 무기명 투표의 비밀 보장
--
--  무기명 투표는 결과(찬성·반대·기권 수와 가결·부결) 말고는
--  누구도 투표 상황을 알 수 없어야 한다. 서기·최고관리자, 데이터베이스를
--  들여다보는 사람도 마찬가지다.
--
--  지금까지는 무기명 표도 표 한 장씩(assembly_ballots) 적혀서,
--  같은 순간에 적힌 "누가 투표했는가" 기록과 맞춰 보면 누가 어디에 찍었는지
--  알아낼 여지가 있었다. 이제 무기명 표는 한 장씩 적지 않고,
--  투표 한 건의 찬성 수·반대 수만 하나씩 올린다. 누가 무엇을 골랐는지는
--  어디에도 남지 않는다. (두 번 투표를 막기 위한 "투표했음" 표시만 남는다)
--
--  또 무기명 투표가 진행되는 동안에는 "지금까지 몇 명 투표" 같은 중간 상황을
--  누구에게도 보이지 않는다. 종료 10초 뒤 결과만 나온다.
--
--  실행 방법 : Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run
--  ※ 105, 106, 107 다음에 실행합니다. 여러 번 실행해도 안전합니다.
-- =====================================================================

alter table public.assembly_votes
  add column if not exists anon_yes integer not null default 0,
  add column if not exists anon_no  integer not null default 0;


create or replace function public.assembly_vote_cast(p_vote bigint, p_choice text)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v    public.assembly_votes%rowtype;
  v_me text;
begin
  select * into v from public.assembly_votes where id = p_vote;
  if v.id is null or v.status <> '진행' then raise exception '투표가 이미 종료되었습니다.'; end if;
  if p_choice not in ('찬성', '반대') then raise exception '찬성·반대 가운데 골라 주세요.'; end if;
  if not public.is_full_member() then raise exception '정회원만 투표할 수 있습니다.'; end if;
  if not exists (select 1 from public.assembly_attendees
                  where meeting_id = v.meeting_id and user_id = auth.uid()) then
    raise exception '먼저 노회에 입장해 주세요.';
  end if;
  begin
    insert into public.assembly_vote_voters (vote_id, user_id) values (v.id, auth.uid());
  exception when unique_violation then
    raise exception '이미 투표하셨습니다.';
  end;
  if v.mode = '기명' then
    select name into v_me from public.profiles where id = auth.uid();
    insert into public.assembly_ballots (vote_id, choice, voter_id, voter_name)
    values (v.id, p_choice, auth.uid(), v_me);
  else
    -- 무기명: 표를 남기지 않고 수만 센다
    if p_choice = '찬성' then
      update public.assembly_votes set anon_yes = anon_yes + 1 where id = v.id;
    else
      update public.assembly_votes set anon_no = anon_no + 1 where id = v.id;
    end if;
  end if;
end
$fn$;


create or replace function public.assembly_vote_json(p_vote bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v     public.assembly_votes%rowtype;
  j     jsonb;
  v_yes integer;
  v_no  integer;
begin
  select * into v from public.assembly_votes where id = p_vote;
  if v.id is null then return null; end if;
  j := jsonb_build_object(
    'id', v.id, 'title', v.title, 'mode', v.mode, 'rule', v.rule, 'test', v.is_test, 'status', v.status,
    'started_at', v.started_at, 'ended_at', v.ended_at,
    -- 무기명은 진행 중 투표 인원도 보이지 않는다
    'cast', case when v.mode = '기명'
                 then (select count(*) from public.assembly_vote_voters x where x.vote_id = v.id)
                 else null end,
    'voted', exists (select 1 from public.assembly_vote_voters x
                      where x.vote_id = v.id and x.user_id = auth.uid()));
  if v.status = '종료' and now() >= v.ended_at + interval '10 seconds' then
    -- 예전에 한 장씩 적힌 무기명 표가 있으면 함께 센다
    select count(*) filter (where choice = '찬성'), count(*) filter (where choice = '반대')
      into v_yes, v_no from public.assembly_ballots where vote_id = v.id;
    v_yes := v_yes + v.anon_yes;
    v_no  := v_no + v.anon_no;
    j := j || jsonb_build_object('result', jsonb_build_object(
      'yes', v_yes, 'no', v_no, 'total', v_yes + v_no, 'eligible', v.eligible,
      -- 기준은 입장한 정회원 전체(투표하지 않은 사람은 기권). 예: 10명이면 과반은 6표
      'passed', case when v.rule = '3분의2'
                     then v_yes > 0 and v_yes * 3 >= greatest(coalesce(v.eligible, 0), v_yes + v_no) * 2
                     else v_yes * 2 > greatest(coalesce(v.eligible, 0), v_yes + v_no) end,
      'names', case when v.mode = '기명' then
                 (select coalesce(jsonb_agg(jsonb_build_object('name', b.voter_name, 'choice', b.choice)
                                            order by b.choice desc, b.voter_name), '[]'::jsonb)
                    from public.assembly_ballots b where b.vote_id = v.id)
               else null end));
  end if;
  return j;
end
$fn$;
revoke all on function public.assembly_vote_json(bigint) from public, anon, authenticated;
revoke all on function public.assembly_vote_cast(bigint, text) from public, anon;
grant execute on function public.assembly_vote_cast(bigint, text) to authenticated;

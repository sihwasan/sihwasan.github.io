-- =====================================================================
--  160. 세례의무금 미납 교회 납부 안내 알림
--
--  임원방 → 세례의무금 관리의 <미납 교회에 납부 안내 알림 보내기> 단추가 부릅니다.
--  그 해 세례의무금(총회 세례교인헌금)이 미납이거나 일부만 납부된 교회의
--  담임목사·장로와 직책을 맡은 분에게 알림함으로 안내를 보냅니다.
--    · 미납액(잔액), 납부 계좌(세례의무금 계좌, 비어 있으면 상회비 계좌)
--    · 납부 마감 시한(총회 시행기한 또는 노회 마감)이 지났으면
--      노회규칙 제29조 제3항(총회 총대·상비부 임원 자격 제한) 안내
--    · 알림함에서는 글 아래에 계좌와 <토스로 납부하기> 상자가 붙습니다 (notifications.html)
--  보낼 수 있는 사람: 노회 관리자와 노회 회계. 같은 분에게는 하루 한 번만 갑니다.
--  자동 발송은 없습니다. 자격 제한을 시스템으로 막지도 않습니다(안내만).
--
--  135_dues_rule29.sql 의 dues29_key·dues29_pays·dues29_roles 를 씁니다 (135 먼저 실행).
--
--  실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

create or replace function public.notify_bapdues_unpaid(p_year int default null)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_me      uuid := auth.uid();
  v_kst     timestamp := (now() at time zone 'Asia/Seoul');
  v_year    int := coalesce(p_year, extract(year from (now() at time zone 'Asia/Seoul'))::int);
  v_stamp   text := 'm' || to_char((now() at time zone 'Asia/Seoul'), 'YYYYMMDD');
  v_sender  text;
  v_sent    int := 0;
  v_pay     jsonb;
  v_acct    text := '';
  v_dl      text;
  v_over    boolean := false;
  v_ch      record;
  v_m       record;
  v_roles   text[];
  v_remain  bigint;
  v_key     text;
  v_title   text;
  v_body    text;
begin
  if v_me is null then return 0; end if;
  if not (public.can_manage() or public.is_presbytery_treasurer()) then
    raise exception '세례의무금 납부 안내 알림은 노회 관리자와 노회 회계만 보낼 수 있습니다.';
  end if;

  select nullif(btrim(coalesce(p.name, '') || ' ' ||
                      coalesce(nullif(p.title, ''), coalesce(p.position, ''))), '')
    into v_sender
    from public.profiles p where p.id = v_me;
  v_sender := coalesce(v_sender, '노회 사무실');

  -- 납부 계좌: 세례의무금 계좌, 비어 있으면 상회비 계좌
  select value into v_pay from public.site_settings where key = 'bapdues_pay';
  if coalesce(regexp_replace(coalesce(v_pay ->> 'account', ''), '\D', '', 'g'), '') = '' then
    select value into v_pay from public.site_settings where key = 'dues_pay';
  end if;
  if coalesce(regexp_replace(coalesce(v_pay ->> 'account', ''), '\D', '', 'g'), '') <> '' then
    v_acct := btrim(coalesce(v_pay ->> 'bank', '') || ' ' || (v_pay ->> 'account')) ||
              ' (예금주 ' || coalesce(nullif(v_pay ->> 'holder', ''), '시화산노회') || ')';
  end if;

  -- 납부 마감 시한이 지났는가: 노회가 그 해를 마감했거나 총회 시행기한이 지났을 때
  select value ->> v_year::text into v_dl from public.site_settings where key = 'bapdues_deadline';
  v_over := exists (select 1 from public.site_settings
                     where key = 'bapdues_closed' and value ? v_year::text);
  begin
    if not v_over and nullif(v_dl, '') is not null then
      v_over := left(v_dl, 10)::date < v_kst::date;
    end if;
  exception when others then null;
  end;

  for v_ch in
    select b.church, b.target, b.paid
      from public.bapdues b
     where b.year = v_year and coalesce(b.target, 0) > 0
       and coalesce(b.paid, 0) < b.target
     order by b.sort, b.church
  loop
    v_remain := v_ch.target - coalesce(v_ch.paid, 0);
    v_key    := 'bapdue-' || v_year || '-' || public.dues29_key(v_ch.church) || '-' || v_stamp;

    for v_m in
      select p.id as uid,
             coalesce(r.name, p.name) as name,
             coalesce(r.category, '') as category,
             coalesce(r.position, p.position, '') as position,
             coalesce(r.church, p.church) as church
        from public.profiles p
        left join public.roster r on r.id = p.roster_id
       where coalesce(p.role, 'pending') not in ('pending', 'general')
         and coalesce(p.suspended, false) = false
         and public.dues29_key(coalesce(r.church, p.church)) = public.dues29_key(v_ch.church)
    loop
      v_roles := public.dues29_roles(v_m.name, v_m.church, v_m.uid);
      if not (public.dues29_pays(v_m.category, v_m.position)
              or coalesce(array_length(v_roles, 1), 0) > 0) then
        continue;
      end if;
      if exists (select 1 from public.notifications n
                  where n.user_id = v_m.uid and n.dedupe_key = v_key) then
        continue;
      end if;

      v_title := '[세례의무금] ' || v_ch.church || ' ' || v_year || '년 세례의무금 납부 안내';
      v_body  :=
        v_ch.church || '의 ' || v_year || '년 세례의무금(총회 세례교인헌금)이 ' ||
        case when coalesce(v_ch.paid, 0) > 0
             then '일부만 납부되었습니다. 배정액 ' || to_char(v_ch.target, 'FM999,999,999,999') || '원 가운데 '
             else '아직 납부되지 않았습니다. 배정액 ' || to_char(v_ch.target, 'FM999,999,999,999') || '원, ' end ||
        '미납액 ' || to_char(v_remain, 'FM999,999,999,999') || '원입니다.' ||
        chr(10) || chr(10) ||
        case when v_over then
          '납부 마감 시한이 지났습니다. 노회규칙 제29조 제3항에 따라 세례의무금 납부 마감 시한을 넘긴 미납 교회는 ' ||
          '총회 총대 및 상비부 임원 자격이 제한됩니다.' || chr(10) ||
          ' (제29조 3항: 상회비 및 총회 세례교인헌금 미납교회는 노회 임원 및 총대, 시찰·상비부 임원을 할 수 없다.)' || chr(10) ||
          case when coalesce(array_length(v_roles, 1), 0) > 0
               then ' ※ 현재 맡고 계신 직책: ' || array_to_string(v_roles, ', ') || chr(10)
               else '' end ||
          '빠른 시일 안에 납부해 주시기 바랍니다.'
        else
          case when nullif(v_dl, '') is not null
               then '납부 시행기한은 ' || left(v_dl, 10) || ' 입니다. ' else '' end ||
          '기한 안에 납부해 주시기 바랍니다. 노회규칙 제29조 제3항에 따라 납부 마감 시한을 넘긴 미납 교회는 ' ||
          '총회 총대 및 상비부 임원 자격이 제한됩니다.'
        end ||
        chr(10) || chr(10) ||
        case when v_acct <> '' then '납부 계좌: ' || v_acct || chr(10) else '' end ||
        '납부하시면 노회 회계가 확인한 뒤 대시보드 <나의 세례의무금>의 안내가 사라집니다. ' ||
        '이미 납부하셨는데도 이 안내를 받으셨다면 노회 회계에게 납부 확인을 요청해 주세요.';

      insert into public.notifications (user_id, kind, title, body, dedupe_key, sent_by, sent_by_name)
      values (v_m.uid, '세례의무금', left(v_title, 200), v_body, v_key, v_me, v_sender);
      v_sent := v_sent + 1;
    end loop;
  end loop;

  return v_sent;
end
$fn$;
grant execute on function public.notify_bapdues_unpaid(int) to authenticated;

comment on function public.notify_bapdues_unpaid(int) is
  '세례의무금 미납·일부 납부 교회의 담임목사·장로·직책자에게 납부 안내 알림(제29조 3항 자격 제한 안내 포함). 수동, 하루 한 번';

-- 확인
select '160 세례의무금 납부 안내 알림 등록 완료' as "결과",
       (select count(*) from public.bapdues b
         where b.year = extract(year from (now() at time zone 'Asia/Seoul'))::int
           and coalesce(b.target, 0) > 0 and coalesce(b.paid, 0) < b.target) as "올해 미납·일부 납부 교회";

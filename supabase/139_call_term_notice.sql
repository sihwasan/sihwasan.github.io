-- =====================================================================
--  139. 청빙 임기 40일 전 알림
--
--  청빙 임기가 끝나기 40일 전부터, 한 임기에 한 번 알림함으로 보냅니다.
--    · 부목사(1년 임기)   → 그 부목사가 시무하는 교회의 당회장에게
--    · 시무목사(3년 임기) → 그 목사가 속한 시찰의 시찰장과 시찰 서기에게
--
--  · 대상     = 노회 명단(roster)에서 교체되지 않은 분(active)
--               부목사 : 분류 또는 직분이 '부목사'
--               시무목사: 분류 '목사'이면서 직분이 '목사' 또는 '시무목사'
--               (홈페이지 SHS.callKind 와 같은 규칙 — 위임목사는 해당 없음)
--  · 만료일   = 명단의 시무 만료일(call_until). 비어 있으면 청빙 허락일(call_on) + 임기
--               (회원 관리 「청빙 임기」 표·대시보드 「나의 청빙 임기」와 같은 셈)
--  · 언제     = 만료일이 오늘(한국 시각)부터 40일 안에 들면. 이미 끝난 임기는 보내지 않습니다
--               (본인 대시보드 맨 위 안내가 따로 알립니다).
--  · 당회장   = 회원 관리 「부목사 청빙 임기」 표의 당회장 칸과 같은 규칙
--               그 교회 담임이 위임목사면 그분, 시무목사이고 임시당회장(call_acting)이
--               적혀 있으면 그 임시당회장, 임시당회장이 비어 있으면 담임목사.
--  · 시찰장·서기 = 시찰 임원(sichal_officers 의 '시찰장'·'서기' 계정)과
--               시찰 정보(sichals.head·clerk 의 맨 앞 이름)와 이름이 같은 회원.
--  · 계정 찾기 = 회원 계정(profiles)의 명단 번호(roster_id)가 먼저, 없으면 같은 이름
--               (교회를 알면 같은 교회만).
--  · 한 번만   = dedupe_key 'callterm-assoc-<명단번호>-<만료일>' / 'callterm-simu-<명단번호>-<만료일>-<시찰>'
--               계속 청빙이 가결되어 서기가 만료일을 고치면 다음 임기에 다시 알립니다.
--
--  run_reminders 는 고치지 않습니다. 홈페이지가 하루 한 번 run_reminders 와
--  같은 자리(js/main.js)에서 run_call_term_notice 를 함께 부릅니다.
--
--  미리 보기 (관리자) : select * from public.call_term_notice_preview();
--    — 지금 40일 안에 드는 분, 받을 분, 받을 계정이 몇 개인지 (알림은 보내지 않음)
--
--  실행 방법 : Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- 교회 이름 견주기 — 띄어쓰기와 끝의 '교회'를 뺀다 (홈페이지 chKey 와 같은 규칙)
create or replace function public.church_key(p text)
returns text language sql immutable as $fn$
  select regexp_replace(regexp_replace(coalesce(p, ''), '\s', '', 'g'), '교회$', '');
$fn$;


-- 주소에 넣을 값 — 띄어쓰기는 '+', 주소에서 뜻이 있는 글자는 %로 (한글은 브라우저가 알아서 바꾼다)
create or replace function public.url_part(p text)
returns text language sql immutable as $fn$
  select replace(replace(replace(replace(replace(coalesce(p, ''),
           '%', '%25'), '&', '%26'), '#', '%23'), '+', '%2B'), ' ', '+');
$fn$;


-- 청빙 임기 갈래 — 'assoc'(부목사 1년) · 'simu'(시무목사 3년) · null
create or replace function public.call_kind(p_category text, p_position text)
returns text language sql immutable as $fn$
  select case
    when p_category = '부목사' or p_position = '부목사' then 'assoc'
    when p_category = '목사' and p_position in ('목사', '시무목사') then 'simu'
    else null
  end;
$fn$;


-- ---------------------------------------------------------------------
-- 1. 지금 알릴 대상과 받을 분 (보내기와 미리 보기가 함께 쓴다)
-- ---------------------------------------------------------------------
create or replace function public.call_term_due(p_days integer default 40)
returns table (
  roster_id   bigint,
  kind        text,       -- assoc / simu
  name        text,
  church      text,
  sichal      text,
  call_on     date,
  until_on    date,
  days_left   integer,
  to_role     text,       -- 당회장(위임목사) / 임시당회장 / 담임목사 / 시찰장 / 시찰 서기
  to_name     text,
  to_user     uuid
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  a       record;
  lead    record;
  v_name  text;
  v_role  text;
  v_rid   bigint;
  v_church text;
  v_uid   uuid;
begin
  for a in
    select r.*, public.call_kind(r.category, r.position) as ck,
           coalesce(r.call_until::date,
                    (r.call_on::date + case when public.call_kind(r.category, r.position) = 'assoc'
                                            then interval '1 year' else interval '3 years' end)::date) as uend
      from public.roster r
     where coalesce(r.active, true)
       and public.call_kind(r.category, r.position) is not null
       and r.call_on is not null
  loop
    continue when a.uend is null or a.uend < v_today or a.uend > v_today + p_days;

    if a.ck = 'assoc' then
      -- 그 교회의 담임 (위임목사를 먼저)
      select r.* into lead
        from public.roster r
       where r.id <> a.id
         and coalesce(r.active, true)
         and public.church_key(r.church) = public.church_key(a.church)
         and r.category in ('목사', '위임목사', '시무목사')
         and coalesce(btrim(r.position), '') in ('', '목사', '위임목사', '시무목사', '담임목사')
       order by (r.position = '위임목사') desc, r.sort nulls last, r.id
       limit 1;

      v_name := null; v_role := null; v_rid := null; v_church := null;
      if lead.id is not null then
        if lead.position = '위임목사' then
          v_name := lead.name; v_role := '당회장(위임목사)'; v_rid := lead.id; v_church := lead.church;
        elsif coalesce(btrim(lead.call_acting), '') <> '' then
          v_name := split_part(btrim(lead.call_acting), ' ', 1); v_role := '임시당회장';
          select r.id, r.church into v_rid, v_church
            from public.roster r
           where r.name = v_name and coalesce(r.active, true)
             and r.category in ('목사', '위임목사', '시무목사', '원로목사', '은퇴목사', '무임목사')
           order by (r.position = '위임목사') desc, r.id
           limit 1;
        else
          v_name := lead.name; v_role := '담임목사'; v_rid := lead.id; v_church := lead.church;
        end if;
      end if;

      v_uid := null;
      if v_name is not null then
        select p.id into v_uid from public.profiles p
         where v_rid is not null and p.roster_id = v_rid
         limit 1;
        if v_uid is null then
          select p.id into v_uid from public.profiles p
           where p.name = v_name
             and (v_church is null or public.church_key(p.church) = public.church_key(v_church))
           order by p.created_at
           limit 1;
        end if;
      end if;

      roster_id := a.id; kind := 'assoc'; name := a.name; church := a.church; sichal := a.sichal;
      call_on := a.call_on::date; until_on := a.uend; days_left := a.uend - v_today;
      to_role := coalesce(v_role, '당회장(담임 기록 없음)'); to_name := v_name; to_user := v_uid;
      return next;

    else
      -- 시무목사 → 그 시찰의 시찰장·서기 (계정이 없으면 받을 분 없이 한 줄)
      v_uid := null;
      for v_role, v_name, v_uid in
        select distinct on (x.uid) x.role, x.nm, x.uid
          from (
            select case o.position when '서기' then '시찰 서기' else '시찰장' end as role,
                   p.name as nm, o.user_id as uid, 0 as pri
              from public.sichal_officers o
              left join public.profiles p on p.id = o.user_id
             where o.sichal = a.sichal and o.position in ('시찰장', '서기')
            union all
            select '시찰장', p.name, p.id, 1
              from public.sichals s
              join public.profiles p on p.name = split_part(btrim(s.head), ' ', 1)
             where s.name = a.sichal and coalesce(btrim(s.head), '') <> ''
            union all
            select '시찰 서기', p.name, p.id, 1
              from public.sichals s
              join public.profiles p on p.name = split_part(btrim(s.clerk), ' ', 1)
             where s.name = a.sichal and coalesce(btrim(s.clerk), '') <> ''
          ) x
         order by x.uid, x.pri
      loop
        roster_id := a.id; kind := 'simu'; name := a.name; church := a.church; sichal := a.sichal;
        call_on := a.call_on::date; until_on := a.uend; days_left := a.uend - v_today;
        to_role := v_role; to_name := v_name; to_user := v_uid;
        return next;
      end loop;
      if not found then
        roster_id := a.id; kind := 'simu'; name := a.name; church := a.church; sichal := a.sichal;
        call_on := a.call_on::date; until_on := a.uend; days_left := a.uend - v_today;
        to_role := '시찰장·서기(계정 없음)'; to_name := null; to_user := null;
        return next;
      end if;
    end if;
  end loop;
end;
$fn$;

revoke all on function public.call_term_due(integer) from public;


-- ---------------------------------------------------------------------
-- 2. 알림 보내기 — 홈페이지가 하루 한 번 부른다
-- ---------------------------------------------------------------------
create or replace function public.run_call_term_notice()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  d       record;
  v_key   text;
  v_title text;
  v_body  text;
  v_sent  integer := 0;
  v_acting text;
  v_link  text;
begin
  if auth.uid() is null then
    return 0;
  end if;

  for d in select * from public.call_term_due(40) where to_user is not null loop
    -- 청원서 작성 바로 가기 — 청빙청원서(form=call)에 청빙 구분·대상자·교회·당회장을 미리 채운다.
    -- 교회명 칸은 끝의 '교회'를 뺀다 (서식이 뒤에 '교회'를 붙인다).
    -- 홈페이지 알림의 <바로 가기>가 글 안의 이 주소로 간다 (js/main.js notiTargetOf).
    if d.kind = 'assoc' then
      v_link := 'petition.html?form=call&v_kind=' || public.url_part('부목사계속') ||
                '&v_name=' || public.url_part(d.name) ||
                '&v_church=' || public.url_part(regexp_replace(coalesce(d.church, ''), '\s*교회$', '')) ||
                '&v_dang=' || public.url_part(d.to_name);
      v_key := 'callterm-assoc-' || d.roster_id || '-' || to_char(d.until_on, 'YYYYMMDD');
      v_title := '[청빙 임기] ' || d.name || ' 부목사 — ' || to_char(d.until_on, 'YYYY-MM-DD') ||
                 ' 만료 (' || d.days_left || '일 남음)';
      v_body :=
        coalesce(d.church, '귀 교회') || ' ' || d.name || ' 부목사의 청빙 임기가 다가옵니다.' || chr(10) ||
        '청빙 허락일 : ' || to_char(d.call_on, 'YYYY-MM-DD') || chr(10) ||
        '시무 만료일 : ' || to_char(d.until_on, 'YYYY-MM-DD') || ' (' || d.days_left || '일 남음)' || chr(10) || chr(10) ||
        '부목사는 시무 기간이 1년입니다. 정기노회에서 <부목사 계속 청빙청원>이 가결되어야 ' ||
        '다시 1년을 시무합니다.' || chr(10) || chr(10) ||
        '[준비 서류 — 부목사 계속 청빙 청원]' || chr(10) ||
        '· 당회장 청원서 1통 (청빙청원서 — 청빙 구분 「부목사계속」)' || chr(10) ||
        '· 당회록 사본 1통 (계속 청빙을 결의한 당회록)' || chr(10) || chr(10) ||
        '노회규칙 제36조에 따라 당회장이 시찰회에 제출하여 진단받은 뒤 서기에게 접수시켜야 하므로, ' ||
        '시찰회 일정을 먼저 확인해 주시기 바랍니다.' ||
        case when d.to_role = '임시당회장' then chr(10) || '(이 교회 담임목사의 임시당회장으로 기록되어 있어 보내 드립니다.)'
             when d.to_role = '담임목사' then chr(10) || '(이 교회 담임목사로 기록되어 있어 보내 드립니다.)'
             else '' end || chr(10) || chr(10) ||
        '청원서 작성 바로 가기 : ' || v_link;
    else
      select nullif(btrim(r.call_acting), '') into v_acting from public.roster r where r.id = d.roster_id;
      v_link := 'petition.html?form=call&v_kind=' || public.url_part('시무목사') ||
                '&v_name=' || public.url_part(d.name) ||
                '&v_church=' || public.url_part(regexp_replace(coalesce(d.church, ''), '\s*교회$', '')) ||
                case when v_acting is not null
                     then '&v_dang=' || public.url_part(split_part(v_acting, ' ', 1)) else '' end;
      v_key := 'callterm-simu-' || d.roster_id || '-' || to_char(d.until_on, 'YYYYMMDD') || '-' || coalesce(d.sichal, '');
      v_title := '[청빙 임기] ' || d.name || ' 시무목사(' || coalesce(d.church, '-') || ') — ' ||
                 to_char(d.until_on, 'YYYY-MM-DD') || ' 만료 (' || d.days_left || '일 남음)';
      v_body :=
        coalesce(d.sichal || ' ', '') || coalesce(d.church, '') || ' ' || d.name ||
        ' 시무목사의 청빙 기한이 다가옵니다.' || chr(10) ||
        '청빙 허락일 : ' || to_char(d.call_on, 'YYYY-MM-DD') || chr(10) ||
        '시무 만료일 : ' || to_char(d.until_on, 'YYYY-MM-DD') || ' (' || d.days_left || '일 남음)' || chr(10) ||
        coalesce('임시당회장 : ' || v_acting || ' 목사' || chr(10), '') || chr(10) ||
        '당회가 조직되지 않은 교회의 담임은 시무목사로서 3년마다 <시무목사 청빙청원>을 해야 합니다. ' ||
        '노회규칙 제36조에 따라 청원서류는 시찰회에서 진단받은 뒤 서기에게 접수되므로, ' ||
        '기한 안에 청원이 올라오도록 살펴 주시기 바랍니다.' || chr(10) || chr(10) ||
        '[준비 서류 — 시무목사 청빙 청원]' || chr(10) ||
        '· 당회장 청원서 2통 (청빙청원서 — 청빙 구분 「시무목사」)' || chr(10) ||
        '· 교인 청빙서 2통 (서명날인)' || chr(10) ||
        '· 공동의회록 사본 2통 (청빙을 결의한 공동의회록)' || chr(10) ||
        '(' || case when d.to_role = '시찰장' then '시찰장으로' else d.to_role || '로' end ||
        ' 기록되어 있어 보내 드립니다.)' || chr(10) || chr(10) ||
        '청원서 작성 바로 가기 : ' || v_link || chr(10) ||
        '교인 청빙서 작성 : petition.html?form=callletter';
    end if;

    insert into public.notifications (user_id, kind, title, body, dedupe_key)
    select d.to_user, '청원 안내', v_title, v_body, v_key
     where not exists (
       select 1 from public.notifications n
        where n.user_id = d.to_user and n.dedupe_key = v_key
     );
    if found then v_sent := v_sent + 1; end if;
  end loop;

  return v_sent;
end;
$fn$;

revoke all on function public.run_call_term_notice() from public;
grant execute on function public.run_call_term_notice() to authenticated;

comment on function public.run_call_term_notice() is
  '청빙 임기 40일 전 알림 — 부목사는 그 교회 당회장에게, 시무목사는 그 시찰의 시찰장·서기에게. 한 임기에 한 번 (139)';


-- ---------------------------------------------------------------------
-- 3. 미리 보기 (관리자) — 지금 알릴 대상과 받을 분, 계정이 있는지
-- ---------------------------------------------------------------------
create or replace function public.call_term_notice_preview(p_days integer default 40)
returns table (
  kind text, name text, church text, sichal text, until_on date, days_left integer,
  to_role text, to_name text, has_account boolean, already_sent boolean
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(public.can_manage(), false) then
    raise exception '관리자만 볼 수 있습니다.';
  end if;
  return query
    select case d.kind when 'assoc' then '부목사' else '시무목사' end,
           d.name, d.church, d.sichal, d.until_on, d.days_left, d.to_role, d.to_name,
           d.to_user is not null,
           exists (select 1 from public.notifications n
                    where n.user_id = d.to_user
                      and n.dedupe_key like 'callterm-' || d.kind || '-' || d.roster_id || '-' ||
                                            to_char(d.until_on, 'YYYYMMDD') || '%')
      from public.call_term_due(p_days) d
     order by d.until_on, d.name;
end;
$fn$;

revoke all on function public.call_term_notice_preview(integer) from public;
grant execute on function public.call_term_notice_preview(integer) to authenticated;

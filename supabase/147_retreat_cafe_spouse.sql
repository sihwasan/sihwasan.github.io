-- =====================================================================
--  147. 수양회 카페 메뉴 최신본 · 부부 중 누구든 두 사람 몫 주문 (2026-10-30)
--
--  1) 카페 주문 단계(cafe1~4)의 메뉴·갈래(ICE/HOT/디카페인)·안내 첫 줄을 교육친교부 총무
--     (이동진 목사님)가 가이드북 앱에서 고친 최신본으로 맞춘다.
--     플로이스트 15 → 18가지, 델문도 13 → 24가지, 폴 바셋 15 → 41가지 (비양도 32가지는 그대로).
--     이미 누가 고른 단계는 메뉴 목록을 바꾸지 않고 알려 준다 (고른 것이 엉뚱한 메뉴를 가리키지 않게).
--  2) 부부: 지금까지는 남편(회원) 화면에서만 사모님 몫까지 고를 수 있었다. 이제 사모님 화면에서도
--     남편 몫을 함께 고른다 — retreat_can_act 와 retreat_state(142)의 「배우자」를 양쪽으로.
--  3) 주문을 모으는 총무가 「진행 관리 → 현황표·주문서」를 보는 권한은 148 sql 이 준다
--     (부서 임원이 아니라 이 수양회만 관리하는 「진행 담당」).
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--  ※ 142 · 145 sql 이후에 실행.
-- =====================================================================


-- 1. 카페 메뉴 ----------------------------------------------------------------
do $menu$
declare
  v_r bigint;
  v_s bigint;
begin
  select id into v_r from public.retreats where title = '2026 제주 부부수양회' order by id limit 1;
  if v_r is null then raise notice '2026 제주 부부수양회가 없습니다 (140 sql 먼저)'; return; end if;

  -- cafe1 · 1일차 비양도 올레커피숍 (32가지)
  select id into v_s from public.retreat_steps where retreat_id = v_r and key = 'cafe1';
  if v_s is not null then
    update public.retreat_steps
       set title = $t$카페 주문 · 1일차 비양도 올레커피숍$t$, body = $t$11/2(월) 보말이야기 점심 후 · 12:25
메뉴 하나를 골라 주세요. 가격은 메뉴판 기준입니다.$t$, variants = array[$t$차갑게 (ICE)$t$, $t$따뜻하게 (HOT)$t$, $t$상관없음$t$]::text[]
     where id = v_s;
    if (select array_agg(label order by seq) from public.retreat_options where step_id = v_s and enabled) is not distinct from array[$t$에스프레소 (HOT) 4,500$t$, $t$아메리카노 HOT 5,000 / ICE 5,500$t$, $t$카페라떼 HOT 5,500 / ICE 6,000$t$, $t$카푸치노 HOT 5,500 / ICE 6,000$t$, $t$바닐라라떼 HOT 5,500 / ICE 6,000$t$, $t$카라멜마끼아또 HOT 5,500 / ICE 6,000$t$, $t$카페모카 HOT 5,500 / ICE 6,000$t$, $t$딸기라떼 (ICE) 6,000$t$, $t$초코라떼 HOT 5,500 / ICE 6,000$t$, $t$말차라떼 HOT 5,500 / ICE 6,000$t$, $t$고구마라떼 HOT 5,500 / ICE 6,000$t$, $t$한라봉라떼 (ICE) 6,000$t$, $t$한라봉차 HOT 5,500 / ICE 6,000$t$, $t$자몽차 HOT 5,500 / ICE 6,000$t$, $t$레몬차 HOT 5,500 / ICE 6,000$t$, $t$귤차 HOT 5,500 / ICE 6,000$t$, $t$한라봉 에이드 (ICE) 6,000$t$, $t$자몽 에이드 (ICE) 6,000$t$, $t$레몬 에이드 (ICE) 6,000$t$, $t$청포도 에이드 (ICE) 6,000$t$, $t$청귤 에이드 (ICE) 6,000$t$, $t$블루베리 스무디 (ICE) 6,000$t$, $t$딸기 스무디 (ICE) 6,000$t$, $t$망고 스무디 (ICE) 6,000$t$, $t$카라향 주스 (ICE) 6,000$t$, $t$복숭아 아이스티 (ICE) 5,500$t$, $t$레몬 아이스티 (ICE) 5,500$t$, $t$생귤주스 (ICE) 6,000$t$, $t$비트주스 (ICE) 6,000$t$, $t$인절미 팥빙수 1인 7,500$t$, $t$인절미 팥빙수 2인 14,000$t$, $t$안 마심$t$]::text[] then
      null;   -- 메뉴가 이미 같다
    elsif exists (select 1 from public.retreat_choices where step_id = v_s) then
      raise notice '%: 이미 고른 분이 있어 메뉴 목록은 바꾸지 않았습니다. 진행 관리에서 고쳐 주세요.', $t$카페 주문 · 1일차 비양도 올레커피숍$t$;
    else
      delete from public.retreat_options where step_id = v_s;
      insert into public.retreat_options (step_id, seq, label) values
        (v_s, 1, $t$에스프레소 (HOT) 4,500$t$),
        (v_s, 2, $t$아메리카노 HOT 5,000 / ICE 5,500$t$),
        (v_s, 3, $t$카페라떼 HOT 5,500 / ICE 6,000$t$),
        (v_s, 4, $t$카푸치노 HOT 5,500 / ICE 6,000$t$),
        (v_s, 5, $t$바닐라라떼 HOT 5,500 / ICE 6,000$t$),
        (v_s, 6, $t$카라멜마끼아또 HOT 5,500 / ICE 6,000$t$),
        (v_s, 7, $t$카페모카 HOT 5,500 / ICE 6,000$t$),
        (v_s, 8, $t$딸기라떼 (ICE) 6,000$t$),
        (v_s, 9, $t$초코라떼 HOT 5,500 / ICE 6,000$t$),
        (v_s, 10, $t$말차라떼 HOT 5,500 / ICE 6,000$t$),
        (v_s, 11, $t$고구마라떼 HOT 5,500 / ICE 6,000$t$),
        (v_s, 12, $t$한라봉라떼 (ICE) 6,000$t$),
        (v_s, 13, $t$한라봉차 HOT 5,500 / ICE 6,000$t$),
        (v_s, 14, $t$자몽차 HOT 5,500 / ICE 6,000$t$),
        (v_s, 15, $t$레몬차 HOT 5,500 / ICE 6,000$t$),
        (v_s, 16, $t$귤차 HOT 5,500 / ICE 6,000$t$),
        (v_s, 17, $t$한라봉 에이드 (ICE) 6,000$t$),
        (v_s, 18, $t$자몽 에이드 (ICE) 6,000$t$),
        (v_s, 19, $t$레몬 에이드 (ICE) 6,000$t$),
        (v_s, 20, $t$청포도 에이드 (ICE) 6,000$t$),
        (v_s, 21, $t$청귤 에이드 (ICE) 6,000$t$),
        (v_s, 22, $t$블루베리 스무디 (ICE) 6,000$t$),
        (v_s, 23, $t$딸기 스무디 (ICE) 6,000$t$),
        (v_s, 24, $t$망고 스무디 (ICE) 6,000$t$),
        (v_s, 25, $t$카라향 주스 (ICE) 6,000$t$),
        (v_s, 26, $t$복숭아 아이스티 (ICE) 5,500$t$),
        (v_s, 27, $t$레몬 아이스티 (ICE) 5,500$t$),
        (v_s, 28, $t$생귤주스 (ICE) 6,000$t$),
        (v_s, 29, $t$비트주스 (ICE) 6,000$t$),
        (v_s, 30, $t$인절미 팥빙수 1인 7,500$t$),
        (v_s, 31, $t$인절미 팥빙수 2인 14,000$t$),
        (v_s, 32, $t$안 마심$t$);
    end if;
  end if;
  -- cafe2 · 2일차 플로이스트 (섭지코지 정상) (18가지)
  select id into v_s from public.retreat_steps where retreat_id = v_r and key = 'cafe2';
  if v_s is not null then
    update public.retreat_steps
       set title = $t$카페 주문 · 2일차 플로이스트 (섭지코지 정상)$t$, body = $t$11/3(화) 14:00 · 성산바다 점심 후 섭지코지 걸어서
메뉴 하나를 골라 주세요. 가격은 메뉴판 기준입니다.$t$, variants = array[$t$차갑게 (ICE)$t$, $t$따뜻하게 (HOT)$t$, $t$ICE · 디카페인 변경 (+1,000원)$t$, $t$HOT · 디카페인 변경 (+1,000원)$t$, $t$상관없음$t$]::text[]
     where id = v_s;
    if (select array_agg(label order by seq) from public.retreat_options where step_id = v_s and enabled) is not distinct from array[$t$피스타치오베라 (ICE) 11,500$t$, $t$에스프레소 (HOT) 7,000$t$, $t$아메리카노 HOT 7,000 / ICE 7,500$t$, $t$플랫화이트 HOT 7,000 / ICE 7,500$t$, $t$카페라떼 HOT 7,500 / ICE 8,000$t$, $t$카푸치노 (HOT) 8,000$t$, $t$바닐라라떼 HOT 8,500 / ICE 9,000$t$, $t$카페모카 HOT 8,500 / ICE 9,000$t$, $t$휘닉스블렌드 (필터) HOT 8,000 / ICE 8,500$t$, $t$디카페인블렌드 (필터) HOT 8,500 / ICE 9,000$t$, $t$제주소다 (ICE) 11,500$t$, $t$딸기라떼 (ICE) 9,000$t$, $t$초코라떼 HOT 8,500 / ICE 9,000$t$, $t$우유 아이스크림 5,500$t$, $t$캐모마일 HOT 8,000 / ICE 8,500$t$, $t$제주녹차 HOT 8,000 / ICE 8,500$t$, $t$배도라지대추생강차 HOT 8,500 / ICE 9,000$t$, $t$안 마심$t$]::text[] then
      null;   -- 메뉴가 이미 같다
    elsif exists (select 1 from public.retreat_choices where step_id = v_s) then
      raise notice '%: 이미 고른 분이 있어 메뉴 목록은 바꾸지 않았습니다. 진행 관리에서 고쳐 주세요.', $t$카페 주문 · 2일차 플로이스트 (섭지코지 정상)$t$;
    else
      delete from public.retreat_options where step_id = v_s;
      insert into public.retreat_options (step_id, seq, label) values
        (v_s, 1, $t$피스타치오베라 (ICE) 11,500$t$),
        (v_s, 2, $t$에스프레소 (HOT) 7,000$t$),
        (v_s, 3, $t$아메리카노 HOT 7,000 / ICE 7,500$t$),
        (v_s, 4, $t$플랫화이트 HOT 7,000 / ICE 7,500$t$),
        (v_s, 5, $t$카페라떼 HOT 7,500 / ICE 8,000$t$),
        (v_s, 6, $t$카푸치노 (HOT) 8,000$t$),
        (v_s, 7, $t$바닐라라떼 HOT 8,500 / ICE 9,000$t$),
        (v_s, 8, $t$카페모카 HOT 8,500 / ICE 9,000$t$),
        (v_s, 9, $t$휘닉스블렌드 (필터) HOT 8,000 / ICE 8,500$t$),
        (v_s, 10, $t$디카페인블렌드 (필터) HOT 8,500 / ICE 9,000$t$),
        (v_s, 11, $t$제주소다 (ICE) 11,500$t$),
        (v_s, 12, $t$딸기라떼 (ICE) 9,000$t$),
        (v_s, 13, $t$초코라떼 HOT 8,500 / ICE 9,000$t$),
        (v_s, 14, $t$우유 아이스크림 5,500$t$),
        (v_s, 15, $t$캐모마일 HOT 8,000 / ICE 8,500$t$),
        (v_s, 16, $t$제주녹차 HOT 8,000 / ICE 8,500$t$),
        (v_s, 17, $t$배도라지대추생강차 HOT 8,500 / ICE 9,000$t$),
        (v_s, 18, $t$안 마심$t$);
    end if;
  end if;
  -- cafe3 · 2일차 함덕 델문도 카페 (24가지)
  select id into v_s from public.retreat_steps where retreat_id = v_r and key = 'cafe3';
  if v_s is not null then
    update public.retreat_steps
       set title = $t$카페 주문 · 2일차 함덕 델문도 카페$t$, body = $t$11/3(화) 18:50 · 삼다온 저녁 후
메뉴 하나를 골라 주세요. 가격은 메뉴판 기준입니다.$t$, variants = array[$t$차갑게 (ICE)$t$, $t$따뜻하게 (HOT)$t$, $t$ICE · 디카페인 변경 (+1,000원)$t$, $t$HOT · 디카페인 변경 (+1,000원)$t$, $t$상관없음$t$]::text[]
     where id = v_s;
    if (select array_agg(label order by seq) from public.retreat_options where step_id = v_s and enabled) is not distinct from array[$t$아메리카노 HOT 7,000 / ICE 7,500$t$, $t$콜드브루 (ICE) 8,000$t$, $t$카페라떼 HOT 8,000 / ICE 8,500$t$, $t$바닐라라떼 HOT 8,500 / ICE 9,000$t$, $t$몬스터라떼 (ICE) 9,000$t$, $t$아포가토 8,000$t$, $t$페퍼민트 (허브티) 7,000$t$, $t$캐모마일 (허브티) 7,000$t$, $t$얼그레이 (허브티) 7,000$t$, $t$루이보스바닐라 (허브티) 7,000$t$, $t$딸기크림라떼 (ICE) 9,000$t$, $t$초콜릿라떼 HOT 8,500 / ICE 9,000$t$, $t$로얄밀크티 HOT 9,000 / ICE 9,500$t$, $t$우도땅콩라떼 HOT 8,500 / ICE 9,000$t$, $t$말차라떼 HOT 8,500 / ICE 9,000$t$, $t$제주 감귤티 HOT 8,500 / ICE 9,000$t$, $t$복숭아 아이스티 (ICE) 8,000$t$, $t$청귤피치 에이드 (ICE) 9,000$t$, $t$핑크레몬 에이드 (ICE) 9,000$t$, $t$트로피칼 망고 에이드 (ICE) 9,000$t$, $t$한라봉&망고 스무디 (ICE) 9,500$t$, $t$딸기 스무디 (ICE) 9,500$t$, $t$백향과귤 주스 (ICE) 9,500$t$, $t$안 마심$t$]::text[] then
      null;   -- 메뉴가 이미 같다
    elsif exists (select 1 from public.retreat_choices where step_id = v_s) then
      raise notice '%: 이미 고른 분이 있어 메뉴 목록은 바꾸지 않았습니다. 진행 관리에서 고쳐 주세요.', $t$카페 주문 · 2일차 함덕 델문도 카페$t$;
    else
      delete from public.retreat_options where step_id = v_s;
      insert into public.retreat_options (step_id, seq, label) values
        (v_s, 1, $t$아메리카노 HOT 7,000 / ICE 7,500$t$),
        (v_s, 2, $t$콜드브루 (ICE) 8,000$t$),
        (v_s, 3, $t$카페라떼 HOT 8,000 / ICE 8,500$t$),
        (v_s, 4, $t$바닐라라떼 HOT 8,500 / ICE 9,000$t$),
        (v_s, 5, $t$몬스터라떼 (ICE) 9,000$t$),
        (v_s, 6, $t$아포가토 8,000$t$),
        (v_s, 7, $t$페퍼민트 (허브티) 7,000$t$),
        (v_s, 8, $t$캐모마일 (허브티) 7,000$t$),
        (v_s, 9, $t$얼그레이 (허브티) 7,000$t$),
        (v_s, 10, $t$루이보스바닐라 (허브티) 7,000$t$),
        (v_s, 11, $t$딸기크림라떼 (ICE) 9,000$t$),
        (v_s, 12, $t$초콜릿라떼 HOT 8,500 / ICE 9,000$t$),
        (v_s, 13, $t$로얄밀크티 HOT 9,000 / ICE 9,500$t$),
        (v_s, 14, $t$우도땅콩라떼 HOT 8,500 / ICE 9,000$t$),
        (v_s, 15, $t$말차라떼 HOT 8,500 / ICE 9,000$t$),
        (v_s, 16, $t$제주 감귤티 HOT 8,500 / ICE 9,000$t$),
        (v_s, 17, $t$복숭아 아이스티 (ICE) 8,000$t$),
        (v_s, 18, $t$청귤피치 에이드 (ICE) 9,000$t$),
        (v_s, 19, $t$핑크레몬 에이드 (ICE) 9,000$t$),
        (v_s, 20, $t$트로피칼 망고 에이드 (ICE) 9,000$t$),
        (v_s, 21, $t$한라봉&망고 스무디 (ICE) 9,500$t$),
        (v_s, 22, $t$딸기 스무디 (ICE) 9,500$t$),
        (v_s, 23, $t$백향과귤 주스 (ICE) 9,500$t$),
        (v_s, 24, $t$안 마심$t$);
    end if;
  end if;
  -- cafe4 · 3일차 폴 바셋 (41가지)
  select id into v_s from public.retreat_steps where retreat_id = v_r and key = 'cafe4';
  if v_s is not null then
    update public.retreat_steps
       set title = $t$카페 주문 · 3일차 폴 바셋$t$, body = $t$11/4(수) 13:25 · 해녀잠수촌 점심 후 · 공항 가기 전 티타임
메뉴 하나를 골라 주세요. 가격은 메뉴판 기준입니다.$t$, variants = array[$t$차갑게 (ICE)$t$, $t$따뜻하게 (HOT)$t$, $t$상관없음$t$]::text[]
     where id = v_s;
    if (select array_agg(label order by seq) from public.retreat_options where step_id = v_s and enabled) is not distinct from array[$t$아메리카노 HOT/ICE 4,700$t$, $t$룽고 HOT/ICE 5,300$t$, $t$카페라떼 HOT/ICE 5,900$t$, $t$플랫 화이트 (슬로우 밀크) HOT/ICE 5,900$t$, $t$카푸치노 (HOT) 5,900$t$, $t$흑임자 카페라떼 HOT/ICE 6,900$t$, $t$카페 소이 밀크 with 허니 HOT/ICE 6,900$t$, $t$제주말차 카페라떼 HOT/ICE 6,900$t$, $t$아이스 아메리카노 (벤티) 6,300$t$, $t$너티 멜로우 콜드브루 (ICE) 6,000$t$, $t$너티 멜로우 콜드브루 라떼 (ICE) 7,000$t$, $t$아이스크림 카페라떼 (ICE) 7,500$t$, $t$아이스크림 밀크티 카페라떼 (ICE) 7,900$t$, $t$유자 그릭요거트 아이스크림 라떼 (ICE) 7,900$t$, $t$애플 시나몬티 HOT/ICE 6,500$t$, $t$우바아쌈밀크티 HOT/ICE 6,900$t$, $t$제주 말차 라떼 HOT/ICE 6,300$t$, $t$딥 초콜릿 라떼 HOT/ICE 6,900$t$, $t$밀크 초콜릿 HOT/ICE 6,300$t$, $t$제주 한라봉티 (HOT) 5,900$t$, $t$로열 캐모마일 허브차 HOT/ICE 5,500$t$, $t$크림슨 펀치 과일차 HOT/ICE 5,500$t$, $t$쿨 민트 허브차 HOT/ICE 5,500$t$, $t$샤인 다즐링 홍차 HOT/ICE 5,500$t$, $t$스팀밀크 (HOT) 4,700$t$, $t$생 토마토 주스 (ICE) 6,900$t$, $t$샤인머스캣 케일 주스 (ICE) 6,900$t$, $t$딸기 바나나 요거트 (ICE) 6,900$t$, $t$커피칩 라떼 프라페 (ICE) 6,900$t$, $t$더블 초콜릿 프라페 (ICE) 6,900$t$, $t$망고 파인애플 프라페 (ICE) 6,900$t$, $t$제주 말차라떼 프라페 (ICE) 6,900$t$, $t$납작복숭아 에이드 (ICE) 6,900$t$, $t$제주 한라봉 에이드 (ICE) 6,900$t$, $t$제주 선셋 레몬 에이드 (ICE) 6,900$t$, $t$흑임자 토핑 아이스크림 5,900$t$, $t$유자 그릭요거트 아이스크림 (컵) 4,800$t$, $t$유자 그릭요거트 아이스크림 토핑컵 5,900$t$, $t$고소한 흑임자 케이크 7,900$t$, $t$몽블랑 마롱 케이크 8,900$t$, $t$안 마심$t$]::text[] then
      null;   -- 메뉴가 이미 같다
    elsif exists (select 1 from public.retreat_choices where step_id = v_s) then
      raise notice '%: 이미 고른 분이 있어 메뉴 목록은 바꾸지 않았습니다. 진행 관리에서 고쳐 주세요.', $t$카페 주문 · 3일차 폴 바셋$t$;
    else
      delete from public.retreat_options where step_id = v_s;
      insert into public.retreat_options (step_id, seq, label) values
        (v_s, 1, $t$아메리카노 HOT/ICE 4,700$t$),
        (v_s, 2, $t$룽고 HOT/ICE 5,300$t$),
        (v_s, 3, $t$카페라떼 HOT/ICE 5,900$t$),
        (v_s, 4, $t$플랫 화이트 (슬로우 밀크) HOT/ICE 5,900$t$),
        (v_s, 5, $t$카푸치노 (HOT) 5,900$t$),
        (v_s, 6, $t$흑임자 카페라떼 HOT/ICE 6,900$t$),
        (v_s, 7, $t$카페 소이 밀크 with 허니 HOT/ICE 6,900$t$),
        (v_s, 8, $t$제주말차 카페라떼 HOT/ICE 6,900$t$),
        (v_s, 9, $t$아이스 아메리카노 (벤티) 6,300$t$),
        (v_s, 10, $t$너티 멜로우 콜드브루 (ICE) 6,000$t$),
        (v_s, 11, $t$너티 멜로우 콜드브루 라떼 (ICE) 7,000$t$),
        (v_s, 12, $t$아이스크림 카페라떼 (ICE) 7,500$t$),
        (v_s, 13, $t$아이스크림 밀크티 카페라떼 (ICE) 7,900$t$),
        (v_s, 14, $t$유자 그릭요거트 아이스크림 라떼 (ICE) 7,900$t$),
        (v_s, 15, $t$애플 시나몬티 HOT/ICE 6,500$t$),
        (v_s, 16, $t$우바아쌈밀크티 HOT/ICE 6,900$t$),
        (v_s, 17, $t$제주 말차 라떼 HOT/ICE 6,300$t$),
        (v_s, 18, $t$딥 초콜릿 라떼 HOT/ICE 6,900$t$),
        (v_s, 19, $t$밀크 초콜릿 HOT/ICE 6,300$t$),
        (v_s, 20, $t$제주 한라봉티 (HOT) 5,900$t$),
        (v_s, 21, $t$로열 캐모마일 허브차 HOT/ICE 5,500$t$),
        (v_s, 22, $t$크림슨 펀치 과일차 HOT/ICE 5,500$t$),
        (v_s, 23, $t$쿨 민트 허브차 HOT/ICE 5,500$t$),
        (v_s, 24, $t$샤인 다즐링 홍차 HOT/ICE 5,500$t$),
        (v_s, 25, $t$스팀밀크 (HOT) 4,700$t$),
        (v_s, 26, $t$생 토마토 주스 (ICE) 6,900$t$),
        (v_s, 27, $t$샤인머스캣 케일 주스 (ICE) 6,900$t$),
        (v_s, 28, $t$딸기 바나나 요거트 (ICE) 6,900$t$),
        (v_s, 29, $t$커피칩 라떼 프라페 (ICE) 6,900$t$),
        (v_s, 30, $t$더블 초콜릿 프라페 (ICE) 6,900$t$),
        (v_s, 31, $t$망고 파인애플 프라페 (ICE) 6,900$t$),
        (v_s, 32, $t$제주 말차라떼 프라페 (ICE) 6,900$t$),
        (v_s, 33, $t$납작복숭아 에이드 (ICE) 6,900$t$),
        (v_s, 34, $t$제주 한라봉 에이드 (ICE) 6,900$t$),
        (v_s, 35, $t$제주 선셋 레몬 에이드 (ICE) 6,900$t$),
        (v_s, 36, $t$흑임자 토핑 아이스크림 5,900$t$),
        (v_s, 37, $t$유자 그릭요거트 아이스크림 (컵) 4,800$t$),
        (v_s, 38, $t$유자 그릭요거트 아이스크림 토핑컵 5,900$t$),
        (v_s, 39, $t$고소한 흑임자 케이크 7,900$t$),
        (v_s, 40, $t$몽블랑 마롱 케이크 8,900$t$),
        (v_s, 41, $t$안 마심$t$);
    end if;
  end if;
end
$menu$;


-- 2. 부부 — 사모님도 남편 몫을 고른다 --------------------------------------------
create or replace function public.retreat_can_act(p_participant bigint)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from public.retreat_participants p
      join public.retreats r on r.id = p.retreat_id
     where p.id = p_participant
       and (p.id = public.retreat_my_participant(p.retreat_id)
         or p.companion_of = public.retreat_my_participant(p.retreat_id)
         or p.id = (select m.companion_of from public.retreat_participants m
                     where m.id = public.retreat_my_participant(p.retreat_id))
         or public.is_committee_officer(r.committee))
  )
$fn$;

-- retreat_state: 142 그대로에 v_mate(남편 줄)만 더했다 — companions·choices 에 남편도 들어간다
create or replace function public.retreat_state(p_retreat bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  r       public.retreats%rowtype;
  v_me    bigint;
  v_mate  bigint;   -- 내가 배우자(사모님)이면 남편 줄
  v_off   boolean;
  v_mem   boolean;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if auth.uid() is null then return jsonb_build_object('login', false); end if;
  v_mem := public.is_member();

  r := public.retreat_pick(p_retreat);
  if r.id is null then return jsonb_build_object('login', true, 'member', v_mem, 'retreat', null); end if;

  v_me := public.retreat_my_participant(r.id);
  /* 정회원도 참가자도 아니면 아무것도 주지 않는다 */
  if not v_mem and v_me is null then
    return jsonb_build_object('login', true, 'member', false, 'retreat', null);
  end if;
  v_off := v_mem and public.is_committee_officer(r.committee);
  select companion_of into v_mate from public.retreat_participants where id = v_me;

  return jsonb_build_object(
    'login', true, 'member', v_mem, 'officer', v_off, 'today', v_today,
    'retreat', to_jsonb(r),
    'me', (select to_jsonb(p) from public.retreat_participants p where p.id = v_me),
    'companions', (select coalesce(jsonb_agg(to_jsonb(p) order by p.seq), '[]'::jsonb)
                     from public.retreat_participants p where p.companion_of = v_me or p.id = v_mate),
    'roommates', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'role', q.role, 'church', q.church)
                                            order by q.seq), '[]'::jsonb)
                    from public.retreat_participants p
                    join public.retreat_participants q
                      on q.retreat_id = p.retreat_id and q.room_group = p.room_group and q.id <> p.id
                   where p.id = v_me and p.room_group is not null),
    'steps', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', s.id, 'seq', s.seq, 'key', s.key, 'title', s.title, 'body', s.body,
                         'kind', s.kind, 'status', s.status, 'due', s.due, 'variants', s.variants,
                         'notify', s.notify, 'opened_at', s.opened_at,
                         'options', (select coalesce(jsonb_agg(jsonb_build_object(
                                                  'id', o.id, 'seq', o.seq, 'label', o.label, 'note', o.note)
                                                  order by o.seq), '[]'::jsonb)
                                       from public.retreat_options o
                                      where o.step_id = s.id and o.enabled))
                       order by s.seq, s.id), '[]'::jsonb)
                from public.retreat_steps s
               where s.retreat_id = r.id and (v_off or s.status <> '닫힘')),
    'choices', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                  from public.retreat_choices c
                  join public.retreat_participants p on p.id = c.participant_id
                 where p.retreat_id = r.id
                   and (v_off or p.id = v_me or p.companion_of = v_me or p.id = v_mate)),
    /* 참가자 전체 명단은 정회원에게만 (생년월일은 임원에게만) */
    'participants', case when not v_mem then '[]'::jsonb else
                      (select coalesce(jsonb_agg(
                          jsonb_build_object('id', p.id, 'seq', p.seq, 'name', p.name, 'role', p.role,
                                             'church', p.church, 'companion_of', p.companion_of,
                                             'bus_seat', p.bus_seat, 'van_seat', p.van_seat,
                                             'room_group', p.room_group, 'room_no', p.room_no,
                                             'present', p.present, 'linked', p.user_id is not null)
                          || case when v_off
                                  then jsonb_build_object('paid', p.paid, 'fee', p.fee, 'note', p.note,
                                         'birth_date', (select b.birth_date from public.retreat_births b where b.participant_id = p.id))
                                  else '{}'::jsonb end
                          order by p.seq), '[]'::jsonb)
                         from public.retreat_participants p where p.retreat_id = r.id) end,
    'program', (select coalesce(jsonb_agg(to_jsonb(g) order by g.day_no, g.seq), '[]'::jsonb)
                  from public.retreat_program g where g.retreat_id = r.id)
  );
end
$fn$;
revoke all on function public.retreat_state(bigint) from public;
grant execute on function public.retreat_state(bigint) to authenticated;


-- 3. (148 sql 로 옮김) 총무는 부서 지정 임원이 아니라 이 수양회의 「진행 담당」으로 넣는다.
--    부서 임원은 수양회 밖의 부서 장부·회의록까지 쓰므로, 수양회만 관리하도록 148 이 따로 둔다.


-- 확인
select s.seq, s.title as "카페",
       (select count(*) from public.retreat_options o where o.step_id = s.id and o.enabled) as "메뉴",
       array_length(s.variants, 1) as "갈래",
       (select count(*) from public.retreat_choices c where c.step_id = s.id) as "고른 사람",
       s.status as "상태"
  from public.retreat_steps s join public.retreats r on r.id = s.retreat_id and r.title = '2026 제주 부부수양회'
 where s.key like 'cafe%'
 order by s.seq;

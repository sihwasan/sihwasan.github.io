-- =====================================================================
--  39. 회의록에 개회 예배 칸 더하기
--
--  상비부와 시찰의 회의는 예배로 시작합니다. 회의록에 그 예배를
--  함께 적을 수 있도록 다섯 칸을 더합니다.
--
--      기도 · 성경 · 찬송 · 설교자 · 설교 제목
--
--  화면의 '회의 내용'은 '결의 사항'으로 이름만 바꿉니다.
--  담기는 곳(body)은 그대로이므로 이미 적어 두신 내용은 그대로 있습니다.
--
--  ※ 감사가 끝난 회의록은 새로 더한 칸도 함께 잠깁니다.
--    (36_audit_ledger.sql 의 잠금 장치가 자료 전체를 견주기 때문입니다)
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 36_audit_ledger.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

do $add$
declare t text;
begin
  foreach t in array array['committee_minutes', 'sichal_minutes'] loop
    execute format($f$
      alter table public.%I
        add column if not exists prayer    text,   -- 기도
        add column if not exists scripture text,   -- 성경
        add column if not exists hymn      text,   -- 찬송
        add column if not exists preacher  text,   -- 설교자
        add column if not exists sermon    text    -- 설교 제목
    $f$, t);
  end loop;
end
$add$;

comment on column public.committee_minutes.prayer    is '개회 예배 - 기도';
comment on column public.committee_minutes.scripture is '개회 예배 - 성경';
comment on column public.committee_minutes.hymn      is '개회 예배 - 찬송';
comment on column public.committee_minutes.preacher  is '개회 예배 - 설교자';
comment on column public.committee_minutes.sermon    is '개회 예배 - 설교 제목';
comment on column public.committee_minutes.body      is '결의 사항';

comment on column public.sichal_minutes.prayer    is '개회 예배 - 기도';
comment on column public.sichal_minutes.scripture is '개회 예배 - 성경';
comment on column public.sichal_minutes.hymn      is '개회 예배 - 찬송';
comment on column public.sichal_minutes.preacher  is '개회 예배 - 설교자';
comment on column public.sichal_minutes.sermon    is '개회 예배 - 설교 제목';
comment on column public.sichal_minutes.body      is '결의 사항';


-- ---------------------------------------------------------------------
-- 확인
-- ---------------------------------------------------------------------
select table_name as "회의록",
       string_agg(column_name, ', ' order by ordinal_position) as "개회 예배 칸"
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('committee_minutes', 'sichal_minutes')
   and column_name in ('prayer', 'scripture', 'hymn', 'preacher', 'sermon')
 group by table_name;

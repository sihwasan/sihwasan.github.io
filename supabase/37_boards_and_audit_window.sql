-- =====================================================================
--  37. 이사 · 미래교회자립위원회 · 감사 기간 수동 열기
--
--  1) 이사
--     제19회 정기노회에서 선정한 이사를 조직 화면에 싣는다.
--       총회 실행위원 / 총신대 운영이사 / GMS 이사 / 기독신문 이사
--     (제19회 정기노회 회의록 30항 '이사 선정')
--
--  2) 미래교회자립위원회를 상비부에 더한다.
--     노회규칙의 미래교회자립위원회 내규에 따라 미자립교회 지원을
--     담당하며, 다른 상비부와 똑같이 회의록·회계 장부를 쓴다.
--
--  3) 감사 기간 수동 열기
--     감사는 3월(봄)·9월(가을)에 시행하지만, 그 달 안에 마치지 못하는
--     일이 있으므로 노회 관리자가 필요할 때 손으로 열 수 있게 한다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 36_audit_ledger.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 이사
--    총대(delegates)와 같은 모양으로 두어, 회기가 바뀌어도 지난 명단을
--    남겨 둔 채 새 명단으로 넘길 수 있게 한다.
-- ---------------------------------------------------------------------
create table if not exists public.board_members (
  id         bigserial primary key,
  kind       text not null,      -- 총회 실행위원 / 총신대 운영이사 / GMS 이사 / 기독신문 이사
  name       text not null,
  position   text,               -- 목사 / 장로
  church     text,
  title      text,               -- 노회장 등 겸직 표시
  term_from  date,               -- 자격 시작 (보통 그 회기 정기노회일)
  term_until date,
  active     boolean not null default true,
  note       text,
  sort       numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);
create index if not exists board_members_kind_idx on public.board_members (kind, sort, id);

alter table public.board_members enable row level security;

drop policy if exists board_members_read  on public.board_members;
drop policy if exists board_members_write on public.board_members;
-- 이사 명단은 정회원이 보고, 등록·수정은 관리자가 한다 (총대와 같다)
create policy board_members_read  on public.board_members for select
  using (public.is_member());
create policy board_members_write on public.board_members for all
  using (public.can_manage()) with check (public.can_manage());


-- 제19회 정기노회(2026. 4. 13.) 이사 선정 결과
insert into public.board_members (kind, name, position, church, term_from, sort)
select * from (values
  ('총회 실행위원',   '김종수', '목사', '섬기는교회',   date '2026-04-13', 10::numeric),
  ('총신대 운영이사', '서용호', '목사', '수암제일교회', date '2026-04-13', 20::numeric),
  ('GMS 이사',        '박흥열', '목사', '시흥생수교회', date '2026-04-13', 30::numeric),
  ('기독신문 이사',   '김종수', '목사', '섬기는교회',   date '2026-04-13', 40::numeric)
) as v(kind, name, position, church, term_from, sort)
where not exists (select 1 from public.board_members);


-- ---------------------------------------------------------------------
-- 2. 미래교회자립위원회를 상비부에 더한다
--    이름이 이미 있으면 하는 일 설명만 채우고 사람은 건드리지 않는다.
-- ---------------------------------------------------------------------
insert into public.committees (name, duty, clerk, sort) values (
  '미래교회자립위원회',
  '미자립교회 지원과 관련한 제반 정책 및 시행 사항을 담당하며, 지원 신청 청원을 심의한다. 세부 사항은 미래교회자립위원회 내규를 따른다.',
  '김동석 목사',
  8)
on conflict (name) do update
  set duty = coalesce(nullif(public.committees.duty, ''), excluded.duty),
      sort = coalesce(public.committees.sort, excluded.sort);


-- ---------------------------------------------------------------------
-- 3. 감사 기간 수동 열기
--
--    open = false 이면 달력대로(3월 봄 / 9월 가을) 열린다.
--    open = true  이면 그 달이 아니어도 year·period 로 감사를 진행한다.
--    노회 관리자가 시스템 운영 화면에서 켜고 끈다.
-- ---------------------------------------------------------------------
insert into public.site_settings (key, value) values (
  'audit_window',
  jsonb_build_object('open', false, 'year', null, 'period', null,
                     'note', '', 'by', '', 'at', null))
on conflict (key) do nothing;


-- ---------------------------------------------------------------------
-- 4. 확인
-- ---------------------------------------------------------------------
select kind as "구분", name as "성명", position as "직분", church as "소속 교회"
  from public.board_members where active order by sort, id;

select name as "상비부", coalesce(head, '-') as "부장", coalesce(clerk, '-') as "서기", sort as "순서"
  from public.committees order by sort;

select value as "감사 기간 설정" from public.site_settings where key = 'audit_window';

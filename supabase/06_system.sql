-- =====================================================================
-- 시화산노회 홈페이지 : 시스템 운영 (알림·매뉴얼·일정)
--
-- 실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣고 Run
--
-- 열람 : 간사·서기·노회장 (운영 알림과 매뉴얼을 받는 대상)
-- 관리 : 노회가 정한 시스템 관리 책임자
-- =====================================================================

-- 시스템 자동 알림 규칙
create table if not exists public.ops_notices (
  id           bigserial primary key,
  title        text not null,
  message      text,
  audience     text not null default '간사',
  rule         text not null check (rule in ('spring','fall','before_spring','before_fall','fixed')),
  offset_days  int  not null default 0,   -- 기준일보다 며칠 전부터 표시할지
  window_days  int  not null default 21,  -- 며칠 동안 표시할지
  fixed_date   date,                       -- rule='fixed'일 때 기준일
  active       boolean not null default true,
  sort         int not null default 0
);

-- 시스템 운영 매뉴얼
create table if not exists public.ops_manual (
  id         bigserial primary key,
  title      text not null,
  body       text not null,
  sort       int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.ops_notices enable row level security;
alter table public.ops_manual  enable row level security;

drop policy if exists ops_notices_read  on public.ops_notices;
drop policy if exists ops_notices_write on public.ops_notices;
drop policy if exists ops_manual_read   on public.ops_manual;
drop policy if exists ops_manual_write  on public.ops_manual;

create policy ops_notices_read  on public.ops_notices for select using (public.can_manage());
create policy ops_notices_write on public.ops_notices for all
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');
create policy ops_manual_read   on public.ops_manual for select using (public.can_manage());
create policy ops_manual_write  on public.ops_manual for all
  using (public.my_role() = 'superadmin') with check (public.my_role() = 'superadmin');

-- 정기노회 기준일 (봄: 4월 둘째 주 월요일, 통상 부활절 다음 주 / 가을: 10월 둘째 주 월요일)
insert into public.site_settings (key, value) values
  ('ops_dates', '{"springMonth":4,"springWeek":2,"fallMonth":10,"fallWeek":2}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 기본 알림 3가지 (이미 있으면 건너뜀)
-- ---------------------------------------------------------------------
insert into public.ops_notices (title, message, audience, rule, offset_days, window_days, sort)
select * from (values
  ('임원 교체 안내',
   '봄 정기노회가 열리는 주간입니다. 노회에서 선출된 신임 임원으로 홈페이지를 갱신해 주세요. 사이트 관리 → 임원 명부에서 임원 표를 수정하고, 회원 관리 → 노회 명단에서 신임 임원의 직책을 등록해 주세요.',
   '간사', 'spring', 0, 21, 1),
  ('상비부 명부 수정 안내',
   '봄 정기노회에서 상비부 배정이 확정되는 기간입니다. 회원 관리 → 상비부 배정 관리에서 각 부서의 부장·서기·회계와 1·2·3년조를 새 배정대로 수정해 주세요.',
   '간사', 'spring', 0, 21, 2),
  ('고시부 공문 발송 안내 (봄)',
   '봄 정기노회 한 달 반 전입니다. 고시규칙부가 각 교회에 고시 공문을 발송해야 하는 시기이니 고시부에 안내해 주세요.',
   '간사', 'before_spring', 45, 45, 3),
  ('고시부 공문 발송 안내 (가을)',
   '가을 정기노회 한 달 반 전입니다. 고시규칙부가 각 교회에 고시 공문을 발송해야 하는 시기이니 고시부에 안내해 주세요.',
   '간사', 'before_fall', 45, 45, 4)
) as v(title, message, audience, rule, offset_days, window_days, sort)
where not exists (select 1 from public.ops_notices);

-- ---------------------------------------------------------------------
-- 기본 운영 매뉴얼 (이미 있으면 건너뜀)
-- ---------------------------------------------------------------------
insert into public.ops_manual (title, body, sort)
select * from (values
  ('공지사항 올리기',
   E'1. 홈페이지에 로그인합니다.\n2. 메뉴에서 임원방 → 사이트 관리를 엽니다.\n3. 공지사항 탭에서 분류·날짜·제목·내용을 입력하고 저장을 누릅니다.\n4. 메인 화면과 게시판에 즉시 반영됩니다. 수정·삭제도 같은 화면에서 할 수 있습니다.', 1),
  ('노회 일정 바꾸기',
   E'1. 임원방 → 사이트 관리 → 노회 일정 탭을 엽니다.\n2. 날짜(예: 10.19)와 내용을 입력하고 추가를 누릅니다.\n3. 지난 일정은 삭제 버튼으로 정리합니다. 메인 화면 오른쪽에 반영됩니다.', 2),
  ('메인 화면 문구 바꾸기',
   E'1. 임원방 → 사이트 관리 → 메인 화면 탭을 엽니다.\n2. 큰 제목·설명·말씀 구절, 오른쪽 안내 상자를 수정하고 저장을 누릅니다.', 3),
  ('임원 교체 (봄 정기노회 후)',
   E'봄 정기노회에서 새 임원이 선출되면 세 곳을 갱신합니다.\n1. 사이트 관리 → 임원 명부: 조직 페이지에 표시되는 임원 표와 총회 총대를 새 임원으로 수정 후 저장.\n2. 회원 관리 → 노회 명단 관리: 신임 임원을 해당 직책(노회장·서기·부서기 등)으로 추가하고, 전임 임원 행은 삭제 후 정회원으로 다시 추가. 이렇게 하면 가입·로그인 시 등급이 자동으로 맞춰집니다.\n3. 회원 관리 → 회원 목록: 이미 가입한 분들의 등급도 새 직책에 맞게 변경.', 4),
  ('상비부 배정 수정',
   E'1. 임원방 → 회원 관리 → 상비부 배정 관리로 이동합니다.\n2. 각 부서의 부장·서기·회계와 1·2·3년조 명단을 수정하고 부서마다 저장을 누릅니다.\n3. 조직 페이지의 상비부 표에 반영됩니다.', 5),
  ('갤러리 사진 올리기',
   E'1. 임원방 → 사이트 관리 → 갤러리 탭을 엽니다.\n2. 사진 파일을 선택하고(여러 장 가능) 행사명과 시기를 입력한 뒤 올리기를 누릅니다.\n3. 사진 크기는 자동으로 조정됩니다. 삭제는 각 사진 아래 삭제 버튼을 누릅니다.', 6),
  ('승인대기 회원 처리',
   E'1. 임원방 → 회원 관리를 엽니다.\n2. 승인대기 회원 표에서 성명과 소속 교회를 확인합니다.\n3. 노회 소속이 맞으면 정회원 설정을 누릅니다. 임원이면 회원 목록의 등급 변경에서 해당 직책을 지정합니다.', 7),
  ('회의록·회칙 개정 반영',
   E'회의록 전문과 회칙 조문의 개정은 문서 구조 보호를 위해 관리 화면에서 직접 수정하지 않습니다.\n개정된 문서를 노회 사무실로 전달하면 홈페이지에 반영됩니다.', 8)
) as v(title, body, sort)
where not exists (select 1 from public.ops_manual);

-- 확인:  select title, rule, offset_days from public.ops_notices order by sort;

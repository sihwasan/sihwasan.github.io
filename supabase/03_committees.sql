-- =====================================================================
-- 시화산노회 홈페이지 : 상비부 배정 관리 테이블
--
-- 실행 방법
--   Supabase 대시보드 → SQL Editor → New query →
--   이 파일 전체를 붙여넣고 Run (한 번만 실행)
--
-- 수정 권한 : 노회장·서기·간사·최고관리자 (서버가 강제)
-- 열람 권한 : 정회원 이상
--
--   ※ 여러 번 실행해도 안전합니다. 이미 등록된 자료는 그대로 유지됩니다.
-- =====================================================================

create table if not exists public.committees (
  name        text primary key,
  duty        text,
  head        text,
  clerk       text,
  treasurer   text,
  y1          text,
  y2          text,
  y3          text,
  sort        int not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.committees enable row level security;

drop policy if exists committees_read  on public.committees;
drop policy if exists committees_write on public.committees;
create policy committees_read  on public.committees for select using (public.is_member());
create policy committees_write on public.committees for all
  using (public.can_manage()) with check (public.can_manage());

-- 제19회 정기노회 공천·조직보고 기준 등록 (이미 있으면 갱신)
insert into public.committees (name, duty, head, clerk, treasurer, y1, y2, y3, sort) values
  ('감사헌의부', '각 시찰회를 경유하여 제출된 각종 서류를 심의하여 본회에 상정하며, 노회 회의록·회계장부·각 상비부 회의록 및 재정장부·지교회 당회록을 감사한다.', '이재용 목사', '문태환 목사', '백윤복 장로', '이재용, 주강완, 박영수, 김완수', '송기태, 김종서', '박상우, 백윤복, 김성조, 문태환', 1),
  ('정치부', '본회가 위임하는 회원심사 및 정치에 관한 사항을 심의 보고한다.', '김성중 목사', '서용호 목사', '정재영 장로', '서용호, 김지수, 윤위석', '김성중, 정재영', '김종수, 김영돈', 2),
  ('고시규칙부', '본회에서 시행하는 각종 고시에 관한 일체를 시행하며 그 결과를 보고하고, 본회의 규칙에 관한 일체를 담당한다.', '박재완 목사', '한동준 목사', '장정훈 목사', '박재완, 문광선', '유성준', '한동준, 장정훈', 3),
  ('재정부', '본회의 재정에 관한 일체를 담당한다.', '이신영 장로', '명영석 목사', '김득철 장로', '명영석, 송언빈, 박아론, 이신영', '유승열, 김득철, 고동욱', '오윤석, 제갈광철, 김하진', 4),
  ('교육친교부', '본회의 교육사업 일체와 주일학교연합회·중고등부 교육사업, 교역자 보수교육, 회원 상호간의 친교와 체육행사 일체를 담당한다.', '강명우 목사', '김창룡 장로', '안상천 목사', '강명우, 이동진, 장경환', '김창룡, 조능, 김종관, 안상천, 김동석', '김선민, 김성훈', 5),
  ('전도선교부', '본회의 전도사업 일체, 남녀전도회 사업감독과 미자립교회·개척교회 지원, 국내외 선교 및 특수분야 선교 일체를 담당한다.', '박현정 목사', '송요한 목사', '윤성복 장로', '김성신, 이재복, 송요한', '김운갑, 정주원, 허경하, 박희원, 박현정', '박규태, 윤성복, 이성대', 6),
  ('사회복지부', '본회가 일임한 사회복지·구제사업, 회원의 후생사업 및 장례 일체를 담당하며, 회원 예우와 애경사는 내규로 정한다.', '박양수 목사', '손영득 목사', '김영우 장로', '박양수, 임동준, 신용화', '전종호, 김영우, 문명수', '손영득, 김상진, 장명국, 안태성', 7)
on conflict (name) do update
  set duty = excluded.duty, head = excluded.head, clerk = excluded.clerk,
      treasurer = excluded.treasurer, y1 = excluded.y1, y2 = excluded.y2,
      y3 = excluded.y3, sort = excluded.sort, updated_at = now();

-- 확인:  select name, head, clerk, treasurer from public.committees order by sort;

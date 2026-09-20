-- =====================================================================
--  97. 회원 명단의 기준 순서 (노회 회의자료 명단 그대로)
--
--  회의자료의 목사 명단은 <장립·신학졸업횟수·나이·전입순>으로 매겨진
--  순서입니다. 그동안 명단 정리를 하면 위임목사가 앞으로, 시무목사가
--  뒤로 밀려 회의자료와 순서가 달라졌습니다.
--
--  이제 회의자료의 순서를 <기준 순서>로 따로 적어 두고, 명단을 어떻게
--  다시 정리하든 늘 이 순서로 돌아오게 합니다.
--    · 처음 화면에 보이는 회원 명단
--    · 시찰별 회원 명단
--    · 이름을 고르는 상자와 서류 명단
--  모두 같은 순서를 씁니다.
--
--  기준 순서에 없는 분(뒤에 들어오신 분)은 그 직위 무리의 맨 뒤에
--  전입순으로 붙습니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 기준 순서 표
-- ---------------------------------------------------------------------
create table if not exists public.roster_order (
  seq       integer primary key,
  category  text not null,
  name      text not null,
  church    text
);

comment on table public.roster_order is
  '노회 회의자료의 회원 명단 순서. 명단을 다시 정리해도 이 순서를 지킨다.';

alter table public.roster_order enable row level security;

drop policy if exists roster_order_read  on public.roster_order;
drop policy if exists roster_order_write on public.roster_order;
create policy roster_order_read  on public.roster_order for select using (public.is_member());
create policy roster_order_write on public.roster_order for all
  using (public.can_manage()) with check (public.can_manage());


-- ---------------------------------------------------------------------
-- 2. 회의자료 명단 (제19회기 정기노회 회의자료)
--    목사 34명은 회의자료 표의 번호 그대로입니다.
--    뒤에 들어오신 분은 그 무리의 맨 끝에 적어 둡니다.
-- ---------------------------------------------------------------------
truncate table public.roster_order;

insert into public.roster_order (seq, category, name, church) values
  -- 목사 (회의자료 1~34번)
  (  1, '목사', '박현정', '율리교회'),
  (  2, '목사', '강명우', '반석교회'),
  (  3, '목사', '임동준', '새힘교회'),
  (  4, '목사', '서용호', '수암제일교회'),
  (  5, '목사', '문광선', '새누리교회'),
  (  6, '목사', '박재완', '수암새권능교회'),
  (  7, '목사', '박양수', '힘찬교회'),
  (  8, '목사', '송기태', '새날선교교회'),
  (  9, '목사', '박흥열', '시흥생수교회'),
  ( 10, '목사', '주강완', '서신영광교회'),
  ( 11, '목사', '이재용', '안산상록교회'),
  ( 12, '목사', '김선민', '나눔의교회'),
  ( 13, '목사', '전종호', '동탄인랜드교회'),
  ( 14, '목사', '김성중', '한숲우리교회'),
  ( 15, '목사', '권병렬', '섬김의교회'),
  ( 16, '목사', '안상천', '참된빛교회'),
  ( 17, '목사', '이성대', '새생명교회'),
  ( 18, '목사', '명영석', '행복한교회'),
  ( 19, '목사', '김지수', '반월교회'),
  ( 20, '목사', '백용선', '노진교회'),
  ( 21, '목사', '김종수', '섬기는교회'),
  ( 22, '목사', '이동진', '동탄영광교회'),
  ( 23, '목사', '유성준', '주품에교회'),
  ( 24, '목사', '김영돈', '안산원곡동교회'),
  ( 25, '목사', '김운갑', '시흥은혜교회'),
  ( 26, '목사', '장정훈', '아름다운숲교회'),
  ( 27, '목사', '한동준', '은광교회'),
  ( 28, '목사', '김동석', '운평장로교회'),
  ( 29, '목사', '손영득', '새솔제일교회'),
  ( 30, '목사', '송요한', '안산샬롬교회'),
  ( 31, '목사', '김성신', '연수교회'),
  ( 32, '목사', '정주원', '주말씀교회'),
  ( 33, '목사', '제갈광철', '예전교회'),
  ( 34, '목사', '문태환', '성산교회'),
  -- 목사 (회의자료 뒤에 전입하신 분)
  ( 35, '목사', '손병민', '노진교회'),

  -- 부목사
  (101, '부목사', '박규태', '반월교회'),
  (102, '부목사', '조능', '반월교회'),
  (103, '부목사', '김하진', '섬기는교회'),
  (104, '부목사', '박상우', '시흥생수교회'),
  (105, '부목사', '오윤석', '안산상록교회'),
  (106, '부목사', '박희원', '반월교회'),
  (107, '부목사', '안창선', null),

  -- 원로목사
  (201, '원로목사', '이세용', '반월교회'),
  (202, '원로목사', '신동열', '노진교회'),
  (203, '원로목사', '김충현', '운평장로교회'),
  (204, '원로목사', '김삼성', '새솔제일교회'),

  -- 은퇴목사
  (301, '은퇴목사', '김해수', '목자교회'),

  -- 무임목사
  (401, '무임목사', '백용선', null),
  (402, '무임목사', '유충근', null),
  (403, '무임목사', '박지만', null),
  (404, '무임목사', '이병준', null),
  (405, '무임목사', '이현철', null),
  (406, '무임목사', '서기영', null),
  (407, '무임목사', '정해정', null),
  (408, '무임목사', '김익환', null),
  (409, '무임목사', '안상환', null),
  (410, '무임목사', '김영창', null),
  (411, '무임목사', '주재경', null),

  -- 장로 (시찰 차례: 북부 → 상록 → 남부)
  (501, '장로', '박영수', '안산샬롬교회'),
  (502, '장로', '유승열', '시흥생수교회'),
  (503, '장로', '장경환', '새날선교교회'),
  (504, '장로', '이재복', '안산상록교회'),
  (505, '장로', '김성훈', '목자교회'),
  (506, '장로', '박아론', '수암새권능교회'),
  (507, '장로', '윤성복', '섬기는교회'),
  (508, '장로', '고동욱', '섬기는교회'),
  (509, '장로', '김완수', '섬김의교회'),
  (510, '장로', '김성조', '새힘교회'),
  (511, '장로', '장명국', '안산원곡동교회'),
  (512, '장로', '김창룡', '반월교회'),
  (513, '장로', '정재영', '반월교회'),
  (514, '장로', '김상진', '반월교회'),
  (515, '장로', '김영우', '새솔제일교회'),
  (516, '장로', '윤위석', '은광교회'),
  (517, '장로', '김득철', '은광교회'),
  (518, '장로', '김종서', '힘찬교회'),
  (519, '장로', '이신영', '수암제일교회'),
  (520, '장로', '송언빈', '서안문호교회'),
  (521, '장로', '문명수', '노진교회'),
  (522, '장로', '안태성', '반석교회'),
  (523, '장로', '백윤복', '성산교회'),
  (524, '장로', '김종관', '연수교회'),
  (525, '장로', '신용화', '운평장로교회'),
  (526, '장로', '허경하', '한숲우리교회'),

  -- 직원
  (601, '직원', '김진분', null);


-- ---------------------------------------------------------------------
-- 3. 기준 순서에서 자리 번호 찾기
--    직위가 바뀐 분은 기준 순서에서 빠집니다(바뀐 무리의 맨 뒤로 갑니다).
--    이름 사이의 빈칸은 무시합니다.
-- ---------------------------------------------------------------------
create or replace function public.roster_base_seq(p_category text, p_name text)
returns integer language sql stable set search_path = public as $fn$
  select min(o.seq)
    from public.roster_order o
   where o.category = coalesce(nullif(btrim(p_category), ''), '-')
     and regexp_replace(o.name, '\s', '', 'g')
       = regexp_replace(coalesce(p_name, ''), '\s', '', 'g');
$fn$;


-- ---------------------------------------------------------------------
-- 3-2. 직위 순서 — 목사는 한 무리다
--    위임목사와 시무목사를 갈라 놓으면 회의자료의 목사 번호가 흐트러집니다.
--    회의자료는 위임·시무를 가리지 않고 목사를 한 표에 담습니다.
--    (45 와 같은 내용입니다. 29 의 옛 함수가 남아 있어도 바로잡습니다)
-- ---------------------------------------------------------------------
create or replace function public.roster_rank(p_category text, p_position text)
returns integer language sql immutable as $fn$
  select case coalesce(nullif(btrim(p_category), ''), btrim(coalesce(p_position, '')))
    when '목사'     then 1
    when '부목사'   then 2
    when '원로목사' then 3
    when '은퇴목사' then 4
    when '무임목사' then 5
    when '장로'     then 6
    else 9
  end;
$fn$;


-- ---------------------------------------------------------------------
-- 4. 명단 다시 정렬 — 기준 순서를 먼저 따른다
--    직위 무리로 나누고, 무리 안에서는 회의자료 순서,
--    회의자료에 없는 분은 그 뒤에 지금 순서대로 붙는다.
-- ---------------------------------------------------------------------
create or replace function public.reorder_roster()
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_n integer := 0;
begin
  if not public.can_manage() then
    raise exception '명단 순서 정리는 관리자(노회장·서기·간사)만 할 수 있습니다.';
  end if;

  with ordered as (
    select r.id,
           row_number() over (
             order by public.roster_rank(r.category, r.position),
                      coalesce(public.roster_base_seq(r.category, r.name), 999999),
                      r.sort,
                      r.id
           ) * 10 as new_sort
      from public.roster r
     where coalesce(r.active, true)
  )
  update public.roster r
     set sort = o.new_sort
    from ordered o
   where r.id = o.id
     and r.sort is distinct from o.new_sort;

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.reorder_roster() from public;
grant execute on function public.reorder_roster() to authenticated;

comment on function public.reorder_roster() is
  '명단을 직위 무리로 나누고, 무리 안에서는 회의자료의 기준 순서를 지킨다.';


-- ---------------------------------------------------------------------
-- 5. 지금 명단에 한 번 적용한다
-- ---------------------------------------------------------------------
with ordered as (
  select r.id,
         row_number() over (
           order by public.roster_rank(r.category, r.position),
                    coalesce(public.roster_base_seq(r.category, r.name), 999999),
                    r.sort,
                    r.id
         ) * 10 as new_sort
    from public.roster r
   where coalesce(r.active, true)
)
update public.roster r
   set sort = o.new_sort
  from ordered o
 where r.id = o.id
   and r.sort is distinct from o.new_sort;


-- ---------------------------------------------------------------------
-- 6. 확인 — 목사 명단이 회의자료 번호대로 나와야 합니다
-- ---------------------------------------------------------------------
select row_number() over (order by r.sort, r.id) as "번호",
       r.name as "성명", r.church as "교회명",
       public.roster_base_seq(r.category, r.name) as "회의자료 번호"
  from public.roster r
 where coalesce(r.active, true) and r.category = '목사'
 order by r.sort, r.id;

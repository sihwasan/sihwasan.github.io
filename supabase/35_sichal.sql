-- =====================================================================
--  35. 시찰회 (북부·남부·상록)
--
--  근거 : 시화산노회 규칙 제3장 (시찰회)
--
--  시찰마다 자기 화면을 갖습니다.
--    · 관내 교회      — 교회 이름을 누르면 그 교회 홈페이지로 갑니다.
--                        주소·연락처·담임목사를 함께 적어 둡니다.
--    · 목회자 명단    — 노회 명단(roster)에서 그 시찰 소속을 모아 보여 줍니다.
--    · 시찰 자료실    — 시찰 서류를 올려 두고 내려받습니다.
--    · 회의록         — 시찰회 회의를 기록하고 보관합니다.
--    · 교회상황 보고서 — 각 교회가 해마다 자기 교회 상황을 올립니다.
--
--  누가 고칠 수 있는가
--    시찰장과 서기가 그 시찰의 관리자입니다. (노회 관리자도 함께)
--    시찰장·서기는 시찰 명부(sichals.head / sichals.clerk)의 이름으로
--    알아보며, 이름이 같지 않은 경우를 대비해 따로 지정할 수도 있습니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 내가 누구인지 알아보는 도우미
-- ---------------------------------------------------------------------

-- 내 소속 교회
create or replace function public.my_church()
returns text language sql stable security definer set search_path = public as $fn$
  select church from public.profiles where id = auth.uid();
$fn$;

-- 내가 속한 시찰. 노회 명단에서 이름과 교회로 찾고, 없으면 교회만으로 찾는다.
create or replace function public.my_sichal_name()
returns text language sql stable security definer set search_path = public as $fn$
  select coalesce(
    (select r.sichal
       from public.roster r
       join public.profiles p on p.id = auth.uid()
      where r.sichal is not null
        and r.name = p.name and r.church = p.church
      limit 1),
    (select r.sichal
       from public.roster r
       join public.profiles p on p.id = auth.uid()
      where r.sichal is not null
        and r.church = p.church
      limit 1)
  );
$fn$;


-- ---------------------------------------------------------------------
-- 2. 시찰 임원 (시찰장·서기)
--    시찰 명부의 이름으로 알아보지만, 동명이인이거나 명부에 적힌 표기가
--    달라 못 알아보는 경우를 대비해 여기에 직접 지정할 수도 있다.
--    지정은 노회 관리자가 한다.
-- ---------------------------------------------------------------------
create table if not exists public.sichal_officers (
  id         bigserial primary key,
  sichal     text not null,
  user_id    uuid not null references auth.users on delete cascade,
  position   text not null default '시찰장',   -- 시찰장 / 서기 / 회계
  created_at timestamptz not null default now(),
  created_by text
);
create unique index if not exists sichal_officers_idx
  on public.sichal_officers (sichal, user_id);

alter table public.sichal_officers enable row level security;

drop policy if exists sichal_officers_read  on public.sichal_officers;
drop policy if exists sichal_officers_write on public.sichal_officers;
-- 본인이 어느 시찰 임원인지 확인해야 하므로 로그인 회원은 읽을 수 있다
create policy sichal_officers_read  on public.sichal_officers for select
  using (auth.uid() is not null);
create policy sichal_officers_write on public.sichal_officers for all
  using (public.can_manage()) with check (public.can_manage());


-- 내가 이 시찰의 관리자인가
--   · 노회 관리자이거나
--   · sichal_officers 에 지정되어 있거나
--   · 시찰 명부의 시찰장·서기 이름과 내 이름이 같으면
-- 그 시찰의 자료를 저장·수정·삭제할 수 있다.
-- (명부에는 '김종수 목사(섬기는교회)'처럼 적히므로 첫 낱말만 견준다)
create or replace function public.is_sichal_officer(p_sichal text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.can_manage()
      or exists (
           select 1 from public.sichal_officers o
            where o.user_id = auth.uid() and o.sichal = p_sichal
         )
      or exists (
           select 1
             from public.sichals s
             join public.profiles p on p.id = auth.uid()
            where s.name = p_sichal
              and p.name is not null
              and (split_part(btrim(coalesce(s.head, '')),  ' ', 1) = p.name
                or split_part(btrim(coalesce(s.clerk, '')), ' ', 1) = p.name)
         );
$fn$;

-- 내가 임원으로 있는 시찰 목록
create or replace function public.my_sichals()
returns table (sichal text, duty_name text)
language sql stable security definer set search_path = public as $fn$
  select o.sichal, o.position
    from public.sichal_officers o
   where o.user_id = auth.uid()
  union
  select s.name,
         case when split_part(btrim(coalesce(s.head, '')), ' ', 1) = p.name
              then '시찰장' else '서기' end
    from public.sichals s
    join public.profiles p on p.id = auth.uid()
   where p.name is not null
     and (split_part(btrim(coalesce(s.head, '')),  ' ', 1) = p.name
       or split_part(btrim(coalesce(s.clerk, '')), ' ', 1) = p.name);
$fn$;

grant execute on function public.my_church()            to authenticated;
grant execute on function public.my_sichal_name()       to authenticated;
grant execute on function public.is_sichal_officer(text) to authenticated;
grant execute on function public.my_sichals()           to authenticated;


-- ---------------------------------------------------------------------
-- 3. 관내 교회
--    교회 이름을 누르면 홈페이지로 가도록 주소(url)를 함께 적어 둔다.
-- ---------------------------------------------------------------------
create table if not exists public.sichal_churches (
  id         bigserial primary key,
  sichal     text not null,
  name       text not null,             -- 교회 이름
  pastor     text,                      -- 담임목사
  url        text,                      -- 교회 홈페이지 주소
  address    text,
  phone      text,
  note       text,
  sort       numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);
create unique index if not exists sichal_churches_name_idx on public.sichal_churches (name);
create index if not exists sichal_churches_sic_idx on public.sichal_churches (sichal, sort, id);

alter table public.sichal_churches enable row level security;

drop policy if exists sichal_churches_read  on public.sichal_churches;
drop policy if exists sichal_churches_write on public.sichal_churches;
-- 담임목사 실명이 들어가므로 정회원부터 본다 (개인정보처리방침 제4조)
create policy sichal_churches_read  on public.sichal_churches for select
  using (public.is_member());
create policy sichal_churches_write on public.sichal_churches for all
  using (public.is_sichal_officer(sichal))
  with check (public.is_sichal_officer(sichal));


-- ---------------------------------------------------------------------
-- 4. 시찰 자료실
--    access : member(정회원 전체) / sichal(그 시찰 소속) / officer(임원)
-- ---------------------------------------------------------------------
create table if not exists public.sichal_docs (
  id          bigserial primary key,
  sichal      text not null,
  title       text not null,
  description text,
  doc_date    date,
  access      text not null default 'member'
              check (access in ('member', 'sichal', 'officer')),
  link_url    text,
  file_path   text,
  file_name   text,
  sort        numeric not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists sichal_docs_idx on public.sichal_docs (sichal, doc_date desc, id desc);

alter table public.sichal_docs enable row level security;

drop policy if exists sichal_docs_read  on public.sichal_docs;
drop policy if exists sichal_docs_write on public.sichal_docs;
create policy sichal_docs_read on public.sichal_docs for select using (
  public.is_sichal_officer(sichal)
  or (access = 'member'  and public.is_member())
  or (access = 'sichal'  and public.is_member() and public.my_sichal_name() = sichal)
  or (access = 'officer' and public.is_officer())
);
create policy sichal_docs_write on public.sichal_docs for all
  using (public.is_sichal_officer(sichal))
  with check (public.is_sichal_officer(sichal));


-- ---------------------------------------------------------------------
-- 5. 시찰회 회의록
-- ---------------------------------------------------------------------
create table if not exists public.sichal_minutes (
  id         bigserial primary key,
  sichal     text not null,
  title      text not null,             -- 예: 제19회기 제2차 시찰회
  met_on     date,
  place      text,
  attendees  text,                      -- 참석자. 한 줄에 한 사람 또는 쉼표로
  body       text,                      -- 회의 내용
  access     text not null default 'sichal'
             check (access in ('member', 'sichal', 'officer')),
  file_path  text,
  file_name  text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create index if not exists sichal_minutes_idx on public.sichal_minutes (sichal, met_on desc, id desc);

alter table public.sichal_minutes enable row level security;

drop policy if exists sichal_minutes_read  on public.sichal_minutes;
drop policy if exists sichal_minutes_write on public.sichal_minutes;
create policy sichal_minutes_read on public.sichal_minutes for select using (
  public.is_sichal_officer(sichal)
  or (access = 'member'  and public.is_member())
  or (access = 'sichal'  and public.is_member() and public.my_sichal_name() = sichal)
  or (access = 'officer' and public.is_officer())
);
create policy sichal_minutes_write on public.sichal_minutes for all
  using (public.is_sichal_officer(sichal))
  with check (public.is_sichal_officer(sichal));


-- ---------------------------------------------------------------------
-- 6. 교회상황 보고서 (해마다 교회별로 한 장)
--
--    올리기 : 그 교회 소속 정회원, 그 시찰의 시찰장·서기, 노회 관리자
--    열람   : 노회 임원 전체, 그 시찰의 시찰장·서기, 그 교회 소속 회원
-- ---------------------------------------------------------------------
create table if not exists public.church_reports (
  id            bigserial primary key,
  year          integer not null,
  sichal        text not null,
  church        text not null,
  pastor        text,                   -- 담임목사

  -- 교인 현황
  members_total      integer,           -- 전체 교인
  members_baptized   integer,           -- 세례교인
  members_new        integer,           -- 새로 등록한 교인

  -- 직원 현황
  staff_pastors      integer,           -- 교역자 (목사·전도사)
  staff_elders       integer,           -- 장로
  staff_deacons      integer,           -- 안수집사
  staff_kwonsa       integer,           -- 권사

  -- 예배·교육
  worship_avg        integer,           -- 주일 낮 예배 평균 출석
  school_total       integer,           -- 교회학교 전체 학생

  -- 재정 (원)
  budget_year        bigint,            -- 당해 예산
  offering_year      bigint,            -- 연간 헌금
  dues_paid          text,              -- 상회비 납부 상황

  note          text,                   -- 특기사항
  file_path     text,                   -- 원본 문서 (한글·PDF 등)
  file_name     text,

  submitted_by  text,
  user_id       uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- 한 해에 한 교회는 한 장만 (다시 올리면 그 위에 고쳐 쓴다)
create unique index if not exists church_reports_year_church_idx
  on public.church_reports (year, church);
create index if not exists church_reports_year_idx on public.church_reports (year desc, sichal, church);

alter table public.church_reports enable row level security;

drop policy if exists church_reports_read   on public.church_reports;
drop policy if exists church_reports_insert on public.church_reports;
drop policy if exists church_reports_update on public.church_reports;
drop policy if exists church_reports_delete on public.church_reports;

create policy church_reports_read on public.church_reports for select using (
  public.is_officer()
  or public.is_sichal_officer(sichal)
  or (public.is_member() and public.my_church() = church)
);
create policy church_reports_insert on public.church_reports for insert with check (
  public.can_manage()
  or public.is_sichal_officer(sichal)
  or (public.is_member() and public.my_church() = church)
);
create policy church_reports_update on public.church_reports for update using (
  public.can_manage()
  or public.is_sichal_officer(sichal)
  or (public.is_member() and public.my_church() = church)
) with check (
  public.can_manage()
  or public.is_sichal_officer(sichal)
  or (public.is_member() and public.my_church() = church)
);
create policy church_reports_delete on public.church_reports for delete using (
  public.can_manage()
  or public.is_sichal_officer(sichal)
  or (public.is_member() and public.my_church() = church)
);


-- ---------------------------------------------------------------------
-- 7. 파일 보관함 (둘 다 비공개. 서명된 주소로만 내려받는다)
-- ---------------------------------------------------------------------

-- 7-1. 시찰 자료·회의록 첨부
--      경로 규칙 : <시찰이름>/<파일>
insert into storage.buckets (id, name, public) values ('sichal-files', 'sichal-files', false)
on conflict (id) do nothing;

drop policy if exists sichal_files_read   on storage.objects;
drop policy if exists sichal_files_insert on storage.objects;
drop policy if exists sichal_files_delete on storage.objects;

-- 파일 경로는 목록(sichal_docs·sichal_minutes)을 통해서만 알 수 있고,
-- 그 목록은 위에서 등급대로 가려 두었다. (노회 자료실과 같은 방식)
create policy sichal_files_read on storage.objects for select
  using (bucket_id = 'sichal-files' and public.is_member());
create policy sichal_files_insert on storage.objects for insert
  with check (bucket_id = 'sichal-files'
              and public.is_sichal_officer(split_part(name, '/', 1)));
create policy sichal_files_delete on storage.objects for delete
  using (bucket_id = 'sichal-files'
         and public.is_sichal_officer(split_part(name, '/', 1)));


-- 7-2. 교회상황 보고서 첨부
--      경로 규칙 : <연도>/<시찰이름>/<교회이름>/<파일>
insert into storage.buckets (id, name, public) values ('church-reports', 'church-reports', false)
on conflict (id) do nothing;

drop policy if exists church_reports_obj_read   on storage.objects;
drop policy if exists church_reports_obj_insert on storage.objects;
drop policy if exists church_reports_obj_delete on storage.objects;

-- 읽기는 보고서 줄과 맞대어 정확히 가린다 (임원 · 그 시찰 임원 · 그 교회)
create policy church_reports_obj_read on storage.objects for select using (
  bucket_id = 'church-reports' and (
    public.is_officer()
    or public.is_sichal_officer(split_part(name, '/', 2))
    or (public.is_member() and public.my_church() = split_part(name, '/', 3))
  )
);
create policy church_reports_obj_insert on storage.objects for insert with check (
  bucket_id = 'church-reports' and (
    public.can_manage()
    or public.is_sichal_officer(split_part(name, '/', 2))
    or (public.is_member() and public.my_church() = split_part(name, '/', 3))
  )
);
create policy church_reports_obj_delete on storage.objects for delete using (
  bucket_id = 'church-reports' and (
    public.can_manage()
    or public.is_sichal_officer(split_part(name, '/', 2))
    or (public.is_member() and public.my_church() = split_part(name, '/', 3))
  )
);


-- ---------------------------------------------------------------------
-- 8. 지금 시찰 명부에 적힌 교회 목록을 옮겨 담는다 (처음 한 번)
--
--    sichals.churches 에 줄바꿈으로 적혀 있는 교회 이름을 한 줄씩 나눈다.
--    담임목사는 노회 명단(roster)에서 같은 교회의 목사를 찾아 채운다.
--    이미 옮겨 둔 교회는 건드리지 않으므로 여러 번 실행해도 안전하다.
-- ---------------------------------------------------------------------
insert into public.sichal_churches (sichal, name, pastor, sort)
select t.sichal, t.church,
       (select r.name from public.roster r
         where r.church = t.church and r.category = '목사'
         order by r.sort, r.id limit 1),
       t.n * 10
  from (
    select s.name as sichal,
           btrim(x.v, E' \r\t') as church,
           x.n
      from public.sichals s,
           lateral unnest(string_to_array(coalesce(s.churches, ''), E'\n'))
                  with ordinality as x(v, n)
  ) t
 where t.church <> ''
on conflict (name) do nothing;


-- ---------------------------------------------------------------------
-- 9. 확인
-- ---------------------------------------------------------------------
select s.name as "시찰", s.head as "시찰장", s.clerk as "서기",
       (select count(*) from public.sichal_churches c where c.sichal = s.name) as "관내 교회",
       (select count(*) from public.roster r where r.sichal = s.name)          as "명단 인원",
       (select count(*) from public.sichal_docs d where d.sichal = s.name)     as "자료",
       (select count(*) from public.sichal_minutes m where m.sichal = s.name)  as "회의록"
  from public.sichals s
 order by s.sort;

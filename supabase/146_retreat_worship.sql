-- =====================================================================
--  146. 수양회 예배 화면 — 진행자가 넘기면 참가자 휴대폰이 따라 넘어간다 (2026-10-30)
--
--  운평교회 「오늘의 예배」처럼, 예배 시간에 참가자 휴대폰에 예배 화면(찬양 가사 ·
--  찬송 · 성경 본문 · 설교 · 축도 …)을 띄운다.
--   · retreat_worship : 예배 한 번 = 한 줄. 화면(slides: 그림 주소 목록), 순서 이름(sections),
--     지금 진행 중인지(live)와 지금 화면 번호(slide).
--   · 진행하는 임원이 retreat.html 「예배」에서 「진행 시작」 → 다음/이전을 누르면 slide 가 바뀌고,
--     화면을 연 참가자 휴대폰은 2초마다 확인해 같은 장으로 넘어간다. 참가자는 앞뒤로
--     넘겨 볼 수도 있고, 「다시 따라가기」로 진행자에게 돌아온다.
--   · 보기  : 정회원, 그리고 수양회 참가자(일반회원 사모님 포함) — 사진·영상과 같다.
--   · 고치기: 그 부서 임원.
--   · 개회 예배 화면 52장은 교육친교부 총무(이동진 목사님)가 만든 가이드북 PPT 그림을 가리킨다.
--     총무가 가이드북의 PPT 를 고치면 이 화면도 고친 그림을 보여 준다 (장 수가 바뀌면 이 파일을 다시 만든다).
--   · 메인 화면 수양회 창(retreat_today)이 진행 중인 예배를 알려 「예배 화면」 단추를 띄운다.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--  ※ 143_retreat_media.sql 이후에 실행.
-- =====================================================================

create table if not exists public.retreat_worship (
  id          bigserial primary key,
  retreat_id  bigint not null references public.retreats on delete cascade,
  title       text not null,
  slides      jsonb not null default '[]'::jsonb,   -- ["https://.../s-01.jpg", ...]
  sections    jsonb not null default '[]'::jsonb,   -- [{"from": 3, "label": "찬양 · 손병민 목사"}, ...] (from: 몇 번째 장부터)
  live        boolean not null default false,
  slide       integer not null default 1,           -- 1부터
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);
create unique index if not exists retreat_worship_title_idx on public.retreat_worship (retreat_id, title);

alter table public.retreat_worship enable row level security;
drop policy if exists retreat_worship_read  on public.retreat_worship;
drop policy if exists retreat_worship_write on public.retreat_worship;

create policy retreat_worship_read on public.retreat_worship for select
  using (public.is_member() or public.retreat_my_participant(retreat_id) is not null);

create policy retreat_worship_write on public.retreat_worship for all
  using (exists (select 1 from public.retreats r where r.id = retreat_id and public.is_committee_officer(r.committee)))
  with check (exists (select 1 from public.retreats r where r.id = retreat_id and public.is_committee_officer(r.committee)));


-- 메인 화면 히어로: 가이드북 주소(143)에 더해, 지금 진행 중인 예배도 알려 준다 (로그인한 분에게만)
create or replace function public.retreat_today()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object('id', r.id, 'title', r.title, 'place', r.place,
                            'start_date', r.start_date, 'end_date', r.end_date, 'stage', r.stage,
                            'day_no', ((now() at time zone 'Asia/Seoul')::date - r.start_date) + 1,
                            'days', (coalesce(r.end_date, r.start_date) - r.start_date) + 1,
                            'guide_url', case when auth.uid() is not null then r.guide_url end,
                            'worship', case when auth.uid() is not null then
                                         (select jsonb_build_object('id', w.id, 'title', w.title)
                                            from public.retreat_worship w
                                           where w.retreat_id = r.id and w.live
                                           order by w.updated_at desc limit 1) end)
    from public.retreats r
   where r.status = 'open' and r.stage <> '마침'
     and (now() at time zone 'Asia/Seoul')::date between r.start_date and coalesce(r.end_date, r.start_date)
   order by r.id desc
   limit 1
$fn$;
grant execute on function public.retreat_today() to anon, authenticated;


-- 개회 예배 (1일차 20:40 · 호텔 세미나실) — 가이드북 PPT 52장
-- 다시 실행하면 화면·순서 이름만 새로 쓰고, 진행 상태(live·slide)는 건드리지 않는다.
insert into public.retreat_worship (retreat_id, title, slides, sections, updated_by)
select r.id, '개회 예배', $j$[
    "https://dongjin0191.github.io/jeju-2026/ppt/s-01.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-02.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-03.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-04.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-05.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-06.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-07.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-08.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-09.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-10.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-11.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-12.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-13.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-14.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-15.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-16.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-17.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-18.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-19.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-20.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-21.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-22.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-23.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-24.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-25.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-26.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-27.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-28.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-29.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-30.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-31.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-32.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-33.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-34.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-35.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-36.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-37.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-38.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-39.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-40.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-41.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-42.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-43.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-44.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-45.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-46.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-47.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-48.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-49.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-50.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-51.jpg",
    "https://dongjin0191.github.io/jeju-2026/ppt/s-52.jpg"
  ]$j$::jsonb, $j$[
   {
    "from": 1,
    "label": "개회 예배"
   },
   {
    "from": 2,
    "label": "예배 순서"
   },
   {
    "from": 3,
    "label": "찬양 · 손병민 목사"
   },
   {
    "from": 14,
    "label": "사회 · 김선민 목사"
   },
   {
    "from": 15,
    "label": "묵상기도"
   },
   {
    "from": 16,
    "label": "찬송 413장 · 내 평생에 가는 길"
   },
   {
    "from": 21,
    "label": "대표기도"
   },
   {
    "from": 22,
    "label": "성경봉독 · 사도행전 9장 3~5절"
   },
   {
    "from": 24,
    "label": "설교 · 쉐키나 · 강명우 목사"
   },
   {
    "from": 27,
    "label": "찬송 419장 · 주 날개 밑 내가 평안히 쉬네"
   },
   {
    "from": 31,
    "label": "축도 · 박흥열 목사"
   },
   {
    "from": 32,
    "label": "개회 예배"
   },
   {
    "from": 33,
    "label": "광고 · 이동진 목사"
   },
   {
    "from": 45,
    "label": "친교의 시간 1 · 소개"
   }
  ]$j$::jsonb, null
  from public.retreats r
 where r.title = '2026 제주 부부수양회'
on conflict (retreat_id, title) do update set slides = excluded.slides, sections = excluded.sections;


-- 확인
select r.title, w.title as "예배", jsonb_array_length(w.slides) as "화면", jsonb_array_length(w.sections) as "순서", w.live as "진행 중"
  from public.retreat_worship w join public.retreats r on r.id = w.retreat_id
 order by w.id;

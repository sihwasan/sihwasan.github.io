-- =====================================================================
--  144. 수양회 — 참가자 얼굴 사진 · 숙소 소개 영상 (2026-10-30)
--
--  가이드북(교육친교부 총무 이동진 목사님이 만든 github.io 앱)에 있던 것을 옮긴다.
--   · 참가자 얼굴 사진: 명단 줄 옆 표(retreat_photos)에 작은 사진(300px)을 그대로 담는다.
--     참가자 명단 표처럼 정회원만 보고, 그 부서 임원만 바꾼다.
--     사진 보관소(R2)에 올리지 않는 까닭: 보관소 주소는 아는 사람 누구나 열 수 있어,
--     얼굴과 이름이 함께 묶인 사진은 명단과 같은 권한 안에 둔다.
--   · 사진 30장은 이 파일에 넣지 않는다 — 별도 시드(144b, 공개 저장소에 올리지 않음)로
--     SQL Editor 에서만 넣는다. 그다음부터는 임원이 명단 「수정」에서 바꾼다.
--   · 가이드북에만 있던 숙소 소개 영상 1편을 「사진·영상」(준비·답사)에 더한다.
--
--  실행: Supabase → SQL Editor → 전체 붙여넣고 Run.  여러 번 실행해도 안전합니다.
--  ※ 143_retreat_media.sql 이후에 실행.
-- =====================================================================


-- 1. 참가자 얼굴 사진 -----------------------------------------------------------
--    photo : 'data:image/jpeg;base64,...' (300px 안팎, 한 장 수십 KB)
create table if not exists public.retreat_photos (
  participant_id bigint primary key references public.retreat_participants on delete cascade,
  photo          text not null check (photo like 'data:image/%' and length(photo) < 300000),
  updated_at     timestamptz not null default now()
);

alter table public.retreat_photos enable row level security;
drop policy if exists retreat_photos_read  on public.retreat_photos;
drop policy if exists retreat_photos_write on public.retreat_photos;

-- 명단과 같이 정회원이 함께 본다
create policy retreat_photos_read on public.retreat_photos for select using (public.is_member());

-- 바꾸기·지우기는 그 수양회 부서 임원만
create policy retreat_photos_write on public.retreat_photos for all
  using (exists (select 1 from public.retreat_participants p
                   join public.retreats r on r.id = p.retreat_id
                  where p.id = participant_id and public.is_committee_officer(r.committee)))
  with check (exists (select 1 from public.retreat_participants p
                        join public.retreats r on r.id = p.retreat_id
                       where p.id = participant_id and public.is_committee_officer(r.committee)));


-- 2. 숙소 소개 영상 (가이드북에서 옮김) — 이미 있으면 넣지 않는다 ---------------------
insert into public.retreat_media (retreat_id, kind, day_no, title, image_url, sort, author_id, author_name)
select r.id, 'video', 0, '숙소 소개 — 라마다 제주함덕호텔', 'https://youtu.be/tNXz9stE0KE', 3, null, '가이드북에서 옮김'
  from public.retreats r
 where r.title = '2026 제주 부부수양회'
   and not exists (select 1 from public.retreat_media m
                    where m.retreat_id = r.id and m.image_url like '%tNXz9stE0KE%');


-- 확인
select r.title,
       (select count(*) from public.retreat_participants p where p.retreat_id = r.id) as "참가자",
       (select count(*) from public.retreat_photos f
          join public.retreat_participants p on p.id = f.participant_id
         where p.retreat_id = r.id) as "얼굴 사진",
       (select count(*) from public.retreat_media m where m.retreat_id = r.id and m.kind = 'video') as "영상"
  from public.retreats r order by r.id;

-- =====================================================================
--  89. 회원 사진 경로 한 번에 받기 — 시찰회 회원 명단의 사진 칸
--
--  회원 신상관리(관리자)는 roster.photo_path 와 profiles.photo_path 를
--  직접 읽어 사진을 보여 주지만, 일반 회원은 다른 사람의 profiles 를
--  읽을 수 없어(정책: 본인·임원만) 회원이 내 정보에서 직접 올린 사진을
--  시찰회 명단에서 볼 수 없었다.
--
--  이 함수는 정회원(is_member)에게만, 명단(roster) 한 사람마다
--  · 관리자가 올린 사진(roster.photo_path)이 있으면 그것을,
--  · 없으면 계정(profiles.roster_id 로 이어진)에 올린 사진을
--  경로만 돌려준다. 사진 파일 자체는 비공개 보관소(member-photos)라
--  화면에서 시간 제한 주소를 따로 발급받아 보여 준다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

create or replace function public.roster_photo_paths()
returns table (out_roster_id bigint, out_photo_path text)
language sql stable security definer set search_path = public as $fn$
  select r.id, coalesce(r.photo_path, sp.photo_path)
    from public.roster r
    left join lateral (
      select p.photo_path
        from public.profiles p
       where p.roster_id = r.id
         and p.photo_path is not null
       order by p.updated_at desc nulls last
       limit 1
    ) sp on true
   where public.is_member()
     and coalesce(r.photo_path, sp.photo_path) is not null;
$fn$;

revoke all on function public.roster_photo_paths() from public;
grant execute on function public.roster_photo_paths() to authenticated;

-- =====================================================================
--  30. 회원정보 카드 (명단에서 이름을 누르면 보이는 정보)
--
--  · 회원명단에서 이름을 누르면 사진·교회·교회 주소·연락처·생년월일·
--    남은 임기(정년까지)를 볼 수 있습니다. 정회원만 열람할 수 있습니다.
--  · 사진·교회 주소는 본인이 로그인 후 내 정보에서 등록·수정합니다.
--  · 사진은 비공개 보관소(member-photos)에 저장되며,
--    정회원에게만 시간 제한이 있는 주소로 보여집니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 프로필에 교회 주소·사진 칸을 더한다
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists church_addr text;
alter table public.profiles add column if not exists photo_path  text;


-- ---------------------------------------------------------------------
-- 2. 회원 사진 보관소 (비공개)
--    · 읽기: 정회원만 (시간 제한 주소 발급)
--    · 올리기·바꾸기·지우기: 본인 폴더(자기 uid)만
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('member-photos', 'member-photos', false)
on conflict (id) do nothing;

drop policy if exists member_photos_read   on storage.objects;
drop policy if exists member_photos_insert on storage.objects;
drop policy if exists member_photos_update on storage.objects;
drop policy if exists member_photos_delete on storage.objects;

create policy member_photos_read on storage.objects for select
  using (bucket_id = 'member-photos' and public.is_member());

create policy member_photos_insert on storage.objects for insert
  with check (bucket_id = 'member-photos'
              and auth.uid()::text = (storage.foldername(name))[1]);

create policy member_photos_update on storage.objects for update
  using (bucket_id = 'member-photos'
         and auth.uid()::text = (storage.foldername(name))[1]);

create policy member_photos_delete on storage.objects for delete
  using (bucket_id = 'member-photos'
         and auth.uid()::text = (storage.foldername(name))[1]);


-- ---------------------------------------------------------------------
-- 3. 회원정보 카드 조회 함수
--    명단의 성명·교회로 프로필을 찾아 카드 정보를 돌려준다.
--    정회원이 아니면 아무것도 돌려주지 않는다.
-- ---------------------------------------------------------------------
create or replace function public.member_card(p_name text, p_church text)
returns table (
  out_name        text,
  out_church      text,
  out_position    text,
  out_church_addr text,
  out_phone       text,
  out_birth_date  date,
  out_retire_date date,
  out_photo_path  text
)
language sql stable security definer set search_path = public as $fn$
  select p.name, p.church, p.position, p.church_addr, p.phone,
         p.birth_date, public.retire_date(p.birth_date), p.photo_path
    from public.profiles p
   where public.is_member()
     and regexp_replace(coalesce(p.name, ''), '\s', '', 'g')
         = regexp_replace(coalesce(p_name, ''), '\s', '', 'g')
     and (
       coalesce(p_church, '') = ''
       or regexp_replace(regexp_replace(coalesce(p.church, ''), '\s', '', 'g'), '교회$', '')
          = regexp_replace(regexp_replace(p_church, '\s', '', 'g'), '교회$', '')
     )
   order by p.updated_at desc
   limit 1;
$fn$;

grant execute on function public.member_card(text, text) to authenticated;
revoke execute on function public.member_card(text, text) from anon;


-- ---------------------------------------------------------------------
-- 4. 확인
-- ---------------------------------------------------------------------
select column_name
  from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles'
   and column_name in ('church_addr', 'photo_path');

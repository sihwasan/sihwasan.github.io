/* 96 — 올린 파일의 보관 이름을 영문·숫자로
 *
 * 무엇이 잘못되어 있었나
 *   Supabase 보관함은 이름에 한글이 들어간 파일을 받지 않는다(Invalid key).
 *   그런데 시찰 자료실과 회의록은 「북부시찰/doc-…-순서지.hwpx」처럼
 *   칸 이름과 파일 이름에 한글을 그대로 써 왔다. 그래서 파일이 붙은 자료는
 *   한 번도 저장되지 않았다(두 보관함 모두 비어 있었다).
 *
 * 어떻게 고쳤나
 *   보관 이름을 「시찰 번호/doc-날짜-이름.확장자」처럼 영문·숫자로만 만든다.
 *   사람이 읽을 원래 이름은 표(file_name · files[].name)에 그대로 적어 두었다가
 *   내려받을 때 그 이름으로 돌려준다.
 *   누가 올리고 지울 수 있는지는 맨 앞 칸의 번호로 가린다.
 *
 *   상비부 표에는 번호 칸이 없었으므로 여기에서 더한다. 이름은 그대로 열쇠로 쓰므로
 *   다른 화면은 손댈 것이 없다.
 */

alter table public.committees add column if not exists id bigserial;

/* 맨 앞 칸(번호)을 이름으로 되돌린다. 예전처럼 이름을 그대로 쓴 경로도 함께 받는다. */
create or replace function public.sichal_of_key(p_key text)
returns text
language sql stable security definer
set search_path to 'public'
as $fn$
  select coalesce(
    (select s.name from public.sichals s
      where p_key ~ '^[0-9]+$' and s.id = p_key::bigint),
    p_key);
$fn$;

create or replace function public.committee_of_key(p_key text)
returns text
language sql stable security definer
set search_path to 'public'
as $fn$
  select coalesce(
    (select c.name from public.committees c
      where p_key ~ '^[0-9]+$' and c.id = p_key::bigint),
    p_key);
$fn$;

/* 시찰 자료실·시찰 회의록 첨부 */
drop policy if exists sichal_files_insert on storage.objects;
create policy sichal_files_insert on storage.objects
  for insert with check (
    bucket_id = 'sichal-files'
    and public.in_my_sichal(public.sichal_of_key(split_part(name, '/', 1))));

drop policy if exists sichal_files_delete on storage.objects;
create policy sichal_files_delete on storage.objects
  for delete using (
    bucket_id = 'sichal-files' and (
      public.is_sichal_officer(public.sichal_of_key(split_part(name, '/', 1)))
      or owner = auth.uid()));

/* 상비부 회의록 첨부 */
drop policy if exists committee_files_insert on storage.objects;
create policy committee_files_insert on storage.objects
  for insert with check (
    bucket_id = 'committee-files'
    and public.is_committee_officer(public.committee_of_key(split_part(name, '/', 1))));

drop policy if exists committee_files_delete on storage.objects;
create policy committee_files_delete on storage.objects
  for delete using (
    bucket_id = 'committee-files'
    and public.is_committee_officer(public.committee_of_key(split_part(name, '/', 1))));

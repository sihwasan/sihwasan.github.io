-- =====================================================================
--  75. 회계 장부 영수증(증빙) 보관 (2단계)
--
--  장부 항목마다 영수증 사진을 여러 장 붙일 수 있게 한다.
--  휴대전화로 찍어 올리면 비공개 보관함(receipts)에 담기고, 그 장부를
--  볼 수 있는 사람만 꺼내 본다. 노회·상비부·시찰 장부가 모두 같이 쓴다.
--
--  이 파일이 하는 일
--    1) 영수증 표(ledger_receipts)를 만든다. 3단계 자동 읽기 결과를 담을
--       칸(taken_on·vendor·amount·ocr)도 미리 둔다.
--    2) 비공개 보관함 receipts 를 만들고, 파일 경로의 맨 앞 칸(장부 번호)으로
--       열람·등록·삭제 권한을 정한다.
--         경로 : <장부번호>/<항목번호>/<시각>-<난수>.jpg
--    3) 감사가 끝났거나 마감된 장부의 영수증은 더하거나 지울 수 없다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 74_presbytery_ledger.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 장부 번호로 권한 알아보기
-- ---------------------------------------------------------------------
create or replace function public.ledger_book_readable(p_book bigint)
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select public.can_read_ledger(b.owner_kind, b.owner)
                     from public.ledger_books b where b.id = p_book), false);
$fn$;
grant execute on function public.ledger_book_readable(bigint) to authenticated;

-- 적을 수 있고, 감사·마감으로 잠기지 않은 장부인가
create or replace function public.ledger_book_writable(p_book bigint)
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select public.is_ledger_owner(b.owner_kind, b.owner)
                          and not b.audited_yn and not coalesce(b.closed_yn, false)
                     from public.ledger_books b where b.id = p_book), false);
$fn$;
grant execute on function public.ledger_book_writable(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- 2. 영수증 표
-- ---------------------------------------------------------------------
create table if not exists public.ledger_receipts (
  id         bigserial primary key,
  entry_id   bigint not null references public.ledger_entries on delete cascade,
  book_id    bigint not null references public.ledger_books on delete cascade,
  file_path  text not null,          -- 보관함 안 경로
  file_name  text,                   -- 올린 파일의 본디 이름
  file_size  integer,                -- 줄인 뒤 크기 (바이트)
  taken_on   date,                   -- (3단계) 영수증에 적힌 일자
  vendor     text,                   -- (3단계) 사용처
  amount     bigint,                 -- (3단계) 영수증 금액
  ocr        jsonb,                  -- (3단계) 자동 읽기 결과 원문
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists ledger_receipts_entry_idx on public.ledger_receipts (entry_id);
create index if not exists ledger_receipts_book_idx  on public.ledger_receipts (book_id);

alter table public.ledger_receipts enable row level security;

drop policy if exists ledger_receipts_read   on public.ledger_receipts;
drop policy if exists ledger_receipts_insert on public.ledger_receipts;
drop policy if exists ledger_receipts_update on public.ledger_receipts;
drop policy if exists ledger_receipts_delete on public.ledger_receipts;
create policy ledger_receipts_read on public.ledger_receipts for select
  using (public.ledger_book_readable(book_id));
create policy ledger_receipts_insert on public.ledger_receipts for insert
  with check (public.ledger_book_writable(book_id)
              and exists (select 1 from public.ledger_entries e
                           where e.id = entry_id and e.book_id = ledger_receipts.book_id));
create policy ledger_receipts_update on public.ledger_receipts for update
  using (public.ledger_book_writable(book_id))
  with check (public.ledger_book_writable(book_id));
create policy ledger_receipts_delete on public.ledger_receipts for delete
  using (public.ledger_book_writable(book_id));


-- ---------------------------------------------------------------------
-- 3. 비공개 보관함
--    경로 맨 앞 칸이 장부 번호다. 그 장부를 볼 수 있으면 열고,
--    적을 수 있으면(잠기지 않았으면) 올리고 지운다.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists receipts_read   on storage.objects;
drop policy if exists receipts_insert on storage.objects;
drop policy if exists receipts_delete on storage.objects;

create policy receipts_read on storage.objects for select
  using (bucket_id = 'receipts' and name ~ '^[0-9]+/'
         and public.ledger_book_readable(split_part(name, '/', 1)::bigint));
create policy receipts_insert on storage.objects for insert
  with check (bucket_id = 'receipts' and name ~ '^[0-9]+/'
              and public.ledger_book_writable(split_part(name, '/', 1)::bigint));
create policy receipts_delete on storage.objects for delete
  using (bucket_id = 'receipts' and name ~ '^[0-9]+/'
         and public.ledger_book_writable(split_part(name, '/', 1)::bigint));


-- ---------------------------------------------------------------------
-- 4. 확인
-- ---------------------------------------------------------------------
-- select r.id, r.book_id, r.entry_id, r.file_path, r.file_size, r.created_by
--   from public.ledger_receipts r order by r.id desc limit 20;

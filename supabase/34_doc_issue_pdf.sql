-- =====================================================================
--  34. 발급한 증명서 PDF를 노회 보관소(Cloudflare R2)에 남기기
--
--  지금까지는 증명서를 열 때마다 브라우저가 그림을 새로 떠서 PDF를
--  만들었습니다. 이제는 발급하는 순간 만들어진 PDF를 노회 보관소에
--  한 번 올려 두고, 다음부터는 그 파일을 그대로 내려받습니다.
--
--  · 발급할 때 만든 그 파일이므로 언제 받아도 모습이 똑같습니다.
--  · 보관소에 올리지 못했더라도 발급은 그대로 성공합니다.
--    그런 건은 pdf_uploaded_at 이 비어 있고, 예전처럼 브라우저가
--    새로 그려서 내려받습니다. (기능이 없어지지 않습니다)
--
--  파일 자체는 R2에 있고, 이 표에는 "어디에 있는지"만 적어 둡니다.
--  파일은 서명된 주소(10분짜리)로만 내려받을 수 있으므로,
--  주소를 안다고 해서 아무나 받을 수 있는 것은 아닙니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================

alter table public.doc_issues
  add column if not exists pdf_url         text,        -- 보관소에서의 주소 (서명 전)
  add column if not exists pdf_path        text,        -- 보관소 안의 파일 위치
  add column if not exists pdf_size        bigint,      -- 파일 크기 (바이트)
  add column if not exists pdf_uploaded_at timestamptz; -- 올린 때. 비어 있으면 "보관본 없음"

comment on column public.doc_issues.pdf_uploaded_at is
  '증명서 PDF를 노회 보관소(R2)에 올린 때. 비어 있으면 보관본이 없어 브라우저가 새로 그린다.';

-- 보관본이 없는 발급 건을 빨리 찾기 위한 색인
create index if not exists doc_issues_pdf_idx
  on public.doc_issues (pdf_uploaded_at)
  where pdf_uploaded_at is null;


-- ---------------------------------------------------------------------
--  확인 — 최근 발급 건에 보관본이 있는지 본다
-- ---------------------------------------------------------------------
select doc_no as "발급번호", doc_type as "서류", name as "대상자",
       issued_on as "발급일",
       case when pdf_uploaded_at is null then '없음 (그때그때 새로 그림)'
            else '있음' end as "보관본",
       pdf_size as "크기(바이트)"
  from public.doc_issues
 order by id desc
 limit 20;

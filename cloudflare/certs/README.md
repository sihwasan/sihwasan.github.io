# 증명서 보관소 (sihwasan-certs)

발급한 증명서 PDF를 Cloudflare R2에 보관해 두었다가, 신청자와 서기가
필요할 때 발급 당시 모습 그대로 내려받게 하는 창구입니다.

- 배포 주소: `https://sihwasan-certs.sihwasan.workers.dev`
- R2 보관함: `sihwasan-certs` (공개 접근 꺼짐 — 서명된 주소로만 내려받습니다)
- 짝이 되는 표: Supabase `public.doc_issues` 의 `pdf_url` `pdf_path`
  `pdf_size` `pdf_uploaded_at` (→ `supabase/34_doc_issue_pdf.sql`)

## 주소

| 주소 | 하는 일 | 누가 |
| --- | --- | --- |
| `POST /upload?issue_id=123` | 증명서 PDF 올리기 (10MB까지) | `can_manage()` |
| `GET /sign?issue_id=123` | 10분짜리 내려받기 주소 받기 | 본인 또는 관리자 |
| `GET /d/<파일>?exp=&sig=` | 실제 파일 보내기 | 서명이 맞을 때 |
| `POST /delete?issue_id=123` | 보관본 지우기 | `can_manage()` |
| `GET /health` | 살아 있는지 확인 | 누구나 |

`/upload` `/sign` `/delete` 는 `Authorization: Bearer <supabase access_token>`
가 있어야 합니다. 이 창구는 관리자 열쇠를 갖고 있지 않고, 보내온 증표로
Supabase에 그때그때 물어봅니다. 그래서 남의 증명서를 대신 꺼내 줄 수 없습니다.

## 배포

```
npx wrangler secret put SIGN_SECRET   # 내려받기 주소에 서명할 열쇠 (한 번만)
npx wrangler deploy
```

## ※ 이 소스에 대하여

지금 운영 중인 워커는 Cloudflare 대시보드에서 직접 배포되었고, 그 소스는
저장소에 없었습니다. 이 파일들은 **위 규약(주소·응답 모양)에 맞추어 저장소에
남긴 것**이며, 배포본과 글자까지 같다고는 보장할 수 없습니다.

저장소와 배포본을 확실히 같게 맞추시려면 이 소스로 다시 배포해 주세요.
다시 배포하실 때에는 `SIGN_SECRET` 을 먼저 넣어야 하고, **이미 발급해 둔
증명서의 내려받기 주소는 새 열쇠로 다시 서명되므로** 열려 있던 예전 주소는
쓸 수 없게 됩니다(다시 누르면 새 주소가 나옵니다). 보관된 파일 자체는
그대로 있습니다.

# 회의 녹음 보관소 (sihwasan-audio)

회의록에 붙이는 회의 녹음 파일을 Cloudflare R2에 보관해 두었다가,
들을 자격이 있는 분께만 들려주는 창구입니다.

- 배포 주소: `https://sihwasan-audio.sihwasan.workers.dev`
- R2 보관함: `sihwasan-audio` (공개 접근 꺼짐 — 서명된 재생 주소로만 들을 수 있습니다)
- 짝이 되는 표: Supabase `public.minutes_audio` (→ `supabase/113_minutes_audio.sql`)
- 화면: `minutes.html`(회의록 보기 안의 회의 녹음 칸), `minutes-audio.html`(허용받은 회원의 듣기 화면),
  `js/minutes-audio.js`

## 누가 무엇을

| 하는 일 | 누가 | 판단하는 곳 |
| --- | --- | --- |
| 올리기·지우기 | 서기 · 회록서기 (· 최고관리자) | `can_upload_minutes_audio()` |
| 늘 듣기 | 서기 · 회록서기 · 노회장 · 간사 (· 최고관리자) | `minutes_audio` 읽기 규칙 |
| 열람 허용(기간 · 모든 회원/고른 회원) | 서기 · 노회장 (· 최고관리자) | `minutes_audio_set_share()` |

이 창구는 관리자 열쇠를 갖고 있지 않습니다. 보내온 로그인 증표로 Supabase에 그때그때
묻고, 표에서 읽히는 녹음(= 들을 자격이 있는 녹음)에만 4시간짜리 재생 주소를 내어 줍니다.

## 주소

| 주소 | 하는 일 |
| --- | --- |
| `POST /up/start` `PUT /up/part` `POST /up/done` `POST /up/abort` | 20MB씩 나누어 올리기 (R2 분할 올리기) |
| `POST /del` | 녹음 지우기 — 표에서 먼저 지운 것만 |
| `POST /sign` | 재생 주소 받기 |
| `GET /p/<보관 이름>?exp=&sig=` | 소리 보내기 (구간 요청 지원 — 앞뒤로 옮겨 듣기) |
| `GET /health` | 살아 있는지 확인 |

## 처음 배포 (노회 Cloudflare 계정으로 로그인한 뒤 한 번)

```
npx wrangler login                      # Sihwasan_presbytery@naver.com 계정
npx wrangler r2 bucket create sihwasan-audio
npx wrangler secret put SIGN_SECRET     # 아무도 모르는 긴 글자 (재생 주소 서명용)
npx wrangler deploy
```

`SIGN_SECRET` 을 바꾸면 이미 열려 있던 재생 주소만 끊기고(다시 누르면 새 주소가 나옵니다),
보관된 녹음은 그대로 있습니다.

# AI 자료 검색 창구 (sihwasan-ai)

홈페이지 첫 화면의 **AI 검색**이 쓰는 창구입니다. 로그인한 회원의 질문을 받아
Claude 에게 묻고, Claude 가 총회 자료와 노회 자료를 도구로 찾아 **근거 번호를 달아** 답합니다.

- 배포 주소: `https://sihwasan-ai.sihwasan.workers.dev`
- 화면: `index.html` 의 `#ai-hero` (`js/ai-chat.js`), 관리자 설정 `admin-ai.html`
- 설정·열쇠: Cloudflare KV `AI_KV` (관리자가 홈페이지에서 넣는다 — 코드·설정 파일에는 열쇠가 없다)
- 질문 기록: Supabase `public.ai_logs` (→ `supabase/114_ai_search.sql`, 답 본문·근거·평가는 `127_ai_learning.sql`)
- 확인된 답: Supabase `public.ai_verified` (→ `supabase/127_ai_learning.sql`, 관리자가 `admin-ai.html#miss` 에서 승인)
- 총회 자료 색인: `data/ai/index.json` (→ `tools/ai-index/build.js` 로 만든다)

## 무엇을 어디서 찾나

| 자료 | 어디서 | 누가 볼 수 있나 |
| --- | --- | --- |
| 총회 헌법·규정·회의결의·보고서 목록 | `data/ai/index.json` (홈페이지에서 받아 둔다) | 모두 |
| 노회규칙·내규 | Supabase `rule_docs` / `rule_articles` | 모두 |
| 임원·총대·상비부·시찰회·이사 | `site_settings` / `committees` / `sichals` / `board_members` | 모두 |
| 회원 명단 · 회원 교회 | `roster` / `sichal_churches` | 정회원 이상 (생년월일·정년은 관리자만) |
| 노회 일정 · 공지 · 결의사항 | `site_schedule` / `meetings` / `site_notices` / `resolutions` | 모두 |
| 시찰 자료실·게시판·청원서 | `sichal_docs` / `sichal_posts` / `petition_submissions` | 자기 시찰 |
| 상비부 일정·공지 | `committee_events` | 회원 |
| 노회 회의록 · 임원 자료실 | `minutes_board` / `officer_docs` | 임원만 |

노회 자료는 **질문한 분의 로그인 증표로** 읽습니다. 그래서 홈페이지에서 볼 수 없는 자료는
Claude 도 보지 못하며, 등급에 따라 답이 달라집니다. 창구는 관리자 열쇠(service role)를 갖고 있지 않습니다.

## 주소

| 주소 | 하는 일 |
| --- | --- |
| `POST /ask` `{question, history?, thread?}` | 답을 SSE 로 흘려보낸다 (`status`·`delta`·`retract`·`sources`·`logged`·`saved`·`usage`·`done`·`error`) |
| `POST /feedback` `{id, helpful, reason?}` | 본인 답에 「도움이 됐어요 / 아니에요(이유)」 — `id` 는 `logged` 로 받은 질문 기록 번호 |
| `GET /health` | 살아 있는가, 열쇠가 있는가, 색인 조각 수 |
| `GET /settings` · `POST /settings` | (관리자) 모델·답변 깊이·하루 한도·허용 등급·켜기/끄기·열쇠 |
| `POST /settings/test` | (관리자) 열쇠로 모델 목록을 받아 보고, `{full:true}` 면 짧은 인사까지 |

## 처음 배포 (노회 Cloudflare 계정으로 한 번)

```
cd cloudflare/ai
npx wrangler login                       # Sihwasan_presbytery@naver.com 계정으로
npx wrangler kv namespace create AI_KV   # 나온 id 를 wrangler.toml 의 KV_ID_HERE 자리에 적는다
npx wrangler deploy
```

`배포.bat` 을 두 번 누르면 위 과정을 대신해 줍니다(KV 가 없으면 만들고 id 를 적어 넣습니다).

배포한 뒤 홈페이지 **관리자 → AI 검색·API 설정** 에서 Anthropic API 열쇠를 넣고 「연결 시험」을 누르면 끝입니다.

## 색인 다시 만들기

총회 자료(`data/assembly/*.json`)를 새로 받아 왔을 때:

```
node tools/ai-index/build.js      # data/ai/index.json 을 다시 만든다
git add data/ai/index.json && git commit -m "AI 색인 갱신" && git push
```

창구는 색인을 6시간마다 다시 받습니다. 바로 반영하려면 `npx wrangler deploy` 를 한 번 더 하면 됩니다.

## 비용

질문 한 번에 보통 입력 1만~3만 토큰(찾은 자료)과 출력 1천 토큰 남짓을 씁니다.
관리자 화면의 모델 고르기에 질문 한 건당 어림 비용이 적혀 있고, 하루 1인 한도·전체 한도로 새는 것을 막습니다.

## 쓰면 쓸수록 나아지는 구조 (127 sql)

모델을 다시 가르치지 않습니다. 사람(관리자)이 확인한 답만 검색 근거로 쌓습니다.

1. `/ask` 가 끝나면 질문·답 본문(근거 표시 `[R3]{{…}}` 포함, 2만 자까지)·근거 목록·`no_answer`
   (「자료에서 확인되지 않습니다」류이거나 인용 근거 0개)를 `ai_logs` 에 남기고, 그 줄 번호를 `logged` 로 돌려준다.
   최고관리자의 질문은 남기지 않는다(117 sql) — 그래서 평가 단추도 없다.
2. 화면(`js/ai-chat.js`)은 답마다 「도움이 됐어요 / 아니에요(이유)」 단추를 달고 `/feedback` 으로 보낸다.
   질문한 분의 증표로 `ai_feedback` 에 쓰므로 본인 질문에만, 본인 이름으로만 들어간다(RLS).
3. 관리자는 「AI 검색·API 설정 → 못 찾은 질문」에서 못 찾음·낮은 평가를 보고(이름·전화번호는 가려서)
   「확인된 답으로 승인」 한다 — 질문 다듬기·답 고치기·열람 등급(정회원 이상/임원 이상/관리자만).
4. 다음 질문부터 `search_verified_answers` 도구가 질문한 분 등급에 맞는 확인된 답을 먼저 내놓고
   (`search_assembly` 결과 맨 앞에도 `verified` 로 붙는다), Claude 는 그것을 우선 쓰되 원문 조문으로 다시 확인한다.

시험: `node test/learning.test.mjs` (Supabase·Claude 는 가짜로 바꿔 흐름 전체를 돌린다)

# 총회 보고서 본문 넣기 (tools/assembly-report)

총회 보고서를 홈페이지에서 **본문으로 읽고 검색**할 수 있게 하는 도구입니다.
결과는 `data/assembly/report-<회기>.json`(보고서별 글)과 `data/assembly/reports.json`(회기 목록, 본문 번호 `x`)에 들어가고,
`assembly-report.html`(총회 → 총회 보고서)이 이를 읽어 목록 → 본문 보기 → 제목·본문 검색을 합니다.
`tools/ai-index/build.js` 가 같은 파일을 AI 검색 색인(`data/ai/index.json`)에 넣습니다.

필요한 것: Python 3 + `pip install pdfplumber`, Node.js

## 새 회기(예: 제112회)를 넣을 때

총회 기획행정국이 펴낸 「제112회 총회 보고서」 PDF(한 권짜리, 글자가 들어 있는 것) 한 파일만 있으면 됩니다.

```bash
python tools/assembly-report/pdf2json.py "C:\...\제112회 총회보고서.pdf" 112 2027
node tools/ai-index/build.js
```

- 차례(「차 례」 쪽)의 「Ⅰ. …」「1. …」「소항목 …」와 쪽 번호로 보고서를 나누고, 쪽마다의 머리글(「N❙제112회 총회 보고서」)은 뗍니다.
- 「X. 노회 상황 보고」처럼 차례에 한 줄뿐인 큰 갈래는 안의 「1. 강동노회」 같은 번호 줄로 다시 나눕니다.
- 끝나면 보고서 수·글자 수·빈 항목이 보입니다. 빈 항목은 대개 표지(갈래 머리) 쪽이거나 보고를 내지 않은 노회입니다.
- 쪽 글은 `tools/assembly-report/cache/pages-112.json` 에 남아 다시 돌릴 때 빠릅니다(저장소에는 올라가지 않음). PDF 를 바꿨으면 이 파일을 지우세요.
- 그런 다음 `git add data/assembly data/ai` → 커밋·푸시. AI 검색 창구는 한 시간 안에 새 색인을 받습니다.

## 옛 회기(총회전자자료실의 낱개 PDF)

제104~110회는 총회전자자료실(gapck.org)에 보고서가 낱개 PDF 로 있어 `reports.json` 의 주소(`u`)로 받아 바꿨습니다.

```bash
python tools/assembly-report/fetch_gapck.py "%TEMP%\gapck-pdf" 110 109
```

받은 PDF 는 적은 폴더에 두고(저장소 밖), 글만 `report-<회기>.json` 에 넣습니다. 제103회는 자료실에 PDF 주소가 없어 본문이 없습니다.

## 화면·색인 규칙

- 본문 주소: `assembly-report.html#s<회기>-r<번호>` — AI 검색의 근거 링크가 이 주소로 본문을 엽니다.
- 색인 조각: `src = '총회 보고서 > 제<회기>회'`, 인용 제목 `제<회기>회 총회 보고서 「<보고서 이름>」`. 검색 창구의 `scope: reports`, `session: <회기>` 로 좁힐 수 있습니다.
- 표·그림은 글자로만 남으므로, 본문 화면에는 「원본 PDF」 링크(있을 때)와 안내를 함께 보입니다.

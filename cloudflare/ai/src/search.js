/* 총회 자료 색인 검색 (낱말 찾기 방식)
 *
 * 홈페이지의 data/ai/index.json(총회 헌법·규정·회의결의·보고서 목록, 조문·항목 단위 조각)을
 * 받아 두었다가, 질문의 낱말이 많이 들어 있는 조각을 BM25 식으로 골라 준다.
 *
 * 색인을 미리 낱말표로 만들어 두지 않고 조각 본문에서 낱말을 그때그때 센다.
 * 조각이 3천 개 남짓이라 한 번 찾는 데 수십 ms 면 되고, 메모리도 본문 크기만 쓴다.
 * (낱말표를 다 펼쳐 두면 워커의 메모리 한도를 넘보게 된다)
 *
 * Node 에서도 그대로 돌릴 수 있어 시험하기 쉽다.
 */

/* 조사(토씨)와 물음말은 떼어 낸다 */
const PARTICLES = ['으로부터', '에서는', '에게는', '으로는', '으로서', '으로써', '이라는', '라는',
  '에서', '에게', '으로', '로서', '로써', '까지', '부터', '처럼', '마다', '조차', '마저', '보다',
  '이란', '이든', '이나', '하고', '과는', '와는', '은', '는', '이', '가', '을', '를', '의', '에',
  '와', '과', '도', '로', '만', '요', '께'];
const STOP = new Set(('어떻게 무엇 무엇을 무엇인가 언제 어디 어디서 누구 누가 왜 얼마 얼마나 몇 ' +
  '입니까 입니다 인가요 하나요 할까요 되나요 됩니까 있나요 있습니까 해야 하는지 되는지 되는 하는 ' +
  '알려줘 알려주세요 설명 설명해 정리 정리해 무슨 어떤 관련 대하여 대한 관하여 관한 대해 대해서 ' +
  '그리고 그러나 하지만 또는 및 등의 등을 것은 것이 있는 없는 이란 라는 내용 경우 사항 규정 ' +
  '총회 헌법 조문 조항 결의 보고 보고서 회의 자료 찾아 찾아줘 알려 주세요 주십시오 뭐야 뭔가요').split(/\s+/));

function stripParticle(w) {
  for (const p of PARTICLES) {
    if (w.length > p.length + 1 && w.endsWith(p)) return w.slice(0, -p.length);
  }
  return w;
}

/* 질문 → 찾을 낱말들. 같은 낱말은 한 번만. */
export function terms(q) {
  const out = [];
  const seen = new Set();
  const norm = String(q || '').toLowerCase().replace(/[^0-9a-z가-힣]+/g, ' ');
  for (const raw of norm.split(/\s+/)) {
    if (!raw || STOP.has(raw)) continue;
    let w = stripParticle(raw);
    if (STOP.has(w)) continue;
    if (w.length < 2 && !/^\d+$/.test(w)) continue;
    if (!seen.has(w)) { seen.add(w); out.push(w); }
    /* "권징조례제35조" 처럼 붙여 쓴 조문 번호는 따로 떼어 낸다 */
    const m = w.match(/^(.*?)(제?\d+조)$/);
    if (m && m[1] && m[1].length >= 2 && !seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
    if (m && !seen.has(m[2])) { seen.add(m[2]); out.push(m[2]); }
  }
  return out;
}

function count(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

/* 조각 본문·제목을 소문자로 — 색인이 커져서(총회 보고서 본문 포함 약 20MB) 소문자 사본을 들고 있지 않고
 * 찾을 때마다 바꾼다 (한글은 그대로이고 영문 머리글자만 바뀌므로 비용이 작다) */
function low(s) { return (s || '').toLowerCase(); }

export class Index {
  constructor(chunks) {
    this.chunks = chunks || [];
    this.docs = this.chunks.map(function (c) {
      return { c: c, len: (c.text || '').length };
    });
    this.N = this.docs.length;
    this.avg = this.docs.reduce(function (a, d) { return a + d.len; }, 0) / Math.max(1, this.N);
    this.dfCache = new Map();
  }

  df(t) {
    if (this.dfCache.has(t)) return this.dfCache.get(t);
    let n = 0;
    for (const d of this.docs) if (low(d.c.text).indexOf(t) !== -1 || low(d.c.title).indexOf(t) !== -1) n++;
    this.dfCache.set(t, n);
    return n;
  }

  /* opts: { scope: 'constitution'|'rules'|'resolutions'|'reports'|'all', session: 110, k: 8 } */
  search(query, opts) {
    opts = opts || {};
    const k = Math.min(20, Math.max(1, opts.k || 8));
    let qt = terms(query);
    if (!qt.length) return [];
    /* 어디에나 나오는 흔한 낱말은 걸러 낸다 (쓸 만한 낱말이 둘 이상 남을 때만) */
    const common = this.N * 0.15;
    const useful = qt.filter(t => this.df(t) <= common);
    if (useful.length >= 2) qt = useful;

    const srcPrefix = {
      constitution: '총회 헌법', rules: '총회 규정', resolutions: '총회 회의결의', reports: '총회 보고서'
    }[opts.scope || 'all'] || '';
    const sessTag = opts.session ? ('제' + opts.session + '회 총회') : '';

    const k1 = 1.4, b = 0.72;
    const scored = [];
    for (const d of this.docs) {
      if (srcPrefix && d.c.src.indexOf(srcPrefix) !== 0) continue;
      if (sessTag && d.c.title.indexOf(sessTag) !== 0) continue;
      const text = low(d.c.text), title = low(d.c.title);
      let score = 0, hit = 0;
      for (const t of qt) {
        const f = count(text, t);
        const ft = count(title, t);
        if (!f && !ft) continue;
        hit++;
        const df = this.df(t) || 1;
        const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
        const tf = f + ft * 3;
        score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * d.len / this.avg));
      }
      if (!score) continue;
      score *= 1 + 0.4 * Math.log(1 + hit);
      scored.push({ d: d, score: score, hit: hit });
    }
    scored.sort((x, y) => y.score - x.score);
    /* 같은 자료에서 너무 많이 뽑히지 않게 */
    const out = [], seen = {};
    for (const x of scored) {
      const key = x.d.c.src + '|' + x.d.c.label;
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 2) continue;
      out.push(Object.assign({ score: Math.round(x.score * 100) / 100 }, x.d.c));
      if (out.length >= k) break;
    }
    return out;
  }

  /* 조문 바로 찾기: book 은 '권징조례' '정치' '예배모범' '헌법적 규칙' 등, article 은 숫자 */
  article(book, article, chapter) {
    const no = parseInt(article, 10);
    if (!book || !no) return [];
    const re = new RegExp('제\\s*' + no + '\\s*조(?!\\d)');
    const bk = String(book).replace(/\s+/g, '');
    const out = [];
    for (const d of this.docs) {
      const src = d.c.src.replace(/\s+/g, '');
      if (src.indexOf('총회헌법>' + bk) !== 0 && src.indexOf('총회규정>' + bk) !== 0 &&
          d.c.label.replace(/\s+/g, '').indexOf(bk) !== 0) continue;
      if (!re.test(d.c.label)) continue;
      if (chapter && d.c.label.indexOf(String(chapter)) === -1 && d.c.text.indexOf(String(chapter)) === -1) continue;
      out.push(d.c);
      if (out.length >= 6) break;
    }
    return out;
  }
}

/* 본문에서 낱말 주변을 잘라 보여 준다 (DB 자료에 쓴다) */
export function snippets(text, words, width, max) {
  text = String(text || '');
  width = width || 160; max = max || 3;
  const low = text.toLowerCase();
  const spots = [];
  for (const w of words || []) {
    let i = 0;
    while ((i = low.indexOf(w.toLowerCase(), i)) !== -1 && spots.length < 12) { spots.push(i); i += w.length; }
  }
  if (!spots.length) return text.slice(0, width * 2) + (text.length > width * 2 ? ' …' : '');
  spots.sort((a, b) => a - b);
  const out = [];
  let last = -1;
  for (const s of spots) {
    if (s < last) continue;
    const a = Math.max(0, s - width / 2), e = Math.min(text.length, s + width);
    out.push((a > 0 ? '…' : '') + text.slice(a, e) + (e < text.length ? '…' : ''));
    last = e;
    if (out.length >= max) break;
  }
  return out.join(' ');
}

/* HTML → 글 */
export function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d|section|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t\r]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

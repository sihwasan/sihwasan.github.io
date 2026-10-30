/* AI 검색이 쓰는 도구들
 *
 * Claude 는 질문을 받으면 아래 도구를 골라 부른다. 도구는 두 갈래다.
 *   · 총회 자료(헌법·규정·회의결의·보고서) — 홈페이지에 미리 만들어 둔 색인(search.js)
 *   · 노회 자료(회원·교회·조직·일정·공지·회칙·회의록·시찰·상비부) — Supabase 에서 그때그때
 *     읽는다. 읽을 때 질문한 분의 로그인 증표를 그대로 쓰므로, 그분이 홈페이지에서 볼 수
 *     있는 것만 읽힌다(열람 규칙이 서버에서 그대로 적용된다). 그래서 등급에 따라 답이 달라진다.
 *
 * 도구가 돌려주는 자료마다 근거 번호(R1, R2 …)와 홈페이지 주소를 붙인다.
 * Claude 는 답에서 [R3] 처럼 적고, 홈페이지는 그것을 눌러 볼 수 있는 링크로 바꾼다.
 *
 * 「확인된 답」(127 sql 의 ai_verified) — 관리자가 확인해 승인한 답. 질문한 분의 증표로 읽으므로
 * 그분 등급에 맞는 것만 읽힌다. search_verified_answers 로 찾고, search_assembly 결과 맨 앞에도
 * 맞는 것이 있으면 verified 로 먼저 붙인다. Claude 는 이것을 우선 쓰되 원문 조문으로 다시 확인한다.
 */
import { snippets, stripHtml, terms } from './search.js';

/* ---------- Supabase 읽기 (질문한 분의 증표 그대로) ---------- */
async function sbGet(env, auth, path) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY }
  });
  if (!r.ok) {
    const t = await r.text().catch(function () { return ''; });
    return { error: 'HTTP ' + r.status + ' ' + t.slice(0, 200) };
  }
  return r.json().catch(function () { return { error: '응답을 읽지 못했습니다.' }; });
}
async function sbRpc(env, auth, fn, args) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST', body: JSON.stringify(args || {}),
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }
  });
  if (!r.ok) return { error: 'HTTP ' + r.status };
  return r.json().catch(function () { return { error: '응답을 읽지 못했습니다.' }; });
}

/* PostgREST 조건에 넣을 낱말: 쉼표·괄호·따옴표·별표는 뺀다 */
function clean(s) { return String(s || '').replace(/[,()*"'\\]/g, ' ').replace(/\s+/g, ' ').trim(); }
function words(s) { return clean(s).split(' ').filter(function (w) { return w.length >= 1; }).slice(0, 5); }
/* 여러 낱말이 모두 들어 있는 줄: and=(or(a.ilike.*w1*,b.ilike.*w1*),or(...w2...)) */
function allWords(cols, ws) {
  if (!ws.length) return '';
  return 'and=(' + ws.map(function (w) {
    const v = encodeURIComponent('*' + w + '*');
    return 'or(' + cols.map(function (c) { return c + '.ilike.' + v; }).join(',') + ')';
  }).join(',') + ')';
}
function anyWord(cols, ws) {
  if (!ws.length) return '';
  const parts = [];
  ws.forEach(function (w) {
    const v = encodeURIComponent('*' + w + '*');
    cols.forEach(function (c) { parts.push(c + '.ilike.' + v); });
  });
  return 'or=(' + parts.join(',') + ')';
}
function enc(s) { return encodeURIComponent(String(s || '')); }
function today() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function addYears(d, n) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return (parseInt(m[1], 10) + n) + '-' + m[2] + '-' + m[3];
}
/* 정년일 = 생일 + 71년 − 1일 (91 sql 의 retire_date 와 같다) */
function retireDate(birth) {
  const m = String(birth || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(parseInt(m[1], 10) + 71, parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/* ---------- 근거 번호 ---------- */
export class Cites {
  constructor() { this.list = []; this.byKey = new Map(); }
  add(x) {
    const key = (x.url || '') + '|' + (x.title || '');
    if (this.byKey.has(key)) return this.byKey.get(key);
    const ref = 'R' + (this.list.length + 1);
    const row = { ref: ref, title: x.title || '', url: x.url || '', kind: x.kind || '', snippet: String(x.snippet || '').slice(0, 1200) };
    this.list.push(row);
    this.byKey.set(key, ref);
    return ref;
  }
}

/* ---------- 도구 정의 (Claude 에게 보여 주는 설명) ---------- */
const S = function (props, required) { return { type: 'object', properties: props, required: required || [], additionalProperties: false }; };

export const TOOL_DEFS = {
  search_verified_answers: {
    description: '관리자가 원문을 확인해 승인한 「확인된 답」에서 질문과 맞는 것을 찾는다. 예전에 잘못 답했거나 답하지 못한 질문을 관리자가 바로잡아 둔 것이다. 처음 자료를 찾을 때 다른 검색과 함께 부른다. 찾은 답은 우선 근거로 쓰되, 그 답이 기대는 원문(조문·결의·규칙)을 다른 도구로 다시 찾아 확인한다.',
    input_schema: S({
      query: { type: 'string', description: '질문 또는 핵심 낱말 (예: "해벌 절차")' }
    }, ['query'])
  },
  search_assembly: {
    description: '총회(대한예수교장로회 합동) 자료를 낱말로 찾는다: 헌법(정치·권징조례·예배모범·신조·요리문답 등), 총회 규정, 역대 총회 회의결의(제1~110회), 총회 보고서 본문(제104~111회 — 총회임원회·상비부·위원회·기관·노회 상황 보고 등). 질문의 핵심 낱말 2~4개로 묻는다. 결과가 엉뚱하면 scope 를 좁히거나 다른 낱말로 다시 찾는다.',
    input_schema: S({
      query: { type: 'string', description: '찾을 낱말들 (예: "면직 해벌 절차")' },
      scope: { type: 'string', enum: ['all', 'constitution', 'rules', 'resolutions', 'reports'], description: '찾을 범위. constitution=헌법, rules=총회 규정, resolutions=총회 회의결의, reports=총회 보고서 본문' },
      session: { type: 'integer', description: '총회 회기 번호 (회의결의를 특정 회기에서만 찾을 때)' },
      k: { type: 'integer', description: '가져올 조각 수 (기본 8, 최대 15)' }
    }, ['query'])
  },
  get_assembly_article: {
    description: '총회 헌법·규정의 조문을 번호로 바로 가져온다. 권징조례·예배모범·헌법적 규칙은 조문 번호가 책 전체에 이어지고, 정치는 장마다 제1조부터 다시 시작하므로 chapter 를 함께 준다.',
    input_schema: S({
      book: { type: 'string', description: '책 이름: 권징조례, 정치, 예배모범, 헌법적 규칙, 총회선거규정 등' },
      article: { type: 'integer', description: '조 번호' },
      chapter: { type: 'string', description: '장 (정치일 때, 예: "제10장")' }
    }, ['book', 'article'])
  },
  search_presbytery_rules: {
    description: '시화산노회 규칙(노회규칙·미래교회자립위원회 내규·선거관리위원회 내규·사회복지부 내규)의 조문을 찾는다. 낱말로 찾거나 조 번호로 바로 가져온다.',
    input_schema: S({
      query: { type: 'string', description: '찾을 낱말들' },
      article: { type: 'integer', description: '조 번호 (노회규칙 제N조)' },
      doc: { type: 'string', description: '문서: 노회규칙 | 미래교회자립위원회 내규 | 선거관리위원회 내규 | 사회복지부 내규' }
    })
  },
  get_organization: {
    description: '시화산노회의 현 조직을 통째로 가져온다: 임원(노회장·부노회장·서기·회록서기·회계 등), 총회 총대, 증경노회장, 상비부(부장·서기·회계·1~3년조), 시찰회(시찰장·서기·회계·소속 교회), 각종 이사. 임원이 누구인지, 어느 부서에 누가 있는지 물으면 이것을 쓴다.',
    input_schema: S({})
  },
  search_members: {
    description: '노회 회원 명단(목사·장로 총대 등)에서 사람을 찾는다. 이름·교회·직분·시찰·직책으로 찾을 수 있다. 소속 교회, 직분(위임목사·부목사·장로 등), 임원 직책, 시찰, 위임일·안수일·시무 기간 등을 돌려준다. 관리자에게는 정년일도 함께 준다. 연락처(전화·주소)는 질문한 분이 명시적으로 물을 때만 답에 쓴다.',
    input_schema: S({
      name: { type: 'string', description: '이름 (일부만 적어도 된다)' },
      church: { type: 'string', description: '교회 이름' },
      keyword: { type: 'string', description: '그 밖의 낱말 (직분·시찰·직책 등)' }
    })
  },
  search_churches: {
    description: '노회 소속 교회를 찾는다 (교회 이름·시찰·담임목사·주소·전화·시무 장로·노회 가입일).',
    input_schema: S({
      name: { type: 'string', description: '교회 이름 (일부만 적어도 된다)' },
      sichal: { type: 'string', description: '시찰 이름 (북부시찰·남부시찰·상록시찰)' },
      keyword: { type: 'string', description: '담임목사 이름·지역 등' }
    })
  },
  search_schedule: {
    description: '노회 일정(정기노회·임원회의·임직식·수양회·총회 등)과 정기노회 날짜·장소를 찾는다. 기간을 비우면 오늘부터 앞으로 1년이다.',
    input_schema: S({
      from: { type: 'string', description: '시작 날짜 YYYY-MM-DD' },
      to: { type: 'string', description: '끝 날짜 YYYY-MM-DD' },
      keyword: { type: 'string', description: '행사 이름·종류' }
    })
  },
  search_notices: {
    description: '홈페이지 공지사항(공지·안내·소식)을 찾는다. 비우면 최근 공지 10건.',
    input_schema: S({
      keyword: { type: 'string', description: '찾을 낱말' },
      limit: { type: 'integer', description: '가져올 수 (기본 10)' }
    })
  },
  search_presbytery_resolutions: {
    /* 회기별 회의결의서 책자 */
    description: '시화산노회 역대 정기노회·임시노회의 회의결의서(회기별 결의사항 책자: 임원·상비부 조직, 청빙·위임·허락·헌의안 처리 결의)를 낱말이나 회기 번호로 찾는다. "○○교회 청빙 결의", "제19회 결의사항" 같은 질문에 쓴다.',
    input_schema: S({
      keyword: { type: 'string', description: '찾을 낱말' },
      session: { type: 'string', description: '회기 (예: 제19회)' }
    })
  },
  search_minutes: {
    description: '노회 회의록 본문에서 낱말을 찾아 그 대목을 돌려준다 (임원만 열람). 어느 회의에서 무엇을 결의했는지, 누가 어떤 청원을 했는지 등.',
    input_schema: S({
      keyword: { type: 'string', description: '찾을 낱말 (2~3개까지)' },
      year: { type: 'integer', description: '연도' }
    }, ['keyword'])
  },
  search_officer_docs: {
    description: '임원 자료실 문서(임원만 열람)에서 찾는다.',
    input_schema: S({ keyword: { type: 'string', description: '찾을 낱말' } }, ['keyword'])
  },
  search_sichal: {
    description: '시찰 방의 자료실·게시판·청원서(질문한 분이 볼 수 있는 시찰만)에서 찾는다.',
    input_schema: S({
      keyword: { type: 'string', description: '찾을 낱말' },
      sichal: { type: 'string', description: '시찰 이름' }
    }, ['keyword'])
  },
  search_presbytery_reports: {
    description: '시화산노회 정기노회 회의자료 책자(노회 보고서)의 본문을 낱말로 찾는다: 서기 사무보고, 각 상비부·시찰 보고, 임원회 보고, 회원 명단, 역대 임원, 교회 주소록, 회의순서 등. 어느 회기 책자 몇 쪽에 무엇이 적혀 있는지 돌려준다.',
    input_schema: S({
      keyword: { type: 'string', description: '찾을 낱말 (2~3개까지)' },
      session: { type: 'integer', description: '회기 번호 (예: 20). 비우면 모든 책자' }
    }, ['keyword'])
  },
  search_directory: {
    description: '노회 주소록: 소속 교회의 주소·우편번호·홈페이지·이메일·교역자(담임·부목사)·시무장로·전화번호(교회/휴대폰/팩스), 원로목사 연락처, 장로회·남전도회·여전도회·주일학교 연합회 임원(직책·성명·교회·휴대폰). "○○교회 주소/전화", "○○교회 담임 누구", "○○ 장로 연락처", "장로회연합회 회장" 같은 질문에 쓴다. 회의자료 책자 주소록을 바탕으로 관리자가 유지한다.',
    input_schema: S({
      keyword: { type: 'string', description: '교회 이름, 사람 이름, 직책, 시찰 이름, 주소 일부, 전화번호 일부 (2~3개까지)' }
    }, ['keyword'])
  },
  search_dues: {
    description: '노회 상회비(교회가 노회에 다달이 내는 회비) 납부 현황: 교회별 월 상회비, 낸 달, 안 낸 달, 미납액, 회기 마감 여부. 회기는 4월에 시작해 이듬해 3월에 끝난다(year 2026 = 2026년 4월 ~ 2027년 3월). year 를 비우면 이번 회기. "미납 교회", "○○교회 상회비 냈나", "상회비 얼마 걷혔나" 같은 질문에 쓴다. 세례의무금(총회에 내는 세례교인헌금) 현황도 함께 돌려준다.',
    input_schema: S({
      year: { type: 'integer', description: '회기 시작 연도 (비우면 이번 회기)' },
      church: { type: 'string', description: '교회 이름 (일부만 적어도 된다)' },
      only_unpaid: { type: 'boolean', description: 'true 면 미납이 있는 교회만' }
    })
  },
  get_retreat: {
    description: '노회 수양회(예: 2026 제주 부부수양회) 안내를 수양회 화면(retreat.html)과 같은 자료에서 가져온다: 날짜별 일정(시각·장소·식당과 메뉴·가격·이동), ' +
      '날짜별 안내 멘트(장소 설명·버스 안내), 카페 주문 단계의 메뉴, 질문한 분과 배우자의 좌석·숙소·회비·고른 메뉴, 개회 예배 순서와 기도 순서, 항공·숙소. ' +
      '"내일 일정", "점심 식당·메뉴", "카페 메뉴", "내 좌석·방", "예배 순서" 같은 질문에 쓴다. day 를 주면 그날만 가져온다.',
    input_schema: S({
      day: { type: 'integer', description: '몇 일차인가 (1·2·3). 날짜로 물으면 결과의 days[].date 와 맞춰 고른다. 비우면 모든 날' },
      part: { type: 'string', enum: ['all', 'schedule', 'cafe', 'me', 'worship'], description: '필요한 부분만 (기본 all)' }
    })
  },
  search_committee: {
    description: '상비부(감사헌의부·정치부·고시규칙부·재정부·교육친교부·전도선교부·사회복지부·미래교회자립위원회)의 일정·공지 기록을 찾는다. 부서 조직(부장·서기·부원)은 get_organization 에 있다.',
    input_schema: S({
      committee: { type: 'string', description: '부서 이름' },
      keyword: { type: 'string', description: '찾을 낱말' }
    })
  }
};

/* 등급별로 보여 줄 도구 */
export function toolsFor(role) {
  const officer = ['superadmin', 'president', 'clerk', 'staff', 'officer'].indexOf(role) !== -1;
  const names = ['search_verified_answers', 'search_assembly', 'get_assembly_article', 'search_presbytery_rules', 'get_organization',
    'search_members', 'search_churches', 'search_schedule', 'search_notices', 'search_presbytery_resolutions',
    'search_sichal', 'search_committee', 'search_presbytery_reports', 'search_directory', 'get_retreat'];
  if (officer) names.push('search_minutes', 'search_officer_docs', 'search_dues');
  return names.map(function (n) {
    return { name: n, description: TOOL_DEFS[n].description, input_schema: TOOL_DEFS[n].input_schema };
  });
}

/* 화면에 보여 줄 "찾는 중…" 글 */
export const TOOL_STATUS = {
  search_verified_answers: '확인된 답을 찾는 중',
  search_assembly: '총회 자료를 찾는 중',
  get_assembly_article: '헌법 조문을 가져오는 중',
  search_presbytery_rules: '노회규칙을 찾는 중',
  get_organization: '노회 조직을 확인하는 중',
  search_members: '회원 명단을 찾는 중',
  search_churches: '회원 교회를 찾는 중',
  search_schedule: '노회 일정을 확인하는 중',
  search_notices: '공지사항을 찾는 중',
  search_presbytery_resolutions: '노회 결의사항을 찾는 중',
  search_minutes: '회의록을 찾는 중',
  search_officer_docs: '임원 자료실을 찾는 중',
  search_sichal: '시찰 자료를 찾는 중',
  search_committee: '상비부 기록을 찾는 중',
  search_dues: '상회비 납부 현황을 확인하는 중',
  search_presbytery_reports: '노회 회의자료 책자를 찾는 중',
  search_directory: '노회 주소록을 찾는 중',
  get_retreat: '수양회 안내를 확인하는 중'
};

/* ---------- 도구 실행 ---------- */
/* ctx: { env, auth, index(Index), cites(Cites), me:{role,...} } */
export async function runTool(name, input, ctx) {
  input = input || {};
  try {
    const fn = RUN[name];
    if (!fn) return { error: '없는 도구입니다: ' + name };
    const out = await fn(input, ctx);
    return out;
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
}

/* ---------- 확인된 답 (관리자 승인) ---------- */
export const VERIFIED_KIND = '확인된 답(관리자 승인)';
const LEVEL_NAME = { member: '정회원 이상', officer: '임원 이상', admin: '관리자만' };

/* 질문한 분이 읽을 수 있는 확인된 답 전부 (한 질문에 한 번만 받는다). 표가 아직 없으면 빈 목록. */
export function loadVerified(ctx) {
  if (!ctx.verifiedP) {
    ctx.verifiedP = sbGet(ctx.env, ctx.auth,
      'ai_verified?select=id,question,keywords,answer,sources,level,updated_at&active=eq.true&order=updated_at.desc&limit=500')
      .then(function (r) { return Array.isArray(r) ? r : []; }, function () { return []; });
  }
  return ctx.verifiedP;
}

/* 질문 낱말이 확인된 답의 질문·찾는 말에 얼마나 들어 있는가로 고른다 (띄어쓰기는 무시).
 * 답 본문에만 있는 낱말은 조금만 친다. 질문 쪽에 절반 이상 들어 있어야 맞는 것으로 본다. */
export function matchVerified(list, query, k) {
  const qt = terms(query);
  if (!qt.length) return [];
  const squash = function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); };
  const out = [];
  (list || []).forEach(function (v) {
    const head = squash(v.question + ' ' + (v.keywords || ''));
    const body = squash(v.answer);
    let inHead = 0, inBody = 0;
    qt.forEach(function (t) {
      if (head.indexOf(t) !== -1) inHead++;
      else if (body.indexOf(t) !== -1) inBody++;
    });
    const headCover = inHead / qt.length;
    const cover = (inHead + inBody) / qt.length;
    if (headCover < 0.5 && !(inHead >= 1 && cover >= 0.75)) return;
    out.push({ v: v, score: Math.round((headCover + 0.3 * (cover - headCover)) * 100) / 100 });
  });
  out.sort(function (a, b) { return b.score - a.score || String(b.v.updated_at).localeCompare(String(a.v.updated_at)); });
  return out.slice(0, k || 3);
}

function verifiedItems(ctx, hits) {
  return hits.map(function (h) {
    const v = h.v;
    const srcs = (Array.isArray(v.sources) ? v.sources : []).map(function (s) { return s && s.title; }).filter(Boolean).slice(0, 12);
    const ref = ctx.cites.add({ title: '확인된 답: ' + v.question, url: '', kind: VERIFIED_KIND,
      snippet: 'Q. ' + v.question + '\n' + v.answer + (srcs.length ? '\n\n원문 근거: ' + srcs.join(', ') : '') });
    ctx.verifiedShown = ctx.verifiedShown || {};
    ctx.verifiedShown[v.id] = true;
    return { ref: ref, kind: VERIFIED_KIND, question: v.question, answer: v.answer, original_sources: srcs,
      level: LEVEL_NAME[v.level] || v.level, approved: String(v.updated_at || '').slice(0, 10), match: h.score };
  });
}

const RUN = {
  async search_verified_answers(input, ctx) {
    const list = await loadVerified(ctx);
    if (!list.length) return { items: [], note: '확인된 답이 아직 없습니다. 다른 도구로 찾으십시오.' };
    const hits = matchVerified(list, input.query || '', 3);
    if (!hits.length) return { items: [], note: '이 질문과 맞는 확인된 답이 없습니다. 다른 도구로 찾으십시오.' };
    return { items: verifiedItems(ctx, hits),
      note: '관리자가 확인한 답입니다. 질문과 맞으면 우선 근거로 쓰고 답 첫 문장에 이 ref 를 다십시오. 그리고 original_sources 의 원문을 해당 도구로 다시 찾아 확인해 원문 근거 번호도 함께 다십시오. 원문과 다르면 원문을 따르십시오.' };
  },
  async search_assembly(input, ctx) {
    const rows = ctx.index.search(input.query, { scope: input.scope || 'all', session: input.session, k: Math.min(15, input.k || 8) });
    /* 맞는 확인된 답이 있으면(이번 질문에서 아직 보여 주지 않은 것) 결과 맨 앞에 먼저 붙인다 */
    const out = {};
    const vlist = await loadVerified(ctx);
    const vhits = matchVerified(vlist, input.query || '', 2).filter(function (h) { return !(ctx.verifiedShown && ctx.verifiedShown[h.v.id]); });
    if (vhits.length) {
      out.verified = verifiedItems(ctx, vhits);
      out.verified_note = '확인된 답(관리자 승인)이 먼저입니다. 질문과 맞으면 우선 쓰되 아래 items 의 원문으로 다시 확인하십시오.';
    }
    if (!rows.length) return Object.assign(out, { items: [], note: '찾은 자료가 없습니다. 다른 낱말이나 범위로 다시 찾아 보십시오.' });
    out.items = rows.map(function (c) {
      const ref = ctx.cites.add({ title: c.label, url: c.url, kind: c.src, snippet: c.text });
      return { ref: ref, source: c.src, title: c.label, text: c.text };
    });
    return out;
  },
  async get_assembly_article(input, ctx) {
    const rows = ctx.index.article(input.book, input.article, input.chapter);
    if (!rows.length) return { items: [], note: '그 조문을 찾지 못했습니다. 책 이름(권징조례·정치·예배모범 등)과 조 번호를 확인하거나 search_assembly 로 찾아 보십시오.' };
    return { items: rows.map(function (c) {
      const ref = ctx.cites.add({ title: c.label, url: c.url, kind: c.src, snippet: c.text });
      return { ref: ref, source: c.src, title: c.label, text: c.text };
    }) };
  },
  async search_presbytery_rules(input, ctx) {
    const [docs, arts] = await Promise.all([
      sbGet(ctx.env, ctx.auth, 'rule_docs?select=key,name,intro,revisions&book=eq.presbytery&order=sort'),
      sbGet(ctx.env, ctx.auth, 'rule_articles?select=doc_key,chapter,title,body,sort&book=eq.presbytery&order=sort')
    ]);
    if (docs.error || arts.error) return { error: docs.error || arts.error };
    const nameOf = {};
    docs.forEach(function (d) { nameOf[d.key] = d.name; });
    let list = arts;
    if (input.doc) {
      const dk = docs.filter(function (d) { return d.name.indexOf(input.doc) !== -1 || input.doc.indexOf(d.name) !== -1; }).map(function (d) { return d.key; });
      if (dk.length) list = list.filter(function (a) { return dk.indexOf(a.doc_key) !== -1; });
    }
    const no = parseInt(input.article, 10);
    if (no) {
      const re = new RegExp('제\\s*' + no + '\\s*조(?!\\d)');
      list = list.filter(function (a) { return re.test(a.title || ''); });
    }
    const ws = words(input.query || '');
    if (ws.length && !no) {
      list = list.map(function (a) {
        const hay = ((a.chapter || '') + ' ' + (a.title || '') + ' ' + (a.body || '')).toLowerCase();
        let sc = 0;
        ws.forEach(function (w) { const lw = w.toLowerCase(); if (hay.indexOf(lw) !== -1) sc += (a.title || '').toLowerCase().indexOf(lw) !== -1 ? 3 : 1; });
        return { a: a, sc: sc };
      }).filter(function (x) { return x.sc > 0; }).sort(function (x, y) { return y.sc - x.sc; }).slice(0, 8).map(function (x) { return x.a; });
    } else {
      list = list.slice(0, 8);
    }
    if (!list.length) return { items: [], note: '해당 조문을 찾지 못했습니다.' };
    return { items: list.map(function (a) {
      const m = String(a.title || '').match(/제\s*(\d+)\s*조/);
      const url = 'rules-presbytery.html#' + a.doc_key + (m ? '-a' + m[1] : '');
      const label = (nameOf[a.doc_key] || '노회규칙') + ' ' + (a.title || a.chapter || '');
      const text = (a.chapter ? a.chapter + '\n' : '') + (a.title ? a.title + '\n' : '') + (a.body || '');
      const ref = ctx.cites.add({ title: label, url: url, kind: '시화산노회 규칙', snippet: text });
      return { ref: ref, title: label, text: text };
    }), revisions: (docs[0] && docs[0].revisions) || '' };
  },
  async get_organization(input, ctx) {
    const [st, coms, sichals, boards, dels] = await Promise.all([
      sbGet(ctx.env, ctx.auth, 'site_settings?select=key,value&key=in.(officers,delegates,veterans,history_officers,sessions)'),
      sbGet(ctx.env, ctx.auth, 'committees?select=name,duty,head,clerk,treasurer,y1,y2,y3,members&order=sort'),
      sbGet(ctx.env, ctx.auth, 'sichals?select=name,area,head,clerk,treasurer,churches&order=sort'),
      sbGet(ctx.env, ctx.auth, 'board_members?select=kind,name,position,church,title&active=eq.true&order=sort'),
      sbGet(ctx.env, ctx.auth, 'delegates?select=kind,name,church,title&active=eq.true&order=sort')
    ]);
    const out = {};
    const set = {};
    (st.error ? [] : st).forEach(function (r) { set[r.key] = r.value; });
    out.session = set.sessions && set.sessions.current ? set.sessions.current : undefined;
    out.officers = set.officers || [];
    out.delegates = (!dels.error && dels.length) ? dels : (set.delegates || []);
    out.veterans = set.veterans || [];
    out.committees = coms.error ? [] : coms;
    out.sichals = sichals.error ? [] : sichals;
    out.boards = boards.error ? [] : boards;
    out.note = '노회 임원은 해마다 봄 정기노회에서 뽑아 1년을 섬긴다. 가을 정기노회(회기 번호가 하나 오른다)에서는 임원을 새로 뽑지 않으므로 봄에 뽑힌 임원이 가을 회기에도 그대로 임원이다.';
    /* 사람 한 줄: 이름 직분 (교회) */
    function person(x) {
      if (!x) return '';
      if (typeof x === 'string') return x;
      return [x.name, x.position || x.title, x.church ? '(' + x.church + ')' : ''].filter(Boolean).join(' ');
    }
    const lines = [];
    lines.push('노회 임원' + (out.session ? ' (' + out.session + ')' : ''));
    out.officers.forEach(function (o) { lines.push((o.role || '') + ' ' + person(o)); });
    if (Array.isArray(out.delegates) && out.delegates.length) {
      lines.push('', '총회 총대');
      const byKind = {};
      out.delegates.forEach(function (d) { const k = d.kind || '총대'; (byKind[k] = byKind[k] || []).push(person(d)); });
      Object.keys(byKind).forEach(function (k) { lines.push(k + ': ' + byKind[k].join(', ')); });
    } else if (out.delegates && typeof out.delegates === 'object') {
      lines.push('', '총회 총대');
      Object.keys(out.delegates).forEach(function (k) {
        const v = out.delegates[k];
        lines.push(({ pastorMain: '목사 정총대', pastorSub: '목사 부총대', elderMain: '장로 정총대', elderSub: '장로 부총대' }[k] || k) + ': ' +
          (Array.isArray(v) ? v.map(person).join(', ') : person(v)));
      });
    }
    if (Array.isArray(out.veterans) && out.veterans.length) {
      lines.push('', '증경노회장: ' + out.veterans.map(person).join(', '));
    }
    if (out.boards.length) {
      lines.push('', '이사·실행위원');
      out.boards.forEach(function (b) { lines.push((b.kind || '') + ' ' + person(b)); });
    }
    const refO = ctx.cites.add({ title: '노회 임원·총대 (조직)', url: 'organization.html#officers', kind: '노회 조직',
      snippet: lines.join('\n').slice(0, 1500) });
    const refC = ctx.cites.add({ title: '상비부 조직', url: 'organization.html#committees', kind: '노회 조직',
      snippet: out.committees.map(function (c) { return c.name + ': 부장 ' + (c.head || '') + ' / 서기 ' + (c.clerk || '') + ' / 회계 ' + (c.treasurer || ''); }).join('\n') });
    const refS = ctx.cites.add({ title: '시찰회 조직', url: 'organization.html#sichal', kind: '노회 조직',
      snippet: out.sichals.map(function (s) { return s.name + ': 시찰장 ' + (s.head || '') + ' / 서기 ' + (s.clerk || '') + ' / 회계 ' + (s.treasurer || '') + ' / 교회 ' + (s.churches || ''); }).join('\n') });
    out.refs = { officers_delegates: refO, committees: refC, sichals: refS };
    return out;
  },
  async search_members(input, ctx) {
    const cols = 'id,name,church,position,role,officer_title,category,sichal,phone,email,address,served_from,ordained_on,ordained_by,licensed_on,call_on,call_until,call_acting,active,term_from,term_until';
    const q = [];
    if (input.name) q.push('name=ilike.' + enc('*' + clean(input.name) + '*'));
    if (input.church) q.push('church=ilike.' + enc('*' + clean(input.church) + '*'));
    const ws = words(input.keyword || '');
    if (ws.length) q.push(allWords(['name', 'church', 'position', 'officer_title', 'category', 'sichal'], ws));
    if (!q.length) return { error: '이름·교회·낱말 가운데 하나는 주어야 합니다.' };
    const rows = await sbGet(ctx.env, ctx.auth, 'roster?select=' + cols + '&' + q.join('&') + '&order=sort,id&limit=40');
    if (rows.error) return { error: rows.error };
    if (!rows.length) return { items: [], note: '명단에서 찾지 못했습니다. (질문한 분의 등급으로 볼 수 없는 명단이거나 이름이 다를 수 있습니다)' };
    let births = {};
    if (['superadmin', 'president', 'clerk', 'staff'].indexOf(ctx.me.role) !== -1) {
      const b = await sbRpc(ctx.env, ctx.auth, 'roster_births');
      if (!b.error) b.forEach(function (x) { births[x.id] = x.birth_date; });
    }
    const items = rows.map(function (r) {
      const o = { name: r.name, church: r.church, position: r.position, grade: r.role, officer_title: r.officer_title || undefined,
        category: r.category || undefined, sichal: r.sichal || undefined, active: r.active,
        served_from: r.served_from || undefined, ordained_on: r.ordained_on || undefined, licensed_on: r.licensed_on || undefined,
        call_on: r.call_on || undefined, call_until: r.call_until || undefined, call_acting: r.call_acting || undefined,
        term_from: r.term_from || undefined, term_until: r.term_until || undefined,
        phone: r.phone || undefined, email: r.email || undefined, address: r.address || undefined };
      if (births[r.id]) { o.birth_date = births[r.id]; o.retire_date = retireDate(births[r.id]); }
      return o;
    });
    const ref = ctx.cites.add({ title: '회원 명단 (' + items.map(function (i) { return i.name; }).slice(0, 5).join('·') + (items.length > 5 ? ' 외' : '') + ')',
      url: 'organization.html#members', kind: '노회 회원 명단',
      snippet: items.map(function (i) { return i.name + ' ' + (i.position || '') + ' (' + (i.church || '') + ')' + (i.officer_title ? ' ' + i.officer_title : ''); }).join('\n') });
    return { ref: ref, items: items, note: '연락처는 질문한 분이 물었을 때만 답에 적는다.' };
  },
  async search_churches(input, ctx) {
    const q = [];
    if (input.name) q.push('name=ilike.' + enc('*' + clean(input.name) + '*'));
    if (input.sichal) q.push('sichal=ilike.' + enc('*' + clean(input.sichal) + '*'));
    const ws = words(input.keyword || '');
    if (ws.length) q.push(allWords(['name', 'pastor', 'address', 'sichal', 'elders'], ws));
    const rows = await sbGet(ctx.env, ctx.auth, 'sichal_churches?select=sichal,name,pastor,url,address,phone,elders,joined_on,note&' + q.join('&') + '&order=sichal,sort&limit=60');
    if (rows.error) return { error: rows.error };
    if (!rows.length) return { items: [], note: '교회를 찾지 못했습니다.' };
    const ref = ctx.cites.add({ title: '회원 교회 (' + rows.map(function (r) { return r.name; }).slice(0, 4).join('·') + (rows.length > 4 ? ' 외' : '') + ')',
      url: 'organization.html#churches', kind: '회원 교회',
      snippet: rows.map(function (r) { return r.name + ' — ' + (r.sichal || '') + ' / 담임 ' + (r.pastor || '') + (r.address ? ' / ' + r.address : ''); }).join('\n') });
    return { ref: ref, items: rows };
  },
  async search_schedule(input, ctx) {
    const from = input.from || today();
    const to = input.to || addYears(from, 1);
    const q = ['event_date=gte.' + from, 'event_date=lte.' + to];
    const ws = words(input.keyword || '');
    if (ws.length) q.push(anyWord(['title', 'kind'], ws));
    const [rows, meets] = await Promise.all([
      sbGet(ctx.env, ctx.auth, 'site_schedule?select=id,title,kind,event_date,end_date,meta&' + q.join('&') + '&order=event_date&limit=40'),
      sbGet(ctx.env, ctx.auth, 'meetings?select=kind,year,meet_date,place,confirmed,note&order=meet_date.desc&limit=6')
    ]);
    if (rows.error) return { error: rows.error };
    const items = rows.map(function (r) {
      const m = r.meta || {};
      const ref = ctx.cites.add({ title: r.event_date + ' ' + r.title, url: 'dashboard.html', kind: '노회 일정',
        snippet: r.event_date + (r.end_date ? '~' + r.end_date : '') + ' ' + r.title + (m.loc ? ' / ' + m.loc : '') + (m.time ? ' / ' + m.time : '') });
      return { ref: ref, date: r.event_date, end_date: r.end_date || undefined, kind: r.kind, title: r.title,
        time: m.time || undefined, place: m.loc || m.place || undefined, person: m.person || undefined, church: m.church || undefined,
        note: m.note || m.info || undefined };
    });
    const out = { items: items, period: from + ' ~ ' + to };
    if (!meets.error && meets.length) {
      out.regular_meetings = meets.map(function (m) { return { kind: m.kind, year: m.year, date: m.meet_date, place: m.place, confirmed: m.confirmed }; });
    }
    if (!items.length) out.note = '그 기간에 등록된 일정이 없습니다.';
    return out;
  },
  async search_notices(input, ctx) {
    const ws = words(input.keyword || '');
    const lim = Math.min(20, input.limit || 10);
    const rows = await sbGet(ctx.env, ctx.auth, 'site_notices?select=id,cat,title,body,date&' + (ws.length ? allWords(['title', 'body'], ws) + '&' : '') + 'order=date.desc,id.desc&limit=' + lim);
    if (rows.error) return { error: rows.error };
    if (!rows.length) return { items: [], note: '공지를 찾지 못했습니다.' };
    return { items: rows.map(function (r) {
      const ref = ctx.cites.add({ title: '공지 ' + r.date + ' ' + r.title, url: 'board.html#notice', kind: '공지사항', snippet: r.body || r.title });
      return { ref: ref, date: r.date, cat: r.cat, title: r.title, body: String(r.body || '').slice(0, 600) };
    }) };
  },
  async search_presbytery_resolutions(input, ctx) {
    /* 결의는 회기별 「회의결의서」 책자(presbytery_reports.kind = 회의결의서)의 쪽에서 찾는다 */
    const ws = words(input.keyword || '');
    let q = 'presbytery_report_pages?select=id,report_id,pdf_page,page_no,heading,text,presbytery_reports!inner(title,session,meet_on,kind)&presbytery_reports.kind=in.(회의결의서,임원회 결의)&order=report_id.desc,page_no&limit=12';
    if (ws.length) q += '&' + allWords(['heading', 'text'], ws);
    if (input.session) q += '&presbytery_reports.session=eq.' + parseInt(String(input.session).replace(/\D/g, ''), 10);
    const rows = await sbGet(ctx.env, ctx.auth, q);
    if (rows.error) return { error: /HTTP 4/.test(rows.error) ? '노회 회의결의는 정회원만 볼 수 있습니다.' : rows.error };
    const list = rows.filter(function (r) { return r.presbytery_reports; });
    if (!list.length) return { items: [], note: '회의결의서에서 그 낱말을 찾지 못했습니다. 다른 낱말이나 회기 번호로 다시 찾아 보십시오.' };
    return { items: list.map(function (r) {
      const rep = r.presbytery_reports || {};
      const where = (rep.title || '회의결의서') + ' ' + (r.page_no != null ? r.page_no + '쪽' : 'PDF ' + r.pdf_page + '쪽') + (r.heading ? ' 「' + r.heading + '」' : '');
      const sn = ws.length ? snippets(r.text, ws, 300, 4) : String(r.text || '').slice(0, 600);
      const ref = ctx.cites.add({ title: where, url: 'resolutions.html?r=' + r.report_id + '&p=' + (r.page_no != null ? r.page_no : r.pdf_page) + (ws.length ? '&q=' + enc(ws[0]) : ''), kind: '노회 회의결의', snippet: sn });
      return { ref: ref, report: rep.title, session: rep.session, meet_on: rep.meet_on, page: r.page_no, heading: r.heading, text: sn };
    }) };
  },
  async search_minutes(input, ctx) {
    const ws = words(input.keyword || '');
    if (!ws.length) return { error: '찾을 낱말을 주어야 합니다.' };
    const q = [allWords(['title', 'body', 'html'], ws)];
    if (input.year) q.push('meeting_date=gte.' + input.year + '-01-01', 'meeting_date=lte.' + input.year + '-12-31');
    const rows = await sbGet(ctx.env, ctx.auth, 'minutes_board?select=id,title,meeting_date,body,html&' + q.join('&') + '&order=meeting_date.desc&limit=5');
    if (rows.error) return { error: rows.error.indexOf('HTTP 4') === 0 ? '회의록은 임원만 열람할 수 있습니다.' : rows.error };
    if (!rows.length) return { items: [], note: '회의록에서 그 낱말을 찾지 못했습니다. 다른 낱말로 다시 찾아 보십시오.' };
    return { items: rows.map(function (r) {
      const text = stripHtml(r.html || '') || String(r.body || '');
      const sn = snippets(text, ws, 320, 4);
      const ref = ctx.cites.add({ title: r.title, url: 'minutes.html?id=' + r.id + '&q=' + enc(ws[0]), kind: '노회 회의록', snippet: sn });
      return { ref: ref, title: r.title, meeting_date: r.meeting_date, text: sn };
    }) };
  },
  async search_officer_docs(input, ctx) {
    const ws = words(input.keyword || '');
    const rows = await sbGet(ctx.env, ctx.auth, 'officer_docs?select=id,level,category,title,body,doc_date,file_name&' + (ws.length ? allWords(['title', 'body', 'category'], ws) + '&' : '') + 'order=doc_date.desc,id.desc&limit=8');
    if (rows.error) return { error: rows.error };
    if (!rows.length) return { items: [], note: '임원 자료실에서 찾지 못했습니다.' };
    return { items: rows.map(function (r) {
      const text = ws.length ? snippets(r.body || '', ws, 260, 3) : String(r.body || '').slice(0, 500);
      const ref = ctx.cites.add({ title: '임원 자료실: ' + r.title, url: 'officer.html', kind: '임원 자료실', snippet: text });
      return { ref: ref, title: r.title, level: r.level, category: r.category, doc_date: r.doc_date, file: r.file_name || undefined, text: text };
    }) };
  },
  async search_sichal(input, ctx) {
    const ws = words(input.keyword || '');
    const sf = input.sichal ? '&sichal=ilike.' + enc('*' + clean(input.sichal) + '*') : '';
    const [docs, posts, pets] = await Promise.all([
      sbGet(ctx.env, ctx.auth, 'sichal_docs?select=id,sichal,title,description,body,doc_date,file_name,link_url&deleted_at=is.null' + sf + (ws.length ? '&' + allWords(['title', 'description', 'body'], ws) : '') + '&order=doc_date.desc,id.desc&limit=6'),
      sbGet(ctx.env, ctx.auth, 'sichal_posts?select=id,sichal,cat,title,body,created_at&deleted_at=is.null' + sf + (ws.length ? '&' + allWords(['title', 'body'], ws) : '') + '&order=created_at.desc&limit=6'),
      sbGet(ctx.env, ctx.auth, 'petition_submissions?select=id,sichal,form_title,title,status,user_name,created_at&deleted_at=is.null' + sf + (ws.length ? '&' + allWords(['title', 'form_title', 'user_name'], ws) : '') + '&order=created_at.desc&limit=6')
    ]);
    const items = [];
    (docs.error ? [] : docs).forEach(function (r) {
      const text = (r.description || '') + '\n' + (ws.length ? snippets(r.body || '', ws, 200, 2) : String(r.body || '').slice(0, 300));
      const ref = ctx.cites.add({ title: r.sichal + ' 자료: ' + r.title, url: 'sichal.html?s=' + enc(r.sichal) + '', kind: '시찰 자료실', snippet: text });
      items.push({ ref: ref, type: '자료', sichal: r.sichal, title: r.title, date: r.doc_date, text: text.trim(), file: r.file_name || r.link_url || undefined });
    });
    (posts.error ? [] : posts).forEach(function (r) {
      const text = ws.length ? snippets(r.body || '', ws, 200, 2) : String(r.body || '').slice(0, 300);
      const ref = ctx.cites.add({ title: r.sichal + ' 게시판: ' + r.title, url: 'sichal.html?s=' + enc(r.sichal) + '', kind: '시찰 게시판', snippet: text });
      items.push({ ref: ref, type: '게시글', sichal: r.sichal, cat: r.cat, title: r.title, date: String(r.created_at || '').slice(0, 10), text: text });
    });
    (pets.error ? [] : pets).forEach(function (r) {
      const ref = ctx.cites.add({ title: r.sichal + ' 청원서: ' + r.title, url: 'sichal.html?s=' + enc(r.sichal) + '', kind: '시찰 청원서', snippet: r.form_title + ' / ' + r.title + ' / ' + r.status });
      items.push({ ref: ref, type: '청원서', sichal: r.sichal, form: r.form_title, title: r.title, status: r.status, by: r.user_name, date: String(r.created_at || '').slice(0, 10) });
    });
    if (!items.length) return { items: [], note: '시찰 자료에서 찾지 못했습니다. (질문한 분이 볼 수 있는 시찰 자료만 찾습니다)' };
    return { items: items };
  },
  async search_presbytery_reports(input, ctx) {
    const ws = words(input.keyword || '');
    if (!ws.length) return { error: '찾을 낱말을 주어야 합니다.' };
    let q = 'presbytery_report_pages?select=id,report_id,pdf_page,page_no,heading,text,presbytery_reports(title,session,meet_on)&' + allWords(['heading', 'text'], ws) + '&order=report_id.desc,page_no&limit=12';
    if (input.session) q += '&presbytery_reports.session=eq.' + parseInt(input.session, 10);
    const rows = await sbGet(ctx.env, ctx.auth, q);
    if (rows.error) return { error: /HTTP 4/.test(rows.error) ? '노회 보고서는 정회원만 볼 수 있습니다 (또는 131 sql 미실행).' : rows.error };
    const list = rows.filter(function (r) { return r.presbytery_reports; });
    if (!list.length) return { items: [], note: '회의자료 책자에서 그 낱말을 찾지 못했습니다. 다른 낱말로 다시 찾아 보십시오.' };
    return { items: list.map(function (r) {
      const rep = r.presbytery_reports || {};
      const where = (rep.title || '노회 보고서') + ' ' + (r.page_no != null ? r.page_no + '쪽' : 'PDF ' + r.pdf_page + '쪽') + (r.heading ? ' 「' + r.heading + '」' : '');
      const sn = snippets(r.text, ws, 300, 4);
      const ref = ctx.cites.add({ title: where, url: 'presbytery-report.html?r=' + r.report_id + '&p=' + (r.page_no != null ? r.page_no : r.pdf_page) + '&q=' + enc(ws[0]), kind: '노회 보고서(회의자료)', snippet: sn });
      return { ref: ref, report: rep.title, session: rep.session, meet_on: rep.meet_on, page: r.page_no, heading: r.heading, text: sn };
    }) };
  },
  async search_directory(input, ctx) {
    const ws = words(input.keyword || '');
    if (!ws.length) return { error: '찾을 낱말을 주어야 합니다.' };
    const cols = ['section', 'name', 'role', 'church', 'address', 'address2', 'pastor', 'elders', 'phone', 'email', 'website'];
    const rows = await sbGet(ctx.env, ctx.auth, 'presbytery_directory?select=*&' + allWords(cols, ws) + '&order=sort,no,id&limit=25');
    if (rows.error) return { error: /HTTP 4/.test(rows.error) ? '노회 주소록은 정회원만 볼 수 있습니다 (또는 132 sql 미실행).' : rows.error };
    if (!rows.length) return { items: [], note: '주소록에서 그 낱말을 찾지 못했습니다. 교회 이름은 「교회」를 빼고(예: 목자), 사람은 이름만으로 다시 찾아 보십시오.' };
    return { items: rows.map(function (r) {
      const line = r.kind === 'person'
        ? [r.section, r.role, r.name, r.church ? r.church + '교회' : '', r.phone].filter(Boolean).join(' · ')
        : [r.section + (r.no != null ? ' ' + r.no : ''), r.name + '교회', [r.postcode, r.address, r.address2 ? '(' + r.address2 + ')' : ''].filter(Boolean).join(' '),
           r.pastor ? '교역자 ' + r.pastor : '', r.elders ? '시무장로 ' + r.elders : '', r.phone, r.website, r.email].filter(Boolean).join(' · ');
      const ref = ctx.cites.add({ title: '노회 주소록 — ' + r.section + ' ' + r.name, url: 'directory.html?q=' + enc(r.name) + '#' + enc(r.section), kind: '노회 주소록', snippet: line });
      return { ref: ref, section: r.section, kind: r.kind, name: r.name, role: r.role, church: r.church, address: [r.postcode, r.address, r.address2].filter(Boolean).join(' '), pastor: r.pastor, elders: r.elders, phone: r.phone, website: r.website, email: r.email };
    }) };
  },
  async search_dues(input, ctx) {
    /* 회기: 4월 ~ 이듬해 3월. 이번 회기 시작 연도 */
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const curM = now.getUTCMonth() + 1, curY = now.getUTCFullYear();
    const fiscalNow = curM >= 4 ? curY : curY - 1;
    const year = parseInt(input.year, 10) || fiscalNow;
    const [rates, pays, closings, baps] = await Promise.all([
      sbGet(ctx.env, ctx.auth, 'dues_rates?select=id,sichal,church,pastor,monthly_amount,sort&year=eq.' + year + '&order=sort,id'),
      sbGet(ctx.env, ctx.auth, 'dues_payments?select=church,month,paid_on,amount&year=eq.' + year + '&order=paid_on'),
      sbGet(ctx.env, ctx.auth, 'dues_closings?select=year,closed_by,created_at&year=eq.' + year),
      sbGet(ctx.env, ctx.auth, 'bapdues?select=church,pastor,members,target,paid,paid_on,memo&year=eq.' + curY + '&order=sort')
    ]);
    if (rates.error) return { error: /HTTP 4/.test(rates.error) ? '상회비 내역은 열람 권한이 없습니다 (관리자·회계·부회계와 상회비를 내는 담임목사·장로만 봅니다).' : rates.error };
    if (!rates.length) return { items: [], note: year + '년 회기 상회비 설정이 아직 없습니다. 임원방 > 상회비 관리 > 상회비 설정에서 교회별 월 상회비를 정해야 납부 현황이 생깁니다.', year: year };
    /* 이번 회기면 4월부터 이번 달까지가 내야 할 달, 지난 회기면 열두 달 모두 */
    const order = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
    const elapsed = year === fiscalNow ? (curM >= 4 ? curM - 3 : curM + 9) : (year < fiscalNow ? 12 : 0);
    const due = order.slice(0, elapsed);
    const byChurch = {};
    (pays.error ? [] : pays).forEach(function (p) {
      (byChurch[p.church] = byChurch[p.church] || []).push(p);
    });
    const q = input.church ? clean(input.church) : '';
    let items = rates.filter(function (r) { return !q || (r.church || '').indexOf(q) !== -1; }).map(function (r) {
      const rate = Number(r.monthly_amount || 0);
      const ps = byChurch[r.church] || [];
      const paidMonths = ps.map(function (p) { return p.month; }).filter(function (m, i, a) { return a.indexOf(m) === i; });
      const unpaid = due.filter(function (m) { return paidMonths.indexOf(m) === -1; });
      const paidTotal = ps.reduce(function (a, p) { return a + (p.amount == null ? rate : Number(p.amount)); }, 0);
      const last = ps.length ? ps.map(function (p) { return p.paid_on; }).sort().slice(-1)[0] : null;
      return { church: r.church, sichal: r.sichal, pastor: r.pastor, monthly_manwon: rate,
        paid_months: order.filter(function (m) { return paidMonths.indexOf(m) !== -1; }),
        unpaid_months: rate ? unpaid : [], arrears_manwon: rate ? unpaid.length * rate : 0,
        paid_total_manwon: paidTotal, last_paid_on: last || undefined, exempt: rate ? undefined : true };
    });
    if (input.only_unpaid) items = items.filter(function (x) { return x.unpaid_months.length > 0; });
    const totalArrears = items.reduce(function (a, x) { return a + x.arrears_manwon; }, 0);
    const summary = { year: year, period: year + '년 4월 ~ ' + (year + 1) + '년 3월', months_due_so_far: due.length,
      churches: rates.length, churches_with_arrears: rates.filter(function (r) {
        const ps = byChurch[r.church] || []; const pm = ps.map(function (p) { return p.month; });
        return Number(r.monthly_amount || 0) > 0 && due.some(function (m) { return pm.indexOf(m) === -1; });
      }).length,
      closed: !closings.error && closings.length ? ('마감됨 (' + (closings[0].closed_by || '') + ')') : '마감 전',
      unit: '만원' };
    const ref = ctx.cites.add({ title: year + '년 회기 상회비 납부 현황', url: 'officer.html#sec-%EC%83%81%ED%9A%8C%EB%B9%84-%EA%B4%80%EB%A6%AC', kind: '상회비 관리 (임원방)',
      snippet: summary.period + ' · 내야 할 달 ' + due.length + '개월 · 교회 ' + rates.length + '곳 · 미납 있는 교회 ' + summary.churches_with_arrears + '곳' +
        (items.length ? '\n' + items.slice(0, 40).map(function (x) { return x.church + ' 월 ' + x.monthly_manwon + '만원 · 미납 ' + x.unpaid_months.length + '개월' + (x.arrears_manwon ? ' (' + x.arrears_manwon + '만원)' : ''); }).join('\n') : '') });
    const out = { ref: ref, summary: summary, selected_arrears_manwon: totalArrears, items: items.slice(0, 60) };
    if (!baps.error && baps.length) {
      const bl = baps.filter(function (b) { return !q || (b.church || '').indexOf(q) !== -1; });
      const refB = ctx.cites.add({ title: curY + '년 세례의무금 납부 현황', url: 'officer.html#sec-%EC%84%B8%EB%A1%80%EC%9D%98%EB%AC%B4%EA%B8%88-%EA%B4%80%EB%A6%AC', kind: '세례의무금 관리 (임원방)',
        snippet: bl.slice(0, 40).map(function (b) { return b.church + ' 목표 ' + Number(b.target || 0).toLocaleString() + '원 · 납입 ' + Number(b.paid || 0).toLocaleString() + '원' + (b.paid_on ? ' (' + b.paid_on + ')' : ''); }).join('\n') });
      out.bapdues = { ref: refB, year: curY, unit: '원', items: bl.slice(0, 60).map(function (b) {
        return { church: b.church, pastor: b.pastor, members: b.members, target: b.target, paid: b.paid, paid_on: b.paid_on || undefined, unpaid: Number(b.paid || 0) < Number(b.target || 0) ? Number(b.target || 0) - Number(b.paid || 0) : 0 };
      }) };
    }
    return out;
  },
  async search_committee(input, ctx) {
    const ws = words(input.keyword || '');
    const q = [];
    if (input.committee) q.push('committee=ilike.' + enc('*' + clean(input.committee) + '*'));
    if (ws.length) q.push(allWords(['title', 'body', 'committee'], ws));
    const rows = await sbGet(ctx.env, ctx.auth, 'committee_events?select=committee,kind,title,body,event_date,end_date,place,done&' + q.join('&') + '&order=event_date.desc.nullslast&limit=12');
    if (rows.error) return { error: rows.error };
    if (!rows.length) return { items: [], note: '상비부 기록에서 찾지 못했습니다.' };
    return { items: rows.map(function (r) {
      const ref = ctx.cites.add({ title: r.committee + ' ' + (r.kind || '') + ': ' + r.title, url: 'committee.html?c=' + enc(r.committee), kind: '상비부', snippet: (r.event_date || '') + ' ' + r.title + '\n' + (r.body || '') });
      return { ref: ref, committee: r.committee, kind: r.kind, title: r.title, date: r.event_date, place: r.place, body: String(r.body || '').slice(0, 400), done: r.done };
    }) };
  },
  /* 수양회 — 수양회 화면과 같은 retreat_state(140·142·147 sql)를 질문한 분의 증표로 읽는다.
   * 그래서 참가자는 자기(와 배우자) 자리·고른 것을, 임원은 아직 닫힌 단계까지 본다. */
  async get_retreat(input, ctx) {
    const S = await sbRpc(ctx.env, ctx.auth, 'retreat_state', { p_retreat: null });
    if (S.error) return { error: S.error };
    const R = S && S.retreat;
    if (!R) return { items: [], note: '지금 볼 수 있는 수양회가 없습니다 (등록된 수양회가 없거나, 정회원·참가자가 아닙니다).' };
    return retreatDigest(S, input, ctx);
  }
};

/* 수양회 상태 → Claude 에게 줄 요약 (근거 번호는 날짜별 일정·카페 단계·내 자리·예배 순서에 하나씩) */
const RETREAT_TAIL = /\n\n(퀴즈|게임|예배|진행 계획[^:\n]*):[\s\S]*$/;
export function retreatDigest(S, input, ctx) {
  const R = S.retreat, st = R.settings || {}, part = input.part || 'all';
  const want = function (p) { return part === 'all' || part === p; };
  const base = 'retreat.html?id=' + R.id;
  const day0 = new Date(R.start_date + 'T00:00:00Z');
  const dateOf = function (n) { return new Date(day0.getTime() + (n - 1) * 86400000).toISOString().slice(0, 10); };
  const nDays = R.end_date && R.end_date > R.start_date
    ? Math.round((new Date(R.end_date + 'T00:00:00Z') - day0) / 86400000) + 1 : 1;
  const todayNo = S.today ? Math.round((new Date(S.today + 'T00:00:00Z') - day0) / 86400000) + 1 : null;
  const out = {
    retreat: { title: R.title, committee: R.committee, start_date: R.start_date, end_date: R.end_date, place: R.place,
      stage: R.stage, flight: st.flight_out || undefined, hotel: st.hotel || undefined, verse: R.verse || undefined },
    today: S.today, today_day_no: todayNo,
    days: []
  };
  const prog = S.program || [];
  const days = input.day ? [Number(input.day)] : Array.from({ length: nDays }, function (_, i) { return i + 1; });

  if (want('schedule')) {
    days.forEach(function (n) {
      const stops = prog.filter(function (g) { return g.day_no === n && g.kind !== 'ment'; });
      const ments = prog.filter(function (g) { return g.day_no === n && g.kind === 'ment'; });
      if (!stops.length && !ments.length) return;
      const lines = stops.map(function (g) {
        return (g.time || '') + ' ' + g.title + (g.body ? ' — ' + g.body.replace(/\n/g, ' ') : '') +
          (g.place ? ' · 장소 ' + g.place : '') + (g.depart ? ' · ' + g.depart + ' 출발' : '') + (g.move ? ' · 다음 이동 ' + g.move : '') +
          (g.status && g.status !== '예정' ? ' [' + g.status + ']' : '');
      });
      const ref = ctx.cites.add({ title: R.title + ' ' + n + '일차 일정 (' + dateOf(n) + ')', url: base + '#prog', kind: '수양회 일정',
        snippet: lines.join('\n') });
      out.days.push({ ref: ref, day_no: n, date: dateOf(n), schedule: lines,
        guide: ments.map(function (g) {
          return { title: g.title, text: String(g.body || '').replace(RETREAT_TAIL, '').slice(0, 900) };
        }) });
    });
  }

  if (want('cafe')) {
    out.cafe = (S.steps || []).filter(function (s) { return s.kind === '선택' && (s.options || []).length; }).map(function (s) {
      const ref = ctx.cites.add({ title: R.title + ' ' + s.title, url: base + '#me', kind: '수양회 주문',
        snippet: (s.body || '') + '\n' + s.options.map(function (o) { return o.label; }).join(' / ') });
      return { ref: ref, title: s.title, when: String(s.body || '').split('\n')[0], status: s.status,
        choices_for_temperature: s.variants || undefined, menu: s.options.map(function (o) { return o.label; }) };
    });
    if (!out.cafe.length) out.cafe_note = '열린 주문 단계가 없습니다 (임원이 주문 단계를 열면 보입니다).';
  }

  if (want('me') && S.me) {
    const people = [S.me].concat(S.companions || []);
    const chosen = function (p) {
      return (S.choices || []).filter(function (c) { return c.participant_id === p.id; }).map(function (c) {
        const s = (S.steps || []).filter(function (x) { return x.id === c.step_id; })[0];
        return (s ? s.title : '') + ': ' + (c.option_label || '') + (c.variant ? ' (' + c.variant + ')' : '') + (c.note ? ' — ' + c.note : '');
      });
    };
    const rows = people.map(function (p) {
      return { name: p.name, role: p.role, list_no: p.seq,
        seat: p.bus_seat ? '버스 ' + p.bus_seat + '번' : (p.van_seat ? '쏠라티 ' + p.van_seat + '번' : '미정'),
        room: p.room_no ? p.room_no + '호' : (p.room_group ? p.room_group + '번 방' : '미정'),
        my_orders: chosen(p) };
    });
    const ref = ctx.cites.add({ title: R.title + ' 내 자리·주문', url: base + '#me', kind: '수양회 내 안내',
      snippet: rows.map(function (x) { return x.name + ' ' + (x.role || '') + ' · ' + x.seat + ' · ' + x.room + (x.my_orders.length ? ' · ' + x.my_orders.join(', ') : ''); }).join('\n') +
        ((S.roommates || []).length ? '\n같은 방: ' + S.roommates.map(function (q) { return q.name; }).join(', ') : '') });
    out.me = { ref: ref, people: rows, roommates: (S.roommates || []).map(function (q) { return q.name + ' ' + (q.role || ''); }) };
  }

  if (want('worship') && (st.worship || st.prayers)) {
    const w = (st.worship || []).map(function (x) { return x.k + ': ' + x.v; });
    const pr = (st.prayers || []).filter(function (x) { return x.v; }).map(function (x) { return x.k + ': ' + x.v; });
    const ref = ctx.cites.add({ title: R.title + ' 개회 예배 순서 · 기도 순서', url: base + '#prog', kind: '수양회 예배',
      snippet: w.join('\n') + (pr.length ? '\n\n기도 순서\n' + pr.join('\n') : '') });
    out.worship = { ref: ref, order: w, prayers: pr };
  }
  return out;
}

/* 시화산노회 AI 자료 검색 창구 (Cloudflare Worker → Claude API)
 *
 * 홈페이지 첫 화면의 검색창이 질문을 보내면, 로그인한 분이 누구이고 어떤 등급인지
 * Supabase 에 확인한 뒤 Claude 에게 묻는다. Claude 는 도구(tools.js)로 총회 자료와
 * 노회 자료를 찾아 근거를 달아 답하고, 답은 글자가 나오는 대로 홈페이지로 흘려보낸다(SSE).
 *
 * 하는 일
 *   POST /ask             { question, history?, thread? }  →  SSE 흐름
 *                         (status / delta / retract / sources / logged{id} / saved / usage / done / error)
 *   POST /feedback        { id, helpful, reason? }  본인 답에 「도움이 됐어요 / 아니에요(이유)」 (127 sql 의 ai_feedback)
 *   GET  /health          창구가 살아 있는가, 열쇠가 등록되어 있는가
 *   GET  /settings        (관리자) 모델·한도·허용 등급·열쇠 등록 여부·오늘 사용량
 *   POST /settings        (관리자) 설정 저장 — api_key 를 주면 열쇠를 바꾼다
 *   POST /settings/test   (관리자) 열쇠로 모델 목록을 받아 보고, 고른 모델로 아주 짧은 인사를 시켜 본다
 *   POST /reports/run     (노회장·서기·최고관리자) 임원 업무 보고서를 지금 다시 만든다 — SSE (progress / done / error)
 *   (예약) 매일 21:00 UTC = 한국 아침 6시에 임원 업무 보고서를 만든다 (wrangler.toml [triggers], 128 sql)
 *   GET  /history         내 질문 내역 (대화별 요약: 제목·질문 수·마지막 답 앞부분)
 *   GET  /history/<id>    대화 하나 (문답 전부 — 다시 보기·이어 묻기)
 *   DELETE /history/<id>  대화 하나 지우기,  DELETE /history  내 내역 모두 지우기
 *
 * 설정과 열쇠는 Cloudflare KV(AI_KV) 에 둔다. 관리자가 홈페이지 「AI 검색·API 설정」에서 넣는다.
 *   KV 'settings' = { api_key, model, effort, daily_user, daily_total, roles[], enabled, updated_at, updated_by }
 *   KV 'u:<날짜>:<회원id>' / 'u:<날짜>:all' = 오늘 질문 수
 *   KV 'h:<회원id>' = 그분의 질문 내역 { threads: [{ id, title, at, updated, turns: [{ q, a, sources, at }] }] }
 *     본인만 읽고 지운다. 관리자도 남의 내역은 볼 수 없다 (관리자가 보는 사용 기록은 Supabase ai_logs).
 *
 * 쓰면 쓸수록 나아지는 구조 (127 sql) — 모델을 다시 가르치지 않고, 사람이 확인한 답만 근거로 쌓는다.
 *   /ask 가 끝나면 질문·답 본문·근거 목록·「못 찾음」 표시를 ai_logs 에 남기고 그 줄 번호를 'logged' 로 돌려준다.
 *   회원은 그 번호로 /feedback 평가를 단다. 관리자는 못 찾은 질문·낮은 평가를 보고 「확인된 답」(ai_verified)을 승인한다.
 *   다음 질문부터 search_verified_answers 도구가 그 답을 (질문한 분 등급에 맞는 것만) 먼저 근거로 내놓는다.
 *
 * 누가 쓸 수 있나
 *   로그인 증표(Bearer)를 Supabase 에 확인하고 profiles.role 이 허용 등급(기본: 정회원 이상)일 때만.
 *   자료는 질문한 분의 증표로 읽으므로 그분이 볼 수 없는 자료(예: 회의록은 임원만)는 Claude 도 보지 못한다.
 */
import { Index } from './search.js';
import { Cites, toolsFor, runTool, TOOL_STATUS } from './tools.js';
import { runReports } from './reports.js';

const ALLOW_ORIGINS = [
  'https://sihwasan.org',
  'https://www.sihwasan.org',
  'https://sihwasan.github.io',
  'http://localhost:8123',
  'http://localhost:8124',
  'http://localhost:8899'
];
const ADMIN_ROLES = ['superadmin', 'president', 'clerk', 'staff'];
const DEFAULTS = {
  model: 'claude-opus-5-5',
  effort: 'medium',
  daily_user: 30,
  daily_total: 300,
  roles: ['superadmin', 'president', 'clerk', 'staff', 'officer', 'member'],
  enabled: true,
  report_enabled: true,   /* 임원 업무 보고서 (매일 아침 6시) */
  report_model: 'claude-opus-5-5',   /* 보고서는 Opus 5.5 로 (2026-10-21 사용자 지시). 비우면 검색과 같은 모델 */
  report_effort: 'medium'
};
/* 관리자 화면의 모델 고르기에 보여 줄 목록 (값: 1백만 토큰당 미화) */
export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', input: 4, output: 20, note: '가장 정확함 · 기본값' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', input: 2, output: 10, note: '빠르고 정확함' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', input: 0.1, output: 0.5, note: '가장 저렴하고 빠름' }
];
const MAX_TURNS = 8;          /* 도구를 부르는 횟수 한도 */
const MAX_OUT = 6000;         /* 답 길이(토큰) */
const HIST_THREADS = 60;      /* 한 분이 보관하는 대화 수 (넘으면 오래된 것부터 빠진다) */
const HIST_TURNS = 20;        /* 대화 하나에 담는 문답 수 */

function cors(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function reply(body, status, origin) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status: status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(origin))
  });
}
function kstDate() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }

/* ---------- 누구인가 ---------- */
async function whoIs(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const u = await fetch(env.SUPABASE_URL + '/auth/v1/user', { headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY } });
  if (!u.ok) return null;
  const user = await u.json().catch(function () { return null; });
  if (!user || !user.id) return null;
  const p = await fetch(env.SUPABASE_URL + '/rest/v1/profiles?select=id,name,role,title,church,position,suspended&id=eq.' + user.id, {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY }
  });
  const rows = p.ok ? await p.json().catch(function () { return []; }) : [];
  const prof = rows[0] || { id: user.id, role: 'pending', name: '' };
  return { id: user.id, auth: auth, role: prof.role, title: prof.title || '', name: prof.name || '', church: prof.church || '',
           position: prof.position || '', suspended: !!prof.suspended };
}

/* ---------- 설정 ---------- */
async function getSettings(env) {
  const s = (await env.AI_KV.get('settings', 'json')) || {};
  return Object.assign({}, DEFAULTS, s);
}
function publicSettings(s, extra) {
  return Object.assign({
    model: s.model, effort: s.effort, daily_user: s.daily_user, daily_total: s.daily_total, roles: s.roles, enabled: s.enabled,
    report_enabled: s.report_enabled !== false, report_model: s.report_model || '', report_effort: s.report_effort || 'medium',
    has_key: !!s.api_key, key_tail: s.api_key ? String(s.api_key).slice(-4) : '',
    updated_at: s.updated_at || null, updated_by: s.updated_by || null, models: MODELS
  }, extra || {});
}
async function usageToday(env, uid) {
  const d = kstDate();
  const [all, me] = await Promise.all([env.AI_KV.get('u:' + d + ':all'), uid ? env.AI_KV.get('u:' + d + ':' + uid) : null]);
  return { date: d, total: parseInt(all || '0', 10), me: parseInt(me || '0', 10) };
}
async function bump(env, uid) {
  const d = kstDate();
  const ttl = { expirationTtl: 3 * 86400 };
  const [all, me] = await Promise.all([env.AI_KV.get('u:' + d + ':all'), env.AI_KV.get('u:' + d + ':' + uid)]);
  await Promise.all([
    env.AI_KV.put('u:' + d + ':all', String(parseInt(all || '0', 10) + 1), ttl),
    env.AI_KV.put('u:' + d + ':' + uid, String(parseInt(me || '0', 10) + 1), ttl)
  ]);
}

/* ---------- 내 질문 내역 (KV 'h:<회원id>') ---------- */
function histKey(uid) { return 'h:' + uid; }
async function histGet(env, uid) {
  const v = await env.AI_KV.get(histKey(uid), 'json');
  return v && Array.isArray(v.threads) ? v : { threads: [] };
}
/* 목록에 보일 맨글 — 근거 표시·굵게·목록 기호를 뗀 답 앞부분 */
function histPreview(a) {
  return String(a || '').replace(/\[R\d+\](\{\{[^{}]*\}\})?/g, '').replace(/\*\*/g, '')
    .replace(/^\s*([-•·]|\d+[.)])\s+/gm, '').replace(/\s+/g, ' ').trim().slice(0, 90);
}
function histSummary(t) {
  const last = t.turns[t.turns.length - 1] || {};
  return { id: t.id, title: t.title, n: t.turns.length, at: t.at, updated: t.updated, preview: histPreview(last.a) };
}
function newThreadId() { return crypto.randomUUID().replace(/-/g, '').slice(0, 16); }
/* 답 하나를 대화에 붙여 저장한다. 그 번호의 대화가 없으면(새 대화이거나 지워졌으면) 그 번호로 새로 만든다. */
async function histSave(env, uid, threadId, turn) {
  const h = await histGet(env, uid);
  const now = new Date().toISOString();
  let t = threadId ? h.threads.find(function (x) { return x.id === threadId; }) : null;
  if (t) h.threads = h.threads.filter(function (x) { return x !== t; });
  else t = { id: threadId || newThreadId(), title: turn.q.slice(0, 80), at: now, updated: now, turns: [] };
  t.turns.push(turn);
  if (t.turns.length > HIST_TURNS) t.turns = t.turns.slice(-HIST_TURNS);
  t.updated = now;
  h.threads.unshift(t);
  h.threads = h.threads.slice(0, HIST_THREADS);
  await env.AI_KV.put(histKey(uid), JSON.stringify(h));
  return t;
}
async function historyApi(request, env, origin, path) {
  const me = await whoIs(request, env);
  if (!me) return reply({ error: '로그인이 확인되지 않았습니다. 다시 로그인해 주세요.' }, 401, origin);
  const id = path.length > 9 ? decodeURIComponent(path.slice(9)) : '';
  if (request.method === 'GET') {
    const h = await histGet(env, me.id);
    if (!id) return reply({ list: h.threads.map(histSummary) }, 200, origin);
    const t = h.threads.find(function (x) { return x.id === id; });
    return t ? reply({ thread: t }, 200, origin) : reply({ error: '지워졌거나 없는 질문입니다.' }, 404, origin);
  }
  if (request.method === 'DELETE') {
    if (!id) { await env.AI_KV.delete(histKey(me.id)); return reply({ ok: true, list: [] }, 200, origin); }
    const h = await histGet(env, me.id);
    const n = h.threads.length;
    h.threads = h.threads.filter(function (x) { return x.id !== id; });
    if (h.threads.length !== n) await env.AI_KV.put(histKey(me.id), JSON.stringify(h));
    return reply({ ok: true, list: h.threads.map(histSummary) }, 200, origin);
  }
  return reply({ error: '없는 주소입니다.' }, 405, origin);
}

/* ---------- 색인 (홈페이지에서 받아 둔다) ---------- */
let INDEX = null, INDEX_AT = 0, INDEX_BUILT = '';
async function getIndex(env) {
  if (INDEX && Date.now() - INDEX_AT < 15 * 60 * 1000) return INDEX;
  /* 15분마다 새 색인을 받는다 (주소 뒤의 15분 단위 번호가 바뀌면 Cloudflare 캐시도 새로 받는다).
   * 색인(index.json)을 새로 올리면 늦어도 30분 안에 AI 검색에 반영된다. */
  const slot = Math.floor(Date.now() / (15 * 60 * 1000));
  const r = await fetch((env.SITE_URL || 'https://sihwasan.org') + '/data/ai/index.json?q=' + slot, { cf: { cacheTtl: 900, cacheEverything: true } });
  if (!r.ok) {
    if (INDEX) return INDEX;
    throw new Error('총회 자료 색인을 받지 못했습니다 (HTTP ' + r.status + ')');
  }
  const j = await r.json();
  INDEX = new Index(j.chunks || []);
  INDEX_AT = Date.now();
  INDEX_BUILT = j.built || '';
  return INDEX;
}

/* ---------- Claude ---------- */
function explain(status, data, raw) {
  const err = (data && data.error) || {};
  let msg = 'Claude API 오류: ' + (err.message || ('HTTP ' + status));
  if (status === 401) msg = 'API 열쇠가 맞지 않거나 폐기되었습니다. 관리자가 「AI 검색·API 설정」에서 열쇠를 다시 넣어 주셔야 합니다.';
  else if (status === 403) msg = 'API 열쇠가 이 요청을 허용받지 못했습니다 (작업 공간의 모델 권한·지역 제한 확인). ' + (err.message || '');
  else if (status === 429 || status === 529 || err.type === 'overloaded_error') msg = 'Claude 서버가 혼잡합니다. 잠시 뒤 다시 물어봐 주세요.';
  else if (status >= 500) msg = 'Claude 쪽에 일시 장애가 있습니다. 잠시 뒤 다시 시도해 주세요.';
  else if (status === 400 && /credit|balance|billing/i.test(err.message || '')) msg = 'Anthropic 계정의 잔액(크레딧)이 부족합니다. 충전 뒤 다시 시도해 주세요.';
  else if (status === 404) msg = '고른 모델(' + (err.message || '') + ')을 쓸 수 없습니다. 관리자가 다른 모델을 골라 주셔야 합니다.';
  if (!data && raw) msg += ' ' + String(raw).slice(0, 120);
  return msg;
}

/* 스트리밍으로 한 번 부르고, 글자는 onText 로 흘려보내며, 다 받은 내용 블록을 돌려준다 */
/* fetcher: 기본은 그냥 fetch. 보고서는 내부 중계 워커(서비스 바인딩 CLAUDE, 도쿄 고정)를 거친다 — reportDeps 참고 */
async function claudeStream(key, body, beta, onText, fetcher) {
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
  if (beta) headers['anthropic-beta'] = beta;
  const r = await (fetcher || fetch)('https://api.anthropic.com/v1/messages', { method: 'POST', headers: headers, body: JSON.stringify(Object.assign({ stream: true }, body)) });
  if (!r.ok) {
    const raw = await r.text().catch(function () { return ''; });
    let data = null; try { data = JSON.parse(raw); } catch (e) {}
    const e = new Error(explain(r.status, data, raw));
    e.status = r.status; e.type = (data && data.error && data.error.type) || ''; e.raw = (data && data.error && data.error.message) || raw.slice(0, 200);
    throw e;
  }
  const blocks = [];
  let stop = null, usage = null, model = body.model, stopDetails = null;
  const dec = new TextDecoder();
  const reader = r.body.getReader();
  let buf = '';
  function handle(ev) {
    if (!ev || !ev.type) return;
    if (ev.type === 'message_start') { model = (ev.message && ev.message.model) || model; usage = (ev.message && ev.message.usage) || usage; }
    else if (ev.type === 'content_block_start') {
      const b = Object.assign({}, ev.content_block);
      if (b.type === 'tool_use') b._json = '';
      if (b.type === 'text') b.text = b.text || '';
      if (b.type === 'thinking') { b.thinking = b.thinking || ''; b.signature = b.signature || ''; }
      blocks[ev.index] = b;
    } else if (ev.type === 'content_block_delta') {
      const b = blocks[ev.index]; const d = ev.delta || {};
      if (!b) return;
      if (d.type === 'text_delta') { b.text += d.text; if (onText) onText(d.text); }
      else if (d.type === 'input_json_delta') b._json += d.partial_json || '';
      else if (d.type === 'thinking_delta') b.thinking += d.thinking || '';
      else if (d.type === 'signature_delta') b.signature += d.signature || '';
    } else if (ev.type === 'content_block_stop') {
      const b = blocks[ev.index];
      if (b && b.type === 'tool_use') { try { b.input = b._json ? JSON.parse(b._json) : {}; } catch (e) { b.input = {}; b._bad = true; } delete b._json; }
    } else if (ev.type === 'message_delta') {
      stop = (ev.delta && ev.delta.stop_reason) || stop;
      stopDetails = (ev.delta && ev.delta.stop_details) || stopDetails;
      if (ev.usage) usage = Object.assign({}, usage || {}, ev.usage);
    } else if (ev.type === 'error') {
      throw new Error('Claude 스트림 오류: ' + ((ev.error && ev.error.message) || ''));
    }
  }
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const lines = chunk.split('\n');
      for (const ln of lines) {
        if (ln.indexOf('data:') !== 0) continue;
        const js = ln.slice(5).trim();
        if (!js) continue;
        let ev = null; try { ev = JSON.parse(js); } catch (e) { continue; }
        handle(ev);
      }
    }
  }
  return { content: blocks.filter(Boolean), stop_reason: stop, stop_details: stopDetails, usage: usage, model: model };
}

/* 한 번 부르되, 잠깐 장애면 조금 쉬고 다시 부르고, 대체(fallbacks) 거절이면 대체 없이 부른다 */
async function claudeCall(key, body, onText, fetcher) {
  let withFb = true;
  for (let i = 0; i < 3; i++) {
    try {
      const b = Object.assign({}, body);
      if (withFb) b.fallbacks = 'default';
      return await claudeStream(key, b, withFb ? 'server-side-fallback-2026-07-01' : '', onText, fetcher);
    } catch (e) {
      const st = e.status || 0;
      if (st === 400 && withFb && /fallback|beta/i.test(e.raw || '')) { withFb = false; continue; }
      if ((st === 0 || st === 408 || st === 429 || st >= 500) && i < 2) { await new Promise(function (r) { setTimeout(r, 900 * (i + 1)); }); continue; }
      throw e;
    }
  }
}

/* ---------- 질문에 답하기 ---------- */
function roleName(r) {
  return { superadmin: '최고관리자', president: '노회장', clerk: '서기', staff: '간사', officer: '임원', member: '정회원',
           associate: '준회원', advisory: '언권회원', general: '일반회원', pending: '승인대기' }[r] || r;
}
function systemPrompt(me, built) {
  const isOfficer = ['superadmin', 'president', 'clerk', 'staff', 'officer'].indexOf(me.role) !== -1;
  const isAdmin = ADMIN_ROLES.indexOf(me.role) !== -1;
  const who = (me.name || '회원') + (me.position ? ' ' + me.position : '') + (me.church ? ' (' + me.church + ')' : '') +
    ' · 등급 ' + roleName(me.role) + (me.title ? ' · 직책 ' + me.title : '');
  return [
    '당신은 대한예수교장로회(합동) 시화산노회 홈페이지의 자료 검색 도우미입니다.',
    '질문한 분: ' + who + '.',
    '오늘: ' + kstDate() + ' (한국 시각). 총회 자료 색인 기준일: ' + (built || '-') + '.',
    '',
    '자료를 찾는 법',
    '- 반드시 도구로 찾은 자료만 근거로 답합니다. 기억에 있는 내용으로 답하지 않습니다.',
    '- 총회 헌법(정치·권징조례·예배모범 등)과 총회 규정·결의는 search_assembly / get_assembly_article 로, 노회규칙은 search_presbytery_rules 로 찾습니다.',
    '- 노회 사람·교회·조직·일정·공지·결의·회의록·시찰·상비부·상회비는 그에 맞는 search_* / get_organization 도구로 찾습니다. 정기노회 회의자료 책자(각 부 보고·시찰 보고·명단·주소록)는 search_presbytery_reports 로 찾습니다.',
    '- 처음 찾은 결과가 질문과 맞지 않으면 낱말을 바꾸거나 범위를 좁혀 두세 번 더 찾습니다. 필요하면 여러 도구를 함께 씁니다.',
    '- 관리자가 원문을 확인해 승인해 둔 「확인된 답」이 있을 수 있습니다. 처음 자료를 찾을 때 search_verified_answers 를 다른 검색과 함께 부릅니다(search_assembly 결과 맨 앞에 verified 로 붙어 오기도 합니다).',
    '- 질문과 맞는 확인된 답이 있으면 그것을 우선 근거로 씁니다. 답의 첫 문장 끝에 그 확인된 답의 근거 번호를 달아(구절도 그 확인된 답 글에서) 관리자가 확인한 답임을 보이고, 반드시 그 답이 기대는 원문 조문·결의·규칙을 해당 도구로 다시 찾아 확인해 각 문장에 원문 근거 번호를 함께 답니다. 원문과 다르면 원문을 따르고 그 차이를 짧게 알립니다. 질문과 맞지 않는 확인된 답은 쓰지 않습니다.',
    '- 도구가 "열람할 수 없다"거나 빈 결과를 주면, 그 자료가 없거나 질문한 분의 등급으로는 볼 수 없다고 솔직히 말합니다.' +
      (isOfficer ? '' : ' (회의록·임원 자료실은 임원만 볼 수 있습니다.)'),
    '',
    '답하는 법',
    '- 한국 장로교 목회자에게 보고하듯 정중한 존댓말로, 결론부터 간결하게 씁니다. 인사말·서론은 쓰지 않습니다.',
    '- 근거로 삼은 자료는 해당 문장 끝에 근거 번호를 [R3] 처럼 적습니다. 번호는 도구가 돌려준 ref 그대로 씁니다. 근거 없는 문장은 쓰지 않습니다.',
    '- 근거 번호 바로 뒤에는 그 자료에서 답의 핵심이 되는 원문 구절(8~60자)을 이중 중괄호로 붙입니다: [R3]{{해벌은 그 회개 여부에 의하여 행하거나}}. 구절은 자료 글과 글자 하나까지 같아야 합니다(요약·바꿔 쓰기 금지, 띄어쓰기는 상관없음). 홈페이지는 이 구절을 원문에서 찾아 밑줄을 긋고, 독자에게는 구절을 보여 주지 않습니다. 같은 번호를 여러 번 쓰면 매번 그 문장에 맞는 구절을 붙입니다.',
    '- 헌법·규정·회칙을 인용할 때는 조문 번호(예: 권징조례 제35조, 정치 제10장 제3조, 노회규칙 제12조)를 함께 적고, 총회 결의는 회기(예: 제110회 총회)를 적습니다.',
    '- 권징(치리·시벌·해벌·재판)이나 총회 결의에 관한 답은 조문·결의 원문을 짧게 인용한 뒤 풀이합니다.',
    '- 자료에 없는 것을 지어내지 않습니다. 확인되지 않으면 "자료에서 확인되지 않습니다"라고 씁니다.',
    '- 회원의 전화번호·주소·생년월일은 질문한 분이 명시적으로 물었을 때만 적습니다.' + (isAdmin ? '' : ' 생년월일·정년일은 관리자만 볼 수 있습니다.'),
    '- 형식: 짧은 문단과 목록(- 또는 1.)을 씁니다. 제목(#)·표·코드블록은 쓰지 않습니다. 굵게(**)는 핵심어에만 씁니다.',
    '- 답 끝에 「근거」 목록을 따로 만들지 않습니다 (홈페이지가 번호를 보고 스스로 만듭니다).',
    '- 질문이 자료 검색과 무관하면(잡담·창작·번역 등) 이 검색창은 노회·총회 자료를 찾는 데 쓰는 것이라고 짧게 안내합니다.'
  ].join('\n');
}

/* 「자료에서 확인되지 않습니다」류의 답이거나 근거를 하나도 달지 못한 답 — 관리자 화면 「못 찾은 질문」에 오른다 */
const NO_ANSWER_RE = /확인되지\s*않(습니다|는다|음)|찾지\s*못했|찾을\s*수\s*없|나와\s*있지\s*않|답을\s*드릴\s*수\s*없|정리하지\s*못했/;
export function isNoAnswer(text, citedCount) {
  const t = String(text || '');
  return !t.trim() || t === '(거절)' || !citedCount || NO_ANSWER_RE.test(t);
}

/* SSE 로 내보내기 */
function sse(writer) {
  const enc = new TextEncoder();
  return {
    send: function (event, data) {
      return writer.write(enc.encode('event: ' + event + '\ndata: ' + JSON.stringify(data || {}) + '\n\n')).catch(function () {});
    },
    close: function () { return writer.close().catch(function () {}); }
  };
}

async function answer(request, env, ctx, origin) {
  const me = await whoIs(request, env);
  if (!me) return reply({ error: '로그인이 확인되지 않았습니다. 다시 로그인해 주세요.' }, 401, origin);
  const s = await getSettings(env);
  if (!s.enabled) return reply({ error: 'AI 검색이 지금은 꺼져 있습니다. (관리자가 「AI 검색·API 설정」에서 켤 수 있습니다)' }, 503, origin);
  if (!s.api_key) return reply({ error: 'AI 검색 열쇠(API 키)가 아직 등록되지 않았습니다. 관리자가 「AI 검색·API 설정」에서 넣어 주셔야 합니다.' }, 503, origin);
  if (me.suspended || (s.roles || DEFAULTS.roles).indexOf(me.role) === -1) {
    return reply({ error: 'AI 검색은 ' + (s.roles || DEFAULTS.roles).map(roleName).join('·') + ' 등급이 이용할 수 있습니다. (현재 등급: ' + roleName(me.role) + ')' }, 403, origin);
  }
  const body = await request.json().catch(function () { return null; });
  const question = body && String(body.question || '').trim();
  if (!question) return reply({ error: '질문을 적어 주세요.' }, 400, origin);
  if (question.length > 1500) return reply({ error: '질문이 너무 깁니다 (1,500자까지).' }, 400, origin);
  const usage = await usageToday(env, me.id);
  const isAdmin = ADMIN_ROLES.indexOf(me.role) !== -1;
  if (!isAdmin && usage.me >= s.daily_user) return reply({ error: '오늘은 ' + s.daily_user + '번까지 물을 수 있습니다. 내일 다시 이용해 주세요.' }, 429, origin);
  if (usage.total >= s.daily_total) return reply({ error: '오늘 노회 전체의 질문 한도(' + s.daily_total + '번)에 이르렀습니다. 내일 다시 이용해 주세요.' }, 429, origin);

  let index;
  try { index = await getIndex(env); } catch (e) { return reply({ error: e.message }, 502, origin); }

  /* 이어 묻기: 앞선 문답(글만) 최대 6턴 */
  const history = [];
  ((body && body.history) || []).slice(-6).forEach(function (h) {
    if (!h || (h.role !== 'user' && h.role !== 'assistant')) return;
    const t = String(h.content || '').slice(0, 4000);
    if (t) history.push({ role: h.role, content: t });
  });
  if (history.length && history[history.length - 1].role === 'user') history.pop();
  /* 내역의 어느 대화에 이어 붙일지 (없으면 새 대화 — 번호를 미리 정해 질문 기록에도 같이 적는다) */
  const threadId = /^[0-9a-f]{8,32}$/.test(String((body && body.thread) || '')) ? String(body.thread) : newThreadId();

  const { readable, writable } = new TransformStream();
  const out = sse(writable.getWriter());
  const cites = new Cites();
  const tools = toolsFor(me.role);
  const messages = history.concat([{ role: 'user', content: question }]);
  const started = Date.now();
  const toolsUsed = [];
  let finalText = '', inTok = 0, outTok = 0, model = s.model;
  let logged = false;

  /* 질문 기록 한 줄 (114·127 sql 의 ai_logs) — 남긴 줄 번호를 돌려준다. 표가 없거나 실패하면 null.
   * 최고관리자는 홈페이지를 유지·보수하는 운영자 계정이라 그 활동은 기록하지 않는다 (117 sql, 감사 기록과 같은 규칙). */
  async function logRow(extra) {
    if (logged || me.role === 'superadmin') return null;
    logged = true;
    const row = Object.assign({ user_id: me.id, user_name: me.name, role: me.role, question: question.slice(0, 1500),
      answer_chars: finalText.length, model: model, input_tokens: inTok, output_tokens: outTok, tools: toolsUsed,
      ms: Date.now() - started, thread: threadId }, extra || {});
    const post = function (r) {
      return fetch(env.SUPABASE_URL + '/rest/v1/ai_logs?select=id', {
        method: 'POST',
        headers: { Authorization: me.auth, apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(r)
      });
    };
    try {
      let r = await post(row);
      if (!r.ok && r.status === 400) {
        /* 127 sql 을 아직 실행하지 않아 새 칸이 없으면 옛 칸만으로 남긴다 (평가 단추는 나오지 않는다) */
        const old = {};
        ['user_id', 'user_name', 'role', 'question', 'answer_chars', 'model', 'input_tokens', 'output_tokens', 'tools', 'ms']
          .forEach(function (k) { old[k] = row[k]; });
        r = await post(old);
        return null;
      }
      if (!r.ok) return null;
      const j = await r.json().catch(function () { return []; });
      return (j && j[0] && j[0].id) || null;
    } catch (e) { return null; }
  }

  ctx.waitUntil((async function () {
    try {
      await out.send('status', { text: '질문을 읽는 중' });
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        let turnText = '';
        const req = {
          model: s.model,
          max_tokens: MAX_OUT,
          system: [{ type: 'text', text: systemPrompt(me, INDEX_BUILT), cache_control: { type: 'ephemeral' } }],
          tools: tools,
          messages: messages,
          output_config: { effort: s.effort || 'medium' }
        };
        const res = await claudeCall(s.api_key, req, function (t) {
          turnText += t;
          out.send('delta', { n: turn, text: t });
        });
        model = res.model || model;
        if (res.usage) { inTok += (res.usage.input_tokens || 0) + (res.usage.cache_read_input_tokens || 0) + (res.usage.cache_creation_input_tokens || 0); outTok += res.usage.output_tokens || 0; }

        if (res.stop_reason === 'refusal') {
          if (turnText) await out.send('retract', { n: turn });
          await out.send('delta', { n: turn + 100, text: '이 질문에는 답을 드릴 수 없습니다. 노회·총회 자료에 관한 질문으로 다시 물어봐 주세요.' });
          finalText = '(거절)';
          break;
        }
        const uses = res.content.filter(function (b) { return b.type === 'tool_use'; });
        if (res.stop_reason === 'tool_use' && uses.length) {
          /* 이번 턴에 흘려보낸 글은 도구를 부르기 전의 중간 글이므로 화면에서 거둔다 */
          if (turnText) await out.send('retract', { n: turn });
          await out.send('status', { text: uses.map(function (u) { return TOOL_STATUS[u.name] || '자료를 찾는 중'; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' · ') });
          const results = [];
          for (const u of uses) {
            toolsUsed.push(u.name);
            const r = u._bad ? { error: '도구 입력(JSON)이 깨졌습니다. 다시 시도하십시오.' } : await runTool(u.name, u.input, { env: env, auth: me.auth, index: index, cites: cites, me: me });
            results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r).slice(0, 60000) });
          }
          /* 돌려받은 블록(thinking 포함)을 그대로 돌려보낸다 */
          messages.push({ role: 'assistant', content: res.content.map(function (b) { const c = Object.assign({}, b); delete c._bad; return c; }) });
          messages.push({ role: 'user', content: results });
          await out.send('status', { text: '답을 정리하는 중' });
          continue;
        }
        finalText = res.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
        if (!finalText && res.stop_reason === 'max_tokens') finalText = turnText;
        break;
      }
      if (!finalText) {
        await out.send('delta', { n: 200, text: '자료를 여러 번 찾았지만 답을 정리하지 못했습니다. 질문을 조금 바꾸어 다시 물어봐 주세요.' });
      }
      const cited = {}, quotes = {};
      (finalText.match(/\[R\d+\]/g) || []).forEach(function (m) { cited[m.slice(1, -1)] = true; });
      /* [R3]{{원문 구절}} — 서랍에서 밑줄 칠 구절 */
      finalText.replace(/\[(R\d+)\]\{\{([^{}]{2,160})\}\}/g, function (m, r, q) { (quotes[r] = quotes[r] || []).push(q.trim()); return m; });
      const srcList = cites.list.map(function (c) { return Object.assign({ cited: !!cited[c.ref], quotes: quotes[c.ref] || [] }, c); });
      await out.send('sources', { list: srcList });
      /* 질문·답·근거를 남기고 그 번호를 화면에 준다 (화면은 이 번호로 평가 단추를 단다) */
      const logId = await logRow({
        answer: finalText.slice(0, 20000),
        sources: srcList.slice(0, 30).map(function (c) {
          return { ref: c.ref, title: c.title, url: c.url, kind: c.kind, cited: c.cited, quotes: c.quotes.slice(0, 4),
                   snippet: c.cited ? String(c.snippet || '').slice(0, 600) : undefined };
        }),
        no_answer: isNoAnswer(finalText, Object.keys(cited).length)
      });
      if (logId) await out.send('logged', { id: logId });
      if (finalText && finalText !== '(거절)') {
        try {
          const t = await histSave(env, me.id, threadId, {
            q: question, a: finalText.slice(0, 20000), at: new Date().toISOString(), log: logId || undefined,
            sources: srcList.slice(0, 24).map(function (c) { return Object.assign({}, c, { snippet: String(c.snippet || '').slice(0, c.cited ? 800 : 300) }); })
          });
          await out.send('saved', { thread: t.id, title: t.title, n: t.turns.length, updated: t.updated, preview: histPreview(finalText) });
        } catch (e) { /* 내역 저장이 안 되어도 답은 그대로 */ }
      }
      await out.send('usage', { model: model, input_tokens: inTok, output_tokens: outTok, ms: Date.now() - started, tools: toolsUsed });
      await out.send('done', {});
    } catch (e) {
      await out.send('error', { message: (e && e.message) || String(e) });
    } finally {
      await out.close();
      try {
        await bump(env, me.id);
        /* 오류로 끝나 아직 남기지 못했으면 여기서 남긴다 */
        await logRow({ answer: finalText ? finalText.slice(0, 20000) : null, no_answer: true });
      } catch (e) {}
    }
  })());

  return new Response(readable, {
    status: 200,
    headers: Object.assign({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }, cors(origin))
  });
}

/* ---------- 답 평가 (127 sql 의 ai_feedback) ----------
 * 질문한 분의 증표로 쓰므로 본인 질문의 답에만, 본인 이름으로만 들어간다 (서버 RLS).
 * 다시 누르면 평가가 바뀐다. 내 질문 내역(KV)의 그 문답에도 표시해 둔다. */
async function feedback(request, env, origin) {
  const me = await whoIs(request, env);
  if (!me) return reply({ error: '로그인이 확인되지 않았습니다. 다시 로그인해 주세요.' }, 401, origin);
  const body = await request.json().catch(function () { return null; });
  const id = body ? Number(body.id) : NaN;
  if (!Number.isInteger(id) || id <= 0) return reply({ error: '평가할 답을 찾지 못했습니다.' }, 400, origin);
  if (typeof body.helpful !== 'boolean') return reply({ error: '평가를 골라 주세요.' }, 400, origin);
  const reason = body.helpful ? null : (String(body.reason || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null);
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/ai_feedback?on_conflict=log_id', {
    method: 'POST',
    headers: { Authorization: me.auth, apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json',
               Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ log_id: id, user_id: me.id, helpful: body.helpful, reason: reason })
  });
  if (!r.ok) {
    const t = await r.text().catch(function () { return ''; });
    if (r.status === 404 || /42P01|PGRST205|does not exist|schema cache/.test(t)) {
      return reply({ error: '평가 기능이 아직 준비되지 않았습니다. (관리자가 supabase/127_ai_learning.sql 을 실행해야 합니다)' }, 503, origin);
    }
    if (r.status === 401 || r.status === 403 || /42501|row-level security/.test(t)) {
      return reply({ error: '본인 질문의 답에만 평가할 수 있습니다.' }, 403, origin);
    }
    return reply({ error: '평가를 저장하지 못했습니다 (HTTP ' + r.status + ').' }, 502, origin);
  }
  try {
    const h = await histGet(env, me.id);
    let hit = false;
    h.threads.forEach(function (t) {
      t.turns.forEach(function (u) { if (u.log === id) { u.fb = body.helpful ? 'up' : 'down'; hit = true; } });
    });
    if (hit) await env.AI_KV.put(histKey(me.id), JSON.stringify(h));
  } catch (e) { /* 내역 표시는 못 해도 평가는 저장됐다 */ }
  return reply({ ok: true, id: id, helpful: body.helpful, reason: reason }, 200, origin);
}

/* ---------- 임원 업무 보고서 (reports.js, 128 sql) ---------- */
/* 예약 실행(cron)은 실행 위치 고정이 먹지 않아 홍콩에서 돌면 Claude 가 403 으로 거절한다 (2026-10-21).
 * 그래서 보고서의 Claude 호출은 도쿄에 고정된 내부 중계 워커 sihwasan-claude(서비스 바인딩 CLAUDE)를 거친다. */
function reportDeps(s, env) {
  const via = env && env.CLAUDE ? function (u, init) { return env.CLAUDE.fetch(u, init); } : null;
  return { claudeCall: function (key, body, onText) { return claudeCall(key, body, onText, via); },
    key: s.api_key, model: s.report_model || s.model, effort: s.report_effort || 'medium' };
}
/* 실패도 마지막 실행 기록에 남긴다 (관리자 화면에서 보이게) */
async function saveRunError(env, trigger, by, message) {
  if (!env.REPORT_KEY) return;
  await fetch(env.SUPABASE_URL + '/rest/v1/rpc/ai_report_save', {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: env.REPORT_KEY, p_data: { run: { trigger: trigger, by: by || null, finished_at: new Date().toISOString(), reports: 0, errors: [String(message).slice(0, 300)] } } })
  }).catch(function () {});
}
/* 두 번 겹쳐 돌지 않게 KV 에 잠금 (15분이면 저절로 풀린다) */
async function reportLock(env, who) {
  const cur = await env.AI_KV.get('report:lock');
  if (cur) return cur;
  await env.AI_KV.put('report:lock', who + ' · ' + new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(11, 16), { expirationTtl: 900 });
  return null;
}
async function reportsRun(request, env, ctx, origin) {
  const me = await whoIs(request, env);
  if (!me) return reply({ error: '로그인이 확인되지 않았습니다. 다시 로그인해 주세요.' }, 401, origin);
  /* 노회장·서기·최고관리자 (2단계 인증까지) — 128 sql 의 ai_report_reader 로 서버가 판정 */
  const chk = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/ai_report_reader', {
    method: 'POST', headers: { Authorization: me.auth, apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: '{}'
  });
  const allowed = chk.ok && (await chk.json().catch(function () { return false; })) === true;
  if (!allowed) return reply({ error: '노회장·서기(2단계 인증을 마친 로그인)만 보고서를 다시 만들 수 있습니다.' }, 403, origin);
  const s = await getSettings(env);
  if (!s.api_key) return reply({ error: 'AI 열쇠(API 키)가 없습니다. 「AI 검색·API 설정」에서 넣어 주세요.' }, 503, origin);
  if (!env.REPORT_KEY) return reply({ error: '창구에 보고서 열쇠(REPORT_KEY)가 설정되지 않았습니다.' }, 503, origin);
  const body = await request.json().catch(function () { return {}; });
  const only = /^[0-9a-f-]{36}$/.test(String(body.only || '')) ? String(body.only) : null;
  const busy = await reportLock(env, me.name || '관리자');
  if (busy) return reply({ error: '지금 보고서를 만들고 있습니다 (' + busy + ' 시작). 끝난 뒤 다시 눌러 주세요.' }, 409, origin);

  const { readable, writable } = new TransformStream();
  const out = sse(writable.getWriter());
  ctx.waitUntil((async function () {
    /* 오래 걸리는 동안 연결이 끊기지 않게 15초마다 신호 */
    const hb = setInterval(function () { out.send('ping', {}); }, 15000);
    try {
      const run = await runReports(env, reportDeps(s, env), { trigger: 'manual', only: only, by: me.name }, function (t) { out.send('progress', { text: t }); });
      await out.send('done', run);
    } catch (e) {
      await saveRunError(env, 'manual', me.name, (e && e.message) || e);
      await out.send('error', { message: (e && e.message) || String(e) });
    } finally {
      clearInterval(hb);
      await env.AI_KV.delete('report:lock').catch(function () {});
      await out.close();
    }
  })());
  return new Response(readable, {
    status: 200,
    headers: Object.assign({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }, cors(origin))
  });
}
/* 매일 아침 6시 (wrangler.toml 의 crons) */
async function reportsCron(env) {
  const s = await getSettings(env);
  if (s.report_enabled === false || !s.api_key || !env.REPORT_KEY) return;
  const busy = await reportLock(env, '예약 실행');
  if (busy) return;
  try {
    /* 예약 실행은 Cloudflare 가 15분에서 끊으므로 13분이 지나면 새 보고서를 시작하지 않는다 */
    await runReports(env, reportDeps(s, env), { trigger: 'cron', deadline: Date.now() + 13 * 60 * 1000 });
  } catch (e) {
    await saveRunError(env, 'cron', null, (e && e.message) || e);
  } finally {
    await env.AI_KV.delete('report:lock').catch(function () {});
  }
}

/* ---------- 관리자 설정 ---------- */
async function settings(request, env, origin, test) {
  const me = await whoIs(request, env);
  if (!me) return reply({ error: '로그인이 확인되지 않았습니다.' }, 401, origin);
  if (ADMIN_ROLES.indexOf(me.role) === -1) return reply({ error: '관리자(노회장·서기·간사·최고관리자)만 설정할 수 있습니다.' }, 403, origin);
  const s = await getSettings(env);

  if (request.method === 'GET') {
    return reply(publicSettings(s, { usage: await usageToday(env, me.id) }), 200, origin);
  }
  const body = await request.json().catch(function () { return {}; });

  if (test) {
    const key = (body.api_key && String(body.api_key).trim()) || s.api_key;
    if (!key) return reply({ ok: false, error: '열쇠가 없습니다.' }, 200, origin);
    const r = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
    const raw = await r.text().catch(function () { return ''; });
    let data = null; try { data = JSON.parse(raw); } catch (e) {}
    if (!r.ok) return reply({ ok: false, error: explain(r.status, data, raw) }, 200, origin);
    const ids = ((data && data.data) || []).map(function (m) { return m.id; });
    const out = { ok: true, models: ids };
    const model = (body.model && String(body.model)) || s.model;
    if (body.full) {
      try {
        const res = await claudeCall(key, { model: model, max_tokens: 60, output_config: { effort: 'low' },
          messages: [{ role: 'user', content: '한 문장으로 짧게 인사해 주세요.' }] }, null);
        out.reply = res.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
        out.model = res.model; out.usage = res.usage;
      } catch (e) { out.ok = false; out.error = e.message; }
    }
    return reply(out, 200, origin);
  }

  const next = Object.assign({}, s);
  if (typeof body.api_key === 'string' && body.api_key.trim()) next.api_key = body.api_key.trim();
  if (body.clear_key === true) delete next.api_key;
  if (typeof body.model === 'string' && MODELS.some(function (m) { return m.id === body.model; })) next.model = body.model;
  if (typeof body.effort === 'string' && ['low', 'medium', 'high'].indexOf(body.effort) !== -1) next.effort = body.effort;
  if (Number.isInteger(body.daily_user) && body.daily_user >= 1 && body.daily_user <= 500) next.daily_user = body.daily_user;
  if (Number.isInteger(body.daily_total) && body.daily_total >= 1 && body.daily_total <= 5000) next.daily_total = body.daily_total;
  if (Array.isArray(body.roles)) {
    const ok = ['superadmin', 'president', 'clerk', 'staff', 'officer', 'member', 'associate', 'advisory', 'general'];
    next.roles = body.roles.filter(function (r) { return ok.indexOf(r) !== -1; });
    ADMIN_ROLES.forEach(function (r) { if (next.roles.indexOf(r) === -1) next.roles.push(r); });
  }
  if (typeof body.enabled === 'boolean') next.enabled = body.enabled;
  if (typeof body.report_enabled === 'boolean') next.report_enabled = body.report_enabled;
  if (typeof body.report_model === 'string' && (body.report_model === '' || MODELS.some(function (m) { return m.id === body.report_model; }))) next.report_model = body.report_model;
  if (typeof body.report_effort === 'string' && ['low', 'medium', 'high'].indexOf(body.report_effort) !== -1) next.report_effort = body.report_effort;
  next.updated_at = new Date().toISOString();
  next.updated_by = me.name || me.id;
  await env.AI_KV.put('settings', JSON.stringify(next));
  return reply(publicSettings(next, { saved: true, usage: await usageToday(env, me.id) }), 200, origin);
}

/* ---------- 회의자료 책자 쪽 읽기 (관리자) ----------
 * 홈페이지(presbytery-report.html)가 PDF 한 쪽(펼침면)을 그림으로 바꿔 보내면,
 * Claude 가 왼쪽·오른쪽 면을 나누어 인쇄 쪽 번호·제목·글을 그대로 받아 적는다. */
const OCR_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    pages: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: {
        no: { type: ['integer', 'null'], description: '그 면에 인쇄된 쪽 번호. 없으면 null' },
        heading: { type: ['string', 'null'], description: '그 면의 큰 제목 (예: 서기 사무보고, 재정부 보고). 없으면 null' },
        text: { type: 'string', description: '그 면의 글 전부. 줄은 그대로 바꾸고, 표는 줄마다 칸을 " | "로 나눈다. 빈 면이면 빈 글' }
      }, required: ['no', 'heading', 'text'] } },
    toc: { type: 'array', description: '이 면이 차례(목차)면 그 항목들. 아니면 빈 배열', items: { type: 'object', additionalProperties: false,
      properties: { title: { type: 'string' }, page: { type: 'integer' }, level: { type: 'integer', description: '1=큰 항목, 2=작은 항목' } },
      required: ['title', 'page', 'level'] } }
  },
  required: ['pages', 'toc']
};
const OCR_PROMPT =
  '이 그림은 대한예수교장로회 시화산노회 정기노회 회의자료 책자의 한 쪽을 스캔한 것입니다. 보통 왼쪽 면과 오른쪽 면이 함께 보입니다(펼침면). ' +
  '면마다 따로, 인쇄된 쪽 번호(보통 아래 가운데 동그라미 안 숫자), 그 면의 큰 제목, 그리고 글 전부를 받아 적어 주세요. ' +
  '글자를 바꾸거나 요약하지 말고 보이는 그대로 적습니다. 이름·교회 이름·숫자·날짜·금액은 특히 정확하게 적습니다. ' +
  '표는 줄마다 칸을 " | "로 나누어 적고, 점선(……)으로 이어진 차례는 "항목 … 쪽" 꼴로 적습니다. ' +
  '빈 면이나 그림만 있는 면은 text 를 빈 글로 두고 no 는 null 로 둡니다. 차례(목차) 면이면 toc 에 항목과 쪽 번호를 적습니다. 왼쪽 면을 먼저, 오른쪽 면을 다음에 둡니다.';

async function ocrPage(request, env, origin) {
  const me = await whoIs(request, env);
  if (!me) return reply({ error: '로그인이 확인되지 않았습니다.' }, 401, origin);
  if (ADMIN_ROLES.indexOf(me.role) === -1) return reply({ error: '관리자만 책자를 읽힐 수 있습니다.' }, 403, origin);
  const s = await getSettings(env);
  if (!s.api_key) return reply({ error: 'AI 열쇠(API 키)가 아직 등록되지 않았습니다.' }, 503, origin);
  const body = await request.json().catch(function () { return null; });
  if (!body || !body.image) return reply({ error: '그림이 없습니다.' }, 400, origin);
  if (String(body.image).length > 9 * 1024 * 1024) return reply({ error: '그림이 너무 큽니다.' }, 400, origin);
  const mt = ['image/jpeg', 'image/png', 'image/webp'].indexOf(body.media_type) !== -1 ? body.media_type : 'image/jpeg';
  const req = {
    model: s.model,
    max_tokens: 8000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: OCR_SCHEMA } },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mt, data: String(body.image) } },
      { type: 'text', text: OCR_PROMPT + (body.hint ? ' (책자: ' + String(body.hint).slice(0, 80) + ', PDF ' + (body.pdf_page || '?') + '쪽)' : '') }
    ] }]
  };
  try {
    const res = await claudeCall(s.api_key, req, null);
    if (res.stop_reason === 'refusal') return reply({ error: '이 쪽은 읽을 수 없다고 응답했습니다.' }, 200, origin);
    const text = res.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
    let out = null;
    try { out = JSON.parse(text); } catch (e) { return reply({ error: '읽은 결과를 해석하지 못했습니다.' }, 200, origin); }
    out.model = res.model; out.usage = res.usage ? { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } : null;
    return reply(out, 200, origin);
  } catch (e) {
    return reply({ error: (e && e.message) || String(e) }, 502, origin);
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'OPTIONS') return reply(null, 204, origin);
    try {
      if (path === '/' || path === '/health') {
        const s = await getSettings(env);
        let idx = null;
        try { idx = await getIndex(env); } catch (e) {}
        return reply({ ok: true, service: '시화산노회 AI 자료 검색', ready: !!s.api_key && s.enabled, model: s.model,
                       index: idx ? { chunks: idx.N, built: INDEX_BUILT } : null, colo: (request.cf && request.cf.colo) || null }, 200, origin);
      }
      if (path === '/ask' && request.method === 'POST') return await answer(request, env, ctx, origin);
      if (path === '/feedback' && request.method === 'POST') return await feedback(request, env, origin);
      if (path === '/reports/run' && request.method === 'POST') return await reportsRun(request, env, ctx, origin);
      if (path === '/history' || path.indexOf('/history/') === 0) return await historyApi(request, env, origin, path);
      if (path === '/ocr' && request.method === 'POST') return await ocrPage(request, env, origin);
      if (path === '/settings' && (request.method === 'GET' || request.method === 'POST')) return await settings(request, env, origin, false);
      if (path === '/settings/test' && request.method === 'POST') return await settings(request, env, origin, true);
      return reply({ error: '없는 주소입니다.' }, 404, origin);
    } catch (e) {
      return reply({ error: (e && e.message) || String(e) }, 500, origin);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(reportsCron(env));
  }
};

/* 시화산노회 AI 자료 검색 창구 (Cloudflare Worker → Claude API)
 *
 * 홈페이지 첫 화면의 검색창이 질문을 보내면, 로그인한 분이 누구이고 어떤 등급인지
 * Supabase 에 확인한 뒤 Claude 에게 묻는다. Claude 는 도구(tools.js)로 총회 자료와
 * 노회 자료를 찾아 근거를 달아 답하고, 답은 글자가 나오는 대로 홈페이지로 흘려보낸다(SSE).
 *
 * 하는 일
 *   POST /ask             { question, history? }  →  SSE 흐름 (status / delta / retract / sources / usage / done / error)
 *   GET  /health          창구가 살아 있는가, 열쇠가 등록되어 있는가
 *   GET  /settings        (관리자) 모델·한도·허용 등급·열쇠 등록 여부·오늘 사용량
 *   POST /settings        (관리자) 설정 저장 — api_key 를 주면 열쇠를 바꾼다
 *   POST /settings/test   (관리자) 열쇠로 모델 목록을 받아 보고, 고른 모델로 아주 짧은 인사를 시켜 본다
 *
 * 설정과 열쇠는 Cloudflare KV(AI_KV) 에 둔다. 관리자가 홈페이지 「AI 검색·API 설정」에서 넣는다.
 *   KV 'settings' = { api_key, model, effort, daily_user, daily_total, roles[], enabled, updated_at, updated_by }
 *   KV 'u:<날짜>:<회원id>' / 'u:<날짜>:all' = 오늘 질문 수
 *
 * 누가 쓸 수 있나
 *   로그인 증표(Bearer)를 Supabase 에 확인하고 profiles.role 이 허용 등급(기본: 정회원 이상)일 때만.
 *   자료는 질문한 분의 증표로 읽으므로 그분이 볼 수 없는 자료(예: 회의록은 임원만)는 Claude 도 보지 못한다.
 */
import { Index } from './search.js';
import { Cites, toolsFor, runTool, TOOL_STATUS } from './tools.js';

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
  enabled: true
};
/* 관리자 화면의 모델 고르기에 보여 줄 목록 (값: 1백만 토큰당 미화) */
export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', input: 4, output: 20, note: '가장 정확함 · 기본값' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', input: 2, output: 10, note: '빠르고 정확함' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', input: 0.1, output: 0.5, note: '가장 저렴하고 빠름' }
];
const MAX_TURNS = 8;          /* 도구를 부르는 횟수 한도 */
const MAX_OUT = 6000;         /* 답 길이(토큰) */

function cors(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

/* ---------- 색인 (홈페이지에서 받아 둔다) ---------- */
let INDEX = null, INDEX_AT = 0, INDEX_BUILT = '';
async function getIndex(env) {
  if (INDEX && Date.now() - INDEX_AT < 6 * 3600 * 1000) return INDEX;
  const r = await fetch((env.SITE_URL || 'https://sihwasan.org') + '/data/ai/index.json', { cf: { cacheTtl: 21600, cacheEverything: true } });
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
async function claudeStream(key, body, beta, onText) {
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
  if (beta) headers['anthropic-beta'] = beta;
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: headers, body: JSON.stringify(Object.assign({ stream: true }, body)) });
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
async function claudeCall(key, body, onText) {
  let withFb = true;
  for (let i = 0; i < 3; i++) {
    try {
      const b = Object.assign({}, body);
      if (withFb) b.fallbacks = 'default';
      return await claudeStream(key, b, withFb ? 'server-side-fallback-2026-07-01' : '', onText);
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
    '- 노회 사람·교회·조직·일정·공지·결의·회의록·시찰·상비부는 그에 맞는 search_* / get_organization 도구로 찾습니다.',
    '- 처음 찾은 결과가 질문과 맞지 않으면 낱말을 바꾸거나 범위를 좁혀 두세 번 더 찾습니다. 필요하면 여러 도구를 함께 씁니다.',
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

  const { readable, writable } = new TransformStream();
  const out = sse(writable.getWriter());
  const cites = new Cites();
  const tools = toolsFor(me.role);
  const messages = history.concat([{ role: 'user', content: question }]);
  const started = Date.now();
  const toolsUsed = [];
  let finalText = '', inTok = 0, outTok = 0, model = s.model;

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
      await out.send('sources', { list: cites.list.map(function (c) { return Object.assign({ cited: !!cited[c.ref], quotes: quotes[c.ref] || [] }, c); }) });
      await out.send('usage', { model: model, input_tokens: inTok, output_tokens: outTok, ms: Date.now() - started, tools: toolsUsed });
      await out.send('done', {});
    } catch (e) {
      await out.send('error', { message: (e && e.message) || String(e) });
    } finally {
      await out.close();
      try {
        await bump(env, me.id);
        /* 질문 기록 (114 sql 의 ai_logs — 없으면 조용히 넘어간다).
         * 최고관리자는 홈페이지를 유지·보수하는 운영자 계정이라 그 활동은 기록하지 않는다 (감사 기록과 같은 규칙). */
        if (me.role !== 'superadmin') await fetch(env.SUPABASE_URL + '/rest/v1/ai_logs', {
          method: 'POST',
          headers: { Authorization: me.auth, apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ user_id: me.id, user_name: me.name, role: me.role, question: question.slice(0, 1500), answer_chars: finalText.length,
            model: model, input_tokens: inTok, output_tokens: outTok, tools: toolsUsed, ms: Date.now() - started })
        }).catch(function () {});
      } catch (e) {}
    }
  })());

  return new Response(readable, {
    status: 200,
    headers: Object.assign({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }, cors(origin))
  });
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
  next.updated_at = new Date().toISOString();
  next.updated_by = me.name || me.id;
  await env.AI_KV.put('settings', JSON.stringify(next));
  return reply(publicSettings(next, { saved: true, usage: await usageToday(env, me.id) }), 200, origin);
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
      if (path === '/settings' && (request.method === 'GET' || request.method === 'POST')) return await settings(request, env, origin, false);
      if (path === '/settings/test' && request.method === 'POST') return await settings(request, env, origin, true);
      return reply({ error: '없는 주소입니다.' }, 404, origin);
    } catch (e) {
      return reply({ error: (e && e.message) || String(e) }, 500, origin);
    }
  }
};

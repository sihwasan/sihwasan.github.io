/* node cloudflare/ai/test/learning.test.mjs
 * 「쓰면 쓸수록 나아지는」 구조(127 sql) 시험 — 바깥(Supabase·Claude·홈페이지)은 모두 가짜로 바꾼다.
 *   1) 확인된 답 고르기(matchVerified)
 *   2) /ask 한 번: 확인된 답 도구 → 근거 → ai_logs 에 답 본문·근거·못 찾음 표시 → 'logged' 번호
 *      (정회원 증표로는 임원용 확인된 답이 보이지 않는다 — 가짜 RLS)
 *   3) search_assembly 결과 맨 앞에 확인된 답
 *   4) /feedback: 본인 평가 저장 + 내 질문 내역에 표시, 남의 답이면 403
 */
import worker, { isNoAnswer } from '../src/index.js';
import { matchVerified, runTool, Cites, toolsFor } from '../src/tools.js';
import { Index } from '../src/search.js';

let fails = 0, passes = 0;
function ok(c, m) { if (c) { passes++; console.log('  통과', m); } else { fails++; console.log('  실패', m); } }

const VERIFIED = [
  { id: 1, question: '권징조례에서 해벌 절차는 어떻게 되나요?', keywords: '해벌 복직', answer: '해벌은 그 회개 여부에 의하여 행한다 (근거: 권징조례 제35조).',
    sources: [{ title: '총회 헌법 권징조례 제35조' }], level: 'member', updated_at: '2026-10-20T10:00:00Z' },
  { id: 2, question: '임원회 비공개 결의 내용', keywords: '', answer: '임원용 답입니다.', sources: [], level: 'officer', updated_at: '2026-10-20T09:00:00Z' },
  { id: 3, question: '정기노회 장소는 어디인가요', keywords: '', answer: '장소는 해마다 다릅니다.', sources: [], level: 'member', updated_at: '2026-10-19T09:00:00Z' }
];
const CHUNKS = [
  { src: '총회 헌법 > 권징조례', label: '권징조례 제35조', title: '권징조례 제35조', url: 'assembly-constitution.html#d35', text: '제35조 해벌은 그 회개 여부에 의하여 행하거나 치리회의 결정으로 한다.' },
  { src: '총회 헌법 > 정치', label: '정치 제10장 제3조', title: '정치 제10장 제3조', url: 'assembly-constitution.html#p10-3', text: '노회는 목사와 장로로 조직한다.' }
];

console.log('[확인된 답 고르기]');
let m = matchVerified(VERIFIED, '권징조례에서 해벌은 어떻게 하나요?', 3);
ok(m.length >= 1 && m[0].v.id === 1, '해벌 질문 → 확인된 답 1번 (' + m.map((x) => x.v.id + ':' + x.score).join(', ') + ')');
m = matchVerified(VERIFIED, '해벌절차', 3);
ok(m.length === 1 && m[0].v.id === 1, '띄어쓰기 없이 물어도 찾음');
m = matchVerified(VERIFIED, '상회비 미납 교회', 3);
ok(m.length === 0, '맞지 않는 질문엔 아무것도 내지 않음');
ok(isNoAnswer('자료에서 확인되지 않습니다.', 1) && isNoAnswer('답 [R1]', 0) && !isNoAnswer('해벌은 ... [R1]', 1) && isNoAnswer('(거절)', 0), '「못 찾음」 판정');

/* ---------- 가짜 바깥 세상 ---------- */
const KV = new Map();
const env = {
  SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon', SITE_URL: 'https://site.test',
  AI_KV: {
    async get(k, t) { const v = KV.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { KV.set(k, v); }, async delete(k) { KV.delete(k); }
  }
};
KV.set('settings', JSON.stringify({ api_key: 'sk-ant-test', model: 'claude-sonnet-5-5' }));
const USERS = { 'Bearer mem': { id: 'u-mem', name: '회원A', role: 'member' }, 'Bearer off': { id: 'u-off', name: '임원갑', role: 'officer' } };
const calls = { logs: [], feedback: [], claude: [] };
let claudeTurn = 0, feedbackFail = false;

function sseBody(events) {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { events.forEach((e) => c.enqueue(enc.encode('data: ' + JSON.stringify(e) + '\n\n'))); c.close(); } });
}
function claudeReply(req) {
  calls.claude.push(req);
  claudeTurn++;
  if (claudeTurn === 1) {
    return sseBody([
      { type: 'message_start', message: { model: req.model, usage: { input_tokens: 100 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'search_verified_answers', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"권징조례 해벌 절차"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu2', name: 'get_assembly_article', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"book":"권징조례","article":35}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } }
    ]);
  }
  const text = '해벌은 회개 여부에 따라 행합니다[R1]{{해벌은 그 회개 여부에 의하여 행한다}}[R2]{{해벌은 그 회개 여부에 의하여 행하거나}}.';
  return sseBody([
    { type: 'message_start', message: { model: req.model, usage: { input_tokens: 300 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } }
  ]);
}
globalThis.fetch = async function (url, init) {
  url = String(url); init = init || {};
  const auth = (init.headers && init.headers.Authorization) || '';
  const json = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://site.test/data/ai/index.json')) return json({ chunks: CHUNKS, built: '2026-10-20' });
  if (url === 'https://sb.test/auth/v1/user') return USERS[auth] ? json({ id: USERS[auth].id }) : json({}, 401);
  if (url.startsWith('https://sb.test/rest/v1/profiles')) return json(USERS[auth] ? [USERS[auth]] : []);
  if (url.startsWith('https://sb.test/rest/v1/ai_verified')) {
    const u = USERS[auth];   /* 가짜 RLS: 정회원은 member 만, 임원은 member+officer */
    return json(VERIFIED.filter((v) => v.level === 'member' || (v.level === 'officer' && u && u.role === 'officer')));
  }
  if (url.startsWith('https://sb.test/rest/v1/ai_logs')) { calls.logs.push(JSON.parse(init.body)); return json([{ id: 77 }], 201); }
  if (url.startsWith('https://sb.test/rest/v1/ai_feedback')) {
    calls.feedback.push({ url: url, auth: auth, prefer: init.headers.Prefer, body: JSON.parse(init.body) });
    return feedbackFail ? json({ code: '42501', message: 'new row violates row-level security policy' }, 403) : new Response(null, { status: 201 });
  }
  if (url === 'https://api.anthropic.com/v1/messages') return new Response(claudeReply(JSON.parse(init.body)), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  return json({ error: 'no mock ' + url }, 404);
};

async function readSse(res) {
  const txt = await res.text();
  return txt.split('\n\n').filter(Boolean).map((b) => {
    const ev = (b.match(/^event: (.*)$/m) || [])[1];
    const data = (b.match(/^data: (.*)$/m) || [])[1];
    return { ev: ev, data: data ? JSON.parse(data) : null };
  });
}
function req(path, method, auth, body) {
  return new Request('https://w.test' + path, { method: method, headers: { Authorization: auth, 'Content-Type': 'application/json', Origin: 'https://sihwasan.org' }, body: body ? JSON.stringify(body) : undefined });
}

console.log('\n[/ask — 정회원]');
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const res = await worker.fetch(req('/ask', 'POST', 'Bearer mem', { question: '권징조례에서 해벌은 어떻게 하나요?' }), env, ctx);
const evs = await readSse(res);
await Promise.all(waits);
const names = evs.map((e) => e.ev);
ok(names.join(',').indexOf('sources,logged,saved,usage,done') !== -1, 'SSE 순서: … sources → logged → saved → usage → done (' + names.filter((n) => n !== 'delta' && n !== 'status').join(',') + ')');
const logged = evs.find((e) => e.ev === 'logged');
ok(logged && logged.data.id === 77, '질문 기록 줄 번호(77)를 화면에 돌려줌');
const sys = calls.claude[0].system[0].text;
ok(/search_verified_answers/.test(sys) && /원문/.test(sys), 'systemPrompt 에 확인된 답 우선·원문 재확인 지시');
ok(calls.claude[0].tools[0].name === 'search_verified_answers', '도구 목록 맨 앞이 search_verified_answers');
const toolMsg = JSON.stringify(calls.claude[1].messages[calls.claude[1].messages.length - 1]);
ok(toolMsg.indexOf('해벌은 그 회개 여부에 의하여 행한다') !== -1, 'Claude 에게 확인된 답이 넘어감');
ok(toolMsg.indexOf('임원용 답') === -1, '정회원 질문에 임원용 확인된 답은 넘어가지 않음');
const src = evs.find((e) => e.ev === 'sources').data.list;
ok(src[0].kind === '확인된 답(관리자 승인)' && src[0].cited && src[1].cited, '근거 1번이 「확인된 답(관리자 승인)」, 원문 조문도 근거로 인용됨');
const lg = calls.logs[0];
ok(lg && lg.answer.indexOf('[R1]{{') !== -1 && lg.no_answer === false && lg.sources.length === 2 && lg.thread && lg.user_id === 'u-mem',
  'ai_logs 에 답 본문(근거 표시 포함)·근거 목록·no_answer=false·대화 번호');
const hist = JSON.parse(KV.get('h:u-mem'));
ok(hist.threads[0].id === lg.thread && hist.threads[0].turns[0].log === 77, '내 질문 내역의 대화 번호 = 기록의 대화 번호, 문답에 기록 번호');

console.log('\n[search_assembly 앞에 확인된 답]');
const c1 = { env: env, auth: 'Bearer off', index: new Index(CHUNKS), cites: new Cites(), me: { role: 'officer' } };
const r1 = await runTool('search_assembly', { query: '해벌 절차' }, c1);
ok(Object.keys(r1)[0] === 'verified' && r1.verified[0].question.indexOf('해벌') !== -1 && r1.items.length >= 1, 'verified 가 items 보다 먼저');
const r2 = await runTool('search_assembly', { query: '해벌' }, c1);
ok(!r2.verified, '같은 질문 안에서 이미 보여 준 확인된 답은 되풀이하지 않음');
const r3 = await runTool('search_verified_answers', { query: '임원회 결의' }, c1);
ok(r3.items.length === 1 && r3.items[0].level === '임원 이상', '임원 증표로는 임원용 확인된 답이 보임');
ok(toolsFor('member').some((t) => t.name === 'search_verified_answers'), '정회원 도구 목록에도 있음');

console.log('\n[/feedback]');
let fr = await worker.fetch(req('/feedback', 'POST', 'Bearer mem', { id: 77, helpful: false, reason: '  조문 번호가   틀렸어요 ' }), env, ctx);
let fj = await fr.json();
const fb = calls.feedback[0];
ok(fr.status === 200 && fj.ok, '평가 저장 200');
ok(fb.url.indexOf('on_conflict=log_id') !== -1 && /merge-duplicates/.test(fb.prefer) && fb.auth === 'Bearer mem', '본인 증표로 upsert (다시 누르면 바뀜)');
ok(fb.body.log_id === 77 && fb.body.user_id === 'u-mem' && fb.body.helpful === false && fb.body.reason === '조문 번호가 틀렸어요', '이유는 다듬어 300자까지');
ok(JSON.parse(KV.get('h:u-mem')).threads[0].turns[0].fb === 'down', '내 질문 내역에도 「아니에요」 표시');
fr = await worker.fetch(req('/feedback', 'POST', 'Bearer mem', { id: 77, helpful: true, reason: '무시됨' }), env, ctx);
ok(calls.feedback[1].body.reason === null && JSON.parse(KV.get('h:u-mem')).threads[0].turns[0].fb === 'up', '「도움이 됐어요」로 바꾸면 이유는 지움');
fr = await worker.fetch(req('/feedback', 'POST', 'Bearer mem', { id: 'x', helpful: true }), env, ctx);
ok(fr.status === 400, '번호가 이상하면 400');
fr = await worker.fetch(req('/feedback', 'POST', 'Bearer nobody', { id: 77, helpful: true }), env, ctx);
ok(fr.status === 401, '로그인 안 했으면 401');
feedbackFail = true;
fr = await worker.fetch(req('/feedback', 'POST', 'Bearer off', { id: 77, helpful: true }), env, ctx);
fj = await fr.json();
ok(fr.status === 403 && /본인 질문/.test(fj.error), '남의 답(서버 RLS 거절) → 403 「본인 질문의 답에만」');

console.log('\n결과: 통과 ' + passes + ' · 실패 ' + fails);
process.exit(fails ? 1 : 0);

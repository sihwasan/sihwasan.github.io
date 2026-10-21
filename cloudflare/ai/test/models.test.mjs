/* node cloudflare/ai/test/models.test.mjs
 * AI 허용 범위 (2026-10-22) 시험 — 바깥(Supabase·Claude)은 모두 가짜로 바꾼다.
 *   1) pickModel: 최고관리자 Opus · 임원별 모델 · 그 밖은 기본 모델 · 목록에 없는 값은 무시
 *   2) /settings user_models: 최고관리자(2단계 인증)만 저장, 노회장·1단계 로그인은 거절, 잘못된 값은 걸러냄
 *   3) /ask: 실제로 Claude 에 보내는 모델이 위 규칙을 따름
 */
import worker, { pickModel, SUPER_MODEL } from '../src/index.js';

let fails = 0, passes = 0;
function ok(c, m) { if (c) { passes++; console.log('  통과', m); } else { fails++; console.log('  실패', m); } }

const OFF = '11111111-2222-3333-4444-555555555555';
const OFF2 = '66666666-7777-8888-9999-000000000000';

console.log('[pickModel]');
const S = { model: 'claude-sonnet-5-5', user_models: { [OFF]: 'claude-haiku-5-5', [OFF2]: 'gpt-x' } };
ok(pickModel(S, { id: 'x', role: 'superadmin' }) === SUPER_MODEL && SUPER_MODEL === 'claude-opus-5-5', '최고관리자는 늘 Opus');
ok(pickModel(S, { id: OFF, role: 'officer' }) === 'claude-haiku-5-5', '정해 둔 임원은 그 모델');
ok(pickModel(S, { id: OFF2, role: 'officer' }) === 'claude-sonnet-5-5', '목록에 없는 모델 값은 무시하고 기본 모델');
ok(pickModel(S, { id: 'm', role: 'member' }) === 'claude-sonnet-5-5', '정해 두지 않은 분은 기본 모델');
ok(pickModel({ model: 'claude-sonnet-5-5' }, { id: OFF, role: 'officer' }) === 'claude-sonnet-5-5', 'user_models 가 없어도 기본 모델');

/* ---------- 가짜 바깥 세상 ---------- */
function jwt(payload) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return 'Bearer ' + b({ alg: 'HS256' }) + '.' + b(payload) + '.sig';
}
const T = {
  super2: jwt({ sub: 'u-super', aal: 'aal2' }),
  super1: jwt({ sub: 'u-super', aal: 'aal1' }),
  pres: jwt({ sub: 'u-pres', aal: 'aal2' }),
  off: jwt({ sub: OFF, aal: 'aal2' }),
  mem: jwt({ sub: 'u-mem', aal: 'aal1' })
};
const USERS = {
  [T.super2]: { id: 'u-super', name: '운영자', role: 'superadmin' },
  [T.super1]: { id: 'u-super', name: '운영자', role: 'superadmin' },
  [T.pres]: { id: 'u-pres', name: '노회장', role: 'president' },
  [T.off]: { id: OFF, name: '임원갑', role: 'officer' },
  [T.mem]: { id: 'u-mem', name: '회원A', role: 'member' }
};
const KV = new Map();
const env = {
  SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon', SITE_URL: 'https://site.test',
  AI_KV: {
    async get(k, t) { const v = KV.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { KV.set(k, v); }, async delete(k) { KV.delete(k); }
  }
};
KV.set('settings', JSON.stringify({ api_key: 'sk-ant-test', model: 'claude-sonnet-5-5' }));
const sent = [];
function sseBody(events) {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { events.forEach((e) => c.enqueue(enc.encode('data: ' + JSON.stringify(e) + '\n\n'))); c.close(); } });
}
globalThis.fetch = async function (url, init) {
  url = String(url); init = init || {};
  const auth = (init.headers && init.headers.Authorization) || '';
  const json = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://site.test/data/ai/index.json')) return json({ chunks: [], built: '2026-10-22' });
  if (url === 'https://sb.test/auth/v1/user') return USERS[auth] ? json({ id: USERS[auth].id }) : json({}, 401);
  if (url.startsWith('https://sb.test/rest/v1/profiles')) return json(USERS[auth] ? [USERS[auth]] : []);
  if (url.startsWith('https://sb.test/rest/v1/ai_verified')) return json([]);
  if (url.startsWith('https://sb.test/rest/v1/ai_logs')) return json([{ id: 1 }], 201);
  if (url === 'https://api.anthropic.com/v1/messages') {
    const req = JSON.parse(init.body);
    sent.push(req.model);
    return new Response(sseBody([
      { type: 'message_start', message: { model: req.model, usage: { input_tokens: 10 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '자료에서 확인되지 않습니다.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }
    ]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  return json({ error: 'no mock ' + url }, 404);
};
function req(path, method, auth, body) {
  return new Request('https://w.test' + path, { method: method, headers: { Authorization: auth, 'Content-Type': 'application/json', Origin: 'https://sihwasan.org' }, body: body ? JSON.stringify(body) : undefined });
}
const ctx = { waitUntil: () => {} };
async function post(auth, body) {
  const r = await worker.fetch(req('/settings', 'POST', auth, body), env, ctx);
  return { status: r.status, body: await r.json() };
}
const stored = () => JSON.parse(KV.get('settings')).user_models;

console.log('\n[/settings user_models]');
let r = await post(T.pres, { user_models: { [OFF]: 'claude-haiku-5-5' } });
ok(r.status === 403 && stored() === undefined, '노회장은 임원별 모델을 저장할 수 없음 (403)');
r = await post(T.super1, { user_models: { [OFF]: 'claude-haiku-5-5' } });
ok(r.status === 403 && /2단계/.test(r.body.error) && stored() === undefined, '최고관리자라도 2단계 인증 전이면 거절');
r = await post(T.super2, { user_models: { [OFF]: 'claude-haiku-5-5', 'not-a-uuid': 'claude-haiku-5-5', [OFF2]: 'gpt-x' } });
ok(r.status === 200 && JSON.stringify(stored()) === JSON.stringify({ [OFF]: 'claude-haiku-5-5' }), '최고관리자(2단계)는 저장, 잘못된 id·모델은 걸러냄');
ok(r.body.user_models[OFF] === 'claude-haiku-5-5' && r.body.super_model === 'claude-opus-5-5', '설정 읽기에 user_models·super_model');
r = await post(T.pres, { daily_user: 40 });
ok(r.status === 200 && stored()[OFF] === 'claude-haiku-5-5', '노회장이 다른 설정을 저장해도 임원별 모델은 그대로');
r = await post(T.super2, { user_models: [] });
ok(r.status === 400 && stored()[OFF] === 'claude-haiku-5-5', '배열 같은 잘못된 값은 400, 기존 값 유지');

console.log('\n[/ask 가 보내는 모델]');
async function ask(auth) {
  const before = sent.length;
  const res = await worker.fetch(req('/ask', 'POST', auth, { question: '정기노회는 언제인가요?' }), env, { waitUntil: (p) => p });
  await res.text();
  return sent[before];
}
ok(await ask(T.super2) === 'claude-opus-5-5', '최고관리자 질문 → Opus');
ok(await ask(T.off) === 'claude-haiku-5-5', '정해 둔 임원 질문 → Haiku');
ok(await ask(T.mem) === 'claude-sonnet-5-5', '정회원 질문 → 기본 모델(Sonnet)');

console.log('\n' + passes + '개 통과, ' + fails + '개 실패');
if (fails) process.exit(1);

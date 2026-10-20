/* node cloudflare/ai/test/reports.test.mjs
 * 임원 업무 보고서(128 sql) 시험 — Supabase·Claude 는 모두 가짜로 바꾼다.
 *   1) 상회비 미납 계산 (duesSummary), 직책 → 보고서 갈래 (dutyOf)
 *   2) runReports: 새 회의록 → 할 일 뽑기 → 저장 → 자료 다시 받기 → 임원마다 보고서 → 저장
 *      (캐시: 모든 부름의 첫 system 글이 같아야 한다, 모르는 task_id 는 0 으로)
 *   3) 한 분 보고서가 실패해도 나머지는 저장되고 오류가 기록된다
 *   4) POST /reports/run: 권한(403) · 잠금(409) · SSE progress/done
 *   5) 예약 실행(scheduled): 끄면 돌지 않고, 켜면 돌고 잠금이 풀린다
 */
import worker from '../src/index.js';
import { runReports, dutyOf, duesSummary, stableContext } from '../src/reports.js';

let fails = 0, passes = 0;
function ok(c, m) { if (c) { passes++; console.log('  통과', m); } else { fails++; console.log('  실패', m); } }

const OFF = [
  { id: '11111111-1111-1111-1111-111111111111', name: '박노회', role: 'president', title: '노회장', church: '시흥교회' },
  { id: '22222222-2222-2222-2222-222222222222', name: '권서기', role: 'clerk', title: '서기', church: '섬김교회' },
  { id: '33333333-3333-3333-3333-333333333333', name: '김회계', role: 'officer', title: '회계', church: '은광교회' }
];
function bundle(tasks, done) {
  return {
    today: '2026-10-21', fiscal_year: 2026, state: { minutes_done: done || [] }, officers: OFF,
    settings: { officers: [{ role: '노회장', name: '박노회' }], sessions: { current: '제20회' } },
    meetings: [{ kind: '봄 정기노회', year: 2027, meet_date: '2027-04-12', place: '미정', confirmed: false }],
    schedule: [{ date: '2026-11-03', title: '임원회' }],
    minutes: [{ id: 2, title: '제20회기 가을 정기노회 회의록', meeting_date: '2026-10-12', created_at: '2026-10-19T13:59:13Z', text: '1. 정치부 보고는 받기로 하다.\n2. 북부시찰 위임 청원은 허락하다.' },
              { id: 1, title: '제19회기 봄 정기노회 회의록', meeting_date: '2026-04-13', created_at: '2026-08-11T01:29:45Z', text: '옛 회의록' }],
    resolutions: [], rules: [{ chapter: '제3장', title: '제9조 (임원의 임무)', body: '3. 서기는 본회의 모든 사무 일체를 담당한다.' }],
    committees: [{ name: '정치부', head: '정부장', clerk: '김서', treasurer: '박회' }], committee_events: [],
    sichals: [{ name: '북부시찰', head: '최시찰' }], boards: [],
    contacts: [{ name: '정부장', church: '나교회', position: '목사', phone: '010-1111-2222' }],
    dues_rates: [{ church: '가교회', pastor: '최목사', monthly: 5 }, { church: '나교회', pastor: '정부장', monthly: 3 }, { church: '다교회', pastor: 'x', monthly: 0 }],
    dues_payments: [{ church: '가교회', month: 4, amount: 5 }, { church: '가교회', month: 5, amount: 5 }, { church: '가교회', month: 6, amount: 5 },
                    { church: '가교회', month: 7, amount: 5 }, { church: '가교회', month: 8, amount: 5 }, { church: '가교회', month: 9, amount: 5 },
                    { church: '가교회', month: 10, amount: 5 }, { church: '나교회', month: 4, amount: 3 }],
    bapdues: { error: 'relation "public.bapdues" does not exist' },
    ledger: { books: [{ id: 1, owner: '노회', year: 2026, opening: 0 }], totals: [{ book: 1, kind: '지출', sum: 120000, n: 1 }],
              recent: [{ date: '2026-10-01', kind: '지출', category: '사업비', title: '임원회 식비', amount: 120000, receipt: false, created: '2026-10-01T00:00:00Z' }],
              payouts_waiting: [{ recipient: '최회원', amount: 50000, title: '거마비', date: '2026-10-12' }] },
    doc_requests: [], petitions: [], tasks: tasks || []
  };
}

console.log('[계산·갈래]');
const ds = duesSummary(bundle());
const ga = ds.rows.find((r) => r.church === '가교회'), na = ds.rows.find((r) => r.church === '나교회'), da = ds.rows.find((r) => r.church === '다교회');
ok(ds.months === 7 && ga.unpaid.length === 0 && na.unpaid.join(',') === '5,6,7,8,9,10' && na.arrears === 18 && da.unpaid.length === 0,
  '10월이면 4~10월 7개월: 가교회 완납, 나교회 5~10월 미납 18만원, 면제 교회는 미납 아님');
ok(ds.unpaidChurches === 1 && ds.arrearsTotal === 18 && ds.paidTotal === 38, '미납 교회 1곳 · 미납 18만원 · 받은 38만원');
ok(dutyOf(OFF[0]) === 'president' && dutyOf(OFF[1]) === 'clerk' && dutyOf(OFF[2]) === 'treasurer' &&
   dutyOf({ role: 'officer', title: '회록서기' }) === 'minutes' && dutyOf({ role: 'officer', title: '부서기' }) === 'vice_clerk' &&
   dutyOf({ role: 'officer', title: '부노회장' }) === 'vice_president' && dutyOf({ role: 'staff', title: '간사' }) === 'staff' &&
   dutyOf({ role: 'officer', title: '' }) === 'officer', '직책 → 보고서 갈래');
const ctx = stableContext(bundle());
ok(/세례의무금[^\n]*읽지 못함/.test(ctx) && /영수증 없음/.test(ctx) && /지급 확인 대기/.test(ctx) && /미납 5·6·7·8·9·10월 \(18만원\)/.test(ctx), '자료 글: 없는 표 표시·영수증 없음·지급 대기·미납 달');
ok(ctx.indexOf('[회의록 2]') !== -1 && ctx.indexOf('정치부 보고는 받기로') === -1, '회의록은 목록만 (본문은 할 일 뽑을 때만)');

/* ---------- 가짜 바깥 ---------- */
const KV = new Map();
const env = {
  SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon', SITE_URL: 'https://site.test', REPORT_KEY: 'secret-key',
  AI_KV: { async get(k, t) { const v = KV.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
           async put(k, v) { KV.set(k, v); }, async delete(k) { KV.delete(k); } }
};
KV.set('settings', JSON.stringify({ api_key: 'sk-ant-test', model: 'claude-haiku-5-5', report_model: 'claude-sonnet-5-5' }));
let calls, saves, bundles, failFor, tasksSaved;
function resetCalls() { calls = []; saves = []; bundles = 0; failFor = ''; tasksSaved = false; }
resetCalls();
const USERS = { 'Bearer clerk': { id: OFF[1].id, name: '권서기', role: 'clerk' }, 'Bearer treas': { id: OFF[2].id, name: '김회계', role: 'officer', title: '회계' } };
function sse(events) {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { events.forEach((e) => c.enqueue(enc.encode('data: ' + JSON.stringify(e) + '\n\n'))); c.close(); } });
}
function claude(req) {
  calls.push(req);
  const schema = req.output_config && req.output_config.format && req.output_config.format.schema;
  const isTasks = schema && schema.required && schema.required[0] === 'tasks';
  const who = JSON.stringify(req.messages).match(/(박노회|권서기|김회계)/);
  if (who && who[1] === failFor) return new Response(JSON.stringify({ error: { type: 'api_error', message: 'boom' } }), { status: 400 });
  const out = isTasks
    ? { tasks: [{ owner: 'clerk', dept_kind: '상비부', dept_name: '정치부', title: '정치부 — 보고 후속 처리', detail: '결의대로', due_date: '', contact_name: '정부장', quote: '정치부 보고는 받기로 하다' }] }
    : { headline: (who ? who[1] : '?') + ' 오늘 할 일', sections: [{ title: '요약', items: ['항목'] }],
        todos: [{ title: '정치부 연락', detail: 'x', target_kind: '상비부', target_name: '정치부', contact_name: '정부장', contact_phone: '010-1111-2222', due: '', priority: '높음', message: '정부장 목사님께', task_id: 101 },
                { title: '없는 번호', detail: 'x', target_kind: '기타', target_name: '', contact_name: '', contact_phone: '', due: '', priority: '낮음', message: '', task_id: 999 }],
        checks: ['영수증 없는 지출 1건'] };
  return new Response(sse([
    { type: 'message_start', message: { model: req.model, usage: { input_tokens: 50, cache_read_input_tokens: calls.length > 1 ? 4000 : 0, cache_creation_input_tokens: calls.length === 1 ? 4000 : 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(out) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 300 } }
  ]), { status: 200 });
}
globalThis.fetch = async function (url, init) {
  url = String(url); init = init || {};
  const h = init.headers || {};
  const json = (b, s) => new Response(JSON.stringify(b), { status: s || 200 });
  if (url === 'https://api.anthropic.com/v1/messages') return claude(JSON.parse(init.body));
  if (url === 'https://sb.test/auth/v1/user') return USERS[h.Authorization] ? json({ id: USERS[h.Authorization].id }) : json({}, 401);
  if (url.startsWith('https://sb.test/rest/v1/profiles')) return json(USERS[h.Authorization] ? [USERS[h.Authorization]] : []);
  if (url === 'https://sb.test/rest/v1/rpc/ai_report_reader') return json(h.Authorization === 'Bearer clerk');
  if (url === 'https://sb.test/rest/v1/rpc/ai_report_bundle') {
    const b = JSON.parse(init.body);
    if (b.p_key !== 'secret-key') return json({ message: 'not allowed' }, 400);
    bundles++;
    return json(tasksSaved ? bundle([{ id: 101, owner: 'clerk', dept_kind: '상비부', dept_name: '정치부', title: '정치부 — 보고 후속 처리', status: '할 일' }], [2]) : bundle());
  }
  if (url === 'https://sb.test/rest/v1/rpc/ai_report_save') {
    const b = JSON.parse(init.body);
    saves.push(b.p_data);
    if (b.p_data.tasks && b.p_data.tasks.length) tasksSaved = true;
    return json({ reports: (b.p_data.reports || []).length, tasks: (b.p_data.tasks || []).map((t, i) => 101 + i) });
  }
  return json({ error: 'no mock ' + url }, 404);
};
async function claudeCallLike(key, body) {
  /* index.js 의 claudeCall 과 같은 꼴로 부르기 위해 진짜 창구 모듈 대신 가짜 Claude 응답을 그대로 읽는다 */
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify(Object.assign({ stream: true }, body)) });
  if (!r.ok) { const t = await r.text(); throw new Error('Claude API 오류: ' + t.slice(0, 80)); }
  const txt = await r.text();
  let text = '', usage = {}, model = body.model, stop = null;
  txt.split('\n\n').forEach((ch) => {
    const m = ch.match(/^data: (.*)$/m); if (!m) return;
    const ev = JSON.parse(m[1]);
    if (ev.type === 'message_start') { usage = ev.message.usage; model = ev.message.model; }
    if (ev.type === 'content_block_delta') text += ev.delta.text;
    if (ev.type === 'message_delta') { stop = ev.delta.stop_reason; usage = Object.assign({}, usage, ev.usage); }
  });
  return { content: [{ type: 'text', text: text }], stop_reason: stop, usage: usage, model: model };
}

console.log('\n[runReports]');
const logs = [];
const run = await runReports(env, { claudeCall: claudeCallLike, key: 'sk', model: 'claude-sonnet-5-5', effort: 'medium' }, { trigger: 'manual', by: '권서기' }, (t) => logs.push(t));
const ext = calls[0];
ok(ext.output_config.format.type === 'json_schema' && ext.output_config.format.schema.required[0] === 'tasks' &&
   JSON.stringify(ext.messages).indexOf('정치부 보고는 받기로') !== -1 && JSON.stringify(ext.messages).indexOf('옛 회의록') === -1,
  '새 회의록(120일 안·안 읽은 것)만 할 일 뽑기 — 구조화 출력');
ok(saves[0].tasks.length === 1 && saves[0].tasks[0].source_ref === 'minutes:2' && saves[0].minutes_done[0] === 2 && /근거: 「정치부 보고는 받기로 하다」/.test(saves[0].tasks[0].detail),
  '뽑은 할 일 저장 (출처 minutes:2, 근거 구절, 읽은 회의록 번호)');
ok(bundles === 2, '할 일을 넣은 뒤 자료를 다시 받음');
const reps = calls.slice(1);
ok(reps.length === 3 && reps.every((c) => c.output_config.format.schema.required.join() === 'headline,sections,todos,checks'), '임원 3명 보고서 — 구조화 출력');
ok(calls.every((c) => c.system[0].text === ext.system[0].text && c.system[0].cache_control && c.system[0].cache_control.type === 'ephemeral'),
  '모든 부름의 첫 system 글이 같고 캐시 표시 (캐시가 맞음)');
ok(reps.every((c) => c.system[1] && /\[101\] 서기 담당/.test(c.system[1].text) && !c.system[1].cache_control), '할 일 목록은 캐시 밖 두 번째 글 (새 할 일 101 포함)');
const sysTxt = ext.system[0].text;
ok(/정부장 · 나교회 · 목사 · 010-1111-2222/.test(sysTxt) && /제9조 \(임원의 임무\)/.test(sysTxt), '자료에 연락처·노회규칙');
ok(/노회장 보고서/.test(JSON.stringify(reps.find((c) => /박노회/.test(JSON.stringify(c.messages))).messages)) &&
   /회계 보고서/.test(JSON.stringify(reps.find((c) => /김회계/.test(JSON.stringify(c.messages))).messages)), '직책별 지시 (노회장·회계)');
ok(reps[0].model === 'claude-sonnet-5-5' && reps[0].output_config.effort === 'medium', '고른 모델·답변 깊이');
const last = saves[saves.length - 1];
const allReps = saves.flatMap((x) => x.reports || []);
ok(allReps.length === 3 && saves.filter((x) => (x.reports || []).length === 1).length === 3, '보고서는 한 분씩 다 쓰는 대로 저장 (3번)');
ok(saves.some((x) => x.run && x.run.running) && last.run.reports === 3 && !last.run.running && last.run.new_tasks === 1 && last.run.trigger === 'manual' && last.run.by === '권서기',
  '시작할 때 「만드는 중」, 끝나면 실행 기록 (보고서 3건)');
const r0 = allReps.find((r) => r.name === '김회계');
ok(r0.duty === 'treasurer' && r0.report_date === '2026-10-21' && r0.headline === '김회계 오늘 할 일' && r0.content.todos[0].task_id === 101 && r0.content.todos[1].task_id === 0,
  '보고서 줄: 갈래·날짜·요약, 모르는 task_id(999)는 0');
ok(last.run.usage.cache_read > 0 && last.run.usage.cache_write > 0 && last.run.usage.output === 1200, '토큰 사용량 (캐시 쓰기·읽기 포함)');
ok(logs[0] === '노회 자료를 받는 중' && logs.some((l) => /회의록에서 할 일/.test(l)) && logs[logs.length - 1] === '저장하는 중', '진행 글');

console.log('\n[한 분 실패]');
resetCalls(); tasksSaved = true; failFor = '박노회';
const run2 = await runReports(env, { claudeCall: claudeCallLike, key: 'sk', model: 'm', effort: 'low' }, { trigger: 'cron' }, null);
ok(run2.reports === 2 && run2.errors.length === 1 && /박노회/.test(run2.errors[0]) && saves.flatMap((x) => x.reports || []).length === 2, '실패한 한 분만 빠지고 오류가 기록됨');
ok(!calls.some((c) => c.output_config.format.schema.required[0] === 'tasks'), '이미 읽은 회의록은 다시 뽑지 않음');
resetCalls(); tasksSaved = true;
await runReports(env, { claudeCall: claudeCallLike, key: 'sk', model: 'm' }, { only: OFF[2].id }, null);
const only = saves.flatMap((x) => x.reports || []);
ok(calls.length === 1 && only.length === 1 && only[0].name === '김회계', '한 분 것만 다시 만들기');
resetCalls(); tasksSaved = true;
const run3 = await runReports(env, { claudeCall: claudeCallLike, key: 'sk', model: 'm' }, { trigger: 'cron', deadline: Date.now() - 1 }, null);
ok(calls.length === 0 && run3.reports === 0 && /시간이 모자라 3분/.test(run3.errors.join()), '시한이 지나면 새 보고서를 시작하지 않고 기록에 남김');

console.log('\n[POST /reports/run]');
const waits = [];
const ctxw = { waitUntil: (p) => waits.push(p) };
function req(auth, body) {
  return new Request('https://w.test/reports/run', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', Origin: 'https://sihwasan.org' }, body: JSON.stringify(body || {}) });
}
let res = await worker.fetch(req('Bearer treas'), env, ctxw);
ok(res.status === 403, '회계는 다시 만들 수 없음 (403)');
res = await worker.fetch(req('Bearer nobody'), env, ctxw);
ok(res.status === 401, '로그인 안 했으면 401');
KV.set('report:lock', '예약 실행 · 06:00');
res = await worker.fetch(req('Bearer clerk'), env, ctxw);
ok(res.status === 409 && /만들고 있습니다/.test((await res.json()).error), '이미 도는 중이면 409');
KV.delete('report:lock');
resetCalls(); tasksSaved = true;
res = await worker.fetch(req('Bearer clerk'), env, ctxw);
const txt = await res.text();
await Promise.all(waits);
ok(res.status === 200 && /event: progress/.test(txt) && /event: done/.test(txt) && /"reports":3/.test(txt), 'SSE progress … done (보고서 3건)');
ok(!KV.has('report:lock'), '끝나면 잠금이 풀림');
ok(calls[1].model === 'claude-sonnet-5-5', '설정의 보고서 모델(report_model)로');

console.log('\n[예약 실행]');
resetCalls();
KV.set('settings', JSON.stringify({ api_key: 'sk-ant-test', model: 'claude-haiku-5-5', report_enabled: false }));
let w2 = [];
await worker.scheduled({}, env, { waitUntil: (p) => w2.push(p) }); await Promise.all(w2);
ok(calls.length === 0 && bundles === 0, '보고서를 끄면 예약 실행도 돌지 않음');
KV.set('settings', JSON.stringify({ api_key: 'sk-ant-test', model: 'claude-haiku-5-5' }));
resetCalls(); tasksSaved = true; w2 = [];
await worker.scheduled({}, env, { waitUntil: (p) => w2.push(p) }); await Promise.all(w2);
ok(calls.length === 3 && calls[0].model === 'claude-opus-5-5' && saves[saves.length - 1].run.trigger === 'cron' && !KV.has('report:lock'), '켜면 돌고(기본 모델 Opus 5.5) 잠금이 풀림');
KV.set('settings', JSON.stringify({ api_key: 'sk-ant-test', model: 'claude-haiku-5-5', report_model: '' }));
resetCalls(); tasksSaved = true; w2 = [];
await worker.scheduled({}, env, { waitUntil: (p) => w2.push(p) }); await Promise.all(w2);
ok(calls.length === 3 && calls[0].model === 'claude-haiku-5-5', '보고서 모델을 비우면 검색과 같은 모델');
/* 보고서의 Claude 호출은 도쿄 고정 내부 중계(서비스 바인딩 CLAUDE)를 거친다 */
resetCalls(); tasksSaved = true; w2 = [];
let via = [];
const envVia = Object.assign({}, env, { CLAUDE: { fetch: (u, init) => { via.push(String(u)); return globalThis.fetch(u, init); } } });
await worker.scheduled({}, envVia, { waitUntil: (p) => w2.push(p) }); await Promise.all(w2);
ok(via.length === 3 && via.every((u) => u === 'https://api.anthropic.com/v1/messages') && calls.length === 3, '예약 실행의 Claude 호출 3번 모두 내부 중계(CLAUDE)를 거침');
resetCalls();
const envNoKey = Object.assign({}, env, { REPORT_KEY: '' });
w2 = [];
await worker.scheduled({}, envNoKey, { waitUntil: (p) => w2.push(p) }); await Promise.all(w2);
ok(bundles === 0, '열쇠가 없으면 돌지 않음');

console.log('\n결과: 통과 ' + passes + ' · 실패 ' + fails);
process.exit(fails ? 1 : 0);

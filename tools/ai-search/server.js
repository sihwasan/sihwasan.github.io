/* 시화산노회 자료 검색 서버
 *
 * 이 컴퓨터에서 돌아가는 작은 서버다. 홈페이지(관리자 전용 검색창)에서
 * 질문을 받아, 총회·노회 자료에서 관련 대목을 찾아낸 뒤
 * Claude에게 물어 답을 만들어 돌려준다.
 *
 * 실행:  node server.js      (또는 start.bat 을 두 번 누르기)
 * 끄기:  창에서 Ctrl+C
 *
 * · 이 컴퓨터가 켜져 있고 이 서버가 돌아갈 때만 검색이 됩니다.
 * · 노회장·서기·간사·최고관리자만 쓸 수 있습니다. (홈페이지 로그인으로 확인)
 * · 하루 질문 수를 제한해 비용이 새지 않도록 했습니다.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/* ---------------- 설정 ---------------- */
const CFG = {
  port: 8790,
  /* 검색을 쓸 수 있는 등급 */
  allowRoles: ['president', 'clerk', 'staff', 'superadmin'],
  /* 홈페이지 주소 (이 주소에서 오는 요청만 받는다) */
  allowOrigins: [
    'https://sihwasan.org',
    'https://www.sihwasan.org',
    'https://sihwasan.github.io',
    'http://localhost:8123',
    'http://127.0.0.1:8123'
  ],
  supabaseUrl: 'https://ltbhgwozkffenahqdzfj.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0Ymhnd296a2ZmZW5haHFkemZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNDk0MDYsImV4cCI6MjEwMTkyNTQwNn0.nSptHsi7nTCWTiyTe_Kl9xpxyHJ3pkhRGoZLI1BdsnI',
  claudeBin: process.env.SHS_CLAUDE_BIN ||
    path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe'),
  /* 비용을 아끼기 위해 작은 모델을 쓴다 */
  model: process.env.SHS_CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
  topK: 8,             /* 질문 하나에 넘길 자료 조각 수 */
  dailyLimitPerUser: 40,
  dailyLimitTotal: 150,
  timeoutMs: 120000
};

/* ---------------- 색인 읽기 ---------------- */
const INDEX_PATH = path.join(__dirname, 'index.json');
if (!fs.existsSync(INDEX_PATH)) {
  console.error('색인이 없습니다. 먼저 이것을 실행해 주세요:  node build-index.js');
  process.exit(1);
}
const INDEX = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const CHUNKS = INDEX.chunks || [];

/* 물음말·토씨처럼 뜻이 없는 말은 견주지 않는다
 * (이런 말이 섞이면 엉뚱하게 요리문답 같은 자료가 딸려 나온다) */
const STOP = new Set((
  '어떻게 무엇 무엇을 무엇인가 언제 어디 어디서 누구 누가 왜 얼마 얼마나 몇 몇개 몇명 ' +
  '입니까 입니다 인가요 하나요 할까요 되나요 됩니까 있나요 있습니까 해야 하는지 되는지 ' +
  '알려줘 알려주세요 설명 설명해 정리 정리해 무슨 어떤 관련 대하여 대한 관하여 관한 ' +
  '그리고 그러나 하지만 또는 및 등의 등을 것은 것이 하는 되는 있는 없는 이란 라는'
).split(/\s+/));

/* 한글은 띄어쓰기만으로 갈라지지 않아, 글자 두 개씩 묶어(bigram) 견준다 */
function terms(s, isQuery) {
  const out = [];
  const norm = String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]+/g, ' ');
  for (const w of norm.split(/\s+/)) {
    if (!w) continue;
    if (isQuery && STOP.has(w)) continue;
    if (/^[0-9a-z]+$/.test(w)) { out.push(w); continue; }
    if (w.length <= 2) { out.push(w); continue; }
    for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2));
  }
  return out;
}

/* 자료 조각마다 낱말 표를 미리 만들어 둔다 */
console.log('색인을 읽는 중입니다...');
const DOCS = CHUNKS.map(c => {
  const tf = new Map();
  for (const t of terms(c.title + ' ' + c.src + ' ' + c.text)) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  /* 제목에 있는 말은 더 무겁게 본다 */
  const title = new Set(terms(c.title + ' ' + c.src));
  return { c, tf, title, len: c.text.length };
});
const DF = new Map();
for (const d of DOCS) for (const t of d.tf.keys()) DF.set(t, (DF.get(t) || 0) + 1);
const N = DOCS.length;
console.log(`자료 조각 ${N}개 준비 완료 (${INDEX.built} 기준)`);

/* 질문과 가까운 조각을 골라낸다 (BM25 방식) */
function retrieve(question, k) {
  let qt = terms(question, true);
  /* 자료 어디에나 나오는 흔한 말은 견주어 봐야 도움이 안 된다 */
  const COMMON = N * 0.12;
  const useful = qt.filter(t => (DF.get(t) || 0) <= COMMON);
  if (useful.length >= 2) qt = useful;
  if (!qt.length) return [];

  const qCount = new Map();
  qt.forEach(t => qCount.set(t, (qCount.get(t) || 0) + 1));

  const avg = DOCS.reduce((a, d) => a + d.len, 0) / Math.max(1, N);
  const k1 = 1.4, b = 0.72;
  const scored = [];
  for (const d of DOCS) {
    let score = 0, hit = 0;
    for (const [t, qn] of qCount) {
      const f = d.tf.get(t);
      if (!f) continue;
      hit++;
      const df = DF.get(t) || 1;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      let s = idf * qn * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg));
      if (d.title.has(t)) s *= 2.5;          /* 제목에 걸리면 가산 */
      score += s;
    }
    if (!score) continue;
    /* 질문의 여러 낱말이 함께 걸린 자료를 앞세운다 */
    score *= 1 + 0.35 * Math.log(1 + hit);
    scored.push({ d, score });
  }
  scored.sort((x, y) => y.score - x.score);

  /* 같은 자료(제목)에서 너무 많이 뽑히지 않도록 고르게 섞는다 */
  const out = [], seen = {};
  for (const x of scored) {
    const key = x.d.c.src + '|' + x.d.c.title;
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] > 2) continue;
    out.push(x.d.c);
    if (out.length >= k) break;
  }
  return out;
}

/* ---------------- 사용량 제한 ---------------- */
const usage = { day: '', total: 0, byUser: {} };
function checkQuota(uid) {
  const today = new Date().toISOString().slice(0, 10);
  if (usage.day !== today) { usage.day = today; usage.total = 0; usage.byUser = {}; }
  if (usage.total >= CFG.dailyLimitTotal) {
    return '오늘 검색 사용량(전체 ' + CFG.dailyLimitTotal + '회)을 다 썼습니다. 내일 다시 이용해 주세요.';
  }
  if ((usage.byUser[uid] || 0) >= CFG.dailyLimitPerUser) {
    return '오늘 검색 사용량(1인 ' + CFG.dailyLimitPerUser + '회)을 다 썼습니다. 내일 다시 이용해 주세요.';
  }
  return null;
}
function useQuota(uid) {
  usage.total++;
  usage.byUser[uid] = (usage.byUser[uid] || 0) + 1;
}

/* ---------------- 로그인 확인 ---------------- */
async function verify(token) {
  if (!token) return { ok: false, msg: '로그인이 필요합니다.' };
  const headers = { apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + token };

  const ures = await fetch(CFG.supabaseUrl + '/auth/v1/user', { headers });
  if (!ures.ok) return { ok: false, msg: '로그인이 만료되었습니다. 다시 로그인해 주세요.' };
  const user = await ures.json();
  if (!user || !user.id) return { ok: false, msg: '로그인 정보를 확인할 수 없습니다.' };

  const pres = await fetch(
    CFG.supabaseUrl + '/rest/v1/profiles?id=eq.' + user.id + '&select=role,name',
    { headers });
  const rows = pres.ok ? await pres.json() : [];
  const p = rows && rows[0];
  if (!p) return { ok: false, msg: '회원 정보를 찾을 수 없습니다.' };
  if (CFG.allowRoles.indexOf(p.role) === -1) {
    return { ok: false, msg: '자료 검색은 노회장·서기·간사만 이용할 수 있습니다.' };
  }
  return { ok: true, uid: user.id, name: p.name || '', role: p.role };
}

/* ---------------- Claude에게 묻기 ---------------- */
function askClaude(prompt) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', CFG.model,
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];
    const cp = spawn(CFG.claudeBin, args, {
      windowsHide: true,
      cwd: __dirname,
      env: Object.assign({}, process.env, { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' })
    });
    let out = '', err = '';
    const timer = setTimeout(() => { cp.kill(); reject(new Error('시간이 너무 오래 걸립니다.')); },
      CFG.timeoutMs);
    cp.stdout.on('data', d => { out += d; });
    cp.stderr.on('data', d => { err += d; });
    cp.on('error', e => { clearTimeout(timer); reject(e); });
    cp.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) {
        reject(new Error(err.trim() || ('Claude 실행에 실패했습니다. (코드 ' + code + ')')));
        return;
      }
      resolve(out.trim());
    });
    cp.stdin.write(prompt);
    cp.stdin.end();
  });
}

function buildPrompt(question, hits) {
  const refs = hits.map((h, i) =>
    `[자료 ${i + 1}] ${h.src} — ${h.title}\n${h.text}`).join('\n\n---\n\n');

  return [
    '당신은 대한예수교장로회(합동) 시화산노회 홈페이지의 자료 검색 도우미입니다.',
    '아래에 주어진 노회·총회 자료만 근거로 질문에 답하십시오.',
    '',
    '지켜야 할 것:',
    '- 자료에 없는 내용은 지어내지 말고, 자료에서 확인되지 않는다고 밝히십시오.',
    '- 한국 장로교 목회자에게 보고하듯 정중한 존댓말로 씁니다.',
    '- 헌법·규정을 인용할 때는 조문 번호(예: 정치 제10장 제3조)를 함께 적습니다.',
    '- 답은 핵심부터 3~6문장으로 간결하게 쓰고, 필요하면 짧은 목록을 씁니다.',
    '- 마지막 줄에 근거로 삼은 자료를 "근거: [자료 1], [자료 3]" 형식으로 적습니다.',
    '- 인사말이나 서론 없이 바로 답부터 씁니다.',
    '',
    '=== 자료 ===',
    refs,
    '',
    '=== 질문 ===',
    question
  ].join('\n');
}

/* ---------------- 서버 ---------------- */
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && CFG.allowOrigins.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  /* 크롬이 공개 사이트 → 내 컴퓨터 요청에 요구하는 항목 */
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/health') {
    send(res, 200, { ok: true, built: INDEX.built, chunks: N, model: CFG.model });
    return;
  }

  if (url.pathname === '/search' && req.method === 'POST') {
    let raw = '';
    req.on('data', d => {
      raw += d;
      if (raw.length > 20000) { req.destroy(); }
    });
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw); } catch (e) { send(res, 400, { error: '요청을 읽지 못했습니다.' }); return; }

      const question = String(body.question || '').trim();
      if (question.length < 2) { send(res, 400, { error: '질문을 입력해 주세요.' }); return; }
      if (question.length > 500) { send(res, 400, { error: '질문이 너무 깁니다. 500자 안으로 줄여 주세요.' }); return; }

      let who;
      try { who = await verify(body.token); }
      catch (e) { send(res, 500, { error: '로그인 확인 중 문제가 생겼습니다.' }); return; }
      if (!who.ok) { send(res, 403, { error: who.msg }); return; }

      const over = checkQuota(who.uid);
      if (over) { send(res, 429, { error: over }); return; }

      const hits = retrieve(question, CFG.topK);
      if (!hits.length) {
        send(res, 200, {
          answer: '자료에서 관련된 대목을 찾지 못했습니다. 다른 낱말로 다시 물어봐 주세요.',
          sources: []
        });
        return;
      }

      const stamp = new Date().toLocaleTimeString('ko-KR');
      console.log(`[${stamp}] ${who.name}(${who.role}) : ${question}`);

      try {
        useQuota(who.uid);
        const answer = await askClaude(buildPrompt(question, hits));
        send(res, 200, {
          answer: answer,
          sources: hits.map((h, i) => ({ n: i + 1, src: h.src, title: h.title, url: h.url }))
        });
      } catch (e) {
        console.error('  → 실패:', e.message);
        send(res, 500, { error: e.message || '답을 만들지 못했습니다.' });
      }
    });
    return;
  }

  send(res, 404, { error: '없는 주소입니다.' });
});

server.listen(CFG.port, '127.0.0.1', () => {
  console.log('');
  console.log('  시화산노회 자료 검색 서버가 켜졌습니다.');
  console.log('  주소   http://127.0.0.1:' + CFG.port);
  console.log('  자료   ' + N + '조각 (' + INDEX.built + ' 기준)');
  console.log('  모델   ' + CFG.model);
  console.log('');
  console.log('  이 창을 열어 두셔야 홈페이지에서 검색이 됩니다.');
  console.log('  끄시려면 Ctrl+C 를 누르세요.');
  console.log('');
});

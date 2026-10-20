/* 시화산노회 바깥 보안 점검 — 교회 컴퓨터에서 매일 돌린다 (Windows 작업 스케줄러, 오전 6시 30분)
 *
 * DB 안의 점검(supabase/126_security_check.sql)이 보지 못하는 바깥을 살피고, 결과를 DB 로 넘겨
 * 하나의 통합 보고(security_reports)를 만든다. 보고와 알림(최고관리자 알림함)은 DB 가 맡는다.
 *
 *   · 홈페이지      — 열리는가, http 로 들어오면 https 로 넘기는가, 외부 라이브러리 버전 고정,
 *                     공개되면 안 되는 파일(.env·봇 설정·비공개 폴더)이 주소로 열리는가
 *   · Cloudflare    — 서버 6곳(AI·영수증·증명서·녹음·자료·사진)이 로그인 없는 요청을 거절하는가, CORS
 *   · Supabase      — 로그인하지 않은 사람(anon 키)이 민감한 표를 읽을 수 없는가, 가입 설정
 *   · GitHub 저장소 — 지금 공개된 모든 파일과 최근 하루 사이 변경(월요일엔 지난 기록 전체)에
 *                     비밀 열쇠(서비스 키·API 키·개인 키·토큰)가 섞였는가, 올라가면 안 되는 파일이 있는가
 *
 * 실행:  node watch.js            점검하고 DB 로 넘긴다 (작업 스케줄러가 부른다)
 *        node watch.js --dry      점검만 하고 화면에 보인다 (DB 로 넘기지 않음)
 *        node watch.js --new-key  이 컴퓨터용 열쇠를 새로 만들고, Supabase 에서 실행할 한 줄(지문)을 보여 준다
 *        node watch.js --ack      지금 저장소(기록 포함)에서 찾은 열쇠를 「확인 처리」해 다음부터 건너뛴다
 *                                 — 폐기·재발급을 마쳤거나 예시값으로 확인한 뒤에만 쓴다. 열쇠는 지문(SHA-256 앞 16자)으로만 적는다.
 * 설정:  같은 폴더의 config.json  { "watchSecret": "…" }  — 저장소에 올리지 않는다(.gitignore).
 *        DB 에는 그 열쇠의 SHA-256 값만 있다 (126 sql 의 security_config).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const SITE = 'https://sihwasan.org';
const SUPABASE_URL = 'https://ltbhgwozkffenahqdzfj.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0Ymhnd296a2ZmZW5haHFkemZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNDk0MDYsImV4cCI6MjEwMTkyNTQwNn0.nSptHsi7nTCWTiyTe_Kl9xpxyHJ3pkhRGoZLI1BdsnI';
const W = (n) => 'https://sihwasan-' + n + '.sihwasan.workers.dev';
const crypto = require('crypto');
const DRY = process.argv.includes('--dry');
const ACK = process.argv.includes('--ack');
let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8')); } catch (e) { CFG = {}; }
const ACKED = new Set(CFG.acknowledged || []);

const items = [];
const seen = { pages: 0, workers: 0, tables: 0, files: 0, commits: 0 };
function add(level, title, detail) { items.push({ level, title: '[바깥] ' + title, detail: detail || '' }); }

async function get(url, init) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    return await fetch(url, Object.assign({ redirect: 'manual', signal: ctl.signal }, init || {}));
  } finally { clearTimeout(t); }
}

/* 1) 홈페이지 */
async function checkSite() {
  try {
    const r = await get(SITE + '/', { redirect: 'follow' });
    seen.pages++;
    if (r.status !== 200) add('위험', '홈페이지가 열리지 않습니다 (HTTP ' + r.status + ')', SITE + ' — GitHub Pages 상태를 확인해 주세요.');
    const html = r.status === 200 ? await r.text() : '';
    const unpinned = [];
    (html.match(/<script[^>]+src="https?:\/\/[^"]+"/g) || []).forEach((tag) => {
      const src = tag.replace(/^.*src="/, '').replace(/"$/, '');
      if (/(jsdelivr|unpkg|cdnjs)/.test(src) && !/@\d+\.\d+\.\d+/.test(src) && !/\/\d+\.\d+\.\d+\//.test(src)) unpinned.push(src);
    });
    const a = await get(SITE + '/js/supabase-auth.js', { redirect: 'follow' });
    seen.pages++;
    if (a.status === 200) {
      ((await a.text()).match(/https:\/\/cdn\.jsdelivr\.net\/npm\/[^'"\s]+/g) || []).forEach((src) => {
        if (!/@\d+\.\d+\.\d+/.test(src)) unpinned.push(src);
      });
    }
    if (unpinned.length) {
      add('주의', '외부 라이브러리를 버전 고정 없이 불러옵니다 (' + unpinned.length + '곳)',
        unpinned.slice(0, 4).join(', ') + ' — 배포처가 바뀌면 홈페이지에 다른 코드가 들어올 수 있습니다. 정확한 버전과 무결성(SRI)으로 고정하기를 권합니다.');
    }
  } catch (e) { add('주의', '홈페이지를 점검하지 못했습니다', String(e && e.message || e)); }
  try {
    const h = await get(SITE.replace('https://', 'http://') + '/');
    if (h.status === 200) add('주의', 'http 주소로도 홈페이지가 열립니다', 'GitHub Pages 설정의 「Enforce HTTPS」를 켜 주세요.');
  } catch (e) { /* http 막힘은 괜찮다 */ }
}

/* 2) 공개되면 안 되는 파일이 주소로 열리는가 */
async function checkExposed() {
  const paths = ['/.env', '/tools/telegram-bot/config.json', '/tools/security-watch/config.json', '/private/',
                 '/.git/config', '/.dev.vars', '/.wrangler/state/'];
  const open = [];
  await Promise.all(paths.map(async (p) => {
    try {
      const r = await get(SITE + p, { headers: { Range: 'bytes=0-200' } });
      seen.pages++;
      if (r.status === 200 || r.status === 206) open.push(p);
    } catch (e) { /* 건너뜀 */ }
  }));
  if (open.length) add('위험', '공개되면 안 되는 파일이 주소로 열립니다', open.join(', ') + ' — 저장소에서 지우고 .gitignore 에 넣은 뒤, 그 안의 열쇠는 모두 새로 바꿔야 합니다.');
}

/* 3) Cloudflare 서버들이 로그인 없는 요청을 거절하는가 */
async function checkWorkers() {
  const probes = [
    ['AI 검색', 'GET', W('ai') + '/settings', '설정 보기'],
    ['AI 검색', 'GET', W('ai') + '/history', '질문 내역'],
    ['영수증', 'POST', W('receipts') + '/read', '영수증 읽기'],
    ['증명서', 'GET', W('certs') + '/sign?issue_id=1', '증명서 내려받기 주소'],
    ['녹음', 'POST', W('audio') + '/sign', '녹음 재생 주소', '{"id":1}'],
    ['녹음', 'POST', W('audio') + '/up/start', '녹음 올리기'],
    ['자료', 'GET', W('docs') + '/f/officer/watch/probe.pdf', '임원 자료 열람'],
    ['자료', 'DELETE', W('docs') + '/f/public/watch/probe.pdf', '자료 지우기'],
    ['사진', 'PUT', W('photos') + '/o/full/watchprobe.jpg', '사진 올리기']
  ];
  const open = [], down = [];
  await Promise.all(probes.map(async (p) => {
    try {
      const init = { method: p[1], headers: { Origin: SITE, 'Content-Type': 'application/json' } };
      if (p[1] === 'POST' || p[1] === 'PUT') init.body = p[4] || (p[1] === 'PUT' ? '' : '{}');
      const r = await get(p[2], init);
      seen.workers++;
      if (r.status >= 200 && r.status < 300) open.push(p[0] + ' — ' + p[3]);
      else if (r.status >= 500) down.push(p[0] + ' (HTTP ' + r.status + ')');
    } catch (e) { down.push(p[0] + ' (' + (e && e.name === 'AbortError' ? '응답 없음' : '접속 실패') + ')'); }
  }));
  if (open.length) add('위험', '로그인 없이 열리는 서버 기능 ' + open.length + '곳', open.join(', ') + ' — 해당 워커의 로그인 확인을 바로 고쳐야 합니다.');
  const uniq = down.filter((v, i, a) => a.indexOf(v) === i);
  if (uniq.length) add('주의', '응답하지 않는 서버 ' + uniq.length + '곳', uniq.join(', ') + ' — Cloudflare 대시보드에서 워커 상태를 확인해 주세요.');
  try {
    const r = await get(W('ai') + '/health', { headers: { Origin: 'https://evil.example' } });
    const allow = r.headers.get('access-control-allow-origin') || '';
    if (allow === '*' || allow === 'https://evil.example') {
      add('위험', 'AI 검색 서버가 아무 사이트에나 문을 엽니다 (CORS: ' + allow + ')', '다른 사이트가 회원의 로그인으로 요청을 보낼 수 있습니다. ALLOW_ORIGINS 를 확인해 주세요.');
    }
  } catch (e) { /* 위에서 다룸 */ }
}

/* 4) 로그인하지 않은 사람(anon 키)이 민감한 표를 읽을 수 있는가 — 읽기만 해 본다 */
async function checkAnon() {
  const tables = [
    ['profiles', 'id', '회원 계정'], ['roster', 'birth_date', '회원 명단의 생년월일'],
    ['church_staff', 'birth_date', '교회 직원 생년월일'], ['doc_requests', 'id', '서류 신청'],
    ['doc_issues', 'id', '증명서 발급 대장'], ['notifications', 'id', '알림'],
    ['audit_logs', 'id', '감사 기록'], ['ledger_entries', 'id', '회계 장부'],
    ['minutes_board', 'id', '회의록'], ['petitions', 'id', '청원서'],
    ['ai_logs', 'id', 'AI 질문 기록'], ['security_reports', 'id', '보안 점검 기록'],
    ['security_external', 'id', '바깥 점검 기록'], ['minutes_audio', 'id', '회의 녹음']
  ];
  const leaked = [];
  await Promise.all(tables.map(async (t) => {
    try {
      const r = await get(SUPABASE_URL + '/rest/v1/' + t[0] + '?select=' + t[1] + '&limit=1', { headers: { apikey: ANON, Authorization: 'Bearer ' + ANON } });
      seen.tables++;
      if (r.status === 200) {
        const rows = await r.json().catch(() => []);
        if (Array.isArray(rows) && rows.length) leaked.push(t[2] + '(' + t[0] + ')');
      }
    } catch (e) { /* 건너뜀 */ }
  }));
  if (leaked.length) add('위험', '로그인 없이 읽히는 자료 ' + leaked.length + '종', leaked.join(', ') + ' — 해당 표의 보호 규칙(RLS)·열 권한을 바로 고쳐야 합니다.');
  try {
    const j = await (await get(SUPABASE_URL + '/auth/v1/settings', { headers: { apikey: ANON } })).json();
    if (j && j.mailer_autoconfirm) {
      add('참고', '이메일 확인 없이 가입됩니다', '가입한 분은 승인 대기로 시작하므로 큰 문제는 아니지만, 가짜 가입이 늘면 Supabase → Authentication 에서 이메일 확인을 켜 주세요.');
    }
  } catch (e) { /* 건너뜀 */ }
}

/* 5) GitHub 저장소 — 공개된 파일 전체 + 최근 변경(월요일엔 지난 기록 전체)에서 비밀 열쇠 찾기 */
const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API 키'],
  [/\bsk-(?:proj-)?[A-Za-z0-9]{32,}/, 'OpenAI API 키'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '개인 키'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS 키'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub 토큰'],
  [/\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/, '텔레그램 봇 토큰'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack 토큰']
];
/* git grep 으로 먼저 걸러 낼 때 쓰는 넓은 그물 (확인은 위 규칙과 JWT 풀어 보기로) */
const GREP_NET = 'sk-ant-|sk-proj-|sk-[A-Za-z0-9]{32}|PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|[0-9]{8,10}:AA[A-Za-z0-9_-]{33}|xox[baprs]-|eyJ[A-Za-z0-9_-]{10,}\\.eyJ';
const BAD_NAME = /(^|\/)\.env(\.|$)|\.pem$|\.key$|(^|\/)id_rsa|service[-_]?account.*\.json$|(^|\/)\.dev\.vars$|telegram-bot\/config\.json$|security-watch\/config\.json$/i;

function jwtRole(tok) {
  try {
    const p = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(p, 'base64').toString('utf8')).role || '';
  } catch (e) { return ''; }
}
function fp(secret) { return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16); }
/* 찾은 열쇠마다 { kind, fp } — 열쇠 자체는 어디에도 남기지 않는다 */
function findSecrets(text) {
  const hit = [];
  SECRET_PATTERNS.forEach((sp) => {
    (text.match(new RegExp(sp[0].source, 'g')) || []).forEach((m) => hit.push({ kind: sp[1], fp: fp(m) }));
  });
  (text.match(/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g) || []).forEach((tok) => {
    if (jwtRole(tok) === 'service_role') hit.push({ kind: 'Supabase 서비스 키(service_role)', fp: fp(tok) });
  });
  return hit;
}
function git(args) {
  return execFileSync('git', ['-C', ROOT, '-c', 'core.quotepath=off'].concat(args), { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}
/* git log -p 출력에서 파일별로 「더해진 줄」만 모아 비밀 열쇠를 찾는다 */
function scanPatch(out, hits) {
  let file = '', added = [];
  function flush() {
    if (file && added.length) findSecrets(added.join('\n')).forEach((k) => hits.push({ file: file, kind: k.kind, fp: k.fp }));
    added = [];
  }
  out.split('\n').forEach((l) => {
    if (l.indexOf('+++ b/') === 0) { flush(); file = l.slice(6); }
    else if (l.charAt(0) === '+' && l.indexOf('+++') !== 0) added.push(l);
  });
  flush();
}
function checkRepo() {
  const ref = 'origin/main';
  try {
    try { git(['fetch', '--quiet', 'origin', 'main']); }
    catch (e) { add('참고', 'GitHub 에서 최신 내용을 받지 못해 이 컴퓨터에 있는 내용으로 검사했습니다', '인터넷 연결을 확인해 주세요.'); }
    /* 올라가면 안 되는 파일 이름 */
    const names = git(['ls-tree', '-r', '--name-only', ref]).split('\n').filter(Boolean);
    seen.files = names.length;
    const bad = names.filter((n) => BAD_NAME.test(n));
    if (bad.length) add('위험', '저장소에 올라가면 안 되는 파일이 있습니다', bad.join(', ') + ' — 지우고 .gitignore 에 넣은 뒤, 들어 있던 열쇠는 새로 바꿔야 합니다.');
    /* 지금 공개된 모든 파일 */
    const hits = [];
    let cand = [];
    try { cand = git(['grep', '-I', '-l', '-E', GREP_NET, ref]).split('\n').filter(Boolean).map((s) => s.replace(ref + ':', '')); }
    catch (e) { cand = []; /* 찾은 것이 없으면 git grep 은 1 로 끝난다 */ }
    cand.forEach((f) => {
      let text = '';
      try { text = git(['show', ref + ':' + f]); } catch (e) { return; }
      findSecrets(text).forEach((k) => hits.push({ file: f, kind: k.kind, fp: k.fp }));
    });
    const label = (h) => h.file + ' — ' + h.kind + ' (지문 ' + h.fp + ')';
    const live = hits.filter((h, i, a) => !ACKED.has(h.fp) && a.findIndex((x) => x.fp === h.fp && x.file === h.file) === i);
    if (live.length) add('위험', '공개 저장소에 비밀 열쇠가 있습니다 (' + live.length + '건)', live.slice(0, 8).map(label).join(', ') + ' — 이미 노출된 것으로 보고 그 열쇠를 바로 폐기·재발급한 뒤 파일에서 지워야 합니다.');
    /* 지난 기록 — 평일엔 최근 26시간, 월요일(과 --ack)엔 처음부터 (지웠어도 기록에는 남는다) */
    const monday = new Date().getDay() === 1 || ACK;
    const logArgs = ['log', ref, '-p', '--no-color', '--unified=0', '-G', GREP_NET];
    if (!monday) logArgs.splice(2, 0, '--since=26.hours');
    const hist = [];
    try { scanPatch(git(logArgs), hist); } catch (e) { /* 기록 없음 */ }
    try { seen.commits = Number(git(['rev-list', '--count'].concat(monday ? [ref] : ['--since=26.hours', ref])).trim()) || 0; } catch (e) { /* 건너뜀 */ }
    const inTree = new Set(hits.map((h) => h.fp));
    const histOnly = hist.filter((h, i, a) => !inTree.has(h.fp) && a.findIndex((x) => x.fp === h.fp) === i);
    const histLive = histOnly.filter((h) => !ACKED.has(h.fp));
    if (histLive.length) add('위험', '저장소 기록에 비밀 열쇠가 남아 있습니다 (' + histLive.length + '건)', histLive.slice(0, 8).map(label).join(', ') +
      ' — 파일에서 지웠더라도 공개 기록에 남아 있으므로 그 열쇠는 폐기·재발급해야 합니다. 폐기를 마쳤으면 교회 컴퓨터에서 「보안점검 확인처리.bat」을 실행해 주세요.');
    const acked = hits.concat(histOnly).filter((h) => ACKED.has(h.fp)).length;
    if (acked) add('참고', '확인 처리한 열쇠 ' + acked + '건은 건너뛰었습니다', '폐기했거나 예시값으로 확인한 열쇠입니다 (config.json 의 acknowledged).');
    seen.monday = monday;
    seen.found = hits.concat(histOnly);
  } catch (e) { add('참고', '저장소 검사를 마치지 못했습니다', String(e && e.message || e).slice(0, 200)); }
}

/* --ack : 지금 찾은 열쇠를 확인 처리 (저장소 검사만 한다) */
function acknowledge() {
  checkRepo();
  const found = (seen.found || []).filter((h, i, a) => a.findIndex((x) => x.fp === h.fp) === i);
  if (!found.length) { console.log('찾은 열쇠가 없습니다.'); return; }
  const list = CFG.acknowledged || [];
  found.forEach((h) => {
    if (list.indexOf(h.fp) === -1) list.push(h.fp);
    console.log('확인 처리: ' + h.file + ' — ' + h.kind + ' (지문 ' + h.fp + ')');
  });
  CFG.acknowledged = list;
  fs.writeFileSync(path.join(HERE, 'config.json'), JSON.stringify(CFG, null, 2), 'utf8');
  console.log('다음 점검부터 위 ' + found.length + '건은 건너뜁니다. (새로 생기는 열쇠는 계속 잡습니다)');
}

/* --new-key : 다른 컴퓨터로 옮기거나 열쇠가 새었을 때 — 새 열쇠를 만들고 DB 에 넣을 지문을 보여 준다 */
function newKey() {
  CFG.watchSecret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(HERE, 'config.json'), JSON.stringify(CFG, null, 2), 'utf8');
  const h = crypto.createHash('sha256').update(CFG.watchSecret, 'utf8').digest('hex');
  console.log('새 열쇠를 config.json 에 넣었습니다. Supabase → SQL Editor 에서 아래 한 줄을 실행해 주세요:\n');
  console.log("update public.security_config set v = '" + h + "' where k = 'watch_secret_sha256';\n");
}

async function main() {
  if (process.argv.includes('--new-key')) { newKey(); return; }
  if (ACK) { acknowledge(); return; }
  const started = Date.now();
  await Promise.all([checkSite(), checkExposed(), checkWorkers(), checkAnon()]);
  checkRepo();
  add('참고', '바깥 점검 범위 (교회 컴퓨터)', '홈페이지 주소 ' + seen.pages + '곳, 서버 기능 ' + seen.workers + '곳, 로그인 없이 읽기 ' + seen.tables +
    '개 표, 공개 저장소 파일 ' + seen.files + '개와 ' + (seen.monday ? '지난 기록 전체' : '최근 하루 변경') + '(' + seen.commits + '건)를 확인했습니다.');

  const summary = items.map((x) => x.level + ' | ' + x.title + ' | ' + x.detail).join('\n');
  const stamp = new Date().toISOString();
  if (DRY) { console.log(summary + '\n(' + ((Date.now() - started) / 1000).toFixed(1) + '초, DB 로 넘기지 않음)'); return; }

  const cfg = CFG;
  let result = '';
  try {
    if (!cfg.watchSecret) throw new Error('config.json 에 watchSecret 이 없습니다');
    const r = await get(SUPABASE_URL + '/rest/v1/rpc/security_ingest_external', {
      method: 'POST',
      headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_secret: cfg.watchSecret, p_items: items, p_manual: false })
    });
    const t = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 200));
    result = '보고 번호 ' + t;
  } catch (e) { result = 'DB 로 넘기지 못함: ' + (e && e.message || e); process.exitCode = 1; }
  /* 마지막 결과를 이 컴퓨터에도 남긴다 (열쇠는 적지 않는다) */
  fs.writeFileSync(path.join(HERE, 'last-run.log'), stamp + '  ' + result + '\n\n' + summary + '\n', 'utf8');
  console.log(result);
}

main();

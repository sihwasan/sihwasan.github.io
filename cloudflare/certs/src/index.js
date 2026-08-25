/* 시화산노회 증명서 보관소 (Cloudflare R2 창구)
 *
 * 발급한 증명서 PDF를 노회 보관소에 남겨 두었다가, 신청자와 서기가
 * 필요할 때 그대로 내려받게 한다. 발급할 때 만든 그 파일이므로
 * 언제 받아도 모습이 똑같다.
 *
 * 하는 일
 *   POST /upload?issue_id=123   증명서 PDF 올리기   (서기·간사·노회장)
 *   GET  /sign?issue_id=123     내려받을 주소 받기  (본인 또는 관리자)
 *   GET  /d/<파일>?exp=&sig=    실제 파일 보내기    (서명이 맞을 때만)
 *   POST /delete?issue_id=123   보관본 지우기       (서기·간사·노회장)
 *
 * 누가 무엇을 볼 수 있는지는 Supabase가 정한다.
 *   · 올리기·지우기 : can_manage() 가 참인 사람만
 *   · 내려받기      : doc_issues 를 읽을 수 있는 사람만
 *                     (본인이 받은 증명서 또는 관리자)
 * 이 창구는 관리자 열쇠를 갖고 있지 않으므로, 남의 증명서를 대신
 * 꺼내 줄 수 없다. 보내온 로그인 증표로 Supabase에 그때그때 물어본다.
 *
 * ※ 이 파일은 지금 운영 중인 워커와 같은 규약(주소·응답 모양)으로
 *   맞추어 저장소에 남겨 둔 것이다. 이 파일로 다시 배포하려면
 *   SIGN_SECRET 을 먼저 넣어야 한다.
 *     npx wrangler secret put SIGN_SECRET
 */

/* 홈페이지 주소. 맨 앞이 기본값이므로 지금 쓰는 주소를 맨 앞에 둔다. */
const ALLOW_ORIGINS = [
  'https://sihwasan.org',
  'https://www.sihwasan.org',
  'https://sihwasan.github.io',
  'http://localhost:8899'
];

const MAX_BYTES = 10 * 1024 * 1024;   /* 증명서 한 장 10MB까지 */
const SIGN_TTL  = 600;                /* 내려받기 주소는 10분간 쓸 수 있다 */

/* 보관소 안의 파일 위치 형식.
 * cert/ 아래의 PDF 만 다루고, 경로를 거슬러 올라가는 장난('..')은 막는다.
 * 형식을 너무 좁히지 않은 것은, 이미 보관되어 있는 파일의 위치를
 * 그대로 다시 읽을 수 있어야 하기 때문이다. */
const KEY_RE = /^cert\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,200}\.pdf$/;

function okKey(k) {
  return typeof k === 'string' && KEY_RE.test(k) &&
         k.indexOf('..') === -1 && k.indexOf('//') === -1;
}

function cors(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function reply(body, status, origin, extra) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status: status,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8' },
      cors(origin), extra || {}
    )
  });
}

/* ---------- 서명 (내려받기 주소를 10분만 살려 둔다) ---------- */

function hex(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

async function sign(env, key, exp) {
  const secret = env.SIGN_SECRET || '';
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return hex(await crypto.subtle.sign(
    'HMAC', k, new TextEncoder().encode(key + '\n' + exp)
  ));
}

/* 글자 수가 같을 때에만 참이 되도록 한 글자씩 끝까지 견준다
 * (빨리 틀리는 것으로 열쇠를 알아내는 장난 방지) */
function sameSig(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- Supabase에 물어보기 ---------- */

function bearer(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth : null;
}

/* 관리자(서기·간사·노회장)인지 Supabase의 can_manage() 로 확인한다 */
async function canManage(auth, env) {
  try {
    const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/can_manage', {
      method: 'POST',
      headers: {
        Authorization: auth,
        apikey: env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch (x) { return false; }
}

/* 이 증명서를 볼 수 있는 사람인지 확인한다.
 * doc_issues 의 보안 정책이 그대로 적용되므로(본인 또는 관리자),
 * 줄이 돌아오면 볼 수 있는 사람이고 안 돌아오면 아니다. */
async function readIssue(auth, env, id) {
  try {
    const r = await fetch(
      env.SUPABASE_URL + '/rest/v1/doc_issues' +
      '?select=id,doc_no,doc_type,name,issued_on,pdf_path&id=eq.' + encodeURIComponent(id),
      { headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY } }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return (rows && rows[0]) || null;
  } catch (x) { return null; }
}

/* 파일 이름: 소속증명서_홍길동_20260816.pdf */
function fileNameOf(row) {
  const d = String(row.issued_on || '').replace(/-/g, '') || '';
  return ((row.doc_type || '증명서') + '_' + (row.name || '') + (d ? '_' + d : ''))
    .replace(/[\\/:*?"<>|]/g, '') + '.pdf';
}

/* 파일 이름에 한글이 들어가므로 두 가지 형태로 함께 적어 준다 */
function disposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return 'attachment; filename="' + ascii + '"; ' +
         "filename*=UTF-8''" + encodeURIComponent(name);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return reply(null, 204, origin);

    if (path === '/' || path === '/health') {
      return reply({ ok: true, service: '시화산노회 증명서 보관소' }, 200, origin);
    }

    /* ---------- 실제 파일 보내기 : 서명이 맞을 때만 ---------- */
    if (path.startsWith('/d/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return reply({ error: '허용되지 않는 요청입니다.' }, 405, origin);
      }
      const key = decodeURIComponent(path.slice(3));
      const exp = url.searchParams.get('exp') || '';
      const sig = url.searchParams.get('sig') || '';
      if (!okKey(key)) return reply({ error: '주소가 올바르지 않습니다.' }, 400, origin);
      if (!/^\d{1,15}$/.test(exp)) return reply({ error: '주소가 올바르지 않습니다.' }, 400, origin);
      if (Number(exp) * 1000 < Date.now()) {
        return reply({ error: '내려받기 주소의 유효 시간이 지났습니다. 다시 눌러 주세요.' }, 410, origin);
      }
      if (!sameSig(sig, await sign(env, key, exp))) {
        return reply({ error: '내려받을 권한이 확인되지 않았습니다.' }, 403, origin);
      }

      const obj = await env.CERTS.get(key);
      if (!obj) return reply({ error: '보관된 증명서를 찾을 수 없습니다.' }, 404, origin);

      const h = new Headers(cors(origin));
      h.set('Content-Type', 'application/pdf');
      h.set('etag', obj.httpEtag);
      /* 증명서는 아무 데도 남기지 않는다 */
      h.set('Cache-Control', 'private, no-store');
      const name = (obj.customMetadata && obj.customMetadata.filename) || 'certificate.pdf';
      h.set('Content-Disposition', disposition(name));
      return new Response(request.method === 'HEAD' ? null : obj.body, { headers: h });
    }

    /* 아래 세 가지는 모두 로그인 증표가 있어야 한다 */
    const auth = bearer(request);
    if (!auth) return reply({ error: '로그인이 확인되지 않았습니다.' }, 401, origin);

    const issueId = url.searchParams.get('issue_id') || '';
    if (!/^\d{1,12}$/.test(issueId)) {
      return reply({ error: '증명서 번호가 올바르지 않습니다.' }, 400, origin);
    }

    /* ---------- 올리기 : 서기·간사·노회장 ---------- */
    if (path === '/upload') {
      if (request.method !== 'POST') return reply({ error: '허용되지 않는 요청입니다.' }, 405, origin);
      if (!(await canManage(auth, env))) {
        return reply({ error: '증명서를 보관할 권한이 없습니다.' }, 403, origin);
      }

      const len = Number(request.headers.get('Content-Length') || 0);
      if (len > MAX_BYTES) {
        return reply({ error: '증명서 한 장은 10MB까지 보관할 수 있습니다.' }, 413, origin);
      }

      const row = await readIssue(auth, env, issueId);
      if (!row) return reply({ error: '발급 기록을 찾을 수 없습니다.' }, 404, origin);

      const body = await request.arrayBuffer();
      if (!body.byteLength) return reply({ error: '보낼 파일이 비어 있습니다.' }, 400, origin);
      if (body.byteLength > MAX_BYTES) {
        return reply({ error: '증명서 한 장은 10MB까지 보관할 수 있습니다.' }, 413, origin);
      }

      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const rand = Math.floor(Math.random() * 1e6);
      const key = 'cert/' + issueId + '/' + stamp + '-' + rand + '.pdf';
      const name = fileNameOf(row);

      await env.CERTS.put(key, body, {
        httpMetadata: { contentType: 'application/pdf' },
        customMetadata: { issue_id: String(issueId), doc_no: row.doc_no || '', filename: name }
      });

      /* 같은 증명서를 다시 올렸으면 먼저 있던 파일은 지운다 */
      if (row.pdf_path && row.pdf_path !== key && okKey(row.pdf_path)) {
        await env.CERTS.delete(row.pdf_path).catch(function () {});
      }

      return reply({
        ok: true, key: key, path: key,
        url: url.origin + '/d/' + key,
        size: body.byteLength
      }, 200, origin);
    }

    /* ---------- 내려받을 주소 주기 : 본인 또는 관리자 ---------- */
    if (path === '/sign') {
      if (request.method !== 'GET') return reply({ error: '허용되지 않는 요청입니다.' }, 405, origin);

      const row = await readIssue(auth, env, issueId);
      if (!row) {
        return reply({ error: '증명서를 찾을 수 없습니다. 본인이 받으신 증명서만 내려받을 수 있습니다.' }, 404, origin);
      }
      const key = row.pdf_path || '';
      if (!key || !okKey(key)) {
        return reply({ error: '보관된 증명서가 없습니다.', no_file: true }, 404, origin);
      }
      if (!(await env.CERTS.head(key))) {
        return reply({ error: '보관된 증명서가 없습니다.', no_file: true }, 404, origin);
      }

      const exp = Math.floor(Date.now() / 1000) + SIGN_TTL;
      const sig = await sign(env, key, exp);
      return reply({
        ok: true,
        url: url.origin + '/d/' + key + '?exp=' + exp + '&sig=' + sig,
        expires_in: SIGN_TTL,
        filename: fileNameOf(row)
      }, 200, origin);
    }

    /* ---------- 보관본 지우기 : 서기·간사·노회장 ---------- */
    if (path === '/delete') {
      if (request.method !== 'POST') return reply({ error: '허용되지 않는 요청입니다.' }, 405, origin);
      if (!(await canManage(auth, env))) {
        return reply({ error: '보관본을 지울 권한이 없습니다.' }, 403, origin);
      }

      const row = await readIssue(auth, env, issueId);
      const key = row && row.pdf_path;
      if (!key || !okKey(key)) {
        return reply({ ok: true, note: '보관된 증명서가 없습니다.' }, 200, origin);
      }
      await env.CERTS.delete(key);
      return reply({ ok: true, key: key }, 200, origin);
    }

    return reply({ error: '없는 주소입니다.' }, 404, origin);
  }
};

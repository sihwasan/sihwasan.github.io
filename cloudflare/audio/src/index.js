/* 시화산노회 회의 녹음 보관소 (Cloudflare R2 창구)
 *
 * 회의록에 붙이는 회의 녹음 파일을 담아 두고, 들을 자격이 있는 분께만 들려준다.
 * 녹음은 한 시간이 넘으면 100MB를 훌쩍 넘으므로 20MB씩 나누어 올린다(R2 분할 올리기).
 *
 * 하는 일
 *   POST /up/start                     올리기 시작 → 보관 이름과 올리기 번호 (서기·회록서기)
 *   PUT  /up/part?key=&uploadId=&n=    한 조각 올리기 (서기·회록서기)
 *   POST /up/done                      조각을 하나로 잇기 (서기·회록서기)
 *   POST /up/abort                     올리다 그만두기 (서기·회록서기)
 *   POST /del                          녹음 지우기 — 표에서 먼저 지운 것만 (서기·회록서기)
 *   POST /sign                         재생 주소 받기 — 들을 자격이 있을 때만 (4시간짜리)
 *   GET  /p/<보관 이름>?exp=&sig=        실제 소리 보내기 (구간 이동 가능)
 *
 * 누가 무엇을 할 수 있는지는 이 창구가 정하지 않는다.
 * 보내온 로그인 증표로 Supabase에 그때그때 묻는다 (113 sql의 can_upload_minutes_audio,
 * minutes_audio 표의 읽기 규칙). 이 창구는 관리자 열쇠를 갖고 있지 않으므로
 * 남의 녹음을 대신 꺼내 줄 수 없다.
 */

const ALLOW_ORIGINS = [
  'https://sihwasan.org',
  'https://www.sihwasan.org',
  'https://sihwasan.github.io',
  'http://localhost:8123',
  'http://localhost:8899'
];

const KEY_RE = /^minutes\/\d{14}-[a-z0-9]{6}\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|mp4|amr|3gp|flac|wma)$/;
const PART_MAX = 50 * 1024 * 1024;        /* 한 조각에 50MB까지 (화면은 20MB씩 보낸다) */
const PLAY_HOURS = 4;                     /* 재생 주소가 살아 있는 시간 */

const TYPE_OF = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg',
  oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', mp4: 'audio/mp4', amr: 'audio/amr',
  '3gp': 'audio/3gpp', flac: 'audio/flac', wma: 'audio/x-ms-wma'
};

function cors(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, HEAD, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function reply(body, status, origin) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(origin))
  });
}

/* ---------- Supabase에 묻기 (보낸 사람의 증표 그대로) ---------- */
function sbHeaders(request, env) {
  return {
    Authorization: request.headers.get('Authorization') || '',
    apikey: env.SUPABASE_ANON_KEY,
    'Content-Type': 'application/json'
  };
}
function hasToken(request) {
  return (request.headers.get('Authorization') || '').startsWith('Bearer ');
}
async function canUpload(request, env) {
  if (!hasToken(request)) return false;
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/can_upload_minutes_audio', {
    method: 'POST', headers: sbHeaders(request, env), body: '{}'
  });
  if (!r.ok) return false;
  return (await r.json().catch(function () { return false; })) === true;
}
/* 표에서 읽히는 줄 — 읽기 규칙이 곧 들을 자격이다 */
async function audioRows(request, env, filter) {
  if (!hasToken(request)) return null;
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/minutes_audio?select=id,file_key&' + filter, {
    headers: sbHeaders(request, env)
  });
  if (!r.ok) return null;
  return r.json().catch(function () { return null; });
}

/* ---------- 재생 주소 서명 ---------- */
function b64url(buf) {
  let s = '';
  new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacKey(env) {
  if (!env.SIGN_SECRET) throw new Error('SIGN_SECRET 이 설정되지 않았습니다.');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SIGN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(env, key, exp) {
  const k = await hmacKey(env);
  return b64url(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(key + '.' + exp)));
}
async function verify(env, key, exp, sig) {
  if (!/^\d+$/.test(exp) || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const k = await hmacKey(env);
  try {
    return await crypto.subtle.verify('HMAC', k, unb64url(sig), new TextEncoder().encode(key + '.' + exp));
  } catch (e) { return false; }
}

function newKey(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  const ext = m && TYPE_OF[m[1]] ? m[1] : 'm4a';
  const t = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const r = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return 'minutes/' + t + '-' + r + '.' + ext;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return reply(null, 204, origin);
    if (path === '/' || path === '/health') {
      return reply({ ok: true, service: '시화산노회 회의 녹음 보관소' }, 200, origin);
    }

    try {
      /* ---------- 올리기 ---------- */
      if (path.startsWith('/up/')) {
        if (!(await canUpload(request, env))) {
          return reply({ error: '녹음 파일은 서기·회록서기만 올릴 수 있습니다.' }, 403, origin);
        }

        if (path === '/up/start' && request.method === 'POST') {
          const body = await request.json().catch(function () { return {}; });
          const key = newKey(body.name);
          const ext = key.split('.').pop();
          const mpu = await env.AUDIO.createMultipartUpload(key, {
            httpMetadata: { contentType: TYPE_OF[ext] || 'application/octet-stream' }
          });
          return reply({ key: key, uploadId: mpu.uploadId }, 200, origin);
        }

        if (path === '/up/part' && request.method === 'PUT') {
          const key = url.searchParams.get('key') || '';
          const uploadId = url.searchParams.get('uploadId') || '';
          const n = Number(url.searchParams.get('n'));
          if (!KEY_RE.test(key) || !uploadId || !(n >= 1 && n <= 10000)) {
            return reply({ error: '올리기 정보가 올바르지 않습니다.' }, 400, origin);
          }
          const len = Number(request.headers.get('Content-Length') || 0);
          if (!len || len > PART_MAX) return reply({ error: '조각 크기가 올바르지 않습니다.' }, 413, origin);
          const part = await env.AUDIO.resumeMultipartUpload(key, uploadId).uploadPart(n, request.body);
          return reply({ partNumber: part.partNumber, etag: part.etag }, 200, origin);
        }

        if ((path === '/up/done' || path === '/up/abort') && request.method === 'POST') {
          const body = await request.json().catch(function () { return {}; });
          const key = String(body.key || ''), uploadId = String(body.uploadId || '');
          if (!KEY_RE.test(key) || !uploadId) return reply({ error: '올리기 정보가 올바르지 않습니다.' }, 400, origin);
          const mpu = env.AUDIO.resumeMultipartUpload(key, uploadId);
          if (path === '/up/abort') {
            await mpu.abort().catch(function () {});
            return reply({ ok: true }, 200, origin);
          }
          const parts = (Array.isArray(body.parts) ? body.parts : []).map(function (p) {
            return { partNumber: Number(p.partNumber), etag: String(p.etag || '') };
          });
          if (!parts.length) return reply({ error: '올린 조각이 없습니다.' }, 400, origin);
          const obj = await mpu.complete(parts);
          return reply({ ok: true, key: key, size: obj.size }, 200, origin);
        }
        return reply({ error: '없는 주소입니다.' }, 404, origin);
      }

      /* ---------- 지우기 : 표에서 먼저 지운 녹음만 ---------- */
      if (path === '/del' && request.method === 'POST') {
        if (!(await canUpload(request, env))) {
          return reply({ error: '녹음 파일은 서기·회록서기만 지울 수 있습니다.' }, 403, origin);
        }
        const body = await request.json().catch(function () { return {}; });
        const key = String(body.key || '');
        if (!KEY_RE.test(key)) return reply({ error: '보관 이름이 올바르지 않습니다.' }, 400, origin);
        const rows = await audioRows(request, env, 'file_key=eq.' + encodeURIComponent(key));
        if (rows === null) return reply({ error: '확인하지 못했습니다. 잠시 뒤 다시 해 주세요.' }, 502, origin);
        if (rows.length) return reply({ error: '회의록에 붙어 있는 녹음은 먼저 목록에서 지워 주세요.' }, 409, origin);
        await env.AUDIO.delete(key);
        return reply({ ok: true }, 200, origin);
      }

      /* ---------- 재생 주소 받기 ---------- */
      if (path === '/sign' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const id = Number(body.id);
        if (!(id > 0)) return reply({ error: '녹음 번호가 올바르지 않습니다.' }, 400, origin);
        if (!hasToken(request)) return reply({ error: '로그인이 확인되지 않았습니다.' }, 401, origin);
        const rows = await audioRows(request, env, 'id=eq.' + id);
        if (rows === null) return reply({ error: '확인하지 못했습니다. 잠시 뒤 다시 해 주세요.' }, 502, origin);
        if (!rows.length || !KEY_RE.test(rows[0].file_key)) {
          return reply({ error: '지금은 이 녹음을 들으실 수 없습니다. (들을 수 있는 기간이 아니거나 권한이 없습니다)' }, 403, origin);
        }
        const key = rows[0].file_key;
        const exp = String(Math.floor(Date.now() / 1000) + PLAY_HOURS * 3600);
        const sig = await sign(env, key, exp);
        return reply({ url: url.origin + '/p/' + key + '?exp=' + exp + '&sig=' + sig, exp: Number(exp) }, 200, origin);
      }

      /* ---------- 소리 보내기 (구간 요청을 받아 앞뒤로 옮겨 들을 수 있다) ---------- */
      if (path.startsWith('/p/') && (request.method === 'GET' || request.method === 'HEAD')) {
        const key = decodeURIComponent(path.slice(3));
        if (!KEY_RE.test(key)) return reply({ error: '보관 이름이 올바르지 않습니다.' }, 400, origin);
        if (!(await verify(env, key, url.searchParams.get('exp') || '', url.searchParams.get('sig') || ''))) {
          return reply({ error: '재생 주소가 만료되었습니다. 화면에서 다시 눌러 주세요.' }, 403, origin);
        }
        const h = new Headers(cors(origin));
        h.set('Accept-Ranges', 'bytes');
        h.set('Cache-Control', 'private, no-store');
        h.set('Content-Disposition', 'inline');

        if (request.method === 'HEAD') {
          const head = await env.AUDIO.head(key);
          if (!head) return reply({ error: '녹음을 찾을 수 없습니다.' }, 404, origin);
          head.writeHttpMetadata(h);
          h.set('Content-Length', String(head.size));
          return new Response(null, { status: 200, headers: h });
        }

        const wantRange = !!request.headers.get('Range');
        let obj;
        try {
          obj = await env.AUDIO.get(key, wantRange ? { range: request.headers } : undefined);
        } catch (e) {
          const head = await env.AUDIO.head(key);
          h.set('Content-Range', 'bytes */' + (head ? head.size : 0));
          return new Response(null, { status: 416, headers: h });
        }
        if (!obj) return reply({ error: '녹음을 찾을 수 없습니다.' }, 404, origin);
        obj.writeHttpMetadata(h);
        h.set('etag', obj.httpEtag);

        if (wantRange && obj.range) {
          const size = obj.size;
          let start, end;
          if (typeof obj.range.suffix === 'number') {
            start = Math.max(0, size - obj.range.suffix); end = size - 1;
          } else {
            start = obj.range.offset || 0;
            end = typeof obj.range.length === 'number' ? start + obj.range.length - 1 : size - 1;
          }
          h.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
          h.set('Content-Length', String(end - start + 1));
          return new Response(obj.body, { status: 206, headers: h });
        }
        h.set('Content-Length', String(obj.size));
        return new Response(obj.body, { status: 200, headers: h });
      }

      return reply({ error: '없는 주소입니다.' }, 404, origin);
    } catch (e) {
      return reply({ error: '처리하지 못했습니다: ' + ((e && e.message) || e) }, 500, origin);
    }
  }
};

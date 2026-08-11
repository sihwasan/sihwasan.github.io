/* 시화산노회 사진 보관소 (Cloudflare R2 창구)
 *
 * 사진은 Cloudflare R2에, 글·명단·기록은 Supabase에 나누어 보관한다.
 * R2는 내보내는 데이터(전송량)에 요금이 없으므로 갤러리가 커져도 부담이 없다.
 *
 * 하는 일
 *   PUT    /o/full/사진이름.jpg   사진 올리기   (로그인한 정회원 이상)
 *   DELETE /o/full/사진이름.jpg   사진 지우기   (관리자, 또는 올린 본인)
 *   GET    /o/full/사진이름.jpg   사진 보여주기 (누구나)
 *
 * 올리는 사람이 정말 노회 회원인지는 Supabase에 물어서 확인한다.
 * 이 창구는 비밀 열쇠를 따로 갖고 있지 않으므로, 남의 이름으로 올릴 수 없다.
 */

const ALLOW_ORIGINS = [
  'https://sihwasan.github.io',
  'http://localhost:8899'
];

/* 올릴 수 있는 이름 형식만 허용한다 (경로를 거슬러 올라가는 장난 방지) */
const KEY_RE = /^(full|thumb)\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(jpg|jpeg|png|webp)$/;

const MAX_BYTES = 8 * 1024 * 1024;   /* 사진 한 장 8MB까지 */

function cors(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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

/* 보낸 사람이 누구인지 Supabase에 확인한다 */
async function whoIs(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;

  const u = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY }
  });
  if (!u.ok) return null;
  const user = await u.json();
  if (!user || !user.id) return null;

  /* 등급은 본인 것만 읽어 온다 (Supabase 보안 정책이 그대로 적용된다) */
  let role = 'pending';
  const p = await fetch(
    env.SUPABASE_URL + '/rest/v1/profiles?select=role&id=eq.' + encodeURIComponent(user.id),
    { headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY } }
  );
  if (p.ok) {
    const rows = await p.json();
    if (rows && rows[0] && rows[0].role) role = rows[0].role;
  }
  return { id: user.id, role: role };
}

const MANAGERS = ['superadmin', 'president', 'clerk', 'staff'];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return reply(null, 204, origin);

    if (url.pathname === '/' || url.pathname === '/health') {
      return reply({ ok: true, service: '시화산노회 사진 보관소' }, 200, origin);
    }

    if (!url.pathname.startsWith('/o/')) return reply({ error: '없는 주소입니다.' }, 404, origin);
    const key = decodeURIComponent(url.pathname.slice(3));
    if (!KEY_RE.test(key)) return reply({ error: '사진 이름 형식이 올바르지 않습니다.' }, 400, origin);

    /* ---------- 보여주기 : 누구나 ---------- */
    if (request.method === 'GET' || request.method === 'HEAD') {
      const obj = await env.PHOTOS.get(key);
      if (!obj) return reply({ error: '사진을 찾을 수 없습니다.' }, 404, origin);
      const h = new Headers(cors(origin));
      obj.writeHttpMetadata(h);
      h.set('etag', obj.httpEtag);
      /* 사진은 한 번 올리면 바뀌지 않으므로 오래 보관해 두고 쓴다 */
      h.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(request.method === 'HEAD' ? null : obj.body, { headers: h });
    }

    /* ---------- 올리기 : 로그인한 정회원 이상 ---------- */
    if (request.method === 'PUT') {
      const me = await whoIs(request, env);
      if (!me) return reply({ error: '로그인이 확인되지 않았습니다.' }, 401, origin);
      if (me.role === 'pending') {
        return reply({ error: '승인대기 상태에서는 사진을 올릴 수 없습니다.' }, 403, origin);
      }

      const len = Number(request.headers.get('Content-Length') || 0);
      if (len > MAX_BYTES) {
        return reply({ error: '사진 한 장은 8MB까지 올릴 수 있습니다.' }, 413, origin);
      }
      if (await env.PHOTOS.head(key)) {
        return reply({ error: '같은 이름의 사진이 이미 있습니다.' }, 409, origin);
      }

      const type = request.headers.get('Content-Type') || 'image/jpeg';
      if (type.indexOf('image/') !== 0) {
        return reply({ error: '사진 파일만 올릴 수 있습니다.' }, 415, origin);
      }

      await env.PHOTOS.put(key, request.body, {
        httpMetadata: { contentType: type },
        customMetadata: { uploader: me.id, role: me.role }
      });
      return reply({ ok: true, key: key, url: url.origin + '/o/' + key }, 201, origin);
    }

    /* ---------- 지우기 : 관리자, 또는 올린 본인 ---------- */
    if (request.method === 'DELETE') {
      const me = await whoIs(request, env);
      if (!me) return reply({ error: '로그인이 확인되지 않았습니다.' }, 401, origin);

      const obj = await env.PHOTOS.head(key);
      if (!obj) return reply({ ok: true, note: '이미 없는 사진입니다.' }, 200, origin);

      const owner = obj.customMetadata && obj.customMetadata.uploader;
      if (MANAGERS.indexOf(me.role) === -1 && owner !== me.id) {
        return reply({ error: '이 사진을 지울 권한이 없습니다.' }, 403, origin);
      }
      await env.PHOTOS.delete(key);
      return reply({ ok: true }, 200, origin);
    }

    return reply({ error: '허용되지 않는 요청입니다.' }, 405, origin);
  }
};

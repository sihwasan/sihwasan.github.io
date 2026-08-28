/* 시화산노회 자료 보관소 (Cloudflare R2 창구)
 *
 * 자료실에 올리는 문서(회의록·공문·회계·서식 등)를 담아 두고,
 * 내려받는 사람의 등급을 확인한 뒤에만 내어 준다.
 *
 * 하는 일
 *   GET /f/공개등급/분류/이름.hwp    자료 내려주기
 *
 * 열람 등급은 파일 이름 맨 앞 칸에 적어 둔다.
 *   public   누구나
 *   member   정회원 이상
 *   officer  노회 임원 이상
 *   admin    노회장·서기·간사 등 관리자만
 *
 * 등급이 public 이 아니면 로그인 증표(Bearer)를 받아 Supabase에 물어보고,
 * 그 사람의 등급이 충분할 때만 내어 준다. 이 창구는 비밀 열쇠를 갖고 있지
 * 않으므로, 남의 자료를 대신 열어 줄 수 없다.
 */

const ALLOW_ORIGINS = [
  'https://sihwasan.org',
  'https://www.sihwasan.org',
  'https://sihwasan.github.io',
  'http://localhost:8123',
  'http://localhost:8899'
];

/* 올릴 수 있는 이름 형식만 허용한다 (경로를 거슬러 올라가는 장난 방지) */
const KEY_RE = /^(public|member|officer|admin)\/[a-z0-9-]{1,40}\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/* 등급별로 들어갈 수 있는 사람 */
const MEMBER  = ['member', 'officer', 'president', 'clerk', 'staff', 'superadmin'];
const OFFICER = ['officer', 'president', 'clerk', 'staff', 'superadmin'];
const ADMIN   = ['president', 'clerk', 'staff', 'superadmin'];

function cors(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function reply(body, status, origin) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status: status,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8' }, cors(origin)
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

function allowed(level, role) {
  if (level === 'public') return true;
  if (!role) return false;
  if (level === 'member') return MEMBER.indexOf(role) !== -1;
  if (level === 'officer') return OFFICER.indexOf(role) !== -1;
  if (level === 'admin') return ADMIN.indexOf(role) !== -1;
  return false;
}

const LEVEL_NAME = {
  member: '정회원', officer: '노회 임원', admin: '노회 관리자(서기·간사·노회장)'
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return reply(null, 204, origin);
    if (url.pathname === '/' || url.pathname === '/health') {
      return reply({ ok: true, service: '시화산노회 자료 보관소' }, 200, origin);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply({ error: '허용되지 않는 요청입니다.' }, 405, origin);
    }
    if (!url.pathname.startsWith('/f/')) {
      return reply({ error: '없는 주소입니다.' }, 404, origin);
    }

    const key = decodeURIComponent(url.pathname.slice(3));
    if (!KEY_RE.test(key)) {
      return reply({ error: '자료 이름 형식이 올바르지 않습니다.' }, 400, origin);
    }
    const level = key.split('/')[0];

    let me = null;
    if (level !== 'public') {
      me = await whoIs(request, env);
      if (!me) {
        return reply({ error: '로그인이 확인되지 않았습니다.' }, 401, origin);
      }
      if (!allowed(level, me.role)) {
        return reply({ error: '이 자료는 ' + (LEVEL_NAME[level] || level) + '만 열람할 수 있습니다.' }, 403, origin);
      }
    }

    const obj = await env.DOCS.get(key);
    if (!obj) return reply({ error: '자료를 찾을 수 없습니다.' }, 404, origin);

    const h = new Headers(cors(origin));
    obj.writeHttpMetadata(h);
    h.set('etag', obj.httpEtag);
    /* 자료는 등급을 확인하고 내어 주므로 중간에 보관해 두지 않는다 */
    h.set('Cache-Control', 'private, no-store');
    return new Response(request.method === 'HEAD' ? null : obj.body, { headers: h });
  }
};

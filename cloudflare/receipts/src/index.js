/* 시화산노회 영수증 자동 읽기 창구 (Cloudflare Worker → Claude API)
 *
 * 회계가 장부에 영수증 사진을 올리면 홈페이지가 이 창구에 사진을 보내고,
 * 창구는 Claude 에게 사진을 보여 주어 일자·사용처·금액·품목을 읽어 돌려준다.
 * 홈페이지는 읽은 값을 입력칸에 미리 채우기만 하고, 저장은 회계가 확인한 뒤 한다.
 *
 * 하는 일
 *   POST /read   { book_id, media_type, image(base64) }  →  { ok, result, usage }
 *   GET  /health
 *
 * 누가 부를 수 있나
 *   로그인 증표(Bearer)를 Supabase 에 확인하고, 그 사람이 book_id 장부를
 *   적을 수 있는지(ledger_book_writable) 물어본다. 아니면 거절한다.
 *   그래서 회계가 아닌 사람이 이 창구로 비용을 쓰게 할 수 없다.
 *
 * 비밀 열쇠
 *   ANTHROPIC_API_KEY 는 wrangler secret 으로만 넣는다. 코드·설정 파일에 적지 않는다.
 */

const ALLOW_ORIGINS = [
  'https://sihwasan.org',
  'https://www.sihwasan.org',
  'https://sihwasan.github.io',
  'http://localhost:8123',
  'http://localhost:8899'
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;      /* 사진 한 장 5MB(base64 기준)까지 */
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/* Claude 가 돌려줄 값의 모양 — 이 틀에 맞는 JSON 만 돌아온다 */
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    taken_on:   { type: ['string', 'null'], description: '거래 일자, YYYY-MM-DD. 연도가 없으면 사진의 다른 단서로 추정하되 확실하지 않으면 null' },
    vendor:     { type: ['string', 'null'], description: '사용처(상호). 지점명은 뺀 짧은 이름' },
    amount:     { type: ['integer', 'null'], description: '최종 합계 금액(원, 부가세 포함, 정수). 여러 금액이 있으면 실제 결제 총액' },
    payment:    { type: ['string', 'null'], description: '결제 수단: 카드 / 현금 / 계좌이체 / 기타' },
    items: {
      type: 'array',
      description: '품목 목록 (읽히는 것만, 최대 20개)',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name:   { type: 'string' },
          amount: { type: ['integer', 'null'] }
        },
        required: ['name', 'amount']
      }
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: '읽은 값에 대한 확신' },
    note:       { type: ['string', 'null'], description: '회계가 확인해야 할 점 (흐림, 잘림, 합계 불명확 등). 없으면 null' }
  },
  required: ['taken_on', 'vendor', 'amount', 'payment', 'items', 'confidence', 'note']
};

const INSTRUCTION =
  '이 사진은 한국 교회 노회의 회계 장부에 붙일 영수증입니다 ' +
  '(간이영수증·손글씨 영수증·카드 매출전표·현금영수증·계산서·이체 확인증 등). ' +
  '사진에서 거래 일자, 사용처(상호), 최종 합계 금액(원), 결제 수단, 품목을 읽어 주세요. ' +
  '금액은 숫자만(원 단위 정수)으로 적고, 여러 금액이 보이면 실제로 지불한 총액을 고르세요. ' +
  '읽을 수 없거나 확실하지 않은 값은 null 로 두고 note 에 그 이유를 짧게 적으세요. ' +
  '사진에 적힌 것 외에 지어내지 마세요.';

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
    status: status,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8' }, cors(origin)
    )
  });
}

/* 보낸 사람이 누구인지 Supabase 에 확인한다 */
async function whoIs(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const u = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY }
  });
  if (!u.ok) return null;
  const user = await u.json();
  if (!user || !user.id) return null;
  return { id: user.id, auth: auth };
}

/* 그 장부를 적을 수 있는 사람인가 (Supabase 의 규칙이 그대로 판정한다) */
async function canWriteBook(me, env, bookId) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/ledger_book_writable', {
    method: 'POST',
    headers: {
      Authorization: me.auth, apikey: env.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_book: bookId })
  });
  if (!r.ok) return false;
  const v = await r.json();
  return v === true;
}

/* Claude API 를 한 번 부른다. { ok, status, data, type, message } 로 돌려준다 */
async function callClaude(env, body, betaHeader) {
  const headers = {
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json'
  };
  if (betaHeader) headers['anthropic-beta'] = betaHeader;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: headers, body: JSON.stringify(body)
  });
  const data = await r.json().catch(function () { return null; });
  const err = (data && data.error) || {};
  return {
    ok: r.ok, status: r.status, data: data,
    type: err.type || '', message: err.message || (r.ok ? '' : 'HTTP ' + r.status)
  };
}

/* 열쇠와 접속이 살아 있는지 — 모델 목록을 물어본다 (토큰을 쓰지 않는다) */
async function checkApi(env) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
    });
    const data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      const err = (data && data.error) || {};
      return { ok: false, status: r.status, type: err.type || '', message: err.message || ('HTTP ' + r.status) };
    }
    return { ok: true, status: r.status,
             models: ((data && data.data) || []).map(function (m) { return m.id; }) };
  } catch (e) {
    return { ok: false, status: 0, type: 'network', message: (e && e.message) || String(e) };
  }
}

/* Claude 에게 사진을 읽게 한다.
 * 1) 고른 모델 + 서버 대체(fallbacks)  2) 대체 없이  3) 다른 모델 — 순서로 시도한다.
 * 열쇠에 권한이 없다는 답(403)이나 모델을 못 찾는 답(404)일 때만 다음으로 넘어간다. */
async function readReceipt(env, mediaType, imageBase64) {
  const primary = env.ANTHROPIC_MODEL || 'claude-opus-5';
  const content = [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
    { type: 'text', text: INSTRUCTION }
  ];
  function bodyFor(model, withFallback) {
    const b = {
      model: model,
      max_tokens: 1024,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
      messages: [{ role: 'user', content: content }]
    };
    /* 안전 분류기가 거절하면 서버가 대신 다른 모델로 다시 시도한다 */
    if (withFallback) b.fallbacks = 'default';
    return b;
  }
  const attempts = [
    { model: primary, fb: true },
    { model: primary, fb: false },
    { model: 'claude-sonnet-5', fb: false }
  ];
  let last = null;
  const tried = [];
  for (const a of attempts) {
    if (tried.indexOf(a.model) === -1) tried.push(a.model);
    const r = await callClaude(env, bodyFor(a.model, a.fb), a.fb ? 'server-side-fallback-2026-07-01' : '');
    if (r.ok) { last = r; break; }
    last = r;
    console.error('claude attempt failed', a.model, a.fb ? 'fallbacks' : 'plain', r.status, r.type, r.message);
    const canMoveOn = r.status === 403 || r.status === 404 ||
      (r.status === 400 && /fallback|beta/i.test(r.message));
    if (!canMoveOn) break;
  }
  if (!last.ok) {
    let msg = 'Claude API 오류: ' + last.message;
    if (last.type) msg += ' [' + last.type + ']';
    if (last.status === 403) {
      msg += ' — 열쇠(API 키)가 이 요청을 허용받지 못했습니다. ' +
        'Anthropic 콘솔에서 키가 속한 작업 공간의 모델 권한·지역 제한을 확인해 주세요 (시도한 모델: ' + tried.join(', ') + ')';
    }
    throw new Error(msg);
  }
  const data = last.data;
  if (data.stop_reason === 'refusal') {
    throw new Error('사진을 읽을 수 없다고 응답했습니다. 다른 사진으로 다시 시도해 주세요.');
  }
  const text = (data.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; }).join('');
  let result = null;
  try { result = JSON.parse(text); } catch (e) {
    throw new Error('읽은 결과를 해석하지 못했습니다.');
  }
  return {
    result: result,
    model: data.model,
    usage: data.usage ? {
      input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens
    } : null
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return reply(null, 204, origin);
    if (url.pathname === '/' || url.pathname === '/health') {
      const out = { ok: true, service: '시화산노회 영수증 자동 읽기',
                    ready: !!env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || 'claude-opus-5',
                    colo: (request.cf && request.cf.colo) || null };
      /* ?check=1 : 열쇠로 모델 목록을 받아 본다 — 접속·권한 문제를 여기서 바로 본다 */
      if (url.searchParams.get('check') && env.ANTHROPIC_API_KEY) out.api = await checkApi(env);
      return reply(out, 200, origin);
    }
    if (url.pathname !== '/read' || request.method !== 'POST') {
      return reply({ error: '없는 주소입니다.' }, 404, origin);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return reply({ error: '자동 읽기 열쇠(ANTHROPIC_API_KEY)가 아직 등록되지 않았습니다.' }, 503, origin);
    }

    const me = await whoIs(request, env);
    if (!me) return reply({ error: '로그인이 확인되지 않았습니다.' }, 401, origin);

    const body = await request.json().catch(function () { return null; });
    if (!body) return reply({ error: '보낸 내용을 읽을 수 없습니다.' }, 400, origin);
    const bookId = parseInt(body.book_id, 10);
    const mediaType = String(body.media_type || 'image/jpeg');
    const image = String(body.image || '');
    if (!bookId) return reply({ error: '장부 번호가 없습니다.' }, 400, origin);
    if (MEDIA_TYPES.indexOf(mediaType) === -1) return reply({ error: '지원하지 않는 사진 형식입니다.' }, 400, origin);
    if (!image || image.length > MAX_IMAGE_BYTES * 4 / 3) {
      return reply({ error: '사진이 없거나 너무 큽니다 (5MB 이하).' }, 400, origin);
    }

    if (!(await canWriteBook(me, env, bookId))) {
      return reply({ error: '이 장부에 영수증을 붙일 권한이 없습니다.' }, 403, origin);
    }

    try {
      const out = await readReceipt(env, mediaType, image);
      return reply({ ok: true, result: out.result, model: out.model, usage: out.usage }, 200, origin);
    } catch (e) {
      const colo = (request.cf && request.cf.colo) || '?';
      console.error('read failed', colo, e && e.message);
      return reply({ error: ((e && e.message) || '읽지 못했습니다.') + ' (접속 지점 ' + colo + ')' }, 502, origin);
    }
  }
};

/* 시화산노회 영수증 자동 읽기 창구 (Cloudflare Worker → Claude API)
 *
 * 회계가 장부에 영수증 사진을 올리면 홈페이지가 이 창구에 사진을 보내고,
 * 창구는 Claude 에게 사진을 보여 주어 일자·사용처·금액·품목을 읽어 돌려준다.
 * 홈페이지는 읽은 값을 입력칸에 미리 채우기만 하고, 저장은 회계가 확인한 뒤 한다.
 *
 * 하는 일
 *   POST /read   { book_id, media_type, image(base64) }  →  { ok, result, usage }
 *   GET  /health            창구가 살아 있는가 (열쇠 등록 여부)
 *   GET  /health?check=1    열쇠로 모델 목록을 받아 본다 (토큰을 쓰지 않음)
 *   GET  /health?check=2    아주 작은 그림으로 진짜 읽기 경로까지 돌려 본다 (토큰을 조금 씀)
 *
 * 누가 부를 수 있나
 *   로그인 증표(Bearer)를 Supabase 에 확인하고, 그 사람이 book_id 장부를
 *   적을 수 있는지(ledger_book_writable) 물어본다. 아니면 거절한다.
 *   그래서 회계가 아닌 사람이 이 창구로 비용을 쓰게 할 수 없다.
 *
 * 장애에 버티기 (2026-09-11)
 *   Claude 쪽의 잠깐 장애(429·5xx·접속 끊김·JSON 아닌 차단 페이지)는 조금 쉬었다가
 *   다시 부르고, 그래도 안 되면 다른 모델(claude-sonnet-5)로 넘어간다.
 *   오류 글에는 원인(형식·접속 지점·차단 머리글)을 담아 홈페이지에 그대로 보인다.
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

/* 자가 진단(?check=2)에 쓰는 아주 작은 그림 — 1×1 PNG */
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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

/* ================= Claude API 부르기 ================= */

function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

/* 응답 머리글 가운데 원인 판단에 쓰이는 것만 추린다 (차단 페이지·재시도 안내 등) */
function pickHeaders(r) {
  const hdr = {};
  if (!r) return hdr;
  ['content-type', 'server', 'cf-ray', 'cf-mitigated', 'request-id', 'x-should-retry', 'retry-after', 'cf-cache-status', 'via']
    .forEach(function (k) { const v = r.headers.get(k); if (v) hdr[k] = v; });
  return hdr;
}

/* 한 번 부른 결과를 { ok, status, data, type, message, headers, body_head } 로 정리한다.
 * JSON 이 아닌 응답(차단 페이지 등)도 오류로 삼되 본문 앞부분을 남겨 원인을 알 수 있게 한다. */
async function fetchClaude(url, init) {
  let r = null, raw = '', data = null;
  try {
    r = await fetch(url, init);
    raw = await r.text();
    try { data = JSON.parse(raw); } catch (e) { data = null; }
  } catch (e) {
    return { ok: false, status: 0, data: null, type: 'network',
             message: (e && e.message) || String(e), headers: {}, body_head: '' };
  }
  const err = (data && data.error) || {};
  return {
    ok: r.ok && !!data,
    status: r.status,
    data: data,
    type: err.type || (r.ok ? '' : (data ? '' : 'non_json')),
    message: err.message || (r.ok ? '' : 'HTTP ' + r.status),
    headers: pickHeaders(r),
    body_head: data ? '' : raw.slice(0, 300)
  };
}

/* 잠깐의 장애인가 — 접속 실패·요청 시간 초과·혼잡(429)·서버 오류(5xx)·JSON 아닌 응답 */
function isTransient(res) {
  return res.status === 0 || res.status === 408 || res.status === 429 || res.status >= 500 ||
         (!res.ok && res.type === 'non_json');
}

/* 잠깐의 장애면 조금 쉬었다가 다시 부른다 (retry-after 가 있으면 그만큼, 없으면 0.7초·1.4초…) */
async function withRetry(fn, tries) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (last.ok || !isTransient(last) || i === tries - 1) break;
    const ra = parseInt(last.headers && last.headers['retry-after'], 10);
    await sleep(Math.min(ra > 0 ? ra * 1000 : 700 * Math.pow(2, i), 6000));
  }
  return last;
}

async function callClaude(env, body, betaHeader) {
  const headers = {
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json'
  };
  if (betaHeader) headers['anthropic-beta'] = betaHeader;
  return withRetry(function () {
    return fetchClaude('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: headers, body: JSON.stringify(body)
    });
  }, 2);
}

/* 열쇠와 접속이 살아 있는지 — 모델 목록을 물어본다 (토큰을 쓰지 않는다) */
async function checkApi(env) {
  const r = await withRetry(function () {
    return fetchClaude('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
    });
  }, 2);
  if (!r.ok) {
    return { ok: false, status: r.status, type: r.type, message: r.message,
             headers: r.headers, body_head: r.body_head || undefined };
  }
  return { ok: true, status: r.status,
           models: ((r.data && r.data.data) || []).map(function (m) { return m.id; }) };
}

/* 사람이 읽을 오류 글 — 홈페이지 입력칸 아래에 그대로 보인다 */
function explain(res, tried) {
  let msg = 'Claude API 오류: ' + res.message;
  if (res.type && res.type !== 'non_json') msg += ' [' + res.type + ']';
  if (res.status === 0) {
    msg = 'Claude API 에 접속하지 못했습니다 (' + res.message + '). 잠시 뒤 「다시 읽기」를 눌러 주세요.';
  } else if (res.status === 429 || res.status === 529 || res.type === 'overloaded_error') {
    msg += ' — Claude 서버가 혼잡합니다. 잠시 뒤 「다시 읽기」를 눌러 주세요.';
  } else if (res.status >= 500) {
    msg += ' — Claude 쪽에 일시 장애가 있습니다. 잠시 뒤 다시 시도해 주세요 (상태: status.claude.com).';
  } else if (res.status === 403) {
    msg += ' — 열쇠(API 키)가 이 요청을 허용받지 못했습니다. ' +
      'Anthropic 콘솔에서 키가 속한 작업 공간의 모델 권한·지역 제한을 확인해 주세요 (시도한 모델: ' + tried.join(', ') + ')';
  } else if (res.status === 401) {
    msg += ' — 열쇠(API 키)가 맞지 않거나 폐기되었습니다. Cloudflare 워커의 ANTHROPIC_API_KEY 를 다시 넣어 주세요.';
  } else if (res.status === 400 && /credit|balance|billing/i.test(res.message)) {
    msg += ' — Anthropic 계정의 잔액(크레딧)이 부족합니다. 충전 뒤 다시 시도해 주세요.';
  }
  if (res.headers && res.headers['cf-mitigated']) msg += ' (차단: ' + res.headers['cf-mitigated'] + ')';
  return msg;
}

/* Claude 에게 사진을 읽게 한다.
 * 1) 고른 모델 + 서버 대체(fallbacks)  2) 대체 없이  3) 다른 모델 — 순서로 시도한다.
 *   · 열쇠 권한(403)·모델 없음(404)·베타 거절(400) 이면 다음 조합으로,
 *   · 잠깐의 장애(429·5xx·접속 실패) 는 같은 모델을 되풀이하지 않고 곧장 다른 모델로,
 *   · 그 밖의 400(요청 자체가 틀림) 은 되풀이해도 소용없으니 멈춘다. */
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
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    if (tried.indexOf(a.model) === -1) tried.push(a.model);
    const r = await callClaude(env, bodyFor(a.model, a.fb), a.fb ? 'server-side-fallback-2026-07-01' : '');
    if (r.ok) { last = r; break; }
    last = r;
    console.error('claude attempt failed', a.model, a.fb ? 'fallbacks' : 'plain',
                  r.status, r.type, r.message, JSON.stringify(r.headers), r.body_head || '');
    if (isTransient(r)) {
      /* 같은 모델은 건너뛰고 다른 모델로 */
      while (i + 1 < attempts.length && attempts[i + 1].model === a.model) i++;
      continue;
    }
    const canMoveOn = r.status === 403 || r.status === 404 ||
      (r.status === 400 && /fallback|beta/i.test(r.message));
    if (!canMoveOn) break;
  }
  if (!last.ok) throw new Error(explain(last, tried));

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
      const check = url.searchParams.get('check');
      if (check && env.ANTHROPIC_API_KEY) {
        /* ?check=1 : 열쇠로 모델 목록을 받아 본다 — 접속·권한 문제를 여기서 바로 본다 */
        out.api = await checkApi(env);
        /* ?check=2 : 진짜 읽기 경로(모델·구조화 출력·대체)까지 아주 작은 그림으로 돌려 본다 */
        if (check === '2') {
          try {
            const t = await readReceipt(env, 'image/png', TINY_PNG);
            out.read = { ok: true, model: t.model, usage: t.usage, result: t.result };
          } catch (e) {
            out.read = { ok: false, error: (e && e.message) || String(e) };
          }
        }
      }
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

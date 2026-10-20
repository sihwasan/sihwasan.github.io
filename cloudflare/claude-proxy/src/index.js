/* 시화산노회 Claude 중계 (sihwasan-claude) — 내부 전용
 *
 * sihwasan-ai 의 예약 실행(매일 아침 6시 임원 업무 보고서)이 Claude API 를 부를 때 거치는 창구.
 * Cloudflare 예약 실행(cron)은 워커의 실행 위치 고정([placement] region)이 먹지 않아, 홍콩 등
 * Claude API 를 지원하지 않는 지역에서 돌면 「Request not allowed」(403)로 거절된다 (2026-10-21 확인).
 * 이 워커는 실행 위치를 도쿄로 고정하고, sihwasan-ai 가 서비스 바인딩(CLAUDE)으로 부른다.
 *
 * 인터넷 주소가 없다 (workers_dev = false, 경로 없음) — 같은 계정의 워커가 바인딩으로만 부를 수 있다.
 * 열쇠를 갖고 있지 않다 — 부르는 쪽이 보낸 머리말(x-api-key)을 그대로 Claude 에 넘길 뿐이다.
 */
const ALLOW = ['/v1/messages', '/v1/models'];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (ALLOW.indexOf(url.pathname) === -1) return new Response('not allowed', { status: 403 });
    const headers = new Headers();
    ['x-api-key', 'anthropic-version', 'anthropic-beta', 'content-type', 'accept'].forEach(function (h) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    });
    return fetch('https://api.anthropic.com' + url.pathname + url.search, {
      method: request.method,
      headers: headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text()
    });
  }
};

/* 시화산노회 총회자료실 - 자료 검색 (관리자 전용)
 *
 * 노회장·서기·간사·최고관리자에게만 총회자료실 위쪽에 검색창을 붙인다.
 * 질문은 노회 사무실 컴퓨터에서 돌아가는 검색 서버로 보내고,
 * 그 컴퓨터가 총회·노회 자료를 찾아 Claude에게 물어 답을 만들어 준다.
 *
 * · 사무실 컴퓨터의 검색 서버가 꺼져 있으면 검색창이 보이지 않는다.
 * · 다른 회원에게는 아무것도 보이지 않는다.
 */
(function () {
  'use strict';

  var SERVER = 'http://127.0.0.1:8790';
  var ALLOW = ['president', 'clerk', 'staff', 'superadmin'];
  var KEEP = 'shs_aisearch_last';   /* 화면을 옮겨도 마지막 답을 이어서 보여준다 */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 답변 글을 화면에 보기 좋게 옮긴다 (굵게 표시와 줄 목록만 살린다) */
  function fmt(text) {
    var lines = String(text || '').split('\n');
    var html = '', list = false;
    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) { if (list) { html += '</ul>'; list = false; } return; }
      var body = esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (/^[-*·]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
        if (!list) { html += '<ul>'; list = true; }
        html += '<li>' + body.replace(/^([-*·]|\d+\.)\s+/, '') + '</li>';
        return;
      }
      if (list) { html += '</ul>'; list = false; }
      if (/^근거\s*:/.test(line)) html += '<p class="ai-basis">' + body + '</p>';
      else html += '<p>' + body + '</p>';
    });
    if (list) html += '</ul>';
    return html;
  }

  function build(user) {
    var gnb = document.querySelector('.gnb');
    if (!gnb) return;

    var wrap = document.createElement('div');
    wrap.className = 'ai-bar';
    wrap.innerHTML =
      '<div class="container ai-bar-in">' +
      '<form class="ai-form" id="ai-form">' +
      '<span class="ai-tag">자료 검색</span>' +
      '<input type="text" id="ai-q" maxlength="500" autocomplete="off" ' +
      'placeholder="총회 헌법·규정·결의와 노회 회칙에서 찾아 답해 드립니다. 예: 노회 임시회는 어떻게 소집합니까?">' +
      '<button type="submit" class="btn sm" id="ai-go">묻기</button>' +
      '<button type="button" class="ai-x hidden" id="ai-close" title="답 닫기">&times;</button>' +
      '</form>' +
      '<div class="ai-panel hidden" id="ai-panel"></div>' +
      '</div>';
    gnb.insertAdjacentElement('afterend', wrap);

    var form = document.getElementById('ai-form');
    var input = document.getElementById('ai-q');
    var panel = document.getElementById('ai-panel');
    var go = document.getElementById('ai-go');
    var closeBtn = document.getElementById('ai-close');

    function show(html) {
      panel.innerHTML = html;
      panel.classList.remove('hidden');
      closeBtn.classList.remove('hidden');
    }
    function hide() {
      panel.classList.add('hidden');
      closeBtn.classList.add('hidden');
      try { sessionStorage.removeItem(KEEP); } catch (x) {}
    }
    closeBtn.addEventListener('click', hide);

    function render(q, data) {
      var src = (data.sources || []).map(function (s) {
        return '<a href="' + esc(s.url) + '">[' + s.n + '] ' + esc(s.src) +
          (s.title ? ' &middot; ' + esc(s.title) : '') + '</a>';
      }).join('');
      show('<div class="ai-q">' + esc(q) + '</div>' +
        '<div class="ai-a">' + fmt(data.answer) + '</div>' +
        (src ? '<div class="ai-src"><span>참고한 자료</span>' + src + '</div>' : '') +
        '<div class="ai-note">사무실 컴퓨터의 검색 서버가 총회·노회 자료에서 찾아 정리한 답입니다. ' +
        '중요한 사안은 원문을 함께 확인해 주세요.</div>');
    }

    /* 화면을 옮겨도 마지막 답이 남아 있게 한다 */
    try {
      var last = JSON.parse(sessionStorage.getItem(KEEP) || 'null');
      if (last && last.q && last.data) { input.value = last.q; render(last.q, last.data); }
    } catch (x) {}

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var q = input.value.trim();
      if (q.length < 2) return;

      go.disabled = true;
      show('<div class="ai-q">' + esc(q) + '</div>' +
        '<div class="ai-loading">자료를 찾아 정리하는 중입니다… (15초쯤 걸립니다)</div>');

      SHSCloud.init().then(function (c) {
        return c.auth.getSession();
      }).then(function (s) {
        var token = s && s.data && s.data.session && s.data.session.access_token;
        return fetch(SERVER + '/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, question: q })
        });
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; });
      }).then(function (out) {
        go.disabled = false;
        if (!out.ok) {
          show('<div class="ai-q">' + esc(q) + '</div>' +
            '<div class="ai-err">' + esc(out.j.error || '답을 만들지 못했습니다.') + '</div>');
          return;
        }
        render(q, out.j);
        try { sessionStorage.setItem(KEEP, JSON.stringify({ q: q, data: out.j })); } catch (x) {}
      }).catch(function () {
        go.disabled = false;
        show('<div class="ai-q">' + esc(q) + '</div>' +
          '<div class="ai-err">노회 사무실 컴퓨터의 검색 서버에 연결하지 못했습니다.<br>' +
          '사무실 컴퓨터에서 <strong>검색서버 시작</strong>을 실행했는지 확인해 주세요.</div>');
      });
    });
  }

  /* 등급을 확인한 뒤, 검색 서버가 켜져 있을 때만 검색창을 붙인다 */
  function start() {
    if (!window.SHS || !SHS.getUser) return;
    SHS.getUser().then(function (user) {
      if (!user || ALLOW.indexOf(user.role) === -1) return;
      if (!(window.SHSCloud && SHSCloud.enabled())) return;

      var ctl = new AbortController();
      var t = setTimeout(function () { ctl.abort(); }, 2500);
      fetch(SERVER + '/health', { signal: ctl.signal })
        .then(function (r) { clearTimeout(t); return r.ok ? r.json() : null; })
        .then(function (h) { if (h && h.ok) build(user); })
        .catch(function () { /* 서버가 꺼져 있으면 조용히 넘어간다 */ });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

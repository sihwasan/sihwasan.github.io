/* 메뉴 왼쪽 세로 메뉴
 *
 * 상단 메뉴(노회소개·시찰회·상비부·노회전자자료실·서류발급·나의 서류·총회·게시판·갤러리·임원방)의
 * 어느 쪽을 열든, 그 메뉴의 하위 항목이 왼쪽에 세로로 서고 본문은 오른쪽에 놓인다.
 * 하위 항목은 이미 그려진 상단 메뉴(.gnb)에서 읽으므로, 로그인 뒤에 덧붙는 항목
 * (일정관리·회의관리·재정부 회계 …)도 그대로 따라온다.
 * 관리자 화면(js/admin-shell.js)은 이 자리에 관리자 메뉴를 대신 세운다.
 * 휴대전화에서는 위쪽에 접었다 펴는 띠가 된다. main.js 가 모든 화면에 끼워 넣는다.
 */
var SHSSide = (function () {
  var SKIP = ['index.html', 'login.html', 'signup.html', 'auth-callback.html', 'reset-password.html',
    'certificate.html', 'today.html', 'app.html', 'mfa.html'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pageOf(h) { return String(h || '').split('#')[0].split('?')[0]; }

  /* 본문을 왼쪽 메뉴 + 오른쪽 본문 틀에 넣는다 (이미 있으면 그대로 쓴다) */
  function ensureWrap() {
    var wrap = document.querySelector('.adm-wrap');
    if (wrap) return wrap;
    var head = document.querySelector('.page-head');
    var main = document.querySelector('main#main') || document.querySelector('main');
    if (!main) return null;
    wrap = document.createElement('div');
    wrap.className = 'adm-wrap';
    var body = document.createElement('div');
    body.className = 'adm-body';
    main.parentNode.insertBefore(wrap, head || main);
    wrap.appendChild(body);
    if (head) body.appendChild(head);
    body.appendChild(main);
    document.body.classList.add('adm-mode');
    return wrap;
  }
  /* 왼쪽 자리에 메뉴를 세운다 — 있던 것은 바꾼다 */
  function setAside(aside) {
    var wrap = ensureWrap();
    if (!wrap) return false;
    var old = wrap.querySelector(':scope > aside');
    if (old) wrap.replaceChild(aside, old); else wrap.insertBefore(aside, wrap.firstChild);
    aside.querySelectorAll('.adm-toggle').forEach(function (t) {
      t.addEventListener('click', function () {
        var open = aside.classList.toggle('open');
        t.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
    return true;
  }

  /* 지금 쪽이 든 상단 메뉴 묶음 (.gnb-item) 을 찾는다 — 해시까지 맞는 것을 먼저 */
  function findSection() {
    var here = location.pathname.split('/').pop() || 'index.html';
    var full = here + location.search + location.hash;
    var items = [].slice.call(document.querySelectorAll('.gnb .gnb-item'));
    var exact = null, byPage = null;
    items.forEach(function (it) {
      var top = it.querySelector(':scope > a');
      var links = [].slice.call(it.querySelectorAll('.gnb-sub a'));
      links.concat(top ? [top] : []).forEach(function (a) {
        var h = a.getAttribute('href') || '';
        if (!exact && (h === full || h === here + location.search)) exact = it;
        if (!byPage && pageOf(h) === here) byPage = it;
      });
    });
    return exact || byPage;
  }

  function menuHtml(section) {
    var top = section.querySelector(':scope > a');
    var title = top ? top.textContent.trim() : '';
    var here = location.pathname.split('/').pop() || 'index.html';
    var full = here + location.hash;                     /* 물음표 뒤(검색어 등)는 무시 */
    var links = [].slice.call(section.querySelectorAll('.gnb-sub a'));
    /* 현재 항목: 주소가 꼭 같은 것, 없으면 같은 쪽인 첫 항목 */
    var onIdx = -1;
    /* 같은 쪽을 ?c=부서 처럼 물음표 값으로 나누는 메뉴(상비부·시찰 등)는 물음표 값까지 꼭 같은 항목을 먼저 고른다 */
    function dec(t) { try { return decodeURIComponent(t); } catch (x) { return t; } }
    var hereQ = dec(here + location.search);
    if (location.search) links.forEach(function (a, i) {
      var h = (a.getAttribute('href') || '').split('#')[0];
      if (onIdx === -1 && h.indexOf('?') !== -1 && dec(h) === hereQ) onIdx = i;
    });
    if (onIdx === -1) links.forEach(function (a, i) { var h = (a.getAttribute('href') || '').replace(/\?[^#]*/, ''); if ((h === full || h === here) && (onIdx === -1 || a.classList.contains('gnb-kid'))) onIdx = i; });
    if (onIdx === -1) links.forEach(function (a, i) { if (onIdx === -1 && pageOf(a.getAttribute('href')) === here) onIdx = i; });
    var cur = onIdx >= 0 ? links[onIdx].textContent.replace(/\s+/g, ' ').trim() : title;
    var html =
      '<button type="button" class="adm-toggle" aria-expanded="false">' +
      '<span class="adm-toggle-t">' + esc(title) + '</span><span class="adm-toggle-c">' + esc(cur) + '</span><span class="adm-caret">▾</span></button>' +
      '<div class="adm-menu"><div class="adm-head"><span class="adm-badge">' + esc(title) + '</span></div><div class="adm-group">';
    links.forEach(function (a, i) {
      if (a.style.display === 'none') return;   /* 자격이 없어 감춘 항목(재정부 회계 등) */
      html += '<a class="adm-link' + (a.classList.contains('gnb-kid') ? ' lv2' : '') + (i === onIdx ? ' on' : '') + '" href="' + esc(a.getAttribute('href')) + '">' +
        esc(a.textContent.replace(/\s+/g, ' ').trim()) + '</a>';
    });
    html += '</div><a class="adm-exit" href="index.html">← 홈페이지로</a></div>';
    return html;
  }

  var mounted = false;
  function mount() {
    var here = location.pathname.split('/').pop() || 'index.html';
    if (SKIP.indexOf(here) !== -1) return;
    if (/[?&]embed=1(?:&|$)/.test(location.search)) return;
    if (document.getElementById('adm-side')) return;   /* 관리자 메뉴가 이미 서 있다 */
    var section = findSection();
    if (!section) return;
    var aside = document.createElement('aside');
    aside.className = 'adm-side sec';
    aside.id = 'sec-side';
    aside.setAttribute('aria-label', '이 메뉴의 항목');
    aside.innerHTML = menuHtml(section);
    if (setAside(aside)) mounted = true;
  }
  /* 로그인 뒤 상단 메뉴에 항목이 덧붙거나(일정관리 등) 탭 해시가 바뀌면 다시 그린다 */
  function refresh() {
    var side = document.getElementById('sec-side');
    if (!side) { mount(); return; }
    var section = findSection();
    if (!section) return;
    var open = side.classList.contains('open');
    side.innerHTML = menuHtml(section);
    side.classList.toggle('open', open);
    side.querySelectorAll('.adm-toggle').forEach(function (t) {
      t.addEventListener('click', function () { var o = side.classList.toggle('open'); t.setAttribute('aria-expanded', o ? 'true' : 'false'); });
    });
  }
  function start() {
    mount();
    var list = document.querySelector('.gnb-list');
    if (list && window.MutationObserver) {
      var timer = null;
      new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(refresh, 80); }).observe(list, { childList: true, subtree: true });
    }
    window.addEventListener('hashchange', refresh);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  return { mount: mount, refresh: refresh, ensureWrap: ensureWrap, setAside: setAside };
})();

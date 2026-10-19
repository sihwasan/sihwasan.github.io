/* 관리자 모드 — 왼쪽 메뉴
 *
 * 관리자(노회장·서기·간사·최고관리자)가 관리 화면에 들어오면, 흩어져 있던 관리
 * 메뉴를 왼쪽 한 줄로 모아 보여 준다. 화면 본문은 오른쪽에 그대로 놓인다.
 * main.js 가 관리자에게만 이 파일을 끼워 넣는다 (ADMIN_PAGES).
 * 휴대전화에서는 위쪽에 접었다 펴는 메뉴가 된다.
 */
var SHSAdminShell = (function () {
  var GROUPS = [
    { title: '관리자 홈', items: [{ t: '한눈에 보기', h: 'admin-home.html', icon: '⌂' }] },
    { title: '홈페이지', items: [
      { t: '공지 · 메인 문구 · 갤러리', h: 'manage.html', icon: '✎',
        sub: [{ t: '공지사항', h: 'manage.html#mg-notice' }, { t: '메인 화면 문구', h: 'manage.html#mg-hero' }, { t: '갤러리', h: 'manage.html#mg-gallery' }] },
      { t: '노회 일정', h: 'schedule.html', icon: '▦' },
      { t: '자료실 · 회칙', h: 'archive-edit.html', icon: '▤' }
    ] },
    { title: '회원 · 조직', items: [
      { t: '회원 관리', h: 'admin.html', icon: '♟' },
      { t: '상비부 관리', h: 'admin.html?view=com', icon: '⚑' },
      { t: '총대 장로 임기 · 공문', h: 'elder-notice.html', icon: '✉' }
    ] },
    { title: '회무', items: [
      { t: '노회 회의관리', h: 'meeting-admin.html', icon: '▣', who: 'meeting' },
      { t: '노회 진행 매니저', h: 'proceed.html', icon: '▶', who: 'clerk' },
      { t: '노회 회의록', h: 'minutes.html', icon: '≡' },
      { t: '서류 발급', h: 'documents.html', icon: '✓' },
      { t: '교회상황 보고서 접수', h: 'report-intake.html', icon: '▥' },
      { t: '감사 결과 보고서', h: 'audit-report.html', icon: '☑' }
    ] },
    { title: '설정', items: [
      { t: 'AI 검색 · API', h: 'admin-ai.html', icon: '✦' },
      { t: '직인 · 도장 · 수수료', h: 'settings.html', icon: '◎' },
      { t: '노회 운영 · 알림 규칙', h: 'manage.html#mg-ops', icon: '⚙' },
      { t: '시스템 운영 · 감사 기록', h: 'ops.html', icon: '⌁' }
    ] }
  ];

  function here() { return (location.pathname.split('/').pop() || 'index.html') + location.search; }
  function pageOf(h) { return h.split('#')[0]; }
  function allowed(item, u) {
    if (!item.who) return true;
    if (item.who === 'clerk') return u.role === 'clerk' || u.role === 'superadmin';
    if (item.who === 'meeting') return u.role === 'clerk' || u.role === 'superadmin' || u.role === 'president' || u.role === 'staff' ||
      (u.role === 'officer' && String(u.title || '').trim() === '부서기');
    return true;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function menuHtml(u) {
    var cur = here();
    var curPage = cur.split('?')[0];
    var html = '';
    GROUPS.forEach(function (g) {
      var items = g.items.filter(function (it) { return allowed(it, u); });
      if (!items.length) return;
      html += '<div class="adm-group"><div class="adm-group-t">' + esc(g.title) + '</div>';
      items.forEach(function (it) {
        var on = pageOf(it.h) === cur || (pageOf(it.h) === curPage && it.h.indexOf('?') === -1 && cur.indexOf('?') === -1) ||
                 (it.h.indexOf('?') !== -1 && cur === it.h);
        /* admin.html 과 admin.html?view=com 을 구분한다 */
        if (curPage === 'admin.html' && cur.indexOf('view=com') !== -1) on = it.h.indexOf('view=com') !== -1;
        else if (curPage === 'admin.html') on = it.h === 'admin.html';
        if (pageOf(it.h) === 'manage.html' && curPage === 'manage.html') on = it.h.indexOf('#mg-ops') === -1 ? location.hash !== '#mg-ops' : location.hash === '#mg-ops';
        html += '<a class="adm-link' + (on ? ' on' : '') + '" href="' + esc(it.h) + '"><span class="adm-ic">' + (it.icon || '·') + '</span>' + esc(it.t) + '</a>';
        if (on && it.sub) {
          html += '<div class="adm-sub">' + it.sub.map(function (s) {
            return '<a href="' + esc(s.h) + '"' + (location.hash && s.h.indexOf(location.hash) !== -1 ? ' class="on"' : '') + '>' + esc(s.t) + '</a>';
          }).join('') + '</div>';
        }
      });
      html += '</div>';
    });
    return html;
  }

  function mount(u) {
    if (!u || !window.SHSAuth || !SHSAuth.canManageMembers(u)) return;
    if (document.getElementById('adm-side')) return;
    var head = document.querySelector('.page-head');
    var main = document.querySelector('main#main') || document.querySelector('main');
    if (!main) return;

    var wrap = document.createElement('div');
    wrap.className = 'adm-wrap';
    var side = document.createElement('aside');
    side.className = 'adm-side'; side.id = 'adm-side';
    side.innerHTML =
      '<button type="button" class="adm-toggle" id="adm-toggle" aria-expanded="false">' +
      '<span class="adm-toggle-t">관리자 메뉴</span><span class="adm-toggle-c">' + esc(document.title.split(' - ')[0]) + '</span><span class="adm-caret">▾</span></button>' +
      '<div class="adm-menu" id="adm-menu"><div class="adm-head"><span class="adm-badge">관리자 모드</span>' +
      '<span class="adm-who">' + esc(SHS.honorific(u)) + '</span></div>' + menuHtml(u) +
      '<a class="adm-exit" href="index.html">← 홈페이지로</a></div>';
    var body = document.createElement('div');
    body.className = 'adm-body';

    main.parentNode.insertBefore(wrap, head || main);
    wrap.appendChild(side);
    wrap.appendChild(body);
    if (head) body.appendChild(head);
    body.appendChild(main);
    document.body.classList.add('adm-mode');

    side.querySelector('#adm-toggle').addEventListener('click', function () {
      var open = side.classList.toggle('open');
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    /* 같은 쪽 안의 탭(#mg-hero 등)으로 옮기면 그 탭을 켠다 */
    side.querySelectorAll('.adm-sub a, .adm-link').forEach(function (a) {
      a.addEventListener('click', function () {
        var h = a.getAttribute('href');
        if (h.split('#')[0] !== here().split('#')[0]) return;
        var id = h.split('#')[1];
        if (!id) return;
        var b = document.querySelector('.tabs button[data-tab="' + id + '"]');
        if (b) { b.click(); side.classList.remove('open'); }
        setTimeout(function () { side.querySelector('#adm-menu').innerHTML = side.querySelector('#adm-menu').innerHTML; }, 0);
      });
    });
    window.addEventListener('hashchange', function () {
      var menu = side.querySelector('#adm-menu');
      var keep = menu.querySelector('.adm-head').outerHTML;
      menu.innerHTML = keep + menuHtml(u) + '<a class="adm-exit" href="index.html">← 홈페이지로</a>';
    });
  }

  function start() {
    if (!window.SHS || !SHS.getUser) return;
    SHS.getUser().then(mount);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return { mount: mount, GROUPS: GROUPS };
})();

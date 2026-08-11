/* 시화산노회 홈페이지 - 공통 레이아웃 및 유틸 */

(function () {
  var user = SHSAuth.currentUser();

  /* ---------- 상단바 + 헤더 + GNB ---------- */
  var NAV = [
    { title: '노회소개', href: 'about.html', sub: [
      { t: '인사말', h: 'about.html#greeting' },
      { t: '노회 연혁', h: 'about.html#history' },
      { t: '관할지역 안내', h: 'about.html#area' },
      { t: '오시는 길', h: 'about.html#location' }
    ]},
    { title: '조직', href: 'organization.html', sub: [
      { t: '노회 임원', h: 'organization.html#officers' },
      { t: '회원명단', h: 'organization.html#members' },
      { t: '시찰회', h: 'organization.html#sichal' },
      { t: '상비부', h: 'organization.html#committees' }
    ]},
    { title: '회칙', href: 'rules-presbytery.html', sub: [
      { t: '노회 회칙', h: 'rules-presbytery.html' },
      { t: '총회 회칙 안내', h: 'rules-assembly.html' },
      { t: '각종 내규', h: 'rules-presbytery.html#bylaws' }
    ]},
    { title: '자료실', href: 'archive.html', sub: [
      { t: '자료 목록', h: 'archive.html' },
      { t: '지난 회기 결의사항', h: 'archive.html#resolutions' },
      { t: '구비서류 안내', h: 'archive.html#forms' }
    ]},
    { title: '게시판', href: 'board.html', sub: [
      { t: '공지사항', h: 'board.html#notice' },
      { t: '자유게시판', h: 'board.html#free' }
    ]},
    { title: '갤러리', href: 'gallery.html', sub: [
      { t: '노회 행사', h: 'gallery.html' }
    ]},
    { title: '임원방', href: 'officer.html', sub: [
      { t: '임원 자료실', h: 'officer.html' },
      { t: '노회 회의록', h: 'minutes.html' },
      { t: '서류 발급', h: 'documents.html' },
      { t: '회원 관리', h: 'admin.html' },
      { t: '사이트 관리', h: 'manage.html' }
    ]}
  ];

  function buildTopbar() {
    var right;
    if (user) {
      right = '<span class="user-name">' + user.name + '</span>' +
        '<span>(' + SHSAuth.roleName(user.role) + (user.title ? ' · ' + user.title : '') + ')</span>' +
        '<a href="mypage.html">내 정보</a>' +
        '<a href="#" id="btn-logout">로그아웃</a>';
    } else {
      right = '<a href="login.html">로그인</a><a href="login.html">회원가입</a>';
    }
    return '<div class="topbar"><div class="container">' +
      '<div>대한예수교장로회(합동) 시화산노회</div>' +
      '<div class="util"><a href="https://gapck.org" target="_blank" rel="noopener">총회 홈페이지</a>' + right + '</div>' +
      '</div></div>';
  }

  function buildHeader() {
    return '<header class="site-header"><div class="container">' +
      '<a class="brand" href="index.html">' +
      '<img class="brand-logo" src="images/logo.svg" alt="시화산노회 로고">' +
      '<span class="brand-text"><span class="denom">THE PRESBYTERIAN CHURCH IN KOREA</span>' +
      '<span class="name">시화산노회</span></span></a>' +
      '<div class="header-contact">노회 사무실<strong>031-486-9993</strong>안산시 단원구 와동공원로1안길 13-7</div>' +
      '</div></header>';
  }

  function buildGnb() {
    var here = location.pathname.split('/').pop() || 'index.html';
    var html = '<nav class="gnb"><ul class="gnb-list">';
    NAV.forEach(function (m) {
      var active = here === m.href ? ' active' : '';
      html += '<li class="gnb-item' + active + '"><a href="' + m.href + '">' + m.title + '</a><div class="gnb-sub">';
      m.sub.forEach(function (s) { html += '<a href="' + s.h + '">' + s.t + '</a>'; });
      html += '</div></li>';
    });
    html += '</ul></nav>';
    return html;
  }

  function buildFooter() {
    return '<footer class="site-footer"><div class="container">' +
      '<div class="f-name">대한예수교장로회(합동) 시화산노회</div>' +
      '<div>노회 사무실 : 경기도 안산시 단원구 와동공원로1안길 13-7 (반월교회 교육관 1층)</div>' +
      '<div>전화 031-486-9993 / 팩스 031-486-9993</div>' +
      '<div class="f-links"><a href="about.html">노회소개</a><a href="rules-presbytery.html">노회 회칙</a>' +
      '<a href="terms.html"><strong>이용약관</strong></a>' +
      '<a href="privacy.html"><strong>개인정보처리방침</strong></a>' +
      '<a href="https://gapck.org" target="_blank" rel="noopener">대한예수교장로회총회</a></div>' +
      '</div></footer>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var fav = document.createElement('link');
    fav.rel = 'icon';
    fav.type = 'image/svg+xml';
    fav.href = 'images/logo.svg';
    document.head.appendChild(fav);

    document.body.insertAdjacentHTML('afterbegin', buildTopbar() + buildHeader() + buildGnb());
    document.body.insertAdjacentHTML('beforeend', buildFooter());

    /* 로그아웃: 이메일 세션과 구글(서버) 세션을 모두 정리한다.
     * 서버 응답이 늦어도 1.5초 후에는 반드시 홈으로 이동한다. */
    function doLogout(e) {
      if (e) e.preventDefault();
      try { SHSAuth.logout(); } catch (x) {}
      var moved = false;
      function go() {
        if (moved) return;
        moved = true;
        location.href = 'index.html';
      }
      if (window.SHSCloud && SHSCloud.enabled()) {
        SHSCloud.signOut().then(go, go);
        setTimeout(go, 1500);
      } else {
        go();
      }
    }
    window.SHSLogout = doLogout;

    var lg = document.getElementById('btn-logout');
    if (lg) lg.addEventListener('click', doLogout);

    /* 구글 로그인(서버) 세션 확인 후 상단바를 그 정보로 바꾼다.
     * 로그인 직후에는 주소 끝에 인증 토큰이 붙어 돌아오므로,
     * 토큰을 처리한 뒤 주소창을 깨끗하게 정리한다. */
    if (window.SHSCloud && SHSCloud.enabled() && !user) {
      var hadToken = location.hash.indexOf('access_token') !== -1;

      SHSCloud.loadProfile().then(function (p) {
        if (hadToken) {
          history.replaceState(null, '', location.pathname + location.search);
        }
        if (!p) return;

        var util = document.querySelector('.topbar .util');
        if (util) {
          util.innerHTML =
            '<a href="https://gapck.org" target="_blank" rel="noopener">총회 홈페이지</a>' +
            '<span class="user-name">' + (p.name || p.email) + '</span>' +
            '<span>(' + SHSCloud.roleName(p.role) + (p.title ? ' · ' + p.title : '') + ')</span>' +
            '<a href="mypage.html">내 정보</a><a href="#" id="btn-logout2">로그아웃</a>';
          var lo = document.getElementById('btn-logout2');
          if (lo) lo.addEventListener('click', window.SHSLogout);
        }

        /* 아직 성명·소속 교회를 등록하지 않은 회원은 등록 화면으로 안내한다. */
        var here = location.pathname.split('/').pop() || 'index.html';
        if (!p.church && here !== 'auth-callback.html' && here !== 'mypage.html') {
          location.href = 'auth-callback.html';
        }
      });
    }

    /* 탭 */
    document.querySelectorAll('.tabs').forEach(function (tabs) {
      var btns = tabs.querySelectorAll('button');
      btns.forEach(function (b) {
        b.addEventListener('click', function () {
          btns.forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          var scope = tabs.parentElement;
          scope.querySelectorAll(':scope > .tab-panel').forEach(function (p) {
            p.classList.toggle('active', p.id === b.dataset.tab);
          });
        });
      });
    });

    /* 해시로 탭 열기 (#officers 등) */
    if (location.hash) {
      var target = document.querySelector('.tabs button[data-tab="' + location.hash.slice(1) + '"]');
      if (target) target.click();
    }

    /* 정기노회 이후 관리자에게 홈페이지 갱신 안내 */
    getUser().then(meetingReminder);
  });

  /* 이름 마스킹: 개인정보 보호를 위해 비회원에게는 가운데 글자를 *로 표시 */
  function maskName(name) {
    var n = String(name || '').trim();
    if (n.length <= 1) return '*';
    if (n.length === 2) return n.charAt(0) + '*';
    if (n.length === 3) return n.charAt(0) + '*' + n.charAt(2);
    return n.charAt(0) + '**' + n.charAt(n.length - 1);
  }

  /* 통합 세션 확인: 구글 로그인(서버)과 이메일 로그인(브라우저)을 모두 확인한다.
   * 반환되는 사용자 객체는 role·title·name·church 등을 가지므로
   * SHSAuth의 권한 판정 함수(isOfficer 등)에 그대로 전달할 수 있다. */
  function getUser() {
    return new Promise(function (resolve) {
      var local = SHSAuth.currentUser();
      if (local) { resolve(local); return; }
      if (window.SHSCloud && SHSCloud.enabled()) {
        SHSCloud.loadProfile().then(function (p) {
          if (!p) { resolve(null); return; }
          resolve({
            id: p.id, email: p.email, name: p.name || p.email,
            church: p.church || '', position: p.position || '',
            phone: p.phone || '', role: p.role, title: p.title || null,
            cloud: true
          });
        });
        return;
      }
      resolve(null);
    });
  }

  /* ---------- 정기노회 일정 알림 ----------
   * 노회규칙 제24조: 정기회는 연 2회.
   *  봄  : 부활절 다음 주 월요일 (2026년 부활절 4/5 → 4/13 개회와 일치)
   *  가을: 10월 둘째 주 주일 후 월요일
   * 정기회가 폐회되면 간사·서기·노회장·최고관리자에게
   * 임원 등록과 명단·상비부 갱신을 요청하는 안내를 띄운다. */

  function easterDate(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100;
    var d = Math.floor(b / 4), ee = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * ee + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31);
    var day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }

  function springMeeting(y) {
    var d = easterDate(y);
    d.setDate(d.getDate() + 8);  /* 부활절(주일) 다음 주 월요일 */
    return d;
  }

  function fallMeeting(y) {
    var d = new Date(y, 9, 1);   /* 10월 1일 */
    var firstSunday = 1 + ((7 - d.getDay()) % 7);
    return new Date(y, 9, firstSunday + 7 + 1);  /* 둘째 주 주일 + 1일(월) */
  }

  function meetingReminder(u) {
    if (!u || !SHSAuth.canManageMembers(u)) return;
    var today = new Date();
    var y = today.getFullYear();
    /* 봄 회기: 2026년 봄 = 제19회 */
    var events = [
      { key: 'spring' + y, date: springMeeting(y), label: '제' + (19 + (y - 2026)) + '회 봄 정기노회',
        tasks: '신임 임원 등록(조직 페이지·명단·계정 등급), 상비부 배정 갱신, 회의록 등록' },
      { key: 'fall' + y, date: fallMeeting(y), label: '제' + (19 + (y - 2026)) + '회기 가을 정기노회',
        tasks: '결의사항·회의록 등록, 명단 변동 반영' }
    ];
    events.forEach(function (ev) {
      var from = ev.date.getTime();
      var until = from + 45 * 24 * 3600 * 1000;   /* 폐회 후 45일간 안내 */
      var now = today.getTime();
      if (now < from || now > until) return;
      if (localStorage.getItem('shs_reminder_done_' + ev.key)) return;

      var dateStr = (ev.date.getMonth() + 1) + '월 ' + ev.date.getDate() + '일';
      var bar = document.createElement('div');
      bar.className = 'container';
      bar.style.marginTop = '16px';
      bar.innerHTML =
        '<div class="notice-banner" style="border-left:4px solid var(--accent)">' +
        '<strong>[홈페이지 갱신 요청]</strong> ' + ev.label + '(' + dateStr + ')가 폐회되었습니다. ' +
        '다음 사항을 갱신해 주세요: ' + ev.tasks + '. ' +
        '<a class="btn sm" style="margin-left:8px" href="admin.html">회원 관리로 이동</a> ' +
        '<button class="btn ghost sm" id="rem-' + ev.key + '">갱신 완료 (알림 끄기)</button>' +
        '</div>';
      var gnb = document.querySelector('.gnb');
      if (gnb) gnb.insertAdjacentElement('afterend', bar);
      var btn = document.getElementById('rem-' + ev.key);
      if (btn) btn.addEventListener('click', function () {
        localStorage.setItem('shs_reminder_done_' + ev.key, '1');
        SHS.logAction('update', '정기노회 갱신 완료 확인', ev.label);
        bar.remove();
      });
    });
  }

  /* 통합 감사 로그: 서버가 연결되어 있으면 서버에, 아니면 브라우저에 기록 */
  function logAction(type, action, detail) {
    if (window.SHSCloud && SHSCloud.enabled() && SHSCloud.currentProfile()) {
      SHSCloud.log(type, action, detail);
    } else {
      SHSAudit.log(type, action, detail);
    }
  }

  /* 전역 헬퍼 */
  window.SHS = {
    user: user,
    getUser: getUser,
    logAction: logAction,
    maskName: maskName,
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    fmtDate: function (d) { return d; },
    requireLogin: function (msg) {
      if (!SHSAuth.currentUser()) {
        alert(msg || '로그인이 필요한 페이지입니다.');
        location.href = 'login.html';
        return false;
      }
      return true;
    }
  };
})();

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
      { t: '사이트 관리', h: 'manage.html' },
      { t: '시스템 운영', h: 'ops.html' }
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

  /* ---------- 시스템 운영 알림 ----------
   * 봄 정기노회: 4월 둘째 주 월요일(통상 부활절 다음 주) / 가을 정기노회: 10월 둘째 주 월요일 (기준일은 운영 일정에서 변경 가능)
   * 알림 규칙은 서버(ops_notices)에서 관리하며, 간사·서기·노회장이 받는다. */

  function nthMonday(y, month, week) {
    var first = new Date(y, month - 1, 1).getDay();      /* 0=일 */
    var firstMonday = 1 + ((8 - first) % 7);
    return new Date(y, month - 1, firstMonday + 7 * (week - 1));
  }

  var DEFAULT_OPS_DATES = { springMonth: 4, springWeek: 2, fallMonth: 10, fallWeek: 2 };

  var DEFAULT_OPS_NOTICES = [
    { id: 'd1', title: '임원 교체 안내', audience: '간사', rule: 'spring', offset_days: 0, window_days: 21, active: true,
      message: '봄 정기노회 주간입니다. 사이트 관리 → 임원 명부와 회원 관리 → 노회 명단을 신임 임원으로 갱신해 주세요.' },
    { id: 'd2', title: '상비부 명부 수정 안내', audience: '간사', rule: 'spring', offset_days: 0, window_days: 21, active: true,
      message: '상비부 배정이 확정되는 기간입니다. 회원 관리 → 상비부 배정 관리에서 새 배정을 입력해 주세요.' },
    { id: 'd3', title: '고시부 공문 발송 안내 (봄)', audience: '간사', rule: 'before_spring', offset_days: 45, window_days: 45, active: true,
      message: '봄 정기노회 한 달 반 전입니다. 고시규칙부에 공문 발송을 안내해 주세요.' },
    { id: 'd4', title: '고시부 공문 발송 안내 (가을)', audience: '간사', rule: 'before_fall', offset_days: 45, window_days: 45, active: true,
      message: '가을 정기노회 한 달 반 전입니다. 고시규칙부에 공문 발송을 안내해 주세요.' }
  ];

  function opsRuleLabel(n) {
    var base = { spring: '봄 정기노회', fall: '가을 정기노회', before_spring: '봄 정기노회', before_fall: '가을 정기노회', fixed: (n.fixed_date || '') }[n.rule] || n.rule;
    if (n.rule === 'fixed') return base + '부터 ' + n.window_days + '일간';
    var when = n.offset_days > 0 ? base + ' ' + n.offset_days + '일 전부터' : base + ' 주간부터';
    return when + ' ' + n.window_days + '일간';
  }

  function opsActive(rows, dates) {
    dates = dates || DEFAULT_OPS_DATES;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var out = [];
    [today.getFullYear()].forEach(function (y) {
      var spring = nthMonday(y, dates.springMonth, dates.springWeek);
      var fall = nthMonday(y, dates.fallMonth, dates.fallWeek);
      rows.forEach(function (n) {
        if (!n.active) return;
        var base;
        if (n.rule === 'spring' || n.rule === 'before_spring') base = spring;
        else if (n.rule === 'fall' || n.rule === 'before_fall') base = fall;
        else if (n.rule === 'fixed' && n.fixed_date) base = new Date(n.fixed_date + 'T00:00:00');
        else return;
        var start = new Date(base.getTime() - n.offset_days * 86400000);
        var end = new Date(start.getTime() + n.window_days * 86400000);
        if (today < start || today > end) return;
        var doneKey = 'shs_ops_done_' + n.id + '_' + y;
        if (localStorage.getItem(doneKey)) return;
        out.push({
          id: n.id, title: n.title, message: n.message, audience: n.audience,
          doneKey: doneKey,
          period: (start.getMonth() + 1) + '.' + start.getDate() + ' ~ ' + (end.getMonth() + 1) + '.' + end.getDate()
        });
      });
    });
    return out;
  }

  /* 관리자 화면 상단 배너: 확인이 필요한 시스템 알림 안내 */
  function meetingReminder(u) {
    if (!u || !SHSAuth.canManageMembers(u)) return;

    function show(active) {
      if (!active.length) return;
      var bar = document.createElement('div');
      bar.className = 'container';
      bar.style.marginTop = '16px';
      bar.innerHTML =
        '<div class="notice-banner" style="border-left:4px solid var(--accent)">' +
        '<strong>[시스템 알림]</strong> 확인이 필요한 운영 알림이 ' + active.length + '건 있습니다: ' +
        active.map(function (n) { return n.title; }).join(', ') + ' ' +
        '<a class="btn sm" style="margin-left:8px" href="ops.html">알림 확인하기</a>' +
        '</div>';
      var gnb = document.querySelector('.gnb');
      if (gnb) gnb.insertAdjacentElement('afterend', bar);
    }

    if (u.cloud && window.SHSCloud && SHSCloud.enabled()) {
      SHSCloud.init().then(function (c) {
        if (!c) return;
        return Promise.all([
          c.from('ops_notices').select('*'),
          c.from('site_settings').select('*').eq('key', 'ops_dates').single()
        ]);
      }).then(function (rs) {
        if (!rs || rs[0].error) { show(opsActive(DEFAULT_OPS_NOTICES, DEFAULT_OPS_DATES)); return; }
        var dates = (rs[1] && rs[1].data && rs[1].data.value) || DEFAULT_OPS_DATES;
        show(opsActive(rs[0].data || [], dates));
      });
      return;
    }
    show(opsActive(DEFAULT_OPS_NOTICES, DEFAULT_OPS_DATES));
  }

  /* 통합 감사 로그: 서버가 연결되어 있으면 서버에, 아니면 브라우저에 기록 */
  function logAction(type, action, detail) {
    if (window.SHSCloud && SHSCloud.enabled() && SHSCloud.currentProfile()) {
      SHSCloud.log(type, action, detail);
    } else {
      SHSAudit.log(type, action, detail);
    }
  }

  /* ---------- 직분 판정 (위임목사) ----------
   * 조직교회(장로가 있는 교회)의 담임목사는 위임목사로 등록한다. */
  function normChurchName(s) {
    return String(s || '').replace(/\s+/g, '').replace(/교회$/, '');
  }
  function isOrganizedChurch(church) {
    var c = normChurchName(church);
    if (!c) return false;
    var found = false;
    Object.keys(SHSData.elders || {}).forEach(function (k) {
      (SHSData.elders[k] || []).forEach(function (el) {
        if (normChurchName(el.church) === c) found = true;
      });
    });
    return found;
  }
  function isSeniorPastorOf(name, church) {
    var n = String(name || '').replace(/\s+/g, '');
    var c = normChurchName(church);
    return (SHSData.pastors || []).some(function (p) {
      return normChurchName(p.church) === c && p.name.replace(/\s+/g, '') === n;
    });
  }
  /* 저장 직전에 직분을 확정한다.
   * 반환: { blocked, msg, position, note } */
  function adjustPosition(name, church, position) {
    if (position === '위임목사' && !isOrganizedChurch(church)) {
      return {
        blocked: true,
        msg: '위임목사 직분은 조직교회(장로가 있는 교회)의 담임목사에게 부여됩니다. ' +
             '입력하신 교회는 조직교회로 확인되지 않습니다. 해당 사항이 있으시면 노회 서기에게 문의해 주세요.'
      };
    }
    if (position === '목사' && isOrganizedChurch(church) && isSeniorPastorOf(name, church)) {
      return { position: '위임목사', note: '조직교회 담임목사로 확인되어 직분이 위임목사로 등록됩니다.' };
    }
    return { position: position };
  }

  /* 전역 헬퍼 */
  window.SHS = {
    user: user,
    getUser: getUser,
    logAction: logAction,
    nthMonday: nthMonday,
    opsActive: opsActive,
    opsRuleLabel: opsRuleLabel,
    isOrganizedChurch: isOrganizedChurch,
    adjustPosition: adjustPosition,
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

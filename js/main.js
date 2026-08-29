/* 시화산노회 홈페이지 - 공통 레이아웃 및 유틸 */

(function () {
  /* 서버 인증을 사용하는 환경에서는 예전 '이 컴퓨터 전용' 로그인 기록을 정리한다.
   * 이것이 남아 있으면 서버 자료를 읽지 못하는 상태로 로그인된 것처럼 보인다. */
  if (window.SHS_SUPABASE && SHS_SUPABASE.ready && SHS_SUPABASE.ready()) {
    try {
      sessionStorage.removeItem('shs_session_v1');
      localStorage.removeItem('shs_session_v1');
    } catch (e) {}
  }

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
      { t: '상비부', h: 'organization.html#committees' },
      { t: '상비부 대시보드', h: 'dashboard.html' }
    ]},
    { title: '시찰회', href: 'sichal.html?s=%EB%B6%81%EB%B6%80%EC%8B%9C%EC%B0%B0', sub: [
      { t: '북부시찰', h: 'sichal.html?s=%EB%B6%81%EB%B6%80%EC%8B%9C%EC%B0%B0' },
      { t: '남부시찰', h: 'sichal.html?s=%EB%82%A8%EB%B6%80%EC%8B%9C%EC%B0%B0' },
      { t: '상록시찰', h: 'sichal.html?s=%EC%83%81%EB%A1%9D%EC%8B%9C%EC%B0%B0' }
    ]},
    { title: '회칙', href: 'rules-presbytery.html', sub: [
      { t: '노회 회칙', h: 'rules-presbytery.html' },
      { t: '총회 회칙 안내', h: 'rules-assembly.html' },
      { t: '각종 내규', h: 'rules-presbytery.html#bylaws' }
    ]},
    { title: '자료실', href: 'archive.html', sub: [
      { t: '자료 목록', h: 'archive.html' },
      { t: '노회 회의결의', h: 'archive.html#sec-%EA%B2%B0%EC%9D%98%EC%82%AC%ED%95%AD' },
      { t: '구비서류 안내', h: 'archive.html#sec-%EA%B5%AC%EB%B9%84%EC%84%9C%EB%A5%98-%EC%95%88%EB%82%B4' },
      { t: '고시 모의고사', h: 'exam.html' }
    ]},
    { title: '총회자료실', href: 'assembly-constitution.html', sub: [
      { t: '총회 헌법', h: 'assembly-constitution.html' },
      { t: '총회 규정', h: 'assembly-rules.html' },
      { t: '총회 회의결의', h: 'assembly-resolution.html' },
      { t: '총회 보고서', h: 'assembly-report.html' }
    ]},
    { title: '서류발급', href: 'request.html', sub: [
      { t: '서류 신청', h: 'request.html' },
      { t: '교회상황 보고서', h: 'report.html' },
      { t: '발급 서류 안내', h: 'request.html#docs' },
      { t: '증명서 진위 확인', h: 'verify.html' },
      { t: '구비서류 규정', h: 'archive.html#forms' }
    ]},
    { title: '게시판', href: 'board.html', sub: [
      { t: '공지사항', h: 'board.html#notice' },
      { t: '자유게시판', h: 'board.html#free' },
      { t: '문의하기', h: 'board.html#inquiry' }
    ]},
    { title: '갤러리', href: 'gallery.html', sub: [
      { t: '노회 행사', h: 'gallery.html' }
    ]},
    { title: '임원방', href: 'officer.html', sub: [
      { t: '임원 자료실', h: 'officer.html' },
      { t: '상회비 관리', h: 'officer.html#sec-%EC%83%81%ED%9A%8C%EB%B9%84-%EA%B4%80%EB%A6%AC' },
      { t: '노회 회의록', h: 'minutes.html' }
    ]}
  ];

  /* 관리자(노회장·서기·간사)에게만 보이는 메뉴.
   * 홈페이지를 고치는 일은 모두 여기에 모아 둔다.
   *
   * 예전에는 이 메뉴와 '홈페이지 설정' 화면의 카드가 거의 같은 곳을
   * 가리켜 두 벌이 되어 있었다. 이제 관리 메뉴는 여기 한 곳에만 두고,
   * 성격이 이어지는 것은 한 화면의 탭으로 모았다.
   *   · 상비부 대시보드 → 회원 관리 안의 탭
   *   · 회칙 개정 반영   → 자료·회칙 관리 안의 탭
   *   · 감독(감사 기록) → 시스템 운영 안의 탭
   *   · 직인·도장       → 따로 세운 항목 (예전 '홈페이지 설정' 화면)
   * 서류 발급은 관리자 일이므로 여기로 들여왔다. */
  var ADMIN_NAV = { title: '관리자', href: 'manage.html', sub: [
    { t: '사이트 관리', h: 'manage.html' },
    { t: '회원 관리', h: 'admin.html' },
    { t: '서류 발급', h: 'documents.html' },
    { t: '자료·회칙 관리', h: 'archive-edit.html' },
    { t: '직인·도장', h: 'settings.html' },
    { t: '시스템 운영', h: 'ops.html' }
  ]};

  /* 로그인한 정회원에게 상단 메뉴 맨 앞에 <대시보드>를 보여 준다.
   * 공지·일정·내 상비부·서류·교회상황 보고서를 한자리에서 본다. */
  function addDashMenu() {
    var list = document.querySelector('.gnb-list');
    if (!list || document.getElementById('gnb-dash')) return;
    var here = location.pathname.split('/').pop() || 'index.html';
    var li = document.createElement('li');
    li.className = 'gnb-item gnb-dash' + (here === 'dashboard.html' ? ' active' : '');
    li.id = 'gnb-dash';
    li.innerHTML = '<a href="dashboard.html">대시보드</a>';
    list.insertBefore(li, list.firstChild);
  }

  /* 고시부 부장·서기에게만 보이는 메뉴 */
  function addExamMenu() {
    var list = document.querySelector('.gnb-list');
    if (!list || document.getElementById('gnb-exam')) return;
    var here = location.pathname.split('/').pop() || 'index.html';
    var li = document.createElement('li');
    li.className = 'gnb-item gnb-admin' + (here === 'exam-admin.html' ? ' active' : '');
    li.id = 'gnb-exam';
    li.innerHTML = '<a href="exam-admin.html">고시부</a><div class="gnb-sub">' +
      '<a href="committee.html?c=%EA%B3%A0%EC%8B%9C%EA%B7%9C%EC%B9%99%EB%B6%80">고시규칙부</a>' +
      '<a href="exam-admin.html">모의고사 응시 관리</a>' +
      '<a href="exam.html">모의고사 보기</a>' +
      '</div>';
    var admin = document.getElementById('gnb-admin');
    if (admin) list.insertBefore(li, admin); else list.appendChild(li);
  }

  function addAdminMenu() {
    var list = document.querySelector('.gnb-list');
    if (!list || document.getElementById('gnb-admin')) return;
    var here = location.pathname.split('/').pop() || 'index.html';
    /* 탭으로 흡수된 예전 주소(감독·회칙 개정 반영)로 들어와도 '관리자'를 켠다 */
    var MOVED = ['audit.html', 'rules-edit.html'];
    var active = (ADMIN_NAV.sub.filter(function (s) { return s.h === here; }).length ||
                  MOVED.indexOf(here) !== -1) ? ' active' : '';
    var li = document.createElement('li');
    li.className = 'gnb-item gnb-admin' + active;
    li.id = 'gnb-admin';
    li.innerHTML = '<a href="' + ADMIN_NAV.href + '">' + ADMIN_NAV.title + '</a><div class="gnb-sub">' +
      ADMIN_NAV.sub.map(function (s) { return '<a href="' + s.h + '">' + s.t + '</a>'; }).join('') +
      '</div>';
    list.appendChild(li);
  }

  /* 화면 표기용 등급 이름
   * 노회장·서기·간사는 '관리자'로 통일 표기한다.
   * 최고관리자는 본인 화면에서만 그대로 표기되며, 회원 목록에는 나타나지 않는다. */
  /* 이름에 직분과 존칭을 붙인다. 예: 김동석 위임목사님 / 박영수 장로님
   * 직분이 없으면 '님'만 붙인다. */
  function honorific(u) {
    if (!u || !u.name) return '';
    var pos = (u.position || '').trim();
    return pos ? u.name + ' ' + pos + '님' : u.name + '님';
  }

  function displayRole(role, title) {
    if (role === 'superadmin') return '최고관리자';
    if (role === 'president' || role === 'clerk' || role === 'staff') return '관리자';
    if (role === 'officer') return title || '임원';
    if (role === 'member') return '정회원';
    if (role === 'pending') return '승인대기';
    return role;
  }

  /* 알림함 — 상단바에서 '총회 홈페이지' 앞에 둔다.
   * 확인하지 않은 알림이 있으면 개수를 함께 보여 준다. */
  function notiLink() {
    return '<a class="noti-link" href="notifications.html" id="noti-link" title="알림함">알림함' +
           '<span class="noti-badge hidden" id="noti-count"></span></a>';
  }

  function buildTopbar() {
    var right;
    if (user) {
      right = '<span class="user-name">' + honorific(user) + '</span>' +
        '<span>(' + displayRole(user.role, user.title) + ')</span>' +
        '<a href="mypage.html">내 정보</a>' +
        '<a href="#" id="btn-logout">로그아웃</a>';
    } else {
      right = '<a href="login.html">로그인</a><a href="signup.html">회원가입</a>';
    }
    return '<a class="skip-link" href="#main">본문 바로가기</a>' +
      '<div class="topbar"><div class="container">' +
      '<div class="brandline">대한예수교장로회(합동) 시화산노회</div>' +
      '<div class="util">' + (user ? notiLink() : '') +
      '<a href="https://gapck.org" target="_blank" rel="noopener">총회 홈페이지</a>' + right + '</div>' +
      '</div></div>';
  }

  function buildHeader() {
    return '<header class="site-header"><div class="container">' +
      '<a class="brand" href="index.html">' +
      '<img class="brand-logo" src="images/logo.svg" alt="시화산노회 로고">' +
      '<span class="brand-text"><span class="denom">THE PRESBYTERIAN CHURCH IN KOREA</span>' +
      '<span class="name">시화산노회</span></span></a>' +
      '<div class="header-contact">노회 사무실<strong>031-486-9993</strong>안산시 단원구 와동공원로1안길 13-7</div>' +
      /* 휴대전화에서 메뉴를 여닫는 단추. 넓은 화면에서는 보이지 않는다. */
      '<button type="button" class="gnb-toggle" id="gnb-toggle" aria-label="메뉴 열기" ' +
      'aria-expanded="false" aria-controls="gnb-list">' +
      '<span></span><span></span><span></span></button>' +
      '</div></header>';
  }

  function buildGnb() {
    var here = location.pathname.split('/').pop() || 'index.html';
    var html = '<nav class="gnb" id="gnb" aria-label="주 메뉴"><ul class="gnb-list" id="gnb-list">';
    NAV.forEach(function (m) {
      /* sichal.html?s=북부시찰 처럼 물음표가 붙은 주소도 알아보게 한다 */
      var active = (here === m.href.split('?')[0] || m.sub.some(function (s) {
        return s.h.split('#')[0].split('?')[0] === here;
      })) ? ' active' : '';
      html += '<li class="gnb-item' + active + '"><a href="' + m.href + '">' + m.title + '</a><div class="gnb-sub">';
      m.sub.forEach(function (s) { html += '<a href="' + s.h + '">' + s.t + '</a>'; });
      html += '</div></li>';
    });
    html += '</ul></nav>';
    return html;
  }

  /* 좁은 화면(휴대전화)에서 하위 메뉴 펼치기
   *
   * 넓은 화면에서는 메뉴에 마우스를 올리면 하위 메뉴가 나오지만, 휴대전화에는
   * 올려놓는 동작이 없어 하위 메뉴를 볼 길이 없었다. 그래서 큰 제목을 한 번
   * 누르면 하위 메뉴가 펼쳐지고, 한 번 더 누르면 그 화면으로 넘어가게 한다.
   *
   * 메뉴는 로그인 뒤에 늘어나기도 하므로(대시보드·고시부·관리자),
   * 목록 전체에 한 번만 걸어 두고 눌린 자리를 찾아 처리한다. */
  function setupGnbTap() {
    var list = document.querySelector('.gnb-list');
    if (!list || list.dataset.tapReady) return;
    list.dataset.tapReady = '1';

    function narrow() {
      return window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
    }

    /* 휴대전화에서는 메뉴를 접어 두고 석 줄 단추로 여닫는다.
     * 좁은 화면에 열두 개 메뉴를 늘어놓으면 화면이 온통 메뉴가 되기 때문이다. */
    var gnb = document.getElementById('gnb');
    var btn = document.getElementById('gnb-toggle');
    if (gnb && btn && !btn.dataset.ready) {
      btn.dataset.ready = '1';
      function setOpen(on) {
        gnb.classList.toggle('open', on);
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        btn.setAttribute('aria-label', on ? '메뉴 닫기' : '메뉴 열기');
      }
      btn.addEventListener('click', function () {
        setOpen(!gnb.classList.contains('open'));
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && gnb.classList.contains('open')) { setOpen(false); btn.focus(); }
      });
      /* 넓은 화면으로 돌아가면 접어 둔 것을 되돌린다 */
      window.addEventListener('resize', function () {
        if (!narrow()) setOpen(false);
      });
    }

    list.addEventListener('click', function (ev) {
      var a = ev.target.closest ? ev.target.closest('.gnb-item > a') : null;
      if (!a || !list.contains(a)) return;
      if (!narrow()) return;

      var li = a.parentElement;
      var sub = li.querySelector('.gnb-sub');
      if (!sub || !sub.querySelector('a')) return;   /* 하위 메뉴가 없으면 그냥 간다 */
      if (li.classList.contains('open')) return;     /* 이미 펼쳐져 있으면 그냥 간다 */

      ev.preventDefault();
      list.querySelectorAll('.gnb-item.open').forEach(function (x) {
        x.classList.remove('open');
        var t = x.firstElementChild;
        if (t && t.tagName === 'A') t.setAttribute('aria-expanded', 'false');
      });
      li.classList.add('open');
      a.setAttribute('aria-expanded', 'true');
    });

    /* 넓은 화면으로 돌아가면 펼쳐 둔 것을 정리한다 */
    window.addEventListener('resize', function () {
      if (narrow()) return;
      list.querySelectorAll('.gnb-item.open').forEach(function (x) {
        x.classList.remove('open');
      });
    });
  }

  function buildFooter() {
    return '<footer class="site-footer"><div class="container">' +
      '<div class="f-name">대한예수교장로회(합동) 시화산노회</div>' +
      '<div>노회 사무실 : 경기도 안산시 단원구 와동공원로1안길 13-7 (반월교회 교육관 1층)</div>' +
      '<div>전화 031-486-9993 / 팩스 031-486-9993</div>' +
      '<div class="f-links"><a href="about.html">노회소개</a><a href="rules-presbytery.html">노회 회칙</a>' +
      '<a href="verify.html">증명서 진위 확인</a>' +
      '<a href="terms.html"><strong>이용약관</strong></a>' +
      '<a href="privacy.html"><strong>개인정보처리방침</strong></a>' +
      '<a href="https://gapck.org" target="_blank" rel="noopener">대한예수교장로회총회</a></div>' +
      '</div></footer>';
  }

  /* ---------- 앱 설치(PWA) ---------- */
  var installEvent = null;

  function setupInstall() {
    /* 아이콘·설정 파일 연결 */
    [
      { rel: 'icon', type: 'image/svg+xml', href: 'images/logo.svg' },
      { rel: 'manifest', href: 'manifest.webmanifest' },
      { rel: 'apple-touch-icon', href: 'images/icons/apple-touch-icon.png' }
    ].forEach(function (a) {
      var l = document.createElement('link');
      Object.keys(a).forEach(function (k) { l[k] = a[k]; });
      document.head.appendChild(l);
    });
    var meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#17335f';
    document.head.appendChild(meta);

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }

    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault();
      installEvent = ev;
      showInstallLink();
    });
  }

  function showInstallLink() {
    if (document.getElementById('btn-install')) return;
    if (localStorage.getItem('shs_install_hidden')) return;
    var util = document.querySelector('.topbar .util');
    if (!util) return;
    util.insertAdjacentHTML('afterbegin',
      '<a href="#" id="btn-install" title="바탕화면에 앱으로 추가합니다">앱 설치</a>');
    document.getElementById('btn-install').addEventListener('click', function (ev) {
      ev.preventDefault();
      if (!installEvent) {
        alert('크롬 주소창 오른쪽의 설치 아이콘을 눌러 설치하실 수 있습니다.\n' +
              '(휴대폰은 브라우저 메뉴 → "홈 화면에 추가")');
        return;
      }
      installEvent.prompt();
      installEvent.userChoice.then(function (r) {
        if (r.outcome === 'accepted') {
          localStorage.setItem('shs_install_hidden', '1');
          var b = document.getElementById('btn-install');
          if (b) b.remove();
        }
        installEvent = null;
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    /* 비밀번호 재설정 메일의 링크로 들어온 경우 재설정 화면으로 보낸다.
     * (메일 링크는 홈으로 돌아오므로 여기서 안내해야 한다.) */
    var here0 = location.pathname.split('/').pop() || 'index.html';
    if (location.hash.indexOf('type=recovery') !== -1 && here0 !== 'reset-password.html') {
      location.replace('reset-password.html' + location.hash);
      return;
    }

    setupInstall();

    document.body.insertAdjacentHTML('afterbegin', buildTopbar() + buildHeader() + buildGnb());
    document.body.insertAdjacentHTML('beforeend', buildFooter());
    setupGnbTap();

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

    /* 서버 세션이 있으면 상단바를 그 정보로 바꾼다 (서버 우선).
     * 로그인 직후에는 주소 끝에 인증 토큰이 붙어 돌아오므로 정리한다. */
    if (window.SHSCloud && SHSCloud.enabled()) {
      var hadToken = location.hash.indexOf('access_token') !== -1;

      SHSCloud.loadProfile().then(function (p) {
        if (hadToken) {
          history.replaceState(null, '', location.pathname + location.search);
        }
        if (!p) return;

        var util = document.querySelector('.topbar .util');
        if (util) {
          util.innerHTML = notiLink() +
            '<a href="https://gapck.org" target="_blank" rel="noopener">총회 홈페이지</a>' +
            '<span class="user-name">' + (honorific(p) || p.email) + '</span>' +
            '<span>(' + displayRole(p.role, p.title) + ')</span>' +
            '<a href="mypage.html">내 정보</a><a href="#" id="btn-logout2">로그아웃</a>';
          var lo = document.getElementById('btn-logout2');
          if (lo) lo.addEventListener('click', window.SHSLogout);
          loadUnread();
          /* 1분마다 새 알림을 확인해 팝업으로 띄운다 */
          setInterval(loadUnread, 60000);
        }

        /* 정기노회가 다가오면 알림을 내보낸다.
         * 홈페이지에 아무나 들어와도 하루 한 번만 조용히 확인하며,
         * 이미 보낸 알림은 서버에서 다시 보내지 않는다. */
        try {
          var remKey = 'shs_rem_' + new Date().toISOString().slice(0, 10);
          if (!localStorage.getItem(remKey)) {
            localStorage.setItem(remKey, '1');
            SHSCloud.init().then(function (c) {
              return c.rpc('run_reminders');
            }).then(function () {
              loadUnread();
            }, function () {});
          }
        } catch (x) {}

        /* 정회원에게 대시보드 메뉴를 맨 앞에 붙인다 */
        if (isActiveMember(toCloudUser(p))) addDashMenu();

        /* 관리자에게 관리자 메뉴를 붙인다 */
        if (['superadmin', 'president', 'clerk', 'staff'].indexOf(p.role) !== -1) addAdminMenu();

        /* 내가 맡은 상비부는 대시보드에서 본다. 상단 메뉴에 따로 두지 않는다. */
        SHSCloud.init().then(function (c) {
          return c.rpc('my_committees');
        }).then(function (r) {
          var list = (r && r.data) || [];
          /* 고시부 메뉴는 그 부서 임원에게만 (부원은 해당하지 않는다) */
          if (list.filter(function (x) { return x.committee === '고시규칙부' && x.is_officer; }).length) addExamMenu();
        }, function () {});

        /* 고시부로 따로 지정된 분도 고시부 메뉴를 본다 */
        SHSCloud.init().then(function (c) {
          return c.from('exam_officers').select('user_id').eq('user_id', p.id);
        }).then(function (r) {
          if (r && r.data && r.data.length) addExamMenu();
        }, function () {});

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

    /* 관리자에게 운영 알림·서류 신청 안내 */
    getUser().then(function (u) {
      localSessionNotice(u);
      meetingReminder(u);
      docRequestWatch(u);
    });
  });

  /* ---------- 알림 팝업 (토스트) ----------
   * 새 알림은 화면 오른쪽 위에 팝업 카드로 한 번 띄운다.
   * 한 번 띄운 알림은 이 기기에서 다시 띄우지 않는다 (알림함에는 그대로 남는다). */
  var TOAST_SEEN_KEY = 'shs_toast_seen_v1';
  function toastLink(n) {
    if (n.kind === '문의') {
      return 'board.html#' +
        (n.dedupe_key && String(n.dedupe_key).indexOf('inquiry-') === 0 ? n.dedupe_key : 'inquiry');
    }
    return 'notifications.html';
  }
  function showToasts(rows) {
    var seen;
    try { seen = JSON.parse(localStorage.getItem(TOAST_SEEN_KEY) || '[]'); } catch (x) { seen = []; }
    var fresh = rows.filter(function (n) { return seen.indexOf(n.id) === -1; }).slice(0, 4);
    if (!fresh.length) return;
    rows.forEach(function (n) { if (seen.indexOf(n.id) === -1) seen.push(n.id); });
    if (seen.length > 300) seen = seen.slice(-300);
    localStorage.setItem(TOAST_SEEN_KEY, JSON.stringify(seen));

    var wrap = document.getElementById('noti-toasts');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'noti-toasts';
      document.body.appendChild(wrap);
    }
    fresh.forEach(function (n, i) {
      var card = document.createElement('div');
      card.className = 'noti-toast';
      card.innerHTML =
        '<button class="nt-x" aria-label="닫기">&times;</button>' +
        '<a href="' + toastLink(n) + '">' +
        '<span class="nt-kind">' + SHS.esc(n.kind || '알림') + '</span>' +
        '<strong class="nt-title">' + SHS.esc(n.title || '') + '</strong>' +
        '<span class="nt-body">' + SHS.esc(String(n.body || '').slice(0, 90)) + '</span>' +
        '<span class="nt-go">' + (n.kind === '문의' ? '답장하기' : '알림함에서 보기') + '</span>' +
        '</a>';
      setTimeout(function () { wrap.appendChild(card); }, i * 250);
      card.querySelector('.nt-x').addEventListener('click', function (ev) {
        ev.preventDefault();
        card.remove();
      });
      setTimeout(function () {
        card.classList.add('out');
        setTimeout(function () { card.remove(); }, 500);
      }, 12000 + i * 250);
    });
  }

  /* ---------- 알림 표시 ----------
   * 읽지 않은 알림이 있으면 상단에 개수를 표시하고,
   * 임명·취임 같은 중요한 알림은 화면 위에 배너로 한 번 더 알린다. */
  function loadUnread() {
    if (!(window.SHSCloud && SHSCloud.enabled())) return;
    SHSCloud.init().then(function (c) {
      if (!c) return null;
      return c.from('notifications').select('*').is('read_at', null)
        .order('created_at', { ascending: false });
    }).then(function (r) {
      var rows = (r && !r.error && r.data) ? r.data : [];

      /* 상단 알림함에 확인하지 않은 개수를 달아 준다 */
      var dot = document.getElementById('noti-count');
      if (dot) {
        dot.textContent = rows.length > 99 ? '99+' : String(rows.length);
        dot.classList.toggle('hidden', !rows.length);
        var link = document.getElementById('noti-link');
        if (link) {
          link.title = rows.length
            ? '확인하지 않은 알림이 ' + rows.length + '건 있습니다'
            : '알림함';
        }
      }
      if (!rows.length) return;
      showToasts(rows);

      /* 임명·취임 알림은 놓치지 않도록 배너로도 안내한다 */
      var big = rows.filter(function (n) { return n.kind === '임명'; })[0];
      if (!big) return;
      if (localStorage.getItem('shs_noti_seen_' + big.id)) return;
      var bar = document.createElement('div');
      bar.className = 'container';
      bar.style.marginTop = '16px';
      bar.innerHTML =
        '<div class="notice-banner" style="border-left:4px solid var(--accent)">' +
        '<strong>[' + SHS.esc(big.title) + ']</strong> 새로운 알림이 도착했습니다. ' +
        '<a class="btn sm" style="margin-left:8px" href="notifications.html">알림 확인</a> ' +
        '<button class="btn ghost sm" id="noti-hide">나중에 보기</button></div>';
      if (document.getElementById('noti-hide')) return;   /* 배너는 하나만 */
      var gnb = document.querySelector('.gnb');
      if (gnb) gnb.insertAdjacentElement('afterend', bar);
      var hb = document.getElementById('noti-hide');
      if (hb) hb.addEventListener('click', function () {
        localStorage.setItem('shs_noti_seen_' + big.id, '1');
        bar.remove();
      });
    }).catch(function () {});
  }

  /* 서버가 아닌 이 컴퓨터 전용 계정으로 로그인한 경우 안내한다.
   * 이 상태에서는 서버에 저장된 회의록·자료·회원 정보를 읽을 수 없다. */
  function localSessionNotice(u) {
    if (!u || u.cloud) return;
    if (!(window.SHSCloud && SHSCloud.enabled())) return;
    if (!SHSAuth.canManageMembers(u)) return;
    var bar = document.createElement('div');
    bar.className = 'container';
    bar.style.marginTop = '16px';
    bar.innerHTML =
      '<div class="notice-banner" style="border-left:4px solid var(--red)">' +
      '<strong>[안내]</strong> 지금은 <strong>이 컴퓨터 전용 계정</strong>으로 로그인되어 있어 ' +
      '서버에 저장된 회의록·자료·회원 정보를 읽을 수 없습니다. ' +
      '로그아웃 후 <strong>서버 계정(구글 또는 이메일)</strong>으로 다시 로그인해 주세요. ' +
      '<a class="btn sm" style="margin-left:8px" href="login.html">로그인 화면으로</a>' +
      '</div>';
    var gnb = document.querySelector('.gnb');
    if (gnb) gnb.insertAdjacentElement('afterend', bar);
  }

  /* ---------- 서류 신청 실시간 알림 (관리자 로그인 중) ---------- */
  function docRequestWatch(u) {
    if (!u || !u.cloud || !SHSAuth.canIssueDocuments(u)) return;
    if (!(window.SHSCloud && SHSCloud.enabled())) return;

    var seen = {};
    try { seen = JSON.parse(localStorage.getItem('shs_docreq_seen') || '{}'); } catch (x) {}

    function banner(rows) {
      /* 단계가 바뀌면 다시 알리도록 신청번호+단계로 기억한다 */
      var fresh = rows.filter(function (r) { return !seen[r.id + ':' + r.status]; });
      if (!fresh.length) return;
      var old = document.getElementById('docreq-banner');
      if (old) old.remove();
      var bar = document.createElement('div');
      bar.className = 'container';
      bar.id = 'docreq-banner';
      bar.style.marginTop = '16px';
      bar.innerHTML =
        '<div class="notice-banner" style="border-left:4px solid var(--red)">' +
        '<strong>[서류 신청]</strong> 처리 대기 중인 서류 신청이 ' + fresh.length + '건 있습니다. ' +
        fresh.slice(0, 3).map(function (r) {
          var stage = r.status === '신청' ? '입금 확인' : r.status === '입금확인' ? '발급 승인' : '증명서 발급';
          return SHS.esc(r.name + ' ' + (r.church || '') + ' — ' + r.doc_type + ' (' + stage + ' 대기)');
        }).join(' / ') +
        ' <a class="btn sm" style="margin-left:8px" href="documents.html#requests">신청 확인</a> ' +
        '<button class="btn ghost sm" id="docreq-hide">나중에 보기</button>' +
        '</div>';
      var gnb = document.querySelector('.gnb');
      if (gnb) gnb.insertAdjacentElement('afterend', bar);
      var hide = document.getElementById('docreq-hide');
      if (hide) hide.addEventListener('click', function () {
        fresh.forEach(function (r) { seen[r.id + ':' + r.status] = 1; });
        localStorage.setItem('shs_docreq_seen', JSON.stringify(seen));
        bar.remove();
      });
    }

    /* 내 차례인 단계만 알린다: 간사=입금 확인, 서기·노회장=발급 승인,
     * 승인된 건의 증명서 발급은 발급 권한자 모두. 최고관리자는 전부. */
    var stages = ['발급승인'];
    if (u.role === 'staff' || u.role === 'superadmin') stages.push('신청');
    if (u.role === 'clerk' || u.role === 'president' || u.role === 'superadmin') stages.push('입금확인');
    function poll() {
      SHSCloud.init().then(function (c) {
        if (!c) return null;
        return c.from('doc_requests').select('*').in('status', stages).order('id', { ascending: false });
      }).then(function (r) {
        if (r && r.data && r.data.length) banner(r.data);
      }).catch(function () {});
    }
    poll();
    setInterval(poll, 60000);   /* 1분마다 새 신청 확인 */
  }

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
  function toCloudUser(p) {
    return {
      id: p.id, email: p.email, name: p.name || p.email,
      church: p.church || '', position: p.position || '',
      phone: p.phone || '', birth_date: p.birth_date || '', address: p.address || '',
      role: p.role, title: p.title || null,
      suspended: !!p.suspended, member_until: p.member_until || null,
      cloud: true
    };
  }

  /* 서버(구글·이메일) 세션을 우선 확인하고, 없을 때만 이 컴퓨터의 체험 계정을 쓴다. */
  function getUser() {
    return new Promise(function (resolve) {
      if (window.SHSCloud && SHSCloud.enabled()) {
        SHSCloud.loadProfile().then(function (p) {
          if (p) { resolve(toCloudUser(p)); return; }
          resolve(SHSAuth.currentUser());
        }, function () { resolve(SHSAuth.currentUser()); });
        return;
      }
      resolve(SHSAuth.currentUser());
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
      var u = SHSAuth.currentUser();
      if (u && u.role === 'superadmin') return;   /* 운영자 계정은 기록 대상 아님 */
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

  /* ---------- 회원 자격 판정 ----------
   * 정회원 자격은 다음 세 가지로 상실된다.
   *  1) 관리자가 자격을 정지한 경우
   *  2) 총대 자격 기간(다음 봄 정기노회)이 지난 경우
   *  3) 총회 정년(만 70세)에 이른 경우  */
  var RETIRE_AGE = 70;

  function ageOn(birth, when) {
    if (!birth) return null;
    var b = new Date(birth + 'T00:00:00');
    if (isNaN(b)) return null;
    var d = when || new Date();
    var a = d.getFullYear() - b.getFullYear();
    var m = d.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && d.getDate() < b.getDate())) a--;
    return a;
  }

  /* 만 70세가 되는 날 (정년일) */
  function retireDate(birth) {
    if (!birth) return null;
    var b = new Date(birth + 'T00:00:00');
    if (isNaN(b)) return null;
    return new Date(b.getFullYear() + RETIRE_AGE, b.getMonth(), b.getDate());
  }

  /* 정년일 표기 (생년월일이 없으면 알 수 없다고 알린다) */
  function retireLabel(u) {
    var rd = retireDate(u && u.birth_date);
    if (!rd) return '생년월일 미등록';
    var y = rd.getFullYear() + '. ' + (rd.getMonth() + 1) + '. ' + rd.getDate() + '.';
    var days = Math.ceil((rd - new Date()) / 86400000);
    if (days <= 0) return y + ' (정년 경과)';
    if (days < 400) return y + ' (' + days + '일 남음)';
    return y + ' (' + Math.floor(days / 365) + '년 ' + Math.floor(days % 365 / 30) + '개월 남음)';
  }

  /* 남은 임기 안내 문구 */
  function termLabel(u) {
    var parts = [];
    var rd = retireDate(u.birth_date);
    if (rd) {
      var days = Math.ceil((rd - new Date()) / 86400000);
      if (days <= 0) parts.push('정년 경과');
      else if (days < 400) parts.push('정년까지 ' + days + '일');
      else parts.push('정년까지 ' + Math.floor(days / 365) + '년 ' + (Math.floor(days % 365 / 30)) + '개월');
    } else {
      parts.push('생년월일 미등록');
    }
    if (u.member_until) {
      var md = new Date(u.member_until + 'T00:00:00');
      var mdays = Math.ceil((md - new Date()) / 86400000);
      parts.push(mdays <= 0 ? '총대 자격 만료' : '총대 자격 ' + u.member_until + '까지');
    }
    return parts.join(' / ') || '-';
  }

  function membershipIssue(u) {
    if (!u) return '로그인이 필요합니다.';
    if (u.role === 'pending') return '승인대기 상태입니다.';
    if (u.suspended) return '정회원 자격이 정지되었습니다.';
    var rd = retireDate(u.birth_date);
    if (rd && rd <= new Date()) return '총회 정년(만 ' + RETIRE_AGE + '세)에 이르러 정회원 자격이 만료되었습니다.';
    if (u.member_until) {
      var md = new Date(u.member_until + 'T00:00:00');
      if (md <= new Date()) return '총대 자격 기간이 만료되어 정회원 자격이 상실되었습니다.';
    }
    return null;
  }

  /* 정회원 이상(자격 유효) 여부.
   * 정년(만 70세)은 등급과 상관없이 모든 회원에게 적용된다. (총회 정년 규정)
   * 그 밖의 사유(승인대기·총대 기간 만료 등)는 관리자·임원에게 적용하지 않는다. */
  function isActiveMember(u) {
    if (!u) return false;
    var rd = retireDate(u.birth_date);
    if (rd && rd <= new Date()) return false;
    if (['superadmin', 'president', 'clerk', 'staff', 'officer'].indexOf(u.role) !== -1) return true;
    return !membershipIssue(u);
  }

  /* 정회원 전용 영역 안내 (자격이 없으면 안내 HTML 반환, 있으면 null) */
  function memberGate(u, what) {
    if (isActiveMember(u)) return null;
    var issue = membershipIssue(u);
    return '<div class="notice-banner">' + (what || '이 자료') + '는 <strong>정회원</strong>만 열람할 수 있습니다. ' +
      (u ? issue + ' 문의는 노회 사무실(031-486-9993)로 해주시기 바랍니다.'
         : '로그인 후 이용해 주세요. <a class="btn sm" style="margin-left:10px" href="login.html">로그인</a>') +
      '</div>';
  }

  /* 전역 헬퍼 */
  /* ---------- 파일 넣기 (끌어다 놓기) ----------
   * 파일 선택 칸을 숨기고 그 자리에 넓은 상자를 놓는다.
   * 파일을 상자 위로 끌어다 놓거나, 상자를 눌러 골라도 된다.
   * 고른 파일은 원래의 파일 선택 칸에 그대로 담기므로,
   * 각 화면의 기존 처리 방식은 손대지 않아도 된다. */
  function dropZone(input, opts) {
    if (!input || input.dataset.dz) return;
    input.dataset.dz = '1';
    opts = opts || {};

    var multiple = input.multiple;
    var wrap = document.createElement('div');
    wrap.className = 'dropzone';
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('role', 'button');
    wrap.innerHTML =
      '<div class="dz-guide">' +
      '<strong>여기에 ' + (opts.what || '파일') + '을 끌어다 놓으세요</strong>' +
      '<span>또는 이 상자를 눌러 컴퓨터에서 고르실 수 있습니다' +
      (multiple ? ' (여러 개 가능)' : '') + '</span></div>' +
      '<div class="dz-list"></div>';

    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.classList.add('dz-input');

    var list = wrap.querySelector('.dz-list');

    function human(n) {
      if (n < 1024) return n + 'B';
      if (n < 1024 * 1024) return Math.round(n / 1024) + 'KB';
      return (n / 1024 / 1024).toFixed(1) + 'MB';
    }

    function paint() {
      var fs = input.files;
      if (!fs || !fs.length) { list.innerHTML = ''; wrap.classList.remove('has'); return; }
      wrap.classList.add('has');
      var h = '';
      for (var i = 0; i < fs.length; i++) {
        h += '<div class="dz-item"><span class="dz-name">' +
          String(fs[i].name).replace(/[&<>"']/g, '') + '</span>' +
          '<span class="dz-size">' + human(fs[i].size) + '</span></div>';
      }
      list.innerHTML = h;
    }

    /* 끌어다 놓은 파일을 원래의 파일 선택 칸에 담는다 */
    function accept(files) {
      if (!files || !files.length) return;
      var dt = new DataTransfer();
      var n = multiple ? files.length : 1;
      for (var i = 0; i < n; i++) {
        if (opts.accept === 'image' && files[i].type.indexOf('image/') !== 0) continue;
        dt.items.add(files[i]);
      }
      if (!dt.files.length) {
        alert('사진 파일만 넣으실 수 있습니다.');
        return;
      }
      input.files = dt.files;
      paint();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    wrap.addEventListener('click', function (ev) {
      if (ev.target === input) return;
      input.click();
    });
    wrap.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); }
    });
    input.addEventListener('change', paint);

    ['dragenter', 'dragover'].forEach(function (t) {
      wrap.addEventListener(t, function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        wrap.classList.add('over');
      });
    });
    ['dragleave', 'dragend'].forEach(function (t) {
      wrap.addEventListener(t, function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        wrap.classList.remove('over');
      });
    });
    wrap.addEventListener('drop', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      wrap.classList.remove('over');
      accept(ev.dataTransfer && ev.dataTransfer.files);
    });

    paint();
    return wrap;
  }

  /* 화면 안의 파일 선택 칸을 한 번에 모두 바꾼다 */
  function dropZoneAll(root, opts) {
    (root || document).querySelectorAll('input[type="file"]:not(.dz-skip)').forEach(function (i) {
      dropZone(i, opts || (i.accept && i.accept.indexOf('image') !== -1
        ? { what: '사진', accept: 'image' } : {}));
    });
  }

  /* 브라우저 창 아무 데나 파일을 떨어뜨렸을 때 그 파일이 열리지 않도록 막는다 */
  ['dragover', 'drop'].forEach(function (t) {
    window.addEventListener(t, function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('.dropzone')) return;
      ev.preventDefault();
    });
  });

  /* 한 화면에 여러 영역이 이어져 스크롤이 길어지면 보기가 어렵다.
   * 큰 제목(h2)을 기준으로 영역을 나누고, 위쪽 띠에서 하나씩 골라 보게 한다.
   * 주소 뒤에 #영역이름을 붙이면 그 영역이 바로 열린다. */
  /* 올린 지 얼마 안 된 글인가 (기본 2주).
   * 공지 목록에서 NEW 를 붙일지 가리는 데 쓴다. */
  function isNew(dateStr, days) {
    if (!dateStr) return false;
    var s = String(dateStr).slice(0, 10);
    var t = new Date(s + 'T00:00:00');
    if (isNaN(t)) return false;
    var 지난날 = (Date.now() - t.getTime()) / 86400000;
    return 지난날 >= -1 && 지난날 < (days || 14);
  }

  /* 목록에 붙일 NEW 표 */
  function newTag(dateStr, days) {
    return isNew(dateStr, days) ? '<span class="new-tag">NEW</span>' : '';
  }

  /* 저장이 정말 되었는가.
   *
   * 권한이 없으면 Supabase 는 오류를 내지 않고 '0줄 바꿈'으로 조용히 끝난다.
   * 그대로 두면 화면에는 저장된 것처럼 보이므로, 고친 줄을 되받아(.select())
   * 정말 바뀌었는지 여기서 가린다.
   *
   *   c.from('표').update(값).eq('id', n).select()   ← .select() 를 꼭 붙인다
   *   var w = SHS.wrote(r); if (!w.ok) { ...w.why 를 보여 준다... }
   */
  function wrote(res) {
    if (!res) return { ok: false, why: '서버에서 답이 오지 않았습니다. 잠시 후 다시 시도해 주세요.' };
    if (res.error) return { ok: false, why: res.error.message };
    if (Array.isArray(res.data) && res.data.length === 0) {
      return { ok: false, why: '저장할 권한이 없어 아무것도 바뀌지 않았습니다. ' +
                              '노회 사무실(031-486-9993)로 알려 주시기 바랍니다.' };
    }
    return { ok: true };
  }

  /* 상비부인가 위원회인가.
   * 상비부는 임기가 3년이라 1·2·3년조로 나누고 우두머리를 '부장'이라 하지만,
   * 위원회는 년조 없이 위원으로만 이루어지고 '위원장'이라 부른다. */
  function isBoard(name) { return /위원회\s*$/.test(String(name || '')); }
  function headTitle(name) { return isBoard(name) ? '위원장' : '부장'; }

  function sectionize(container, opts) {
    if (!container) return;
    opts = opts || {};
    var kids = Array.prototype.slice.call(container.children);
    var heads = kids.filter(function (el) { return el.tagName === 'H2'; });
    if (heads.length < 2) return;

    var intro = [];
    var secs = [];
    var cur = null;
    kids.forEach(function (el) {
      if (el.tagName === 'H2') {
        cur = { label: (el.textContent || '').trim(), nodes: [el] };
        secs.push(cur);
      } else if (cur) {
        cur.nodes.push(el);
      } else {
        intro.push(el);
      }
    });

    function slug(s, i) {
      var t = s.replace(/\s*\(.*$/, '').replace(/\s+/g, '-');
      return encodeURIComponent(t) || 's' + (i + 1);
    }

    var nav = document.createElement('div');
    nav.className = 'section-nav';
    var panels = [];

    secs.forEach(function (s, i) {
      var p = document.createElement('div');
      p.className = 'page-section';
      /* 제목에 이름표가 붙어 있으면 그대로 물려받는다.
       * 알림에서 보내는 documents.html#requests 같은 바로가기가 계속 통하도록. */
      if (s.nodes[0].id) { p.id = s.nodes[0].id; s.nodes[0].removeAttribute('id'); }
      else p.id = 'sec-' + slug(s.label, i);
      s.nodes.forEach(function (n) { p.appendChild(n); });
      /* 영역 안에서는 제목을 한 번만 보이게 한다 */
      panels.push(p);

      var a = document.createElement('a');
      a.href = '#' + p.id;
      a.textContent = opts.labels && opts.labels[i] ? opts.labels[i] : s.label;
      nav.appendChild(a);
    });

    container.innerHTML = '';
    intro.forEach(function (n) { container.appendChild(n); });
    container.appendChild(nav);
    panels.forEach(function (p) { container.appendChild(p); });

    function show(id) {
      var hit = false;
      panels.forEach(function (p, i) {
        var on = p.id === id;
        if (on) hit = true;
        p.classList.toggle('hidden', !on);
        nav.children[i].classList.toggle('active', on);
        if (on) nav.children[i].setAttribute('aria-current', 'page');
        else nav.children[i].removeAttribute('aria-current');
      });
      if (!hit) show(panels[0].id);
    }

    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        var id = a.getAttribute('href').slice(1);
        /* 기록을 남겨 두어야 뒤로 가기가 이전 영역으로 돌아간다 */
        if (history.pushState) history.pushState(null, '', '#' + id);
        else location.hash = id;
        show(id);
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    show(location.hash ? location.hash.slice(1) : panels[0].id);
    window.addEventListener('hashchange', function () {
      show(location.hash ? location.hash.slice(1) : panels[0].id);
    });
  }

  /* ---------- 화면 안에서 단계 이동 ----------
   * 한 페이지 안에서 화면이 바뀔 때(시험 시작·채점 결과 등) 기록을 남겨,
   * 뒤로 가기를 누르면 홈이 아니라 이전 단계로 돌아가게 한다. */
  function stepNav(steps) {
    var current = null;

    function render(name, first) {
      var fn = steps[name];
      if (!fn) return;
      current = name;
      fn(first);
    }

    window.addEventListener('popstate', function (ev) {
      var name = (ev.state && ev.state.shsStep) || null;
      if (!name) name = Object.keys(steps)[0];
      if (name !== current) render(name);
    });

    return function go(name, run) {
      if (run) steps[name] = run;
      if (history.pushState) {
        history.pushState({ shsStep: name }, '', location.pathname + location.search);
      }
      render(name);
    };
  }

  window.SHS = {
    user: user,
    getUser: getUser,
    sectionize: sectionize,
    isBoard: isBoard,
    headTitle: headTitle,
    wrote: wrote,
    isNew: isNew,
    newTag: newTag,
    stepNav: stepNav,
    dropZone: dropZone,
    dropZoneAll: dropZoneAll,
    logAction: logAction,
    displayRole: displayRole,
    honorific: honorific,
    isActiveMember: isActiveMember,
    membershipIssue: membershipIssue,
    memberGate: memberGate,
    termLabel: termLabel,
    retireLabel: retireLabel,
    ageOn: ageOn,
    retireDate: retireDate,
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

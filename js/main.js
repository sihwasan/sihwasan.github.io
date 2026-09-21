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
      { t: '오시는 길', h: 'about.html#location' },
      /* 조직 — 예전 <조직> 메뉴를 이 아래로 옮겼다 */
      { t: '노회 임원', h: 'organization.html#officers' },
      { t: '회원명단', h: 'organization.html#members' },
      { t: '회원교회', h: 'organization.html#churches' },
      { t: '시찰회 조직', h: 'organization.html#sichal' },
      { t: '상비부 조직', h: 'organization.html#committees' },
      { t: '홈페이지 이용 안내', h: 'guide.html' }
    ]},
    { title: '시찰회', href: 'sichal.html?s=%EB%B6%81%EB%B6%80%EC%8B%9C%EC%B0%B0', sub: [
      { t: '북부시찰', h: 'sichal.html?s=%EB%B6%81%EB%B6%80%EC%8B%9C%EC%B0%B0' },
      { t: '남부시찰', h: 'sichal.html?s=%EB%82%A8%EB%B6%80%EC%8B%9C%EC%B0%B0' },
      { t: '상록시찰', h: 'sichal.html?s=%EC%83%81%EB%A1%9D%EC%8B%9C%EC%B0%B0' }
    ]},
    /* 상비부 — 부서마다 회의록·회계 장부·자료가 있는 상비부 화면으로 */
    { title: '상비부', href: 'committee.html?c=%EA%B0%90%EC%82%AC%ED%97%8C%EC%9D%98%EB%B6%80', sub: [
      { t: '감사헌의부', h: 'committee.html?c=%EA%B0%90%EC%82%AC%ED%97%8C%EC%9D%98%EB%B6%80' },
      { t: '정치부', h: 'committee.html?c=%EC%A0%95%EC%B9%98%EB%B6%80' },
      { t: '고시규칙부', h: 'committee.html?c=%EA%B3%A0%EC%8B%9C%EA%B7%9C%EC%B9%99%EB%B6%80' },
      { t: '재정부', h: 'committee.html?c=%EC%9E%AC%EC%A0%95%EB%B6%80' },
      { t: '교육친교부', h: 'committee.html?c=%EA%B5%90%EC%9C%A1%EC%B9%9C%EA%B5%90%EB%B6%80' },
      { t: '전도선교부', h: 'committee.html?c=%EC%A0%84%EB%8F%84%EC%84%A0%EA%B5%90%EB%B6%80' },
      { t: '사회복지부', h: 'committee.html?c=%EC%82%AC%ED%9A%8C%EB%B3%B5%EC%A7%80%EB%B6%80' },
      { t: '미래교회자립위원회', h: 'committee.html?c=%EB%AF%B8%EB%9E%98%EA%B5%90%ED%9A%8C%EC%9E%90%EB%A6%BD%EC%9C%84%EC%9B%90%ED%9A%8C' },
      { t: '상비부 대시보드', h: 'dashboard.html' }
    ]},
    { title: '회칙', href: 'rules-presbytery.html', sub: [
      { t: '노회 회칙', h: 'rules-presbytery.html' },
      { t: '총회 회칙 안내', h: 'rules-assembly.html' },
      { t: '각종 내규', h: 'rules-presbytery.html#bylaws' }
    ]},
    { title: '서류발급', href: 'request.html', sub: [
      { t: '서류 신청', h: 'request.html' },
      { t: '신청서류 확인', h: 'request.html#list' },
      { t: '증명서 진위 확인', h: 'verify.html' }
    ]},
    { title: '자료실', href: 'archive.html', sub: [
      { t: '구비서류 안내', h: 'archive.html#sec-%EA%B5%AC%EB%B9%84%EC%84%9C%EB%A5%98-%EC%95%88%EB%82%B4' },
      { t: '청원서', h: 'petition.html' },
      { t: '교회상황 보고서', h: 'report.html' },
      { t: '나의 서류', h: 'mydocs.html' },
      { t: '노회 회의결의', h: 'archive.html#sec-%EA%B2%B0%EC%9D%98%EC%82%AC%ED%95%AD' },
      { t: '고시 모의고사', h: 'exam.html' }
    ]},
    { title: '총회', href: 'assembly-constitution.html', sub: [
      { t: '총회 활동현황', h: 'dashboard.html#hub-assembly' },
      { t: '총회 헌법', h: 'assembly-constitution.html' },
      { t: '총회 규정', h: 'assembly-rules.html' },
      { t: '총회 회의결의', h: 'assembly-resolution.html' },
      { t: '총회 보고서', h: 'assembly-report.html' }
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
      { t: '세례의무금 관리', h: 'officer.html#sec-%EC%84%B8%EB%A1%80%EC%9D%98%EB%AC%B4%EA%B8%88-%EA%B4%80%EB%A6%AC' },
      { t: '재정부 회계', h: 'officer.html#sec-%EC%9E%AC%EC%A0%95%EB%B6%80-%ED%9A%8C%EA%B3%84', fin: true },
      { t: '감사 결과 보고서', h: 'audit-report.html' },
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
   *   · 노회 운영·감독(감사 기록) → 사이트 관리 안의 탭
   *   · 직인·도장       → 따로 세운 항목 (예전 '홈페이지 설정' 화면)
   * 서류 발급은 관리자 일이므로 여기로 들여왔다. */
  var ADMIN_NAV = { title: '관리자', href: 'manage.html', sub: [
    { t: '사이트 관리', h: 'manage.html' },
    { t: '회원 관리', h: 'admin.html' },
    { t: '상비부 관리', h: 'admin.html?view=com' },
    { t: '교회상황 보고서 접수', h: 'report-intake.html' },
    { t: '서류 발급', h: 'documents.html' },
    { t: '자료·회칙 관리', h: 'archive-edit.html' },
    { t: '직인·도장', h: 'settings.html' }
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

  /* 노회장·서기·간사에게 임원방 하위에 <노회 일정관리>를 붙인다 */
  function addScheduleMenu() {
    var links = document.querySelectorAll('.gnb-item > a[href="officer.html"]');
    if (!links.length) return;
    var sub = links[0].parentNode.querySelector('.gnb-sub');
    if (!sub || sub.querySelector('a[href="schedule.html"]')) return;
    var a = document.createElement('a');
    a.href = 'schedule.html';
    a.textContent = '노회 일정관리';
    sub.insertBefore(a, sub.firstChild);   /* 맨 위 자리 */
  }

  /* 노회장·서기·간사에게 임원방 하위에 <노회 진행 매니저>를 붙인다.
   * 회의 순서지를 만들어 두고 당일 순서를 하나씩 진행하는 도구다. */
  function addProceedMenu() {
    var links = document.querySelectorAll('.gnb-item > a[href="officer.html"]');
    if (!links.length) return;
    var sub = links[0].parentNode.querySelector('.gnb-sub');
    if (!sub || sub.querySelector('a[href="proceed.html"]')) return;
    var a = document.createElement('a');
    a.href = 'proceed.html';
    a.textContent = '노회 진행 매니저';
    var sched = sub.querySelector('a[href="schedule.html"]');
    if (sched && sched.nextSibling) sub.insertBefore(a, sched.nextSibling);
    else sub.insertBefore(a, sub.firstChild);
  }

  /* 회록서기(부회록서기)에게 임원방 하위에 <회의록 작성 안내>를 붙인다.
   * 총회 표준 회의록 작성 및 보존 규정을 정리한 안내와 샘플이다. */
  function addMinutesWriteMenu() {
    var links = document.querySelectorAll('.gnb-item > a[href="officer.html"]');
    if (!links.length) return;
    var sub = links[0].parentNode.querySelector('.gnb-sub');
    if (!sub || sub.querySelector('a[href="minutes-guide.html"]')) return;
    var a = document.createElement('a');
    a.href = 'minutes-guide.html';
    a.textContent = '회의록 작성 안내';
    /* 노회 진행 매니저 바로 뒤 (그 메뉴가 없으면 노회 회의록 바로 위) */
    var proceed = sub.querySelector('a[href="proceed.html"]');
    if (proceed && proceed.nextSibling) sub.insertBefore(a, proceed.nextSibling);
    else if (proceed) sub.appendChild(a);
    else {
      var minutes = sub.querySelector('a[href="minutes.html"]');
      if (minutes) sub.insertBefore(a, minutes); else sub.appendChild(a);
    }
  }

  /* 재정부 회계 메뉴 — 노회 회계·부회계(와 총관리자)에게만 보인다.
   * 감사 기간의 감사부장·서기는 데이터베이스(can_read_ledger)에 물어 켠다.
   * 노회장·서기·간사·부서기 등 다른 임원에게는 보이지 않는다. */
  function showFinanceMenu(p) {
    var links = document.querySelectorAll('a[data-fin]');
    if (!links.length || !p) return;
    function show() { links.forEach(function (a) { a.style.display = ''; }); }
    if (p.role === 'superadmin' || (p.role === 'officer' && !!p.title && p.title.indexOf('회계') !== -1)) { show(); return; }
    if (!(window.SHSCloud && SHSCloud.enabled && SHSCloud.enabled())) return;
    SHSCloud.init().then(function (c) {
      return c.rpc('can_read_ledger', { p_kind: 'presbytery', p_owner: '노회' });
    }).then(function (r) { if (r && r.data === true) show(); }, function () {});
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
    if (role === 'advisory') return '언권회원';
    if (role === 'general') return '일반회원';
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
        '<span class="user-role">(' + displayRole(user.role, user.title) + ')</span>' +
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
        var page = s.h.split('#')[0].split('?')[0];
        /* 대시보드는 상단에 제 메뉴가 따로 생기므로 여기서는 켜지 않는다 (중복 선택 방지) */
        if (page === 'dashboard.html') return false;
        return page === here;
      })) ? ' active' : '';
      html += '<li class="gnb-item' + active + '"><a href="' + m.href + '">' + m.title + '</a><div class="gnb-sub">';
      m.sub.forEach(function (s) {
        /* '미래교회자립위원회'처럼 긴 이름은 '위원회'를 다음 줄로 내려 칸 밖으로 나가지 않게 한다 */
        var label = s.t.replace(/^(.{4,})(위원회)$/, '$1<br>$2');
        /* 재정부 회계는 회계·부회계에게만 — 로그인 확인 뒤 showFinanceMenu 가 켠다 */
        html += '<a href="' + s.h + '"' + (s.fin ? ' data-fin="1" style="display:none"' : '') + '>' + label + '</a>';
      });
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
    meta.content = '#5d5041';
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

  /* ---------- 창(모달) 밖으로 끌어도 닫히지 않게 ----------
   * 입력 칸의 글을 끌어 고르다가 마우스를 창 밖(어두운 배경)에서 놓으면 브라우저는
   * 배경에 '클릭'이 난 것으로 쳐서, 배경 클릭 = 닫기 규칙 때문에 창이 사라진다.
   * 배경 위에서 눌렀다가 배경 위에서 뗀 진짜 클릭만 지나가게 하고, 안에서 시작된
   * 끌기는 어느 창이든 여기서 걸러 낸다. (x 단추와 진짜 배경 클릭은 그대로) */
  var pressedOn = null;
  document.addEventListener('mousedown', function (ev) { pressedOn = ev.target; }, true);
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!pressedOn || pressedOn === t || !(t instanceof Element) || !t.contains(pressedOn)) return;
    if (window.getComputedStyle(t).position !== 'fixed') return;
    var r = t.getBoundingClientRect();
    if (r.width < window.innerWidth * 0.9 || r.height < window.innerHeight * 0.9) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
  }, true);

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
    /* 첫 화면처럼 글로 미리 적어 둔 아래쪽 안내가 있으면 그대로 쓴다.
     * (검색로봇은 자바스크립트를 돌리지 않으므로, 적어 둔 것이 있어야 읽는다) */
    if (!document.querySelector('footer.site-footer')) {
      document.body.insertAdjacentHTML('beforeend', buildFooter());
    }
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
            '<span class="user-role">(' + displayRole(p.role, p.title) + ')</span>' +
            '<a href="mypage.html">내 정보</a><a href="#" id="btn-logout2">로그아웃</a>';
          var lo = document.getElementById('btn-logout2');
          if (lo) lo.addEventListener('click', window.SHSLogout);
          window.__shsUser = p;
          showFinanceMenu(p);
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
              /* 정년이 지난 분을 언권회원으로 바꾸는 일도 같은 자리에서 한다 */
              c.rpc('apply_retirement').then(function () {}, function () {});
              return c.rpc('run_reminders');
            }).then(function () {
              loadUnread();
            }, function () {});
          }
        } catch (x) {}

        /* 정회원에게 대시보드 메뉴를 맨 앞에 붙인다 */
        if (isActiveMember(toCloudUser(p))) addDashMenu();

        /* 관리자에게 관리자 메뉴를 붙인다 */
        if (['superadmin', 'president', 'clerk', 'staff'].indexOf(p.role) !== -1) {
          addAdminMenu();
          addScheduleMenu();
        }

        /* 노회 진행 매니저 — 서기만 (최고관리자는 관리를 위해 함께 본다) */
        if (p.role === 'clerk' || p.role === 'superadmin') {
          addProceedMenu();
        }

        /* 회의록 작성 매니저 — 회록서기만 (부회록서기는 열람만, 최고관리자 포함) */
        if (p.role === 'superadmin' ||
            (p.role === 'officer' && p.title && p.title.trim() === '회록서기')) {
          addMinutesWriteMenu();
        }

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

    /* 탭 — 누를 때 주소 해시에 기록을 남겨, 뒤로 가기를 누르면
     * 홈이 아니라 직전에 보던 탭으로 돌아가게 한다 */
    var tabRestoring = false;
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
          if (!tabRestoring && b.dataset.tab && history.pushState &&
              location.hash !== '#' + b.dataset.tab) {
            history.pushState(null, '', '#' + b.dataset.tab);
          }
        });
      });
    });

    /* 해시로 탭 열기 (#officers 등) */
    if (location.hash) {
      var target = document.querySelector('.tabs button[data-tab="' + location.hash.slice(1) + '"]');
      if (target) { tabRestoring = true; target.click(); tabRestoring = false; }
    }

    /* 뒤로 가기·앞으로 가기: 해시에 적힌 탭을 다시 보여 준다 */
    window.addEventListener('hashchange', function () {
      var id = location.hash.slice(1);
      var b = id && document.querySelector('.tabs button[data-tab="' + id + '"]');
      if (!b) {
        /* 해시가 비면(처음 들어온 상태) 첫 번째 탭 묶음의 첫 탭으로 되돌린다 */
        if (!id) b = document.querySelector('.tabs button[data-tab]');
        if (!b) return;
      }
      if (b.classList.contains('active')) return;
      tabRestoring = true;
      b.click();
      tabRestoring = false;
    });

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
  /* 알림 하나가 가리키는 화면.
   * 문의는 그 글로, 서류는 그 신청·증명서로 곧장 데려간다.
   * 서류는 보는 사람에 따라 갈 곳이 다르다 —
   * 관리자는 처리 화면(서류 발급), 신청자는 내 신청 내역. */
  /* 알림에서 곧바로 갈 곳. 갈 곳이 마땅치 않으면 null 을 돌려 준다. */
  function notiTargetOf(n, u) {
    var key = String((n && n.dedupe_key) || '');
    var title = String((n && n.title) || '');
    if (n.kind === '문의') {
      return 'board.html#' + (key.indexOf('inquiry-') === 0 ? key : 'inquiry');
    }
    if (n.kind === '운영' && key.indexOf('handover-') === 0) {
      return 'dashboard.html';
    }
    if (n.kind === '서류') {
      if (key.indexOf('docissue-') === 0) {
        return 'certificate.html?id=' + key.slice(9);
      }
      var canDo = u && SHSAuth.canIssueDocuments && SHSAuth.canIssueDocuments(u);
      if (key.indexOf('docreq-') === 0) {
        return canDo ? 'documents.html#' + key : 'request.html#' + key;
      }
      return canDo ? 'documents.html#requests' : 'request.html';
    }
    /* 회의비·거마비 지급 — 내 정보의 <지급 수령 확인> */
    if (n.kind === '회계' && key.indexOf('payout-') === 0) {
      return 'mypage.html#payouts';
    }
    /* 회기 마감 요청·승인·반려 — 그 장부 화면으로 (열쇠말: lclose-번호-종류-이름) */
    if (n.kind === '회계' && key.indexOf('lclose-') === 0) {
      var lc = key.match(/^lclose-\d+-(committee|sichal|presbytery)-(.+?)(-ok|-no)?$/);
      if (lc) {
        if (lc[1] === 'presbytery') return 'officer.html#sec-%EC%9E%AC%EC%A0%95%EB%B6%80-%ED%9A%8C%EA%B3%84';
        if (lc[1] === 'committee') return 'committee.html?c=' + encodeURIComponent(lc[2]) + '#lg';
        return 'sichal.html?s=' + encodeURIComponent(lc[2]);
      }
      return null;
    }
    /* 청원서 — 시찰 서기에게는 그 청원서의 <서류 진단>,
     * 낸 분에게는 <나의 서류>의 시찰로 보낸 청원서 */
    if (n.kind === '시찰') {
      /* 시찰장이 노회로 제출(84) — 관리자는 임원방 접수함, 낸 분은 나의 서류 */
      if (key.indexOf('petfwd-') === 0) {
        var adm = !!(u && window.SHSAuth && SHSAuth.canManageMembers && SHSAuth.canManageMembers(u));
        return adm ? 'officer.html#sec-' + encodeURIComponent('시찰-경유-청원서') : 'mydocs.html';
      }
      var nh = key.match(/^petnh-(\d+)-(.+)$/);            /* 노회 서기 처리 결과 → 그 시찰의 통과 청원서 */
      if (nh) return 'sichal.html?s=' + encodeURIComponent(nh[2]) + '#pass';
      var m = key.match(/^petition-(\d+)-(.+)$/);          /* 73 이후의 새 알림 */
      if (m) {
        return 'sichal.html?s=' + encodeURIComponent(m[2]) + '&p=' + m[1] + '#review';
      }
      if (key.indexOf('petsub-') === 0) return 'mydocs.html';
      /* 예전 알림 — 제목의 [시찰명]과 문구를 읽어 알맞은 화면으로 */
      if (title.indexOf('진단 결과') !== -1) return 'mydocs.html';
      var sc = (title.match(/^\[([^\]]+)\]/) || [])[1] || '';
      if (sc && title.indexOf('청원서') !== -1) {
        return 'sichal.html?s=' + encodeURIComponent(sc) + '#review';
      }
      return null;
    }
    return null;
  }
  /* 알림 쪽지(토스트)처럼 어디로든 보내야 할 때 쓰는 것 — 갈 곳이 없으면 알림함으로 */
  function notiLinkOf(n, u) {
    return notiTargetOf(n, u) || 'notifications.html';
  }
  function toastLink(n) {
    return notiLinkOf(n, window.__shsUser || null);
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
        '<span class="nt-go">' +
        (n.kind === '문의' ? '답장하기' : n.kind === '서류' ? '바로 가기' : '알림함에서 보기') +
        '</span>' +
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
      retire_applied: !!p.retire_applied,
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

  var SHS_esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

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

  /* 규칙의 올해 표시 기간 (관리자 화면의 세부 보기에 쓴다) */
  function opsWindow(n, dates) {
    dates = dates || DEFAULT_OPS_DATES;
    var y = new Date().getFullYear();
    var base;
    if (n.rule === 'spring' || n.rule === 'before_spring') base = nthMonday(y, dates.springMonth, dates.springWeek);
    else if (n.rule === 'fall' || n.rule === 'before_fall') base = nthMonday(y, dates.fallMonth, dates.fallWeek);
    else if (n.rule === 'fixed' && n.fixed_date) base = new Date(n.fixed_date + 'T00:00:00');
    else return null;
    var start = new Date(base.getTime() - (n.offset_days || 0) * 86400000);
    var end = new Date(start.getTime() + (n.window_days || 21) * 86400000);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    return { start: start, end: end, open: today >= start && today <= end };
  }

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

  /* 상단 배너: 표시 기간에 든 시스템 알림
   * 규칙의 대상(명부 연동)과 관리자에게 보인다 (서버 my_ops_notices 가 고른다).
   * 알림마다 <완료> 단추가 있어 누르면 이번 회기에는 다시 보이지 않고(서버에 남아
   * 어느 기기에서든 같다), <나중에 보기>는 이 창에서만 잠시 숨긴다. */
  function meetingReminder(u) {
    if (!u) return;
    var esc = SHS_esc;

    function show(rows) {
      rows = (rows || []).filter(function (n) {
        if (n.acked) return false;
        try { if (sessionStorage.getItem('shs_ops_later_' + n.id + '_' + n.period_key)) return false; } catch (x) {}
        return true;
      });
      if (!rows.length) return;
      var isAdmin = SHSAuth.canManageMembers(u);
      function md(d) { var m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? parseInt(m[1], 10) + '.' + parseInt(m[2], 10) : ''; }
      var bar = document.createElement('div');
      bar.className = 'container';
      bar.style.marginTop = '16px';
      bar.innerHTML =
        '<div class="notice-banner" style="border-left:4px solid var(--accent)">' +
        '<strong>[시스템 알림]</strong> 확인이 필요한 알림이 ' + rows.length + '건 있습니다. ' +
        '<small style="color:var(--gray-5)">처리한 뒤 완료를 누르면 이번 회기에는 다시 보이지 않습니다.</small>' +
        '<ul style="margin:8px 0 4px;padding-left:18px">' +
        rows.map(function (n) {
          return '<li style="margin:4px 0"><strong>' + esc(n.title) + '</strong> ' +
            '<small style="color:var(--gray-5)">(' + md(n.start_on) + ' ~ ' + md(n.end_on) +
            (n.audience ? ' · 대상 ' + esc(n.audience) : '') + ')</small>' +
            (n.message ? '<div style="font-size:0.88rem;color:var(--gray-7);margin-top:2px;white-space:pre-wrap">' + esc(n.message) + '</div>' : '') +
            '<button class="btn sm" data-opsack="' + n.id + '" data-pk="' + esc(n.period_key) + '"' +
              (n.doneKey ? ' data-donekey="' + esc(n.doneKey) + '"' : '') + ' style="margin-top:4px">완료</button>' +
            '</li>';
        }).join('') + '</ul>' +
        (isAdmin ? '<a class="btn ghost sm" href="manage.html#mg-ops">알림 규칙 관리</a> ' : '') +
        '<button class="btn ghost sm" id="ops-later-btn">나중에 보기</button>' +
        '</div>';
      var gnb = document.querySelector('.gnb');
      if (gnb) gnb.insertAdjacentElement('afterend', bar);

      bar.querySelectorAll('button[data-opsack]').forEach(function (b) {
        b.addEventListener('click', function () {
          function hide() {
            var li = b.closest('li');
            if (li) li.remove();
            if (!bar.querySelector('li')) bar.remove();
          }
          /* 서버가 없을 때(예전 방식): 이 브라우저에만 남긴다 */
          if (b.dataset.donekey) {
            try { localStorage.setItem(b.dataset.donekey, '1'); } catch (x) {}
            hide();
            return;
          }
          b.disabled = true; b.textContent = '처리 중…';
          SHSCloud.init().then(function (c) {
            return c.rpc('ack_ops_notice', { p_id: parseInt(b.dataset.opsack, 10), p_period_key: b.dataset.pk });
          }).then(function (r) {
            if (r && r.error) { alert(r.error.message); b.disabled = false; b.textContent = '완료'; return; }
            hide();
          }).catch(function (x) { alert((x && x.message) || x); b.disabled = false; b.textContent = '완료'; });
        });
      });
      var later = bar.querySelector('#ops-later-btn');
      if (later) later.addEventListener('click', function () {
        rows.forEach(function (n) {
          try { sessionStorage.setItem('shs_ops_later_' + n.id + '_' + n.period_key, '1'); } catch (x) {}
        });
        bar.remove();
      });
    }

    if (u.cloud && window.SHSCloud && SHSCloud.enabled()) {
      SHSCloud.init().then(function (c) {
        if (!c) return null;
        return c.rpc('my_ops_notices');
      }).then(function (r) {
        if (!r || r.error) return;   /* 82 sql 전이면 조용히 건너뛴다 */
        show(r.data || []);
      }).catch(function () {});
      return;
    }
    /* 서버가 없을 때(예전 방식): 관리자에게 기본 규칙만 */
    if (SHSAuth.canManageMembers(u)) {
      var act = opsActive(DEFAULT_OPS_NOTICES, DEFAULT_OPS_DATES);
      show(act.map(function (n) { return { id: n.id, title: n.title, message: n.message, audience: n.audience, period_key: 'local', doneKey: n.doneKey }; }));
    }
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
   *  3) 총회 정년(만 71세)에 이른 경우  */
  var RETIRE_AGE = 71;   /* 총회 정년 1년 연장(2026-09): 만 71세가 되는 생일 하루 전까지 시무 */

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

  /* 정년일 = 만 71세가 되는 생일 하루 전 (총회 정년 규정, 2026-09 1년 연장 적용).
   * 이 날까지 시무하고, 만 71세 생일부터 정년 경과로 본다. */
  function retireDate(birth) {
    if (!birth) return null;
    var b = new Date(birth + 'T00:00:00');
    if (isNaN(b)) return null;
    return new Date(b.getFullYear() + RETIRE_AGE, b.getMonth(), b.getDate() - 1);
  }

  function todayStart() {
    var d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }

  /* 정년일까지 남은 날수 (0 = 오늘이 정년일, 음수 = 경과, null = 생년월일 없음) */
  function daysToRetire(birth) {
    var rd = retireDate(birth);
    if (!rd) return null;
    return Math.round((rd - todayStart()) / 86400000);
  }

  /* 정년이 지났는가 — 만 71세 생일 당일부터 참 */
  function isRetired(birth) {
    var d = daysToRetire(birth);
    return d !== null && d < 0;
  }

  /* 정년일 표기 (생년월일이 없으면 알 수 없다고 알린다) */
  function retireLabel(u) {
    var rd = retireDate(u && u.birth_date);
    if (!rd) return '생년월일 미등록';
    var y = rd.getFullYear() + '. ' + (rd.getMonth() + 1) + '. ' + rd.getDate() + '.';
    var days = daysToRetire(u.birth_date);
    if (days < 0) return y + ' (정년 경과)';
    if (days === 0) return y + ' (오늘이 정년일)';
    if (days < 400) return y + ' (' + days + '일 남음)';
    return y + ' (' + Math.floor(days / 365) + '년 ' + Math.floor(days % 365 / 30) + '개월 남음)';
  }

  /* ---------- 시무목사 청빙 (3년 임기) ----------
   *
   * 당회가 없는 교회 — 곧 시무장로가 없어 당회를 이루지 못한 교회의 담임은
   * 위임목사가 아니라 시무목사다. 시무목사는 노회의 허락을 받아 3년씩 시무하고,
   * 3년이 지나기 전에 다시 시무목사 청빙청원을 해야 한다.
   * 위임목사는 임기가 없으므로 이 셈에 들지 않는다.
   *
   *   call_on     노회가 청빙을 허락한 날
   *   call_until  시무가 끝나는 날 (비어 있으면 허락일부터 3년 뒤)
   *   call_acting 임시당회장 */
  var CALL_YEARS = 3;
  var CALL_SOON_DAYS = 180;   /* 반년 — 한 회기 앞이면 다시 청원을 준비할 때다 */

  /* 3년마다 청빙청원을 해야 하는 자리인가.
   * 명단의 직분은 대개 '목사'로 적혀 있고, 위임을 받은 분만 '위임목사'다.
   * 무임·원로·은퇴·부목사와 장로는 해당하지 않는다. */
  function isSimuPastor(m) {
    if (!m) return false;
    return m.category === '목사' && (m.position === '목사' || m.position === '시무목사');
  }

  function ymd(d) {
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  /* 시무 만료일 — 명단에 따로 적혀 있으면 그것을 따르고, 없으면 허락일 + 3년 */
  function callUntil(m) {
    if (!m) return null;
    if (m.call_until) return String(m.call_until).slice(0, 10);
    if (!m.call_on) return null;
    var d = new Date(String(m.call_on).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return null;
    d.setFullYear(d.getFullYear() + CALL_YEARS);
    return ymd(d);
  }

  /* 남은 날수를 '2년 3개월' 같은 우리말로 */
  function spanKo(days) {
    days = Math.abs(days);
    if (days < 31) return days + '일';
    var mo = Math.round(days / 30.44);
    var y = Math.floor(mo / 12), m = mo % 12;
    if (!y) return m + '개월';
    return y + '년' + (m ? ' ' + m + '개월' : '');
  }

  /* 시무목사 청빙 형편
   *   none  청원해야 하는 자리인데 적힌 기록이 없다
   *   na    해당 없음 (위임목사·부목사·원로·은퇴·무임·장로 등)
   *   done  시무목사로 청빙받았다가 위임 등으로 자리가 바뀌어 임기가 끝났다
   *   ok    아직 넉넉히 남았다
   *   soon  반년 안으로 다가왔다 — 다시 청원할 때
   *   over  기한이 지났다 */
  function callTerm(m) {
    var on = m && m.call_on ? String(m.call_on).slice(0, 10) : null;
    var until = callUntil(m);

    if (!isSimuPastor(m)) {
      if (!on) return { state: 'na', on: null, until: null, days: null, label: '' };
      return { state: 'done', on: on, until: until, days: null,
        label: on + ' 청빙 · 지금은 ' + ((m && (m.position || m.category)) || '다른 직분') +
          '이므로 시무목사 임기는 끝났습니다' };
    }
    if (!on) {
      return { state: 'none', on: null, until: null, days: null,
        label: '청빙청원 기록이 없습니다' };
    }

    var d = new Date(until + 'T00:00:00');
    if (isNaN(d)) {
      return { state: 'none', on: on, until: null, days: null, label: '만료일을 알 수 없습니다' };
    }
    var days = Math.round((d - todayStart()) / 86400000);
    var state = days < 0 ? 'over' : (days <= CALL_SOON_DAYS ? 'soon' : 'ok');
    var label =
      state === 'over' ? until + ' 만료 (' + spanKo(days) + ' 지남) — 시무목사 청빙청원이 필요합니다'
      : state === 'soon' ? until + '까지 (' + spanKo(days) + ' 남음) — 다시 청빙청원할 때입니다'
      : until + '까지 (' + spanKo(days) + ' 남음)';
    return { state: state, on: on, until: until, days: days, label: label };
  }

  /* 남은 임기 안내 문구 */
  function termLabel(u) {
    var parts = [];
    var days = daysToRetire(u.birth_date);
    if (days !== null) {
      if (days < 0) parts.push('정년 경과');
      else if (days === 0) parts.push('오늘이 정년일');
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
    if (u.role === 'general') return '일반회원은 정회원 전용 자료를 열람할 수 없습니다.';
    /* 정년이 지났는데 아직 정년 처리(언권회원 전환 또는 관리자 확정)가 안 된 경우 */
    if (isRetired(u.birth_date) && !u.retire_applied) return '총회 정년(만 ' + RETIRE_AGE + '세)에 이르러 정회원 자격이 만료되었습니다.';
    if (u.member_until) {
      var md = new Date(u.member_until + 'T00:00:00');
      if (md <= new Date()) return '총대 자격 기간이 만료되어 정회원 자격이 상실되었습니다.';
    }
    return null;
  }

  /* 정회원 이상(자격 유효) 여부.
   * 정년(만 71세)이 지나면 언권회원으로 자동 전환된다. 다만 관리자가 정년이
   * 지난 분의 등급을 직접 정한 경우(retire_applied)에는 그 등급을 따른다.
   * 그 밖의 사유(승인대기·총대 기간 만료 등)는 관리자·임원에게 적용하지 않는다. */
  function isActiveMember(u) {
    if (!u) return false;
    if (isRetired(u.birth_date) && !u.retire_applied) return false;
    if (u.role === 'general') return false;
    if (['superadmin', 'president', 'clerk', 'staff', 'officer'].indexOf(u.role) !== -1) return true;
    return !membershipIssue(u);
  }

  /* 언권회원 제한: 서류 발급·청원서·보고서 작성은 할 수 없다.
   * 그 밖의 활동은 정회원과 동일하다. */
  function fullMemberGate(u, what) {
    if (u && u.role === 'advisory') {
      return '<div class="notice-banner">언권회원은 <strong>' + (what || '이 기능') +
        '</strong>을 이용하실 수 없습니다. 문의는 노회 사무실(031-486-9993)로 해주시기 바랍니다.</div>';
    }
    return null;
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
    notiLinkOf: notiLinkOf,
    notiTargetOf: notiTargetOf,
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
    fullMemberGate: fullMemberGate,
    termLabel: termLabel,
    retireLabel: retireLabel,
    isSimuPastor: isSimuPastor,
    callUntil: callUntil,
    callTerm: callTerm,
    CALL_YEARS: CALL_YEARS,
    ageOn: ageOn,
    retireDate: retireDate,
    isRetired: isRetired,
    daysToRetire: daysToRetire,
    nthMonday: nthMonday,
    opsActive: opsActive,
    opsWindow: opsWindow,
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

/* ==========================================================================
   손전화 화면 — 가로·세로 전환과 확대·축소
   --------------------------------------------------------------------------
   1) 눕혔다 세웠다 할 때 화면 크기를 제때 다시 재고 그리는 쪽에도 알린다.
   2) 화면보다 넓은 표에는 옆으로 밀어 볼 자리를 둘러 준다.
   3) 큰 사진에 확대·축소(+ · - · 두 손가락 · 두 번 두드리기)를 붙인다.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;

  /* ---------- 1. 가로·세로 전환 ---------- */

  /* 지금 화면이 가로인지 세로인지, 그리고 실제로 보이는 높이가 얼마인지
   * 문서에 적어 둔다. 손전화 브라우저는 주소창이 접혔다 펴지며 높이가
   * 오르내리므로, vh 대신 이 값을 쓰면 창이 잘리지 않는다. */
  function mark() {
    var h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    var w = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
    root.setAttribute('data-orient', w > h ? 'landscape' : 'portrait');
    root.style.setProperty('--vh', (h * 0.01) + 'px');
  }

  var turnTimer = null;
  /* 아이폰·안드로이드는 화면을 돌린 '직후'에는 아직 예전 크기를 알려 준다.
   * 그래서 두 번(곧바로 한 번, 조금 뒤 한 번) 재고, 캔버스처럼 스스로
   * 다시 그려야 하는 쪽에도 resize 를 한 번 더 알린다. */
  function onTurn() {
    mark();
    clearTimeout(turnTimer);
    turnTimer = setTimeout(function () {
      mark();
      fitWide();
      try { window.dispatchEvent(new Event('resize')); } catch (e) {}
    }, 280);
  }

  window.addEventListener('orientationchange', onTurn);
  if (window.screen && screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', onTurn);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', mark);
  }

  var sizeTimer = null;
  window.addEventListener('resize', function () {
    mark();
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(fitWide, 160);
  });

  mark();

  /* ---------- 2. 화면보다 넓은 표 ---------- */

  /* 페이지 전체가 옆으로 밀리지 않도록 html·body 를 잠가 두었기 때문에,
   * 화면보다 넓은 표는 잘린 채 나머지를 볼 길이 없었다. 눕혀도 마찬가지다.
   * 그런 표에만 옆으로 미는 자리를 둘러 준다. (들어맞는 표는 그대로 둔다) */
  function fitWide() {
    var room = root.clientWidth;
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      if (t.parentNode && t.parentNode.classList &&
          t.parentNode.classList.contains('x-scroll')) continue;
      if (t.closest && t.closest('.x-scroll')) continue;
      if (t.getBoundingClientRect().width <= room - 8) continue;

      var box = document.createElement('div');
      box.className = 'x-scroll';
      t.parentNode.insertBefore(box, t);
      box.appendChild(t);
    }
  }

  /* ---------- 3. 큰 사진 확대·축소 ---------- */

  var MIN = 1, MAX = 6;

  function setupZoom(lb) {
    if (lb.dataset.zoomReady) return;
    var img = lb.querySelector('img');
    if (!img) return;
    lb.dataset.zoomReady = '1';

    /* 돌리기(rotate)는 사진 자체에 걸려 있다. 확대를 같은 자리에 걸면 서로
     * 덮어쓰므로, 사진을 한 겹 감싸 그 자리에 확대를 건다. */
    var wrap = document.createElement('div');
    wrap.className = 'lb-zoom';
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);

    var bar = document.createElement('div');
    bar.className = 'lb-zoombar';
    bar.innerHTML =
      '<button type="button" data-z="out" aria-label="축소" title="축소">&minus;</button>' +
      '<span class="lb-zpct">100%</span>' +
      '<button type="button" data-z="in" aria-label="확대" title="확대">&plus;</button>' +
      '<button type="button" class="wide" data-z="reset" aria-label="원래 크기로">원래대로</button>';
    lb.appendChild(bar);

    var pct = bar.querySelector('.lb-zpct');
    var s = 1, tx = 0, ty = 0;

    /* 확대한 사진을 끌어도 화면 밖으로 달아나지 않게 붙잡아 둔다 */
    function hold() {
      var mx = Math.max(0, (wrap.offsetWidth * s - lb.clientWidth) / 2);
      var my = Math.max(0, (wrap.offsetHeight * s - lb.clientHeight) / 2);
      tx = Math.min(mx, Math.max(-mx, tx));
      ty = Math.min(my, Math.max(-my, ty));
    }

    function draw() {
      hold();
      wrap.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
      wrap.classList.toggle('zoomed', s > 1.01);
      pct.textContent = Math.round(s * 100) + '%';
      bar.querySelector('[data-z="out"]').disabled = s <= MIN + 0.001;
      bar.querySelector('[data-z="in"]').disabled = s >= MAX - 0.001;
    }

    /* px·py 는 큰 사진 칸의 한가운데를 0 으로 본 자리.
     * 그 자리를 손가락(또는 마우스) 밑에 그대로 붙들어 둔 채 배율만 바꾼다. */
    function zoomTo(next, px, py) {
      next = Math.min(MAX, Math.max(MIN, next));
      if (Math.abs(next - s) < 0.001) return;
      tx = px - (px - tx) * next / s;
      ty = py - (py - ty) * next / s;
      s = next;
      if (s <= MIN + 0.001) { s = MIN; tx = 0; ty = 0; }
      draw();
    }

    function reset() { s = 1; tx = 0; ty = 0; draw(); }

    function local(cx, cy) {
      var r = lb.getBoundingClientRect();
      return { x: cx - (r.left + r.width / 2), y: cy - (r.top + r.height / 2) };
    }

    /* ----- 단추 ----- */
    bar.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-z]') : null;
      if (!b) return;
      ev.stopPropagation();
      var k = b.getAttribute('data-z');
      if (k === 'in') zoomTo(s * 1.5, 0, 0);
      else if (k === 'out') zoomTo(s / 1.5, 0, 0);
      else reset();
    });

    /* ----- 컴퓨터: 바퀴로 확대, 끌어서 옮기기, 두 번 눌러 확대 ----- */
    wrap.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var p = local(ev.clientX, ev.clientY);
      zoomTo(s * (ev.deltaY < 0 ? 1.18 : 1 / 1.18), p.x, p.y);
    }, { passive: false });

    wrap.addEventListener('dblclick', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var p = local(ev.clientX, ev.clientY);
      if (s > 1.01) reset(); else zoomTo(2.5, p.x, p.y);
    });

    var drag = null;
    wrap.addEventListener('mousedown', function (ev) {
      if (s <= 1.01) return;
      ev.preventDefault();
      drag = { x: ev.clientX - tx, y: ev.clientY - ty };
      wrap.classList.add('dragging');
    });
    window.addEventListener('mousemove', function (ev) {
      if (!drag) return;
      tx = ev.clientX - drag.x; ty = ev.clientY - drag.y;
      draw();
    });
    window.addEventListener('mouseup', function () {
      drag = null; wrap.classList.remove('dragging');
    });

    /* ----- 손가락: 두 손가락으로 넓히기, 끌어서 옮기기, 두 번 두드려 확대 -----
     * 확대해 놓았을 때는 옆으로 쓸어도 다음 사진으로 넘어가지 않게 막는다.
     * 확대하지 않았을 때는 그대로 두어 앞·뒤 넘기기가 살아 있게 한다. */
    var pinch = null, pan = null, lastTap = 0;

    function gap(a, b) {
      var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    function midOf(a, b) {
      return local((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    }

    wrap.addEventListener('touchstart', function (ev) {
      if (ev.touches.length === 2) {
        ev.stopPropagation();
        pan = null;
        pinch = { d: gap(ev.touches[0], ev.touches[1]), s: s, m: midOf(ev.touches[0], ev.touches[1]) };
        wrap.classList.add('dragging');
        return;
      }
      if (ev.touches.length === 1) {
        var now = Date.now();
        if (now - lastTap < 300) {                 /* 두 번 두드리기 */
          ev.preventDefault(); ev.stopPropagation();
          var p = local(ev.touches[0].clientX, ev.touches[0].clientY);
          if (s > 1.01) reset(); else zoomTo(2.5, p.x, p.y);
          lastTap = 0;
          return;
        }
        lastTap = now;
        if (s > 1.01) {
          ev.stopPropagation();
          pan = { x: ev.touches[0].clientX - tx, y: ev.touches[0].clientY - ty };
          wrap.classList.add('dragging');
        }
      }
    }, { passive: false });

    wrap.addEventListener('touchmove', function (ev) {
      if (pinch && ev.touches.length === 2) {
        ev.preventDefault(); ev.stopPropagation();
        var d = gap(ev.touches[0], ev.touches[1]);
        if (pinch.d > 0) zoomTo(pinch.s * d / pinch.d, pinch.m.x, pinch.m.y);
        return;
      }
      if (pan && ev.touches.length === 1) {
        ev.preventDefault(); ev.stopPropagation();
        tx = ev.touches[0].clientX - pan.x;
        ty = ev.touches[0].clientY - pan.y;
        draw();
      }
    }, { passive: false });

    function endTouch(ev) {
      if (pinch || pan) ev.stopPropagation();
      pinch = null; pan = null;
      wrap.classList.remove('dragging');
    }
    wrap.addEventListener('touchend', endTouch);
    wrap.addEventListener('touchcancel', endTouch);

    /* 다음·이전 사진으로 넘어가거나 창을 닫으면 배율을 원래대로 돌린다 */
    if ('MutationObserver' in window) {
      new MutationObserver(function () { if (s !== 1) reset(); })
        .observe(img, { attributes: true, attributeFilter: ['src'] });
      new MutationObserver(function () {
        if (!lb.classList.contains('open') && s !== 1) reset();
      }).observe(lb, { attributes: true, attributeFilter: ['class'] });
    }

    draw();
  }

  /* 큰 사진 창은 갤러리처럼 처음부터 있는 것도, 시찰방·회계처럼 나중에
   * 만들어 붙이는 것도 있다. 둘 다 잡아 준다. */
  function scanZoom() {
    var list = document.querySelectorAll('.lightbox');
    for (var i = 0; i < list.length; i++) setupZoom(list[i]);
  }

  function start() {
    fitWide();
    scanZoom();
    if ('MutationObserver' in window) {
      new MutationObserver(scanZoom).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

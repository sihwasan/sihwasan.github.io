/* 시화산노회 홈페이지 회원 가입 및 어플 설치 안내 (웹용, app.html)
 *
 * 카카오톡으로 보낸 링크(sihwasan.org/app)를 누르면 열리는 화면이다.
 * 휴대전화 종류와 지금 열린 곳(카카오톡 안, 크롬, 사파리 …)을 알아보고
 * 그에 맞는 단계만 차례로 보여 준다.
 *   ① 크롬으로 열기 (아이폰은 사파리) — 크롬이 없으면 Play 스토어 설치 안내
 *   ② 회원 가입 · 로그인 — 마치면 이 화면으로 돌아온다 (sessionStorage 'shs_next')
 *   ③ 앱 설치 — 안드로이드 크롬은 단추 하나로, 아이폰은 그림으로 안내
 * 주소 끝에 ?as=and-kakao 처럼 붙이면 그 환경의 화면을 미리 볼 수 있다. */
(function () {
  var SITE = 'https://sihwasan.org/app';
  var IMG = 'images/app-guide/';
  var MSG = '[시화산노회] 홈페이지 회원 가입 및 어플 설치 안내\n\n' +
    '아래 링크를 누르시고, 화면의 단추를 차례로 눌러 주세요. (5분)\n' +
    '① 크롬으로 열기  ② 회원 가입  ③ 앱 설치\n\n' + SITE;

  /* 그림: [파일, 설명, 덧붙임] */
  var SHOT = {
    a1: ['a1_playstore', '초록색 「설치」를 누릅니다.', '이미 깔려 있으면 「열기」나 「사용」이 보입니다. 「사용」이 보이면 그것을 누릅니다.'],
    a2: ['a2_welcome', '크롬이 처음 열리면 「○○○(으)로 계속」을 누릅니다.', '다음 화면이 더 나오면 「예」나 「아니요」 아무것이나 누르셔도 됩니다. (화면은 휴대전화마다 조금 다릅니다)'],
    a3: ['a3_menu', '크롬 오른쪽 위 ⋮ 를 누릅니다.', ''],
    a4: ['a4_add', '「홈 화면에 추가」를 누릅니다.', '「앱 설치」라고 보이면 그것을 누릅니다.'],
    a5: ['a5_install', '「설치」를 누릅니다.', '「추가」가 한 번 더 나오면 「추가」를 누릅니다.'],
    a6: ['a6_home', '바탕 화면에 「시화산노회」 아이콘이 생깁니다.', '앞으로는 이 아이콘으로 들어오시면 됩니다.'],
    i1: ['i1_share', '사파리 아래쪽 가운데의 공유 단추를 누릅니다.', ''],
    i1b: ['i1b_more', '공유 단추가 없고 ⋯ 만 보이면, ⋯ 를 누른 뒤 「공유」를 누릅니다.', ''],
    i2: ['i2_sheet', '목록을 손가락으로 위로 밀어 올려 「홈 화면에 추가」를 누릅니다.', ''],
    i3: ['i3_add', '오른쪽 위 「추가」를 누릅니다.', ''],
    i4: ['i4_home', '홈 화면에 「시화산노회」 아이콘이 생깁니다.', '앞으로는 이 아이콘으로 들어오시면 됩니다.']
  };
  var CHROME_ICON = '<img class="ag-icon" src="images/chrome.png" alt="크롬 아이콘">';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- 어디서 열렸나 ---------- */
  var UA = navigator.userAgent || '';
  var forced = (location.search.match(/[?&]as=([a-z-]+)/) || [])[1];
  function detect() {
    if (forced) return forced;
    var android = /Android/i.test(UA);
    var ios = /iPhone|iPad|iPod/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
    var kakao = /KAKAOTALK/i.test(UA);
    var inapp = kakao || /NAVER|DaumApps|Instagram|FBAN|FBAV|FB_IAB|Line\/|BAND\/|KAKAOSTORY|; wv\)/i.test(UA);
    var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    if (standalone) return 'app';
    if (android) {
      if (kakao) return 'and-kakao';
      if (!inapp && /Chrome\//.test(UA) && !/SamsungBrowser|EdgA|Whale|OPR\/|YaBrowser|Firefox|Version\/\d/i.test(UA)) return 'and-chrome';
      return 'and-other';
    }
    if (ios) {
      if (kakao) return 'ios-kakao';
      if (inapp || /FxiOS|EdgiOS|Whale|OPiOS/i.test(UA)) return 'ios-inapp';
      if (/CriOS/.test(UA)) return 'ios-chrome';
      return 'ios-safari';
    }
    return 'desktop';
  }
  var ENV = detect();
  var AND = ENV.indexOf('and-') === 0, IOS = ENV.indexOf('ios-') === 0, DESK = ENV === 'desktop';
  var READY = ENV === 'and-chrome' || ENV === 'ios-safari' || ENV === 'ios-chrome' || ENV === 'app';  /* ① 끝 */

  /* ---------- 그림 ---------- */
  function shots(keys) {
    return '<div class="ag-shots">' + keys.map(function (k, i) {
      var s = SHOT[k], h = k.charAt(0) === 'i' ? 1045 : 1126;
      return '<figure class="ag-shot"><button type="button" data-zoom="' + k + '" aria-label="그림 크게 보기 — ' + esc(s[1]) + '">' +
        '<img loading="lazy" src="' + IMG + s[0] + '.webp" width="600" height="' + h + '" alt="' + esc(s[1]) + '"></button>' +
        '<figcaption><b class="n">' + (i + 1) + '</b>' + esc(s[1]) + (s[2] ? '<small>' + esc(s[2]) + '</small>' : '') + '</figcaption></figure>';
    }).join('') + '</div>';
  }
  function more(id, title, html, open) {
    return '<details class="ag-more" id="' + id + '"' + (open ? ' open' : '') + '><summary>' + title + '</summary><div>' + html + '</div></details>';
  }
  function setState(n, st) {
    var el = $('ag-s' + n);
    el.classList.remove('cur', 'done', 'todo');
    if (st) el.classList.add(st);
  }

  /* ---------- ① 크롬으로 열기 ---------- */
  var target = location.origin && location.origin.indexOf('http') === 0 ? location.origin + location.pathname : SITE;
  function chromeIntent() {
    var u = target.replace(/^https?:\/\//, '');
    return 'intent://' + u + '#Intent;scheme=https;package=com.android.chrome;' +
      (ENV === 'and-kakao' ? '' : 'S.browser_fallback_url=' + encodeURIComponent('https://play.google.com/store/apps/details?id=com.android.chrome') + ';') + 'end';
  }

  function step1() {
    var b = $('ag-s1-b'), h = $('ag-s1-h');
    if (ENV === 'app') {
      h.textContent = '앱으로 열려 있습니다';
      b.innerHTML = '<p>바탕 화면의 「시화산노회」 아이콘으로 들어오셨습니다.</p>';
      return setState(1, 'done');
    }
    if (ENV === 'and-chrome') {
      h.innerHTML = '크롬(Chrome)으로 열기';
      b.innerHTML = '<p>' + CHROME_ICON + ' 크롬으로 열려 있습니다. 아래 ②로 넘어가세요.</p>';
      return setState(1, 'done');
    }
    if (ENV === 'ios-safari' || ENV === 'ios-chrome') {
      h.textContent = ENV === 'ios-safari' ? '사파리(Safari)로 열기' : '크롬(Chrome)으로 열기';
      b.innerHTML = '<p>' + (ENV === 'ios-safari' ? '사파리' : CHROME_ICON + ' 크롬') + '로 열려 있습니다. 아래 ②로 넘어가세요.</p>';
      return setState(1, 'done');
    }
    if (AND) {
      h.textContent = '크롬(Chrome)으로 열기';
      var where = ENV === 'and-kakao' ? '<strong>카카오톡 안의 화면</strong>' :
        (/SamsungBrowser/i.test(UA) ? '<strong>삼성 인터넷</strong>' : '<strong>크롬이 아닌 화면</strong>');
      b.innerHTML =
        '<p>지금은 ' + where + '입니다. 회원 가입과 앱 설치는 <strong>크롬</strong>에서 해야 합니다.</p>' +
        '<p>크롬은 ' + CHROME_ICON + ' 이 아이콘의 인터넷 앱입니다.</p>' +
        '<button class="btn ag-big" type="button" id="ag-open"><img src="images/chrome.png" alt="">크롬으로 열기</button>' +
        '<div class="ag-msg" id="ag-msg1" role="status"></div>' +
        more('ag-noch', '크롬이 없거나 열리지 않으면',
          '<p>Play 스토어에서 크롬을 먼저 설치합니다.</p>' +
          '<button class="btn ghost ag-big" type="button" id="ag-store">Play 스토어에서 크롬 설치하기</button>' +
          shots(['a1']) +
          '<p class="ag-tip">설치가 끝나면 <strong>◁ 뒤로 가기</strong>로 이 화면에 돌아와 위의 <strong>「크롬으로 열기」</strong>를 다시 눌러 주세요.<br>' +
          '(크롬 주소창에 <strong>sihwasan.org/app</strong> 을 직접 적으셔도 됩니다)</p>') +
        more('ag-first', '크롬이 처음 열릴 때', shots(['a2']));
      $('ag-open').addEventListener('click', openChrome);
      $('ag-store').addEventListener('click', openStore);
      return setState(1, 'cur');
    }
    if (IOS) {
      h.textContent = '사파리(Safari)로 열기';
      if (ENV === 'ios-kakao') {
        b.innerHTML =
          '<p>지금은 <strong>카카오톡 안의 화면</strong>입니다. 아이폰은 <strong>사파리</strong>에서 앱을 설치합니다.</p>' +
          '<button class="btn ag-big" type="button" id="ag-open">사파리로 열기</button>' +
          '<div class="ag-msg" id="ag-msg1" role="status"></div>' +
          '<p class="ag-tip">크롬을 쓰시는 분은 크롬에서 <strong>sihwasan.org/app</strong> 을 여셔도 됩니다.</p>';
        $('ag-open').addEventListener('click', openChrome);
      } else {
        b.innerHTML =
          '<p>지금 화면에서는 앱을 설치할 수 없습니다. 화면 아래나 위의 <span class="ag-key">⋯</span> 또는 공유 단추를 누르고 ' +
          '<strong>「Safari로 열기」</strong>(또는 「기본 브라우저로 열기」)를 눌러 주세요.</p>' +
          '<p>잘 안 되면 주소를 복사해 사파리 주소창에 붙여 넣으셔도 됩니다.</p>' +
          '<button class="btn ghost ag-big" type="button" data-copy="link">주소 복사하기</button>' +
          '<div class="ag-msg" id="ag-copymsg1" role="status"></div>';
      }
      return setState(1, 'cur');
    }
    /* 컴퓨터 */
    h.textContent = '크롬(Chrome)으로 열기';
    b.innerHTML =
      '<p>이 안내는 <strong>휴대전화</strong>에서 하는 것입니다. 휴대전화의 카카오톡에서 위의 링크를 누르면, ' +
      '그 휴대전화에 맞는 단추가 나옵니다.</p>' +
      '<ul class="ag-list"><li><strong>안드로이드(갤럭시)</strong> — 「크롬으로 열기」 단추를 누릅니다. ' + CHROME_ICON + ' 크롬이 없으면 Play 스토어에서 설치합니다.</li>' +
      '<li><strong>아이폰</strong> — 「사파리로 열기」 단추를 누릅니다.</li></ul>' +
      more('ag-noch', '그림 보기 — Play 스토어에서 크롬 설치 · 크롬 첫 화면', shots(['a1', 'a2']));
  }

  /* 앱을 열어 보고, 2.5초 안에 화면이 가려지지 않으면 열리지 않은 것으로 본다 */
  var tried = '';
  function tryOpen(url, kind) {
    tried = kind;
    var gone = false;
    function hide() { if (document.hidden) gone = true; }
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    location.href = url;
    setTimeout(function () {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', hide);
      if (gone || document.hidden) return;
      if (kind === 'chrome' && AND) {
        say('ag-msg1', 'warn', '크롬이 열리지 않았습니다. 크롬이 설치되어 있지 않거나 꺼져 있는 것 같습니다. 아래 <strong>「Play 스토어에서 크롬 설치하기」</strong>를 눌러 주세요.');
        var d = $('ag-noch'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      } else if (kind === 'store') {
        location.href = 'https://play.google.com/store/apps/details?id=com.android.chrome';
      } else if (kind === 'chrome' && IOS) {
        say('ag-msg1', 'warn', '사파리가 열리지 않았습니다. 화면 오른쪽 아래 <span class="ag-key">⋯</span> 를 누르고 「다른 브라우저로 열기」를 눌러 주세요.');
      }
    }, 2500);
  }
  function openChrome() {
    if (ENV === 'ios-kakao' || (ENV === 'and-kakao' && !/Android/i.test(UA) && forced)) {
      tryOpen('kakaotalk://web/openExternal?url=' + encodeURIComponent(target), 'chrome');
    } else {
      tryOpen(chromeIntent(), 'chrome');
    }
    say('ag-msg1', 'good', AND ? '크롬이 열리면 크롬에서 이어서 하시면 됩니다. 크롬이 처음 열리면 아래 「크롬이 처음 열릴 때」 그림을 보세요.'
      : '사파리가 열리면 사파리에서 이어서 하시면 됩니다.');
  }
  function openStore() { tryOpen('market://details?id=com.android.chrome', 'store'); }

  /* Play 스토어에 다녀오면 — 이제 크롬으로 열기를 누르도록 */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || tried !== 'store') return;
    tried = '';
    say('ag-msg1', 'good', '크롬 설치를 마치셨으면 이제 <strong>「크롬으로 열기」</strong>를 눌러 주세요.');
    var b = $('ag-open');
    if (b) {
      b.scrollIntoView({ behavior: 'smooth', block: 'center' });
      b.classList.remove('ag-flash'); void b.offsetWidth; b.classList.add('ag-flash');
    }
  });

  function say(id, kind, html) {
    var m = $(id);
    if (!m) return;
    m.className = 'ag-msg ' + (kind || '');
    m.innerHTML = html;
  }

  /* ---------- ② 회원 가입 ---------- */
  function step2(user) {
    var b = $('ag-s2-b');
    if (user) {
      var who = esc(user.name || user.email || '') + (user.position ? ' ' + esc(user.position) : '') + '님';
      var g = window.SHS && SHS.displayRole ? SHS.displayRole(user.role, user.title) : user.role;
      var bad = user.role === 'pending' || user.role === 'general';
      b.innerHTML = '<p><strong>' + who + '</strong> — 가입되어 있습니다. (' + esc(g) + ')</p>' +
        (bad ? '<div class="ag-msg warn">아직 <strong>(' + esc(g) + ')</strong>입니다. 성명 · 소속 교회가 노회 명단과 같아야 회원 등급이 정해집니다. ' +
          '<a href="mypage.html">내 정보</a>에서 확인해 주시고, 그래도 그대로면 노회 서기나 간사에게 연락해 주세요.</div>' : '');
      setState(2, 'done');
      return;
    }
    if (!READY && !DESK) {
      b.innerHTML = '<p>' + (IOS ? '①을 먼저 해 주세요. 사파리에서' : '①을 먼저 해 주세요. 크롬에서') + ' 이어서 합니다.</p>';
      setState(2, 'todo');
      return;
    }
    b.innerHTML =
      '<p>처음이시면 <strong>회원 가입</strong>, 전에 가입하셨으면 <strong>로그인</strong>을 누릅니다.</p>' +
      '<div class="ag-two"><a class="btn ag-big" href="signup.html" data-next="1">회원 가입</a>' +
      '<a class="btn ghost ag-big" href="login.html" data-next="1">로그인</a></div>' +
      '<ul class="ag-list">' +
      '<li><strong>성명 · 직분 · 소속 교회 · 생년월일</strong>을 적습니다. 소속 교회가 목록에 없으면 「교회명 직접 입력」을 고릅니다.</li>' +
      '<li><span class="ag-key">구글 계정으로 가입하기</span>나 <span class="ag-key">네이버 계정으로 가입하기</span>를 누르면 비밀번호를 따로 만들지 않아도 됩니다.</li>' +
      '<li>성명과 소속 교회가 노회 명단과 같으면 회원 등급이 자동으로 정해집니다.</li>' +
      '<li>가입이 끝나면 이 안내로 다시 돌아옵니다.</li></ul>';
    setState(2, DESK ? '' : 'cur');
  }

  /* ---------- ③ 앱 설치 ---------- */
  var installEv = null;
  window.addEventListener('beforeinstallprompt', function (x) { x.preventDefault(); installEv = x; });
  window.addEventListener('appinstalled', function () { installed(); });

  function installed() {
    setState(3, 'done');
    $('ag-s3-b').innerHTML = '<p>설치되었습니다. 바탕 화면의 <strong>「시화산노회」</strong> 아이콘으로 들어오시면 됩니다.</p>' + shots([IOS ? 'i4' : 'a6']);
    allDone();
  }

  function step3(loggedIn) {
    var b = $('ag-s3-b');
    if (ENV === 'app') { installed(); return; }
    if (!READY && !DESK) {
      b.innerHTML = '<p>①을 먼저 해 주세요.</p>';
      setState(3, 'todo');
      return;
    }
    if (ENV === 'and-chrome') {
      b.innerHTML =
        '<button class="btn ag-big" type="button" id="ag-inst">앱 설치하기</button>' +
        '<div class="ag-msg" id="ag-msg3" role="status"></div>' +
        shots(['a5', 'a6']) +
        more('ag-manual', '「앱 설치하기」 단추로 안 되면', shots(['a3', 'a4', 'a5']));
      $('ag-inst').addEventListener('click', install);
    } else if (ENV === 'ios-safari') {
      b.innerHTML = '<p>아이폰은 사파리 메뉴에서 설치합니다. 그림의 빨간 곳을 차례로 누르세요.</p>' + shots(['i1', 'i2', 'i3', 'i4']) +
        more('ag-ios26', '공유 단추가 안 보이면', shots(['i1b']));
    } else if (ENV === 'ios-chrome') {
      b.innerHTML = '<p>크롬 <strong>주소창 오른쪽의 공유 단추</strong>를 누르고, 아래 그림처럼 「홈 화면에 추가」 → 「추가」를 누릅니다.</p>' + shots(['i2', 'i3', 'i4']);
    } else {
      /* 컴퓨터 — 두 가지 다 보여 준다 */
      b.innerHTML = '<div class="ag-tabs" role="tablist">' +
        '<button type="button" role="tab" aria-selected="true" data-tab="and">안드로이드(갤럭시)</button>' +
        '<button type="button" role="tab" aria-selected="false" data-tab="ios">아이폰</button></div>' +
        '<div data-pane="and"><p>크롬에서 「앱 설치하기」 단추를 누르거나, 오른쪽 위 ⋮ → 「홈 화면에 추가」를 누릅니다.</p>' + shots(['a3', 'a4', 'a5', 'a6']) + '</div>' +
        '<div data-pane="ios" hidden><p>사파리 공유 단추 → 「홈 화면에 추가」 → 「추가」를 누릅니다.</p>' + shots(['i1', 'i2', 'i3', 'i4']) +
        '<p class="ag-tip">공유 단추가 없고 ⋯ 만 보이는 아이폰은 ⋯ → 「공유」를 먼저 누릅니다.</p></div>';
      b.querySelector('.ag-tabs').addEventListener('click', function (ev) {
        var t = ev.target.closest('[data-tab]');
        if (!t) return;
        [].forEach.call(b.querySelectorAll('[data-tab]'), function (x) { x.setAttribute('aria-selected', String(x === t)); });
        [].forEach.call(b.querySelectorAll('[data-pane]'), function (p) { p.hidden = p.getAttribute('data-pane') !== t.getAttribute('data-tab'); });
      });
      return;
    }
    setState(3, loggedIn ? 'cur' : '');
  }

  var busy = false;
  function install() {
    if (busy) return;
    if (installEv) {
      busy = true;
      installEv.prompt();
      installEv.userChoice.then(function (r) {
        busy = false;
        installEv = null;
        if (r.outcome === 'accepted') installed();
        else say('ag-msg3', 'warn', '설치를 취소하셨습니다. 다시 하시려면 「앱 설치하기」를 눌러 주세요.');
      }, function () { busy = false; });
      return;
    }
    say('ag-msg3', 'warn', '이미 설치되어 있을 수 있습니다. 바탕 화면에서 <strong>「시화산노회」</strong> 아이콘을 찾아보세요. ' +
      '없으면 아래 그림처럼 크롬 오른쪽 위 <strong>⋮</strong> → <strong>「홈 화면에 추가」</strong>를 눌러 주세요.');
    var d = $('ag-manual');
    if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  function allDone() {
    var d = $('ag-done');
    d.classList.add('all');
    $('ag-done-h').textContent = '다 되었습니다. 감사합니다!';
  }

  /* ---------- 로그인 확인 ---------- */
  function hasSession() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k)) return true;
      }
    } catch (x) {}
    return false;
  }
  function watchLogin() {
    if (!hasSession()) return;
    var n = 0;
    var t = setInterval(function () {
      n++;
      if (window.__shsUser) {
        clearInterval(t);
        step2(window.__shsUser);
        if (ENV !== 'app' && !$('ag-s3').classList.contains('done')) step3(true);
      } else if (n > 40) clearInterval(t);
    }, 300);
  }

  /* ---------- 복사 · 보내기 ---------- */
  function copy(text, msgId, okText) {
    function ok() { say(msgId, 'good', okText); }
    function fail() {
      window.prompt('아래 글을 길게 눌러 복사해 주세요.', text);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, fail);
    else fail();
  }
  document.addEventListener('click', function (ev) {
    var c = ev.target.closest('[data-copy]');
    if (c) {
      var link = c.getAttribute('data-copy') === 'link';
      var id = $('ag-copymsg1') && $('ag-s1').contains(c) ? 'ag-copymsg1' : 'ag-copymsg';
      copy(link ? SITE : MSG, id, link ? '링크를 복사했습니다. 카카오톡 대화방에 붙여 넣으세요.' : '안내 문구를 복사했습니다. 카카오톡 대화방에 붙여 넣으세요.');
      return;
    }
    var n = ev.target.closest('[data-next]');
    if (n) { try { sessionStorage.setItem('shs_next', 'app.html'); } catch (x) {} }
    var z = ev.target.closest('[data-zoom]');
    if (z) openZoom(z.getAttribute('data-zoom'), z);
  });
  $('ag-send').addEventListener('click', function () {
    if (navigator.share) {
      navigator.share({ title: '시화산노회 홈페이지 회원 가입 및 어플 설치 안내', text: MSG.replace(SITE, '').trim(), url: SITE }).catch(function () {});
    } else {
      copy(MSG, 'ag-sendmsg', '안내 문구와 링크를 복사했습니다. 카카오톡 대화방에 붙여 넣으세요.');
    }
  });

  /* ---------- 그림 크게 보기 ---------- */
  var zoom = $('ag-zoom'), zoomFrom = null, downOnBack = false;
  function openZoom(k, from) {
    var s = SHOT[k];
    if (!s) return;
    zoomFrom = from;
    $('ag-zoom-img').src = IMG + s[0] + '.webp';
    $('ag-zoom-img').alt = s[1];
    $('ag-zoom-cap').textContent = s[1];
    zoom.hidden = false;
    document.body.classList.add('ag-noscroll');
    $('ag-zoom-x').focus();
  }
  function closeZoom() {
    if (zoom.hidden) return;
    zoom.hidden = true;
    document.body.classList.remove('ag-noscroll');
    if (zoomFrom && document.body.contains(zoomFrom)) zoomFrom.focus();
  }
  $('ag-zoom-x').addEventListener('click', closeZoom);
  zoom.addEventListener('pointerdown', function (ev) { downOnBack = ev.target === zoom || ev.target.id === 'ag-zoom-img'; });
  zoom.addEventListener('click', function (ev) {
    if (downOnBack && (ev.target === zoom || ev.target.id === 'ag-zoom-img')) closeZoom();
    downOnBack = false;
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeZoom();
    if (ev.key === 'Tab' && !zoom.hidden) { ev.preventDefault(); $('ag-zoom-x').focus(); }
  });

  /* ---------- 시작 ---------- */
  if (DESK) $('ag-share').hidden = false;
  if (IOS) $('ag-done-ios').hidden = false;
  step1();
  step2(null);
  step3(false);
  watchLogin();
})();

/* 오늘의 노회 — QR 출석 · 명단 확정 · 거마비 · 전자투표
 *
 * 화면은 몇 초마다 서버의 assembly_state 를 불러 다시 그린다.
 * 누가 무엇을 볼 수 있는지는 서버가 정해서 내려 주므로(105_today_assembly.sql),
 * 여기서는 내려온 것만 그린다.
 *   · 회원   : 입장하기, 거마비 수령 확인, 투표
 *   · 서기   : 출석 QR 코드 생성, 명단 확정, 투표 올리기·종료, 노회 마치기
 *   · 회계   : 확정 명단에 거마비 지급 승인
 */
(function () {
  var e = SHS.esc;
  var CODE_KEY = 'shs_asm_code';
  var root, C = null, S = null, offset = 0, busy = false, pollTimer = null;
  var roster = null;          /* 서기에게 보여 줄 재적 수 */
  var qrOpen = false, qrFrom = null;
  /* 서기가 회기 상자에서 고른 노회. 고르지 않았고 주소가 #qr 이면 회기 상자 목록을 보여 준다. */
  var SEL_KEY = 'shs_asm_sel', list = null;
  function getSel() { try { return Number(sessionStorage.getItem(SEL_KEY)) || null; } catch (x) { return null; } }
  function setSel(id) { try { if (id) sessionStorage.setItem(SEL_KEY, id); else sessionStorage.removeItem(SEL_KEY); } catch (x) {} }
  var oldServer = false;
  var dayOpen = false, nextDay;
  function ymdToday() {
    var d = new Date(Date.now() + offset);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function listMode() { return !oldServer && !!(S && S.me && isClerk(S.me) && location.hash === '#qr' && !getSel()); }

  function qs(k) {
    var m = location.search.match(new RegExp('[?&]' + k + '=([^&]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  /* 출석은 회의장에서 QR을 찍어야 인정된다.
   * 휴대전화 카메라로 찍어 들어온 주소(?c=)나 화면 안 카메라로 찍은 코드만 쓰고,
   * 로그인하러 다녀오는 동안을 위해 30분만 기억한다. 손으로 적는 입장 코드는 받지 않는다. */
  var FRESH_MS = 30 * 60 * 1000;
  function saveCode(c) {
    try { localStorage.setItem(CODE_KEY, JSON.stringify({ c: c, t: Date.now() })); } catch (x) {}
  }
  function getCode() {
    var c = qs('c');
    if (c) { saveCode(c); return String(c).trim().toUpperCase(); }
    try {
      var o = JSON.parse(localStorage.getItem(CODE_KEY) || 'null');
      if (o && o.c && Date.now() - o.t < FRESH_MS) return String(o.c).trim().toUpperCase();
    } catch (x) {}
    return '';
  }
  function clearCode() { try { localStorage.removeItem(CODE_KEY); } catch (x) {} }

  function now() { return Date.now() + offset; }
  function won(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }
  function hm(t) {
    if (!t) return '';
    var d = new Date(t);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function ymdhm(t) {
    if (!t) return '';
    var d = new Date(t);
    return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate() + ' ' + hm(t);
  }
  function mmss(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60); s = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function pct(a, b) { return b ? (Math.round(a * 1000 / b) / 10) + '%' : '0%'; }

  /* 회원 구분과 그에 따른 안내 */
  var GRADE_INFO = {
    '정회원': '정회원입니다. 발언과 투표에 모두 참여할 수 있습니다.',
    '언권회원': '언권회원입니다. 발언은 할 수 있으나 투표에는 참여할 수 없습니다.',
    '준회원': '준회원입니다. 투표에는 참여할 수 없습니다.',
    '일반회원': '일반회원입니다. 노회 회원이 아니므로 입장할 수 없습니다.',
    '승인대기': '아직 노회 회원으로 확인되지 않은 계정입니다. 회원이 아니므로 입장할 수 없습니다. 서기에게 문의해 주세요.'
  };
  function gradeOf(role) {
    return role === 'advisory' ? '언권회원' : role === 'associate' ? '준회원'
         : role === 'general' ? '일반회원' : role === 'pending' ? '승인대기' : '정회원';
  }
  /* 이름 · 직분 · 소속 교회(무임이면 없음) · 회원 구분을 한 장에 보여 준다 */
  function idCard(name, position, church, grade) {
    if (grade === '회원') grade = '일반회원';
    var non = grade === '일반회원' || grade === '승인대기';
    return '<dl class="ta-id">' +
      '<div><dt>이름</dt><dd><strong>' + e(name || '') + '</strong></dd></div>' +
      '<div><dt>직분</dt><dd>' + e(position || '-') + '</dd></div>' +
      '<div><dt>소속 교회</dt><dd>' + (String(church || '').trim() ? e(church) : '없음 (무임)') + '</dd></div>' +
      '<div><dt>회원 구분</dt><dd><span class="ta-grade' + (grade === '정회원' ? ' full' : non ? ' non' : '') + '">' +
      e(grade) + '</span></dd></div></dl>' +
      '<div class="ta-gradeinfo' + (non ? ' non' : '') + '">' + e(GRADE_INFO[grade] || '') + '</div>';
  }

  function ruleName(r) { return r === '3분의2' ? '3분의 2 이상' : '과반'; }

  /* 바뀐 부분만 다시 그린다. 적어 둔 값(data-keep)은 다시 그려도 남긴다. */
  var cache = {};
  function paint(id, html) {
    if (cache[id] === html) return;
    cache[id] = html;
    var el = document.getElementById(id);
    if (!el) return;
    var keep = {};
    var focusKey = document.activeElement && document.activeElement.getAttribute &&
                   document.activeElement.getAttribute('data-keep');
    [].forEach.call(el.querySelectorAll('[data-keep]'), function (i) {
      keep[i.getAttribute('data-keep')] = i.type === 'checkbox' || i.type === 'radio' ? i.checked : i.value;
    });
    el.innerHTML = html;
    [].forEach.call(el.querySelectorAll('[data-keep]'), function (i) {
      var k = i.getAttribute('data-keep');
      if (!(k in keep)) return;
      if (i.type === 'checkbox' || i.type === 'radio') i.checked = keep[k]; else i.value = keep[k];
      if (k === focusKey) i.focus();
    });
  }

  /* ---------- 크롬으로 열기 ----------
   * QR을 찍으면 휴대전화의 기본 브라우저(삼성 인터넷 등)나 카카오톡·네이버 앱 안의
   * 화면으로 열리는 일이 많다. 구글 로그인과 앱 설치는 크롬에서 가장 잘 되므로,
   * 안드로이드에서 크롬이 아니면 크롬으로 한 번 넘겨 보고(주소의 nc=1 은 되돌아온 표시),
   * 넘어가지 못한 분에게는 「크롬으로 열기」 단추를 보여 준다. 아이폰은 사파리 그대로 둔다. */
  var UA = navigator.userAgent || '';
  var IS_ANDROID = /Android/i.test(UA);
  var IS_KAKAO = /KAKAOTALK/i.test(UA);
  var REAL_CHROME = /Chrome\//.test(UA) &&
    !/SamsungBrowser|EdgA|Whale|OPR\/|; wv\)|KAKAOTALK|NAVER|DaumApps|Instagram|FBAN|FBAV|FB_IAB|Line\//i.test(UA);
  function needChrome() { return IS_KAKAO || (IS_ANDROID && !REAL_CHROME); }
  function chromeTarget() {
    var c = getCode();
    return location.origin + location.pathname + '?' + (c ? 'c=' + encodeURIComponent(c) + '&' : '') + 'nc=1';
  }
  function openChrome() {
    var url = chromeTarget();
    if (IS_KAKAO) {
      location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
    } else {
      location.href = 'intent://' + url.replace(/^https?:\/\//, '') +
        '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' +
        encodeURIComponent(url) + ';end';
    }
  }
  function chromeBar() {
    var bar = document.getElementById('ta-chrome');
    if (!bar) return;
    if (!needChrome()) { bar.innerHTML = ''; return; }
    bar.innerHTML = '<div class="ta-chromebar"><div><strong>크롬(Chrome)으로 여는 것이 좋습니다</strong>' +
      '<div class="ta-sub">지금 화면에서는 구글 로그인이나 앱 설치가 되지 않을 수 있습니다.</div></div>' +
      '<button class="btn" type="button" id="ta-openchrome">크롬으로 열기</button></div>';
    document.getElementById('ta-openchrome').addEventListener('click', openChrome);
    /* QR을 찍고 막 들어온 때에만 한 번 스스로 넘겨 본다 */
    var tried = false;
    try { tried = !!sessionStorage.getItem('shs_asm_chrome'); sessionStorage.setItem('shs_asm_chrome', '1'); } catch (x) {}
    if (qs('c') && !qs('nc') && !tried) openChrome();
  }

  /* ---------- 서버 ---------- */
  function refresh() {
    if (!C) return Promise.resolve();
    return C.rpc('assembly_state', { p_code: getCode() || null, p_meeting: getSel() }).then(function (r) {
      /* 서버가 아직 옛 판이면(105를 다시 실행하기 전) 옛 방식으로 불러 화면은 열리게 한다 */
      if (r.error && /p_meeting|schema cache/i.test(r.error.message || '')) {
        oldServer = true;
        return C.rpc('assembly_state', { p_code: getCode() || null });
      }
      oldServer = false;
      return r;
    }).then(function (r) {
      if (r.error) { setupNeeded(r.error); return; }
      /* 노회 날인지는 시스템의 노회 일정이 정한다 (QR을 만든 날짜와 무관) */
      return Promise.all([
        C.rpc('assembly_today'),
        nextDay === undefined
          ? C.from('meetings').select('kind,meet_date').gte('meet_date', ymdToday())
              .order('meet_date', { ascending: true }).limit(1)
          : Promise.resolve(null)
      ]).then(function (rs) {
        dayOpen = !!(rs[0] && !rs[0].error && rs[0].data);
        if (rs[1]) nextDay = (rs[1].data && rs[1].data[0]) || null;
        return r;
      }, function () { return r; });
    }).then(function (r) {
      if (!r || r.error) return;
      S = r.data || {};
      if (S.now) offset = Date.parse(S.now) - Date.now();
      if (S.me && S.me.mgr && roster === null) loadRoster();
      if (S.me && isClerk(S.me) && sessions === null) loadSessions();
      if (listMode()) {
        return C.rpc('assembly_list').then(function (lr) {
          list = (lr && !lr.error && lr.data) || [];
          render();
        });
      }
      render();

    }, function () {});
  }
  function setupNeeded(err) {
    paint('ta-gate', '<div class="notice-banner" style="border-left:4px solid var(--red)">' +
      '<strong>[준비 중]</strong> 오늘의 노회 기능이 아직 서버에 설치되지 않았습니다. ' +
      '관리자가 <code>supabase/105_today_assembly.sql</code> 을 Supabase SQL Editor에서 실행하면 열립니다.' +
      '<div style="font-size:.8rem;color:var(--gray-5);margin-top:6px">' + e(err.message || '') + '</div></div>');
  }
  /* 회기 설정(사이트 관리)을 읽어, 고른 날짜에 시작하는 회기를 미리 채운다 */
  var sessions = null;
  function loadSessions() {
    sessions = false;
    C.from('site_settings').select('value').eq('key', 'sessions').then(function (r) {
      sessions = (r && r.data && r.data[0] && r.data[0].value) || false;
      fillSession(false);
    }, function () {});
  }
  function guessSession(date) {
    if (!sessions) return '';
    var hit = (sessions.list || []).filter(function (x) { return x.from === date; })[0];
    if (hit) return hit.no;
    return sessions.current ? Number(sessions.current) + 1 : '';
  }
  function fillSession(force) {
    var se = document.getElementById('ta-osess'), ti = document.getElementById('ta-otitle'),
        da = document.getElementById('ta-odate');
    if (!se || !ti) return;
    if (force || !se.value) se.value = guessSession(da.value);
    if (se.value && (!ti.value || /^제\d+회 정기노회$/.test(ti.value))) ti.value = '제' + se.value + '회 정기노회';
  }
  function loadRoster() {
    roster = false;
    C.from('roster').select('id,category,active').then(function (r) {
      if (!r || r.error || !r.data) return;
      var rows = r.data.filter(function (x) { return x.active !== false; });
      roster = {
        pastor: rows.filter(function (x) { return String(x.category || '').indexOf('목사') !== -1; }).length,
        elder: rows.filter(function (x) { return x.category === '장로'; }).length
      };
      render();
    }, function () {});
  }
  function schedule() {
    if (pollTimer) clearTimeout(pollTimer);
    var live = S && S.meeting && S.meeting.status !== 'closed' && (S.entered || (S.me && (S.me.mgr || S.me.tre)));
    pollTimer = setTimeout(function () {
      if (document.hidden || busy) { schedule(); return; }
      refresh().then(schedule);
    }, live ? 3000 : 10000);
  }

  /* 단추 하나로 서버 일을 한 번만 시킨다 (중복 제출 막기) */
  function run(btn, fn, args, after) {
    if (busy) return;
    busy = true;
    var old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '처리 중…'; }
    C.rpc(fn, args).then(function (r) {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = old; }
      if (r.error) { alert(r.error.message || '처리하지 못했습니다.'); return; }
      if (after) after(r.data);
      return refresh();
    }, function () {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = old; }
      alert('서버에 연결하지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
    });
  }

  /* ---------- 그리기 ---------- */
  function render() {
    var m = S.meeting, me = S.me || {};
    if (listMode()) {
      ['ta-head', 'ta-gate', 'ta-my', 'ta-vote', 'ta-tre', 'ta-hist'].forEach(function (id) { paint(id, ''); });
      renderList();
      return;
    }
    placeOrder(m, me);
    renderHead(m);
    if (oldServer && (me.mgr || me.tre)) {
      paint('ta-chrome', '<div class="notice-banner" style="border-left:4px solid var(--red);margin-bottom:16px">' +
        '<strong>[서버 갱신 필요]</strong> 새 기능(회기 상자·가결 기준·테스트 투표·QR 지우기)을 쓰려면 ' +
        '<code>supabase/105_today_assembly.sql</code> 의 최신 내용을 Supabase SQL Editor에서 다시 실행해 주세요.</div>');
    }
    renderGate(m, me);
    renderMy(m);
    renderVote(m, me);
    renderClerk(m, me);
    renderTre(m, me);
    tick();
  }

  /* 중요한 순서대로 놓는다.
   *   회원      : 노회 → (입장 안내) → 진행 중인 투표 → 내 정보·거마비 → 앞선 투표
   *   서기·회계 : 노회 → 진행 중인 투표 → 서기 일 → 회계 일 → 내 정보 → 앞선 투표 → (본인 입장 안내)
   * 거마비 수령 확인이 기다리고 있으면 내 정보를 투표 바로 아래로 올린다. */
  function placeOrder(m, me) {
    var admin = !!(me.mgr || me.tre);
    var due = S.my && S.my.allow_status === '지급';
    var o = admin
      ? { 'ta-head': 1, 'ta-vote': 2, 'ta-my': due ? 3 : 6, 'ta-clerk': 4, 'ta-tre': 5, 'ta-hist': 7, 'ta-gate': S.login && m ? 8 : 2 }
      : { 'ta-head': 1, 'ta-gate': 2, 'ta-vote': 3, 'ta-my': 4, 'ta-hist': 5, 'ta-clerk': 6, 'ta-tre': 7 };
    Object.keys(o).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.order = o[id];
    });
  }

  function chips(c, confirmed) {
    var t = confirmed ? c.c_total : c.total, p = confirmed ? c.c_pastor : c.pastor,
        el = confirmed ? c.c_elder : c.elder, x = confirmed ? c.c_etc : c.etc;
    return '<div class="ta-chips">' +
      '<div class="ta-chip big"><span>참석</span><strong>' + t + '</strong>명</div>' +
      '<div class="ta-chip"><span>목사</span><strong>' + p + '</strong>명</div>' +
      '<div class="ta-chip"><span>장로 총대</span><strong>' + el + '</strong>명</div>' +
      (x ? '<div class="ta-chip"><span>그 밖</span><strong>' + x + '</strong>명</div>' : '') +
      '</div>';
  }

  function renderHead(m) {
    if (!m) { paint('ta-head', ''); return; }
    var st = m.status === 'open' ? '<span class="ta-badge live">입장 중</span>'
           : m.status === 'confirmed' ? '<span class="ta-badge on">회의 진행 중 · 명단 확정</span>'
           : '<span class="ta-badge">마친 노회</span>';
    paint('ta-head', '<div class="ta-card ta-headcard">' +
      '<div class="ta-date">' + (m.session_no ? '제' + m.session_no + '회기 · ' : '') + e(String(m.meet_date || '').replace(/-/g, '.')) + '</div>' +
      '<h2>' + e(m.title) + '</h2>' + st +
      (S.counts ? chips(S.counts, false) : '') + '</div>');
  }

  function renderGate(m, me) {
    var h = '';
    if (!S.login) {
      h = '<div class="ta-card ta-center">' +
        '<h3>로그인해 주세요</h3>' +
        '<p>노회에 입장하려면 먼저 로그인해야 합니다.<br>로그인하면 이 화면으로 돌아와 <strong>입장하기</strong>를 누를 수 있습니다.</p>' +
        '<a class="btn ta-bigbtn" href="login.html">로그인</a>' +
        '<p class="ta-sub">계정이 없으시면 <a href="signup.html">회원가입</a> 후 이용해 주세요. · <a href="today-guide.html">이용 안내 보기</a></p></div>';
    } else if (!m) {
      h = '<div class="ta-card ta-center"><h3>지금 열려 있는 노회가 없습니다</h3>' +
        '<p>노회 당일, 화면이나 순서지에 있는 <strong>QR 코드</strong>를 휴대전화 카메라로 찍어 주세요.</p>' +
        '<p class="ta-sub"><a href="today-guide.html">회원가입 · 앱 설치 · 입장 방법 안내 보기</a></p></div>';
    } else if (!S.entered && m.status !== 'closed') {
      if (!dayOpen) {
        var nd = nextDay && nextDay.meet_date ? String(nextDay.meet_date).split('-') : null;
        h = '<div class="ta-card ta-center"><h3>' + e(m.title) + '</h3>' +
          '<p>오늘의 노회는 <strong>노회 당일</strong>에 열립니다.' +
          (nd ? '<br>다음 노회 : <strong>' + e(nextDay.kind || '') + ' ' + Number(nd[1]) + '월 ' + Number(nd[2]) + '일</strong>' : '') +
          '<br>당일 회의장의 QR 코드를 찍어 입장해 주세요.</p></div>';
      } else {
        var g0 = gradeOf(me.role);
        var can = !(g0 === '승인대기' || g0 === '일반회원');
        if ((me.mgr || me.tre) && !S.code_ok) {
          h = '<div class="ta-card"><h3>본인 출석</h3>' +
            '<div class="ta-sub">서기·회계도 회의장의 QR 코드를 찍어야 출석이 인정됩니다.</div>' +
            '<div class="ta-btnrow"><button class="btn" data-act="enter">입장하기 (QR 찍기)</button></div></div>';
        } else {
          h = '<div class="ta-card ta-center">' +
            '<h3>' + e(me.name || '') + '님, 환영합니다</h3>' +
            idCard(me.name, me.position, me.church, g0) +
            (!can ? '' :
              '<p>' + (S.code_ok
                ? 'QR 코드가 확인되었습니다. 내용이 맞으면 아래 단추를 눌러 주세요.'
                : '아래 <strong>입장하기</strong>를 누르면 카메라가 열립니다.<br>회의장에 있는 <strong>출석 QR 코드</strong>를 찍어야 출석이 인정됩니다.') +
              '</p><button class="btn ta-bigbtn" data-act="enter">입장하기</button>') +
            '</div>';
        }
      }
    }
    paint('ta-gate', h);
  }

  function renderMy(m) {
    var a = S.my, h = '';
    if (m && a) {
      h = '<div class="ta-card"><div class="ta-myrow"><span class="ta-check">✓</span><div>' +
        '<strong>입장했습니다</strong>' +
        '<div class="ta-sub">' + hm(a.entered_at) + ' 입장' +
        (a.confirmed ? ' · 확정 명단에 올랐습니다' : '') + '</div></div></div>' +
        idCard(a.name, a.position, a.church, a.grade);
      if (a.allow_status === '지급') {
        h += '<div class="ta-alarm"><div><span class="ta-badge live">회계 알림</span>' +
          '<div class="ta-amt">거마비 ' + won(a.allow_amount) + '</div>' +
          '<div class="ta-sub">' + e(a.allow_paid_by || '회계') + ' 회계가 지급했습니다. 받으셨으면 수령 확인을 눌러 주세요. 이 확인이 영수증을 대신합니다.</div></div>' +
          '<button class="btn ta-bigbtn" data-act="receive" data-id="' + a.id + '">수령 확인</button></div>';
      } else if (a.allow_status === '수령') {
        h += '<div class="ta-receipt"><div class="ta-rc-title">영 수 증</div>' +
          '<div class="ta-rc-row"><span>내역</span><b>' + e(m.title) + ' 거마비</b></div>' +
          '<div class="ta-rc-row"><span>금액</span><b>' + won(a.allow_amount) + '</b></div>' +
          '<div class="ta-rc-row"><span>수령인</span><b>' + e((a.name || '') + ' ' + (a.position || '')) + '</b></div>' +
          '<div class="ta-rc-row"><span>수령 확인</span><b>' + ymdhm(a.allow_received_at) + '</b></div>' +
          '<div class="ta-sub">' + (a.in_ledger ? '노회 회계 장부에 기입되었습니다.' : '수령 확인이 기록되었습니다.') + '</div></div>';
      }
      h += '</div>';
    }
    paint('ta-my', h);
  }

  function resultHtml(v) {
    var r = v.result;
    /* 입장한 정회원 가운데 투표하지 않은 사람은 기권으로 센다 */
    var abst = r.eligible != null ? Math.max(0, r.eligible - r.total) : 0;
    /* 가결 기준과 득표율은 입장한 정회원 전체(기권 포함)를 기준으로 한다 */
    var base = Math.max(r.eligible || 0, r.total);
    var h = '<div class="ta-result">' +
      '<div class="ta-r-bars three">' +
      '<div class="ta-r-all"><span>총 투표수</span><strong>' + r.total + '</strong>표<em>' +
      (r.eligible != null ? '재석 정회원 ' + r.eligible + '명 중 · ' + pct(r.total, r.eligible) : '&nbsp;') + '</em></div>' +
      '<div class="ta-r-yes"><span>찬성</span><strong>' + r.yes + '</strong>표<em>득표율 ' + pct(r.yes, base) + '</em></div>' +
      '<div class="ta-r-no"><span>반대</span><strong>' + r.no + '</strong>표<em>득표율 ' + pct(r.no, base) + '</em></div>' +
      '<div class="ta-r-abs"><span>기권</span><strong>' + abst + '</strong>명<em>' + pct(abst, base) + '</em></div></div>' +
      '<div class="ta-r-bar"><i style="width:' + (base ? r.yes * 100 / base : 0) + '%"></i></div>' +
      '<div class="ta-sub">가결 기준 — ' + (v.rule === '3분의2'
        ? '찬성이 재석 정회원 ' + base + '명의 3분의 2 이상 (' + Math.ceil(base * 2 / 3) + '표 이상)'
        : '찬성이 재석 정회원 ' + base + '명의 과반 (' + (Math.floor(base / 2) + 1) + '표 이상)') + '</div>' +
      '<div class="ta-verdict ' + (r.passed ? 'pass' : 'fail') + '">' + (r.passed ? '가 결' : '부 결') +
      (v.test ? '<small>테스트 결과</small>' : '') + '</div>';
    if (r.names && r.names.length) {
      var y = r.names.filter(function (n) { return n.choice === '찬성'; }).map(function (n) { return e(n.name); });
      var n2 = r.names.filter(function (n) { return n.choice === '반대'; }).map(function (n) { return e(n.name); });
      h += '<details class="ta-names"><summary>기명 투표 내역</summary>' +
        '<div><b>찬성</b> ' + (y.join(', ') || '없음') + '</div>' +
        '<div><b>반대</b> ' + (n2.join(', ') || '없음') + '</div></details>';
    }
    return h + '</div>';
  }

  function renderVote(m, me) {
    var v = S.vote, h = '';
    if (m && v) {
      h = '<div class="ta-card ta-votecard' + (v.test ? ' test' : '') + '">' +
        (v.test ? '<div class="ta-testbar">테스트 투표 — 연습입니다. 실제 결의가 아닙니다.</div>' : '') +
        '<div class="ta-vhead">' +
        '<span class="ta-badge ' + (v.status === '진행' ? 'live' : '') + '">' +
        (v.status === '진행' ? '투표 중' : '투표 종료') + '</span>' +
        '<span class="ta-badge">' + e(v.mode) + ' 투표</span>' +
        '<span class="ta-badge">가결 기준 ' + ruleName(v.rule) + '</span>' +
        '<span class="ta-timer" data-timer="vote"></span></div>' +
        '<h3 class="ta-vtitle">' + e(v.title) + '</h3>';
      if (v.status === '진행') {
        h += '<div class="ta-sub">지금까지 ' + v.cast + '명 투표' +
          (S.counts ? ' / 재석 정회원 ' + S.counts.full + '명' : '') + '</div>';
        if (v.voted) h += '<div class="ta-done">투표를 마쳤습니다. 결과는 투표가 종료된 뒤에 나옵니다.</div>';
        else if (S.entered && me.full) {
          h += '<div class="ta-vbtns">' +
            '<button class="ta-vbtn yes" data-act="cast" data-choice="찬성">찬성</button>' +
            '<button class="ta-vbtn no" data-act="cast" data-choice="반대">반대</button></div>' +
            (v.mode === '기명' ? '<div class="ta-sub">기명 투표입니다 — 누가 어떻게 투표했는지 결과에 표시됩니다.</div>'
                               : '<div class="ta-sub">무기명 투표입니다 — 누가 어떻게 투표했는지 기록되지 않습니다.</div>');
        } else if (S.entered) h += '<div class="ta-done">투표는 정회원만 참여할 수 있습니다.</div>';
        else h += '<div class="ta-done">입장한 정회원만 투표할 수 있습니다.</div>';
        if (me.mgr) h += '<button class="btn danger ta-endbtn" data-act="vend" data-id="' + v.id + '">투표 종료하기</button>';
      } else if (v.result) {
        h += resultHtml(v);
      } else {
        h += '<div class="ta-count"><div data-timer="count">10</div><span>초 뒤 결과가 발표됩니다</span></div>';
      }
      h += '</div>';
    }
    paint('ta-vote', h);
    h = '';
    if (m && S.history && S.history.length) {
      h += '<details class="ta-card ta-hist"><summary>앞선 투표 결과 ' + S.history.length + '건</summary>' +
        S.history.map(function (x) {
          return x.result ? '<div class="ta-histrow"><b>' + e(x.title) + '</b> <span>(' + e(x.mode) + ')</span> — 찬성 ' +
            x.result.yes + ' · 반대 ' + x.result.no +
            (x.result.eligible != null ? ' · 기권 ' + Math.max(0, x.result.eligible - x.result.total) : '') + ' → <strong class="' + (x.result.passed ? 'pass' : 'fail') + '">' +
            (x.result.passed ? '가결' : '부결') + '</strong></div>' : '';
        }).join('') + '</details>';
    }
    paint('ta-hist', h);
  }

  function qrUrl(code) {
    return location.origin + location.pathname.replace(/[^/]*$/, '') + 'today.html?c=' + code;
  }
  function qrImg(code, cell) {
    try {
      var q = qrcode(0, 'M');
      q.addData(qrUrl(code));
      q.make();
      return '<img class="ta-qr" src="' + q.createDataURL(cell || 8, 4) + '" alt="노회 출석 QR 코드">';
    } catch (x) { return '<div class="ta-err">QR 코드를 만들지 못했습니다.</div>'; }
  }

  function isClerk(me) { return me.role === 'clerk' || me.role === 'superadmin'; }

  function openForm(heading) {
    var d = new Date(now());
    var ds = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    return '<h3>' + heading + '</h3>' +
      '<p class="ta-sub">노회 회기와 날짜를 정하고 출석 QR 코드를 만듭니다. 출석 QR은 노회 날 회의장에 띄우거나 붙여 둡니다.</p>' +
      '<div class="ta-guidebox"><strong>촬요용 「앱 설치 안내」 QR</strong>' +
      '<div class="ta-sub">촬요에는 출석 QR이 아니라 이 QR을 인쇄해 주세요. 찍으면 회원가입 → 크롬으로 앱 설치 → 노회 날 입장 방법 안내가 열려, 노회 전에 미리 준비할 수 있습니다.</div>' +
      '<div class="ta-btnrow"><button class="btn" type="button" data-act="guidesave">앱 설치 안내 QR 저장 (촬요용)</button>' +
      '<a class="btn ghost" href="today-guide.html" target="_blank" rel="noopener">안내문 보기 · 인쇄</a></div></div>' +
      '<form class="ta-form" data-form="open">' +
      '<label class="ta-short">노회 회기<input data-keep="osess" id="ta-osess" type="number" min="1" max="999" inputmode="numeric" placeholder="예: 20"></label>' +
      '<label>노회 이름<input data-keep="otitle" id="ta-otitle" placeholder="예: 제20회 정기노회" maxlength="60"></label>' +
      '<label>날짜<input data-keep="odate" id="ta-odate" type="date" value="' + ds + '"></label>' +
      '<button class="btn" type="submit">QR 코드 생성</button></form>';
  }

  /* 회기 상자 목록 — <노회 출석 QR 코드 생성> 메뉴로 들어오면 먼저 보이는 화면 */
  function renderList() {
    var ST = { open: '<span class="ta-badge live">입장 받는 중</span>', confirmed: '<span class="ta-badge on">명단 확정</span>', closed: '<span class="ta-badge">마침</span>' };
    var h = '<div class="ta-card ta-admin"><div class="ta-role">서기</div><h3>회기별 출석 QR 코드</h3>';
    if (!list || !list.length) {
      h += '<div class="ta-empty">아직 만든 QR 코드가 없습니다 — 아래에서 회기를 정해 만들어 주세요.</div>';
    } else {
      h += '<div class="ta-boxes">' + list.map(function (x) {
        return '<div class="ta-box' + (x.today ? ' today' : '') + '">' +
          '<div class="ta-box-no">제' + (x.session_no || '?') + '회기</div>' +
          '<div class="ta-box-title">' + e(x.title) + '</div>' +
          '<div class="ta-sub">' + e(String(x.meet_date || '').replace(/-/g, '.')) + (x.today ? ' · <strong>오늘</strong>' : '') + '</div>' +
          '<div class="ta-box-st">' + (ST[x.status] || '') + '</div>' +
          '<div class="ta-sub">입장 ' + x.attendees + '명 · 투표 ' + x.votes + '건 · 코드 ' + e(x.code) + '</div>' +
          '<div class="ta-btnrow"><button class="btn sm" data-act="pick" data-id="' + x.id + '">열기</button>' +
          (x.votes ? '<span class="ta-badge on" title="회의에서 표결된 기록은 지울 수 없습니다">표결 기록 영구 보존</span>'
                   : '<button class="btn danger sm" data-act="delete" data-id="' + x.id + '" data-name="' + e(x.title) + '">삭제</button>') +
          '</div></div>';
      }).join('') + '</div>';
    }
    paint('ta-clerk', h + openForm('새 회기 QR 코드 만들기') + '</div>');
    fillSession(false);
  }
  function renderClerk(m, me) {
    /* 본 투표(테스트가 아닌)가 하나라도 있으면 이 노회 기록은 영구 보존 */
    var voted = !!((S.vote && !S.vote.test) || (S.history && S.history.length));
    if (!me.mgr || ((!m || m.status === 'closed') && !isClerk(me))) { paint('ta-clerk', ''); return; }
    var h = '<div class="ta-card ta-admin"><div class="ta-role">서기</div>' +
      (isClerk(me) ? '<div class="ta-back"><button class="btn ghost sm" data-act="tolist">← 회기 목록</button></div>' : '');
    if (!m || m.status === 'closed') {
      var d = new Date(now());
      var ds = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      h += '<h3 id="qr">노회 출석 QR 코드 생성</h3>' +
        '<p class="ta-sub">노회 회기와 날짜를 정하고 QR 코드를 만들면, 회원들이 QR을 찍어 입장할 수 있습니다. 미리 만들어 순서지에 인쇄해 두셔도 됩니다.</p>' +
        '<form class="ta-form" data-form="open">' +
        '<label class="ta-short">노회 회기<input data-keep="osess" id="ta-osess" type="number" min="1" max="999" inputmode="numeric" placeholder="예: 20"></label>' +
        '<label>노회 이름<input data-keep="otitle" id="ta-otitle" placeholder="예: 제20회 정기노회" maxlength="60"></label>' +
        '<label>날짜<input data-keep="odate" id="ta-odate" type="date" value="' + ds + '"></label>' +
        '<button class="btn" type="submit">QR 코드 생성</button></form>';
      if (m && !voted) h += '<div class="ta-btnrow ta-end"><button class="btn danger sm" data-act="delete">마친 「' + e(m.title) +
        '」 기록 지우기</button></div>';
    } else {
      var c = S.counts || {};
      var base = h; h = '';
      h += '<h3 id="qr">노회 출석 QR 코드' + (m.session_no ? ' <span class="ta-badge">제' + m.session_no + '회기</span>' : '') + '</h3>' +
        '<div class="ta-qrbox">' + qrImg(m.code, 5) + '<div>' +
        '<div class="ta-codebig">' + e(m.code) + '</div>' +
        '<div class="ta-sub">QR 코드 번호 — 출석은 회의장에서 이 QR을 찍어야 인정됩니다.</div>' +
        '<div class="ta-btnrow"><button class="btn" data-act="qrfull">화면에 크게 띄우기 · 인쇄</button>' +
        '<button class="btn ghost" data-act="qrsave">출석 QR 그림 저장 (회의장 게시용)</button></div>' +
        '<div class="ta-sub">출석 QR은 노회 날 회의장 화면이나 입구에만 게시해 주세요. 촬요에는 아래 「앱 설치 안내」 QR을 넣습니다.</div>' +
        '<div class="ta-btnrow"><button class="btn ghost sm" type="button" data-act="guidesave">앱 설치 안내 QR 저장 (촬요용)</button></div>' +
        '<div class="ta-sub">회원들에게 나눠 줄 <a href="today-guide.html" target="_blank" rel="noopener">이용 안내문(회원가입 · 앱 설치 · 입장 방법)</a>도 함께 인쇄해 넣어 주세요.</div>' +
        '</div></div>';

      var qrPart = h; h = '';
      /* 명단 */
      var list = S.attendees || [];
      var late = list.filter(function (a) { return !a.confirmed; }).length;
      h += '<h3>' + (m.status === 'open' ? '입장 명단' : '확정 명단') + '</h3>';
      if (roster) h += '<div class="ta-sub">재적 — 목사 회원 ' + roster.pastor + '명 · 장로 총대 ' + roster.elder + '명</div>';
      h += chips(c, m.status !== 'open');
      if (m.status === 'open') {
        h += '<div class="ta-btnrow"><button class="btn ta-bigbtn" data-act="confirm"' + (list.length ? '' : ' disabled') +
          '>명단 확정하기</button></div>' +
          '<div class="ta-sub">회의가 시작될 때 누릅니다. 확정된 명단은 회계에게 전달됩니다.</div>';
      } else {
        h += '<div class="ta-sub">' + ymdhm(m.confirmed_at) + ' 확정 · 회계에게 전달됨</div>';
        if (late) h += '<div class="ta-btnrow"><button class="btn" data-act="confirm">확정 뒤 입장한 ' + late + '명도 명단에 넣기</button></div>';
      }
      h += tableHtml(list, m);

      var listPart = h; h = '';
      /* 투표 */
      h += '<h3>전자투표</h3>';
      if (S.vote && S.vote.status === '진행') {
        h += '<div class="ta-sub">「' + e(S.vote.title) + '」 투표가 진행 중입니다. 위 투표 상자의 <strong>투표 종료하기</strong>를 누르면 10초 뒤 결과가 나옵니다.</div>';
      } else {
        h += '<form class="ta-form" data-form="vote">' +
          '<label>투표 주제<input data-keep="vtitle" id="ta-vtitle" maxlength="120" placeholder="예: 제3호 안건 — ○○교회 설립 허락의 건"></label>' +
          '<div class="ta-radio"><label><input type="radio" name="vmode" value="무기명" data-keep="vm1" checked> 무기명</label>' +
          '<label><input type="radio" name="vmode" value="기명" data-keep="vm2"> 기명</label></div>' +
          '<div class="ta-radio"><span class="ta-rlabel">가결 기준</span>' +
          '<label><input type="radio" name="vrule" value="과반" data-keep="vr1" checked> 과반</label>' +
          '<label><input type="radio" name="vrule" value="3분의2" data-keep="vr2"> 3분의 2</label></div>' +
          '<button class="btn" type="submit">투표하기</button>' +
          '<button class="btn ghost" type="button" data-act="vtest">테스트 투표하기</button></form>' +
          '<div class="ta-sub">「테스트 투표하기」는 본 투표 전에 회원들이 연습해 보는 투표입니다. 주제를 비워 두면 「테스트 투표」로 올라가고, 결과는 기록에 남지 않습니다.</div>' +
          '<div class="ta-sub">입장한 정회원(' + (c.full || 0) + '명)만 투표할 수 있습니다.</div>';
      }
      /* 입장 받는 동안: QR → 명단·확정 → 투표
       * 명단 확정 뒤  : 투표 → 확정 명단 → QR(접어 둠) */
      var votePart = h;
      h = base + (m.status === 'open'
        ? qrPart + listPart + votePart
        : votePart + listPart + '<details class="ta-fold"><summary>출석 QR 코드 다시 보기</summary>' + qrPart + '</details>');
      h += '<div class="ta-btnrow ta-end">' +
        (isClerk(me) && !voted ? '<button class="btn danger" data-act="delete">QR 코드 지우기</button>' : '') +
        '<button class="btn ghost" data-act="close">노회 마치기</button></div>' +
        (isClerk(me) && voted ? '<div class="ta-sub" style="text-align:right">회의에서 표결된 기록이 있어 이 노회의 기록은 영구 보존됩니다. (삭제 불가)</div>' : '') +
        (isClerk(me) && !voted ? '<div class="ta-sub" style="text-align:right">「QR 코드 지우기」는 연습으로 만든 노회를 입장 명단·투표·거마비 기록까지 모두 지웁니다.</div>' : '');
    }
    paint('ta-clerk', h + '</div>');
  }

  function tableHtml(list, m) {
    if (!list.length) return '<div class="ta-empty">아직 입장한 사람이 없습니다 — QR 코드를 화면에 띄워 주세요.</div>';
    return '<div class="ta-tablewrap"><table class="ta-table"><thead><tr><th>번호</th><th>이름</th><th>교회</th><th>구분</th><th>입장</th><th></th></tr></thead><tbody>' +
      list.map(function (a, i) {
        return '<tr' + (a.confirmed || m.status === 'open' ? '' : ' class="late"') + '><td>' + (i + 1) + '</td>' +
          '<td><strong>' + e(a.name || '') + '</strong> ' + e(a.position || '') + '</td><td>' + e(a.church || '') + '</td>' +
          '<td>' + e(a.grade || '') + '</td><td>' + hm(a.entered_at) +
          (a.confirmed || m.status === 'open' ? '' : ' <span class="ta-badge">확정 뒤</span>') + '</td>' +
          '<td>' + (a.allow_status ? '' : '<button class="btn ghost sm" data-act="remove" data-id="' + a.id +
            '" data-name="' + e(a.name || '') + '">빼기</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderTre(m, me) {
    if (!me.tre || !m) { paint('ta-tre', ''); return; }
    var h = '<div class="ta-card ta-admin"><div class="ta-role">회계</div><h3>거마비 지급</h3>';
    if (m.status === 'open') {
      h += '<div class="ta-empty">서기가 명단을 확정하면 이곳에 확정 명단이 전달됩니다.</div>';
    } else {
      var list = (S.attendees || []).filter(function (a) { return a.confirmed; });
      var wait = list.filter(function (a) { return !a.allow_status; });
      var paid = list.filter(function (a) { return a.allow_status; });
      var sum = 0, got = 0;
      paid.forEach(function (a) { sum += a.allow_amount || 0; if (a.allow_status === '수령') got += a.allow_amount || 0; });
      h += '<div class="ta-sub">확정 명단 ' + list.length + '명 · 지급 승인 ' + paid.length + '명 ' + won(sum) +
        ' · 수령 확인 ' + won(got) + '</div>';
      if (wait.length) {
        h += '<div class="ta-bulk"><label>한 사람 금액 <input id="ta-bulk" data-keep="bulk" type="number" min="0" step="1000" value="30000" inputmode="numeric"></label>' +
          '<button class="btn ghost sm" data-act="bulk">모두에게 적용</button>' +
          '<button class="btn ghost sm" data-act="allon">모두 선택</button>' +
          '<button class="btn ghost sm" data-act="alloff">모두 해제</button></div>' +
          '<div class="ta-tablewrap"><table class="ta-table"><thead><tr><th>지급</th><th>이름</th><th>교회</th><th>금액(원)</th></tr></thead><tbody>' +
          wait.map(function (a) {
            return '<tr><td><input type="checkbox" class="ta-pick" data-keep="pk' + a.id + '" data-id="' + a.id + '" checked aria-label="' + e(a.name || '') + ' 지급"></td>' +
              '<td><strong>' + e(a.name || '') + '</strong> ' + e(a.position || '') + '</td><td>' + e(a.church || '') + '</td>' +
              '<td><input class="ta-amtin" type="number" min="0" step="1000" inputmode="numeric" data-keep="am' + a.id + '" data-id="' + a.id + '" value="30000"></td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="ta-btnrow"><button class="btn ta-bigbtn" data-act="approve">선택한 사람에게 거마비 지급 승인</button></div>' +
          '<div class="ta-sub">체크를 풀면 지급 대상에서 빠집니다. 승인하면 받는 분에게 알림이 가고, 현금을 드린 뒤 본인이 수령 확인을 누르면 장부에 기입됩니다.</div>';
      }
      if (paid.length) {
        h += '<h3>지급 현황</h3><div class="ta-tablewrap"><table class="ta-table"><thead><tr><th>이름</th><th>교회</th><th>금액</th><th>상태</th><th></th></tr></thead><tbody>' +
          paid.map(function (a) {
            return '<tr><td><strong>' + e(a.name || '') + '</strong> ' + e(a.position || '') + '</td><td>' + e(a.church || '') + '</td>' +
              '<td>' + won(a.allow_amount) + '</td><td>' +
              (a.allow_status === '수령'
                ? '<span class="ta-badge on">수령 확인 ' + hm(a.allow_received_at) + '</span>' + (a.in_ledger ? ' 장부 기입' : ' <span class="ta-err">장부 미기입(마감)</span>')
                : '<span class="ta-badge live">수령 확인 대기</span>') + '</td>' +
              '<td>' + (a.allow_status === '지급' ? '<button class="btn ghost sm" data-act="acancel" data-id="' + a.id +
                '" data-name="' + e(a.name || '') + '">지급 취소</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      if (!list.length) h += '<div class="ta-empty">확정 명단이 비어 있습니다.</div>';
    }
    paint('ta-tre', h + '</div>');
  }

  /* ---------- 시계 ---------- */
  var asked = 0;
  function tick() {
    if (!S || !S.vote) return;
    var v = S.vote, st = Date.parse(v.started_at);
    var t = document.querySelector('[data-timer="vote"]');
    if (t) t.textContent = mmss((v.ended_at ? Date.parse(v.ended_at) : now()) - st);
    var c = document.querySelector('[data-timer="count"]');
    if (c && v.ended_at) {
      var left = 10 - Math.floor((now() - Date.parse(v.ended_at)) / 1000);
      c.textContent = Math.max(0, left);
      if (left <= 0 && Date.now() - asked > 1500 && !busy) { asked = Date.now(); refresh(); }
    }
  }

  /* ---------- QR 크게 보기 ---------- */
  function openQr(from) {
    if (qrOpen || !S.meeting || !S.meeting.code) return;
    qrOpen = true; qrFrom = from || null;
    var m = S.meeting;
    var ov = document.createElement('div');
    ov.className = 'ta-overlay'; ov.id = 'ta-overlay';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', '노회 출석 QR 코드');
    ov.innerHTML = '<div class="ta-ovbox" tabindex="-1">' +
      '<button class="ta-x" data-ov="close" aria-label="닫기">&times;</button>' +
      '<div class="ta-ovtitle">' + e(m.title) + '</div>' +
      '<div class="ta-ovsub">휴대전화 카메라로 QR 코드를 찍고 입장해 주세요</div>' +
      qrImg(m.code, 12) +
      '<div class="ta-codebig">' + e(m.code) + '</div>' +
      '<div class="ta-ovsub">시화산노회 앱 → 오늘의 노회 → 입장하기 → 이 QR을 찍어 주세요</div>' +
      '<div class="ta-btnrow ta-noprint"><button class="btn" data-ov="print">인쇄</button>' +
      '<button class="btn ghost" data-ov="close">닫기</button></div></div>';
    document.body.appendChild(ov);
    document.body.classList.add('ta-qr-open');
    var down = false;
    ov.addEventListener('mousedown', function (ev) { down = ev.target === ov; });
    ov.addEventListener('click', function (ev) {
      var a = ev.target.getAttribute && ev.target.getAttribute('data-ov');
      if (a === 'print') { window.print(); return; }
      if (a === 'close' || (down && ev.target === ov)) closeQr();
      down = false;
    });
    ov.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Tab') return;
      var f = ov.querySelectorAll('button');
      var first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
    ov.querySelector('.ta-ovbox').focus();
  }
  function closeQr() {
    var ov = document.getElementById('ta-overlay');
    if (ov) ov.remove();
    document.body.classList.remove('ta-qr-open');
    qrOpen = false;
    if (qrFrom && document.body.contains(qrFrom)) qrFrom.focus();
  }

  /* QR을 큰 PNG 그림으로 내려받는다 — 촬요(회의자료) 편집에 넣는 용도 */
  function saveQr(url, name) {
    var m = S.meeting;
    if (!url && (!m || !m.code)) return;
    try {
      var q = qrcode(0, 'M');
      q.addData(url || qrUrl(m.code));
      q.make();
      var n = q.getModuleCount(), cell = 20, pad = 4 * cell, size = n * cell + pad * 2;
      var cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      var x = cv.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, size, size);
      x.fillStyle = '#000';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        if (q.isDark(r, c)) x.fillRect(pad + c * cell, pad + r * cell, cell, cell);
      }
      var a = document.createElement('a');
      a.href = cv.toDataURL('image/png');
      a.download = name || '노회출석QR_' + (m.session_no ? '제' + m.session_no + '회_' : '') + m.code + '.png';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { alert('QR 그림을 만들지 못했습니다.'); }
  }

  /* ---------- QR 찍기 (화면 안 카메라) ---------- */
  var scan = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve();
    return new Promise(function (ok, no) {
      var sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
      sc.onload = ok; sc.onerror = no;
      document.head.appendChild(sc);
    });
  }
  function codeFrom(text) {
    var t = String(text || '');
    var m = t.match(/[?&]c=([A-Za-z0-9]{4,16})/);
    if (m && /sihwasan|today\.html/i.test(t)) return m[1].toUpperCase();
    return '';
  }
  function scanMsg(t, bad) {
    var el = document.getElementById('ta-scanmsg');
    if (el) { el.textContent = t; el.className = 'ta-ovsub' + (bad ? ' ta-err' : ''); }
  }
  function openScanner(from) {
    if (scan) return;
    scan = { from: from || null, stream: null, raf: 0, done: false };
    var ov = document.createElement('div');
    ov.className = 'ta-overlay'; ov.id = 'ta-scan';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'QR 코드 찍기');
    ov.innerHTML = '<div class="ta-ovbox" tabindex="-1">' +
      '<button class="ta-x" data-sc="close" aria-label="닫기">&times;</button>' +
      '<div class="ta-ovtitle">QR 코드를 찍으세요</div>' +
      '<div class="ta-ovsub" id="ta-scanmsg">회의장에 게시된 출석 QR 코드를 네모 안에 맞춰 주세요.</div>' +
      '<div class="ta-scanbox"><video id="ta-video" playsinline muted></video><i></i></div>' +
      '<div class="ta-btnrow"><button class="btn ghost" data-sc="close">닫기</button></div></div>';
    document.body.appendChild(ov);
    document.body.classList.add('ta-qr-open');
    var down = false;
    ov.addEventListener('mousedown', function (ev) { down = ev.target === ov; });
    ov.addEventListener('click', function (ev) {
      if ((ev.target.getAttribute && ev.target.getAttribute('data-sc') === 'close') || (down && ev.target === ov)) closeScanner();
      down = false;
    });
    ov.querySelector('.ta-ovbox').focus();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      scanMsg('이 화면에서는 카메라를 쓸 수 없습니다. 휴대전화의 기본 카메라 앱으로 회의장의 QR 코드를 찍어 주세요.', true);
      return;
    }
    var detector = null;
    try { if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (x) {}
    var ready = detector ? Promise.resolve() : loadJsQR();
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (st) {
      if (!scan) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
      scan.stream = st;
      var v = document.getElementById('ta-video');
      v.srcObject = st;
      v.play();
      var cv = document.createElement('canvas'), cx = cv.getContext('2d');
      ready.then(function () {
        var busyScan = false;
        function step() {
          if (!scan || scan.done) return;
          scan.raf = requestAnimationFrame(step);
          if (busyScan || v.readyState < 2) return;
          if (detector) {
            busyScan = true;
            detector.detect(v).then(function (rs) { busyScan = false; if (rs && rs[0]) found(rs[0].rawValue); },
                                    function () { busyScan = false; });
          } else if (window.jsQR) {
            var w = v.videoWidth, hh = v.videoHeight;
            if (!w) return;
            cv.width = w; cv.height = hh;
            cx.drawImage(v, 0, 0, w, hh);
            var r = window.jsQR(cx.getImageData(0, 0, w, hh).data, w, hh);
            if (r && r.data) found(r.data);
          }
        }
        step();
      }, function () {
        scanMsg('QR 읽기 도구를 불러오지 못했습니다. 휴대전화의 기본 카메라 앱으로 QR 코드를 찍어 주세요.', true);
      });
    }, function () {
      scanMsg('카메라를 쓸 수 없습니다. 카메라 사용을 허용하시거나, 휴대전화의 기본 카메라 앱으로 QR 코드를 찍어 주세요.', true);
    });
  }
  function found(text) {
    if (!scan || scan.done) return;
    var c = codeFrom(text);
    if (!c) { scanMsg('시화산노회 출석 QR 코드가 아닙니다. 회의장의 출석 QR 코드를 찍어 주세요.', true); return; }
    scan.done = true;
    scanMsg('QR 코드를 확인했습니다. 입장하는 중…');
    saveCode(c);
    C.rpc('assembly_enter', { p_code: c }).then(function (r) {
      closeScanner();
      if (r.error) { alert(r.error.message || '입장하지 못했습니다.'); return; }
      clearCode();
      cache = {};
      refresh();
    }, function () {
      closeScanner();
      alert('서버에 연결하지 못했습니다. 다시 눌러 주세요.');
    });
  }
  function closeScanner() {
    if (!scan) return;
    if (scan.raf) cancelAnimationFrame(scan.raf);
    if (scan.stream) scan.stream.getTracks().forEach(function (t) { t.stop(); });
    var ov = document.getElementById('ta-scan');
    if (ov) ov.remove();
    document.body.classList.remove('ta-qr-open');
    var from = scan.from;
    scan = null;
    if (from && document.body.contains(from)) from.focus();
  }

  /* ---------- 누르는 일 ---------- */
  function onClick(ev) {
    var b = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!b || b.disabled) return;
    var act = b.getAttribute('data-act'), id = Number(b.getAttribute('data-id')), m = S.meeting;
    if (act === 'enter') {
      if (S.code_ok && getCode()) run(b, 'assembly_enter', { p_code: getCode() }, clearCode);
      else openScanner(b);
    }
    else if (act === 'receive') {
      if (confirm('거마비 ' + won(S.my.allow_amount) + '을 받으셨습니까?\n수령 확인을 누르면 영수증으로 처리됩니다.')) run(b, 'assembly_allowance_receive', { p_id: id });
    }
    else if (act === 'cast') {
      var ch = b.getAttribute('data-choice');
      if (confirm('「' + ch + '」에 투표합니다. 투표한 뒤에는 바꿀 수 없습니다.')) run(b, 'assembly_vote_cast', { p_vote: S.vote.id, p_choice: ch });
    }
    else if (act === 'vend') {
      if (confirm('투표를 종료합니다. 10초 뒤 결과가 발표됩니다.')) run(b, 'assembly_vote_end', { p_vote: id });
    }
    else if (act === 'confirm') {
      if (confirm('지금 입장한 ' + (S.counts ? S.counts.total : 0) + '명으로 명단을 확정합니다.\n확정 명단은 회계에게 전달됩니다.')) run(b, 'assembly_confirm', { p_meeting: m.id });
    }
    else if (act === 'remove') {
      if (confirm(b.getAttribute('data-name') + ' 님을 명단에서 뺍니다.')) run(b, 'assembly_attendee_remove', { p_id: id });
    }
    else if (act === 'close') {
      if (confirm('노회를 마칩니다. 더 이상 입장·투표를 할 수 없습니다.\n(거마비 수령 확인은 계속할 수 있습니다)')) run(b, 'assembly_close', { p_meeting: m.id });
    }
    else if (act === 'pick') { setSel(id); cache = {}; refresh(); }
    else if (act === 'tolist') { setSel(null); if (location.hash !== '#qr') history.replaceState(null, '', location.pathname + location.search + '#qr'); cache = {}; refresh(); }
    else if (act === 'delete') {
      var dname = b.getAttribute('data-name') || m.title, did = id || m.id;
      if (confirm('「' + dname + '」의 QR 코드를 지웁니다.\n입장 명단·투표·거마비 기록과 장부에 자동 기입된 거마비까지 모두 지워지며 되돌릴 수 없습니다.') &&
          confirm('정말 지우시겠습니까? 이미 인쇄해 둔 출석 QR 코드는 더 이상 쓸 수 없게 됩니다.')) {
        run(b, 'assembly_delete', { p_meeting: did }, function () {
          clearCode(); cache = {};
          if (getSel() === did) { setSel(null); if (location.hash !== '#qr') history.replaceState(null, '', location.pathname + '#qr'); }
        });
      }
    }
    else if (act === 'qrfull') openQr(b);
    else if (act === 'qrsave') saveQr();
    else if (act === 'guidesave') saveQr('https://sihwasan.org/today-guide.html', '시화산노회_앱설치안내QR.png');
    else if (act === 'vtest') startVote(b.form, b, true);
    else if (act === 'bulk') {
      var val = document.getElementById('ta-bulk').value;
      [].forEach.call(document.querySelectorAll('.ta-amtin'), function (i) { i.value = val; });
    }
    else if (act === 'allon' || act === 'alloff') {
      [].forEach.call(document.querySelectorAll('.ta-pick'), function (i) { i.checked = act === 'allon'; });
    }
    else if (act === 'approve') {
      var items = [], sum = 0;
      [].forEach.call(document.querySelectorAll('.ta-pick'), function (i) {
        if (!i.checked) return;
        var inp = document.querySelector('.ta-amtin[data-id="' + i.getAttribute('data-id') + '"]');
        var amt = Math.floor(Number(inp && inp.value) || 0);
        if (amt > 0) { items.push({ id: Number(i.getAttribute('data-id')), amount: amt }); sum += amt; }
      });
      if (!items.length) { alert('지급할 사람을 선택하고 금액을 적어 주세요.'); return; }
      if (confirm(items.length + '명에게 모두 ' + won(sum) + '을 지급 승인합니다.\n받는 분에게 알림이 갑니다.')) {
        run(b, 'assembly_allowance_approve', { p_meeting: m.id, p_items: items });
      }
    }
    else if (act === 'acancel') {
      if (confirm(b.getAttribute('data-name') + ' 님의 거마비 지급을 취소합니다.')) run(b, 'assembly_allowance_cancel', { p_id: id });
    }
  }

  function onSubmit(ev) {
    var f = ev.target, kind = f.getAttribute && f.getAttribute('data-form');
    if (!kind) return;
    ev.preventDefault();
    var btn = f.querySelector('button[type="submit"]');
    if (kind === 'code') {
      var c = document.getElementById('ta-code').value.trim().toUpperCase();
      if (!c) return;
      try { localStorage.setItem(CODE_KEY, c); } catch (x) {}
      history.replaceState(null, '', 'today.html?c=' + encodeURIComponent(c));
      cache['ta-gate'] = null;
      refresh();
    } else if (kind === 'open') {
      var t = document.getElementById('ta-otitle').value.trim();
      if (!t) { alert('노회 이름을 적어 주세요.'); return; }
      var sn = parseInt(document.getElementById('ta-osess').value, 10);
      if (!(sn > 0)) { alert('노회 회기를 적어 주세요.'); return; }
      if (!confirm('제' + sn + '회기 「' + t + '」 (' + document.getElementById('ta-odate').value + ')\n' +
          '출석 QR 코드를 만듭니다.')) return;
      run(btn, 'assembly_open', { p_title: t, p_date: document.getElementById('ta-odate').value || null, p_session: sn });
    } else if (kind === 'vote') {
      startVote(f, btn, false);
    }
  }

  /* 투표 올리기 — test 가 참이면 연습용 테스트 투표 */
  function startVote(f, btn, test) {
    var input = document.getElementById('ta-vtitle');
    var vt = input.value.trim();
    if (!vt && test) vt = '테스트 투표';
    if (!vt) { alert('투표 주제를 적어 주세요.'); return; }
    var mode = (f.querySelector('input[name="vmode"]:checked') || {}).value || '무기명';
    var rule = (f.querySelector('input[name="vrule"]:checked') || {}).value || '과반';
    if (!confirm((test ? '[테스트 투표 — 연습]\n' : '') + '「' + vt + '」\n' + mode + ' 투표 · 가결 기준 ' +
                 ruleName(rule) + '\n투표를 시작합니다.')) return;
    run(btn, 'assembly_vote_start',
      { p_meeting: S.meeting.id, p_title: vt, p_mode: mode, p_rule: rule, p_test: !!test },
      function () { if (!test) input.value = ''; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    root = document.getElementById('ta-root');
    if (!root) return;
    getCode();
    chromeBar();
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('change', function (ev) {
      if (ev.target.id === 'ta-odate') fillSession(true);
      else if (ev.target.id === 'ta-osess') fillSession(false);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (scan) closeScanner(); else if (qrOpen) closeQr();
    });
    window.addEventListener('hashchange', function () { cache = {}; refresh(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    setInterval(tick, 250);
    if (!(window.SHSCloud && SHSCloud.enabled())) {
      root.innerHTML = '<div class="notice-banner">서버에 연결되어 있지 않아 오늘의 노회를 열 수 없습니다.</div>';
      return;
    }
    SHSCloud.init().then(function (c) {
      C = c;
      if (!C) return;
      refresh().then(schedule);
    });
  });
})();

/* 대시보드 — 로그인한 정회원이 한눈에 보는 화면
 *
 * 흩어져 있던 것을 한자리에 모은다.
 *   나의 알림 · 노회 공지 · 노회 일정
 *   내가 맡은 상비부 · 그 부서의 일정과 공지
 *   (대시보드 화면에서 <전체 보기>를 누르면 상비부 전체까지 본다)
 *   신청서류 발급 현황 · 교회상황 보고서
 *
 * 가운데 상비부 부분은 <상비부 대시보드>(js/dashboard.js)를 그대로
 * 불러 쓴다. 두 곳이 갈라져 서로 달라지는 일을 막기 위함이다.
 *
 * 로그인하지 않은 분과 정회원이 아닌 분에게는 이 화면을 보이지 않는다.
 * 부르는 쪽에서 SHSBoard.can(user) 로 먼저 가려 주면 된다.
 *
 *   SHSBoard.mount(자리, 지금 로그인한 사람)
 */
var SHSBoard = (function () {
  'use strict';

  function esc(s) { return SHS.esc(s); }
  function ymd(d) { return d.toISOString().slice(0, 10); }

  /* 이 화면을 볼 수 있는 사람인가 — 서버 로그인한 정회원 */
  function can(user) {
    return !!(user && user.cloud && SHS.isActiveMember(user) &&
              window.SHSCloud && SHSCloud.enabled());
  }

  /* full : 상비부 전체까지 보여 준다 (대시보드 화면)
   *        아니면 내가 맡은 부서만 보여 준다 (메인 화면) */
  function mount(box, user, opts) {
    if (!box) return;
    if (!can(user)) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    var full = !!(opts && opts.full);

    box.innerHTML =
      '<div class="section-title"><h2>대시보드</h2>' +
      (full ? '' : '<a class="more" href="dashboard.html">전체 보기</a>') +
      '</div>' +
      '<div id="dash-noti"></div>' +
      '<div class="dash-cols">' +
      '<section aria-label="노회 공지"><h3 class="dash-h">노회 공지</h3>' +
      '<div id="dash-notice"><p class="dash-none">불러오는 중...</p></div></section>' +
      '<section aria-label="노회 일정"><h3 class="dash-h">노회 일정</h3>' +
      '<div id="dash-sched"><p class="dash-none">불러오는 중...</p></div></section>' +
      '</div>' +
      '<div id="dash-com"></div>' +
      '<div class="dash-cols">' +
      '<section aria-label="신청서류 발급 현황"><h3 class="dash-h">신청서류 발급 현황</h3>' +
      '<div id="dash-doc"><p class="dash-none">불러오는 중...</p></div></section>' +
      '<section aria-label="교회상황 보고서"><h3 class="dash-h">교회상황 보고서</h3>' +
      '<div id="dash-report"><p class="dash-none">불러오는 중...</p></div></section>' +
      '</div>';

    /* 상비부 부분은 상비부 대시보드를 그대로 쓰되, 내가 맡은 것만 보여 준다.
     * 다른 부서의 일정과 공지까지 여기서 볼 까닭은 없다. */
    if (window.SHSDash) {
      SHSDash.mount(document.getElementById('dash-com'), user, { onlyMine: !full });
    }

    SHSCloud.init().then(function (c) {
      function soft(p) { return p.then(function (x) { return x; }, function () { return { data: null }; }); }
      var year = new Date().getFullYear();
      return Promise.all([
        soft(c.from('notifications').select('*').order('created_at', { ascending: false }).limit(30)),
        soft(c.from('site_notices').select('*')
              .order('date', { ascending: false }).order('id', { ascending: false }).limit(6)),
        soft(c.from('site_schedule').select('*').order('sort')),
        soft(c.from('doc_requests').select('*').order('id', { ascending: false }).limit(50)),
        soft(c.from('doc_issues').select('id,doc_no,doc_type,issued_on,void_yn,request_id')
              .order('id', { ascending: false }).limit(50)),
        soft(c.from('church_reports').select('year,sichal,church,updated_at').eq('year', year))
      ]);
    }).then(function (rs) {
      drawNoti((rs[0] && rs[0].data) || []);
      drawNotices((rs[1] && rs[1].data) || []);
      drawSchedule((rs[2] && rs[2].data) || []);
      drawDocs((rs[3] && rs[3].data) || [], (rs[4] && rs[4].data) || []);
      drawReports((rs[5] && rs[5].data) || []);
    }).catch(function () {});

    /* ---------- 나의 알림 ---------- */
    function drawNoti(rows) {
      var el = document.getElementById('dash-noti');
      var unread = rows.filter(function (n) { return !n.read_at; });
      var h = '<div class="noti-card' + (unread.length ? ' has' : '') + '">' +
        '<div class="noti-card-head"><span class="n-label">나의 알림</span>' +
        (unread.length
          ? '<span class="n-count">' + unread.length + '</span>' +
            '<span class="n-sub">확인하지 않은 알림이 ' + unread.length + '건 있습니다</span>'
          : '<span class="n-sub">확인하지 않은 알림이 없습니다</span>') +
        '<a class="more" href="notifications.html">알림함</a></div>';
      if (unread.length) {
        h += '<ul class="noti-card-list">' + unread.slice(0, 5).map(function (n) {
          return '<li><a href="notifications.html">' +
            (n.kind ? '<span class="n-kind">' + esc(n.kind) + '</span>' : '') +
            '<span class="n-t">' + esc(n.title) + '</span>' +
            '<span class="n-d">' + esc(String(n.created_at).slice(0, 10)) + '</span></a></li>';
        }).join('') + '</ul>' +
          (unread.length > 5
            ? '<div class="noti-card-more"><a href="notifications.html">' +
              (unread.length - 5) + '건 더 보기</a></div>' : '');
      }
      el.innerHTML = h + '</div>';
    }

    /* ---------- 노회 공지 ---------- */
    function drawNotices(rows) {
      var el = document.getElementById('dash-notice');
      if (!rows.length) rows = (SHSData.notices || []).slice(0, 6);
      if (!rows.length) { el.innerHTML = '<p class="dash-none">등록된 공지가 없습니다.</p>'; return; }
      el.innerHTML = '<ul class="notice-list">' + rows.slice(0, 6).map(function (n) {
        return '<li><span class="cat">' + esc(n.cat) + '</span>' +
          '<a href="board.html#notice">' + SHS.newTag(n.date) + esc(n.title) + '</a>' +
          '<span class="date">' + esc(n.date) + '</span></li>';
      }).join('') + '</ul>' +
        '<div class="dash-more"><a href="board.html">공지사항 더보기</a></div>';
    }

    /* ---------- 노회 일정 ---------- */
    function drawSchedule(rows) {
      var el = document.getElementById('dash-sched');
      var list = rows.length
        ? rows.map(function (s) { return { date: s.date_label, title: s.title }; })
        : (SHSData.schedule || []);
      if (!list.length) { el.innerHTML = '<p class="dash-none">잡힌 일정이 없습니다.</p>'; return; }
      el.innerHTML = '<div class="side-box"><div class="box-body">' +
        list.map(function (s) {
          return '<div class="schedule-item"><span class="d">' + esc(s.date) + '</span>' +
            '<span class="t">' + esc(s.title) + '</span></div>';
        }).join('') + '</div></div>';
    }

    /* ---------- 신청서류 발급 현황 ---------- */
    function drawDocs(reqs, issues) {
      var el = document.getElementById('dash-doc');
      var admin = SHSAuth.canManageMembers(user);
      var mine = reqs.filter(function (r) { return r.user_id === user.id; });
      var waiting = reqs.filter(function (r) { return r.status === '신청'; });
      var myIssues = issues.filter(function (x) { return !x.void_yn; });

      var h = '';

      if (admin && waiting.length) {
        h += '<div class="dash-alert"><strong>처리할 서류 신청 ' + waiting.length + '건</strong>' +
          ' <a href="documents.html#requests">지금 처리하기</a></div>';
      }

      /* 내가 낸 신청 */
      if (mine.length) {
        h += '<table class="tbl dash-tbl"><thead><tr><th style="width:104px">신청일</th>' +
          '<th>서류</th><th style="width:92px">상태</th></tr></thead><tbody>' +
          mine.slice(0, 4).map(function (r) {
            return '<tr><td>' + esc(String(r.created_at).slice(0, 10)) + '</td>' +
              '<td class="left">' + esc(r.doc_type) + '</td>' +
              '<td><span class="role-badge">' + esc(r.status) + '</span></td></tr>';
          }).join('') + '</tbody></table>';
      } else {
        h += '<p class="dash-none">신청하신 서류가 없습니다.</p>';
      }

      h += '<div class="dash-more">' +
        '<a href="request.html">서류 신청하기</a>' +
        (myIssues.length ? ' · <a href="request.html">발급된 증명서 ' + myIssues.length + '건</a>' : '') +
        (admin ? ' · <a href="documents.html">발급 대장</a>' : '') +
        '</div>';
      el.innerHTML = h;
    }

    /* ---------- 교회상황 보고서 ---------- */
    function drawReports(rows) {
      var el = document.getElementById('dash-report');
      var year = new Date().getFullYear();
      var officer = SHSAuth.isOfficer(user);
      var myChurch = user.church || '';
      var mine = rows.filter(function (r) { return r.church === myChurch; })[0];

      var h = '';
      if (myChurch) {
        h += mine
          ? '<div class="dash-ok"><strong>' + esc(myChurch) + '</strong>의 ' + year + '년 보고서를 ' +
            '제출하셨습니다. <span class="dash-dim">(' +
            esc(String(mine.updated_at || '').slice(0, 10)) + ')</span></div>'
          : '<div class="dash-alert"><strong>' + esc(myChurch) + '</strong>의 ' + year +
            '년 보고서를 아직 내지 않으셨습니다.</div>';
      } else {
        h += '<p class="dash-none">가입 정보에 소속 교회가 없어 보고서를 낼 수 없습니다.</p>';
      }

      if (officer) {
        var bySic = {};
        rows.forEach(function (r) { bySic[r.sichal] = (bySic[r.sichal] || 0) + 1; });
        var keys = Object.keys(bySic).sort();
        h += '<p class="dash-sub">' + year + '년 제출 현황 — 모두 <strong>' + rows.length + '곳</strong>' +
          (keys.length ? ' (' + keys.map(function (k) {
            return esc(k) + ' ' + bySic[k];
          }).join(' · ') + ')' : '') + '</p>';
      }

      h += '<div class="dash-more">' +
        '<a href="sichal.html#report">내 시찰에서 내기</a></div>';
      el.innerHTML = h;
    }
  }

  return { can: can, mount: mount };
})();

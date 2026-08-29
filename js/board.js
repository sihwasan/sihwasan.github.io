/* 대시보드 — 로그인한 정회원이 한눈에 보는 화면
 *
 * 흩어져 있던 것을 한자리에 모은다.
 *   나의 알림 · 노회 공지 · 노회 일정
 *   내가 맡은 부서 · 그 부서의 일정과 공지
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
    /* 최고관리자(노회 사무실 계정)는 소속 교회·시찰·부서가 없으므로
     * 개인 칸은 빼고 노회 전체 정보만 보여 준다. */
    var isSuper = user.role === 'superadmin';

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
      (isSuper ? '' :
      '<div class="dash-cols">' +
      '<section aria-label="나의 교회"><h3 class="dash-h">나의 교회</h3>' +
      '<div id="dash-church"><p class="dash-none">불러오는 중...</p></div></section>' +
      '<section aria-label="나의 상회비"><h3 class="dash-h">나의 상회비</h3>' +
      '<div id="dash-mydues"><p class="dash-none">불러오는 중...</p></div></section>' +
      '</div>') +
      '<div class="dash-cols">' +
      (isSuper ? '' :
      '<section aria-label="나의 시찰" id="dash-sichal-sec"><h3 class="dash-h">나의 시찰</h3>' +
      '<div id="dash-sichal"><p class="dash-none">불러오는 중...</p></div></section>') +
      '<section aria-label="상회비 전체" id="dash-dues-sec" class="hidden' + (isSuper ? ' span2' : '') + '">' +
      '<h3 class="dash-h">상회비 전체 <a class="more" href="officer.html#sec-%EC%83%81%ED%9A%8C%EB%B9%84-%EA%B4%80%EB%A6%AC">관리 화면</a></h3>' +
      '<div id="dash-dues-body"><p class="dash-none">불러오는 중...</p></div></section>' +
      '</div>' +
      (isSuper ? '' : '<div id="dash-com"></div>') +
      '<div class="dash-cols">' +
      '<section aria-label="신청서류 발급 현황"><h3 class="dash-h">신청서류 발급 현황</h3>' +
      '<div id="dash-doc"><p class="dash-none">불러오는 중...</p></div></section>' +
      '<section aria-label="교회상황 보고서"><h3 class="dash-h">교회상황 보고서</h3>' +
      '<div id="dash-report"><p class="dash-none">불러오는 중...</p></div></section>' +
      '</div>';

    /* 상회비: 정회원 모두에게 '나의 교회 납부 현황'을,
     * 관리자와 회계·부회계에게는 노회 전체 요약을 함께 보여 준다.
     * 내 교회는 노회 명단(roster)에서 온다 — my_dues 가 계정→명단→교회로 잇는다. */
    (function () {
      if (!user.cloud) return;
      var canDues = SHSAuth.canManageMembers(user) || user.role === 'officer';
      var duesLink = 'officer.html#sec-%EC%83%81%ED%9A%8C%EB%B9%84-%EA%B4%80%EB%A6%AC';
      /* 관리자·회계에게는 나의 시찰 옆에 전체 요약 칸을 연다.
       * 아닌 회원에게는 나의 시찰이 줄 전체를 쓴다. */
      var sicSec = document.getElementById('dash-sichal-sec');
      if (canDues) document.getElementById('dash-dues-sec').classList.remove('hidden');
      else if (sicSec) sicSec.classList.add('span2');
      var yr = new Date().getFullYear();
      var mo = new Date().getMonth() + 1;

      /* ----- 나의 상회비 (명단의 내 교회 기준) ----- */
      SHSCloud.init().then(function (c) {
        return c.rpc('my_dues', { p_year: yr });
      }).then(function (r) {
        var el = document.getElementById('dash-mydues');
        if (!el) return;
        var rows = (r && r.data) || [];
        if (!rows.length) {
          el.innerHTML = '<p class="dash-none">우리 교회는 올해 상회비 설정에 없습니다. ' +
            '궁금하신 점은 노회 회계에게 문의해 주세요.</p>';
          return;
        }
        var info = rows[0];
        var paid = {};
        rows.forEach(function (x) { if (x.out_month) paid[x.out_month] = x; });
        var months = Object.keys(paid).length;
        var sum = 0;
        rows.forEach(function (x) { if (x.out_month) sum += Number(x.out_amount || 0); });
        var dots = '';
        for (var m = 1; m <= 12; m++) {
          var pd = paid[m];
          dots += '<span class="md-dot' + (pd ? ' on' : '') + (m === mo ? ' cur' : '') + '"' +
            (pd ? ' title="' + m + '월 ' + Number(pd.out_amount || 0) + '만원 (' + (pd.out_paid_on || '') + ')"'
                : ' title="' + m + '월 미납"') + '>' + m + '</span>';
        }
        /* 이번 달까지 안 낸 달을 미납으로 본다 */
        var lateMonths = [];
        for (var lm = 1; lm <= mo; lm++) if (!paid[lm]) lateMonths.push(lm);
        var lateAmt = lateMonths.length * Number(info.out_monthly || 0);
        var lateHtml = lateMonths.length
          ? '<p class="mydues-late">' + lateMonths.join('·') + '월 미납 — <strong>' +
            lateAmt.toLocaleString('ko-KR') + '만원</strong></p>'
          : '<p class="mydues-ok">이번 달까지 미납이 없습니다.</p>';
        el.innerHTML =
          '<div class="mydues-head"><strong>' + SHS.esc(info.out_church) + '</strong>' +
          (info.out_pastor ? ' <span class="mydues-p">' + SHS.esc(info.out_pastor) + ' 목사</span>' : '') +
          ' · 월 ' + Number(info.out_monthly || 0) + '만원' +
          (info.out_closed ? ' <span class="dues-mini-closed">' + yr + '년 마감</span>' : '') + '</div>' +
          '<div class="mydues-dots">' + dots + '</div>' +
          lateHtml +
          '<p class="mydues-sum">올해 ' + months + '개월 납부 · ' + sum.toLocaleString('ko-KR') + '만원' +
          '<span class="mydues-note">납부 확인이 실제와 다르면 노회 회계에게 알려 주세요.</span></p>';
      }).catch(function () {
        var el = document.getElementById('dash-mydues');
        if (el) el.innerHTML = '<p class="dash-none">상회비 현황을 불러오지 못했습니다.</p>';
      });

      /* ----- 전체 요약 (관리자·회계) ----- */
      if (!canDues) return;
      SHSCloud.init().then(function (c) {
        return Promise.all([
          c.from('dues_rates').select('church,monthly_amount').eq('year', yr),
          c.from('dues_payments').select('church,month,amount').eq('year', yr),
          c.from('dues_closings').select('year').eq('year', yr)
        ]);
      }).then(function (rs) {
        var rates = rs[0].data || [], pays = rs[1].data || [];
        var closed = ((rs[2] || {}).data || []).length > 0;
        var el = document.getElementById('dash-dues-body');
        if (!rates.length) {
          el.innerHTML = '<p class="dash-none">' + yr + '년 상회비 설정이 아직 없습니다. ' +
            '<a href="' + duesLink + '" style="color:var(--navy);text-decoration:underline">관리 화면에서 설정</a></p>';
          return;
        }
        var monthly = 0, paid = 0, curCnt = 0, paidToDate = 0;
        var rateBy = {};
        rates.forEach(function (r2) { monthly += Number(r2.monthly_amount || 0); rateBy[r2.church] = Number(r2.monthly_amount || 0); });
        pays.forEach(function (p2) {
          var a = p2.amount != null ? Number(p2.amount) : (rateBy[p2.church] || 0);
          paid += a;
          if (p2.month <= mo) paidToDate += a;
          if (p2.month === mo) curCnt++;
        });
        var pct = monthly ? Math.round(paid / (monthly * 12) * 100) : 0;
        /* 이번 달까지 부과된 금액과 실제 낸 금액의 차이 */
        var late = Math.max(0, monthly * mo - paidToDate);
        el.innerHTML =
          '<div class="dues-mini">' +
          '<span><strong>' + curCnt + '/' + rates.length + '</strong> ' + mo + '월 납부 교회</span>' +
          '<span><strong>' + paid.toLocaleString('ko-KR') + '만</strong> 올해 납부액</span>' +
          '<span><strong>' + pct + '%</strong> 연간 납부율</span>' +
          '<span class="' + (late ? 'dues-mini-late' : '') + '"><strong>' +
          late.toLocaleString('ko-KR') + '만</strong> ' + mo + '월까지 미납</span>' +
          (closed ? '<span class="dues-mini-closed">' + yr + '년 마감됨</span>' : '') +
          '</div>' +
          '<div class="dues-mini-bar"><div style="width:' + Math.min(100, pct) + '%"></div></div>';
      }).catch(function () {
        var el = document.getElementById('dash-dues-body');
        if (el) el.innerHTML = '<p class="dash-none">상회비 현황을 불러오지 못했습니다.</p>';
      });
    })();

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
        soft(c.from('church_reports').select('year,sichal,church,updated_at').eq('year', year)),
        soft(c.from('sichal_churches').select('sichal,name,pastor,url,address,phone')),
        soft(c.from('sichals').select('name,area,head,clerk,treasurer').order('sort')),
        soft(c.rpc('my_sichal_name')),
        soft(c.from('sichal_report_submissions').select('*').eq('year', year)),
        soft(c.from('church_staff').select('church').eq('role', '시무장로'))
      ]);
    }).then(function (rs) {
      drawNoti((rs[0] && rs[0].data) || []);
      drawNotices((rs[1] && rs[1].data) || []);
      drawSchedule((rs[2] && rs[2].data) || []);
      drawDocs((rs[3] && rs[3].data) || [], (rs[4] && rs[4].data) || []);
      drawReports((rs[5] && rs[5].data) || [], (rs[9] && rs[9].data) || []);
      drawMine((rs[6] && rs[6].data) || [], (rs[7] && rs[7].data) || [],
               (rs[8] && rs[8].data) || '');
      drawDanghoi((rs[6] && rs[6].data) || [], (rs[10] && rs[10].data) || []);
    }).catch(function () {});

    /* ---------- 나의 교회 · 나의 시찰 ----------
     * 내 교회와 내 시찰이 어디인지, 누가 임원인지 한자리에서 보여 준다.
     * 교회는 노회 명단이 아니라 관내 교회(sichal_churches)에서 찾는다. */
    function drawMine(churches, sichals, sicName) {
      var myChurch = user.church || '';
      var row = churches.filter(function (x) { return x.name === myChurch; })[0] || null;
      var sic = String(sicName || (row && row.sichal) || '');
      var link = 'sichal.html?s=' + encodeURIComponent(sic);

      /* 나의 교회 (최고관리자 화면에는 이 칸이 없다) */
      var el = document.getElementById('dash-church');
      if (!el) return;
      var h = '';
      if (!myChurch) {
        h = '<p class="dash-none">가입 정보에 소속 교회가 없습니다. ' +
            '<a href="mypage.html">내 정보</a>에서 등록해 주세요.</p>';
      } else {
        h = '<div class="dash-box">' +
          '<div class="dash-box-t">' + esc(myChurch) + '</div>' +
          '<div class="dash-box-s">' +
          (sic ? esc(sic) : '시찰 미지정') +
          (row && row.pastor ? ' · 담임 ' + esc(row.pastor) : '') + '</div>' +
          (row
            ? '<dl class="dash-kv">' +
              (row.address ? '<div><dt>주소</dt><dd>' + esc(row.address) + '</dd></div>' : '') +
              (row.phone ? '<div><dt>전화</dt><dd><a href="tel:' + esc(row.phone) + '">' +
                            esc(row.phone) + '</a></dd></div>' : '') +
              (row.url ? '<div><dt>홈페이지</dt><dd><a href="' + esc(row.url) +
                          '" target="_blank" rel="noopener">' + esc(row.url) + '</a></dd></div>' : '') +
              '</dl>' +
              (!row.address && !row.phone && !row.url
                ? '<p class="dash-none">주소·연락처·홈페이지가 아직 비어 있습니다.</p>' : '')
            : '<p class="dash-none">관내 교회 명단에 이 교회가 아직 없습니다. ' +
              '노회 사무실로 알려 주시기 바랍니다.</p>');
        h += '</div><div class="dash-more">' +
          (sic ? '<a href="' + link + '#church">교회 정보 보기·고치기</a>' : '') + '</div>';
      }
      el.innerHTML = h;

      /* 나의 시찰 */
      el = document.getElementById('dash-sichal');
      var s2 = sichals.filter(function (x) { return x.name === sic; })[0] || null;
      if (!sic) {
        el.innerHTML = '<p class="dash-none">속한 시찰을 알 수 없습니다. ' +
          '노회 사무실(031-486-9993)로 알려 주시기 바랍니다.</p>';
        return;
      }
      var cnt = churches.filter(function (x) { return x.sichal === sic; }).length;
      el.innerHTML = '<div class="dash-box">' +
        '<div class="dash-box-t">' + esc(sic) + '</div>' +
        (s2 && s2.area ? '<div class="dash-box-s">' + esc(s2.area) + '</div>' : '') +
        '<dl class="dash-kv">' +
        '<div><dt>시찰장</dt><dd>' + esc((s2 && s2.head) || '-') + '</dd></div>' +
        '<div><dt>서기</dt><dd>' + esc((s2 && s2.clerk) || '-') + '</dd></div>' +
        '<div><dt>회계</dt><dd>' + esc((s2 && s2.treasurer) || '-') + '</dd></div>' +
        '<div><dt>관내 교회</dt><dd>' + cnt + '곳</dd></div>' +
        '</dl></div>' +
        '<div class="dash-more"><a href="' + link + '#church">시찰 화면으로</a>' +
        ' · <a href="' + link + '#doc">자료실</a>' +
        ' · <a href="' + link + '#minutes">회의록</a></div>';
    }

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

    /* ---------- 당회가 있는 교회 수 (관리자) ----------
     * 당회가 있는 교회 = 시무장로가 있는 조직교회 (담임은 위임목사로 표기).
     * 교회 관리에서 시무장로를 넣고 빼면 이 수가 함께 바뀐다. */
    function drawDanghoi(churches, elders) {
      if (!SHSAuth.canManageMembers(user)) return;
      var el = document.getElementById('dash-report');
      if (!el) return;
      var set = {};
      (elders || []).forEach(function (x) {
        set[String(x.church || '').replace(/\s|교회$/g, '')] = 1;
      });
      var organized = Object.keys(set).length;
      var total = (churches || []).length;
      el.insertAdjacentHTML('afterbegin',
        '<p class="dash-sub" style="margin-top:0">당회가 있는 교회(조직교회) <strong>' +
        organized + '곳</strong>' + (total ? ' / 관내 교회 ' + total + '곳' : '') +
        ' <span class="dash-dim">— 교회 관리의 시무장로 기준</span></p>');
    }

    /* ---------- 교회상황 보고서 ---------- */
    function drawReports(rows, subs) {
      subs = subs || [];
      var el = document.getElementById('dash-report');
      var year = new Date().getFullYear();
      var officer = SHSAuth.isOfficer(user);
      var myChurch = user.church || '';
      var mine = rows.filter(function (r) { return r.church === myChurch; })[0];

      var h = '';
      if (user.role === 'superadmin') {
        h += '';   /* 노회 사무실 계정은 낼 보고서가 없다 — 아래 전체 현황만 */
      } else if (myChurch) {
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

        /* 시찰이 노회 서기에게 낸 것 */
        var subMap = {};
        subs.forEach(function (x) { subMap[x.sichal] = x; });
        var sicNames = Object.keys(bySic).concat(Object.keys(subMap))
          .filter(function (x, i, a) { return a.indexOf(x) === i; }).sort();
        if (sicNames.length) {
          h += '<p class="dash-sub">시찰 제출 — ' + sicNames.map(function (k) {
            var x = subMap[k];
            return esc(k) + ' ' + (x
              ? '<strong>제출 (' + esc(String(x.submitted_at).slice(0, 10)) + ')</strong>'
              : '<span class="dash-dim">미제출</span>');
          }).join(' · ') + '</p>';
        }
      }

      h += '<div class="dash-more">' +
        '<a href="sichal.html#report">내 시찰에서 내기</a></div>';
      el.innerHTML = h;
    }
  }

  return { can: can, mount: mount };
})();

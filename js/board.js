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

    /* ---------- 화면 얼개 ----------
     * 전체 대시보드(full)는 카드 허브형 — 항목 카드를 누르면 상세가 열린다.
     * 메인 화면 요약은 예전 그대로 촘촘한 표 형태를 쓴다. */
    var LOADING = '<p class="dash-none">불러오는 중...</p>';

    /* 선으로 그린 아이콘 (참조 디자인풍) */
    function hicon(d) {
      return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.7" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
    }
    var HICONS = {
      noti: hicon('<path d="M24 8a10 10 0 0 0-10 10v7l-4 6h28l-4-6v-7a10 10 0 0 0-10-10z"/><path d="M20 33a4 4 0 0 0 8 0"/><circle cx="33" cy="11" r="4"/>'),
      notice: hicon('<path d="M8 20v8h6l14 8V12l-14 8H8z"/><path d="M33 18a8 8 0 0 1 0 12"/><path d="M37 14a14 14 0 0 1 0 20"/>'),
      sched: hicon('<rect x="8" y="12" width="32" height="28" rx="3"/><path d="M8 20h32M16 8v8M32 8v8"/><path d="M15 27h4M22 27h4M29 27h4M15 33h4M22 33h4"/>'),
      church: hicon('<path d="M10 40V24l14-10 14 10v16"/><path d="M24 6v8M20 10h8"/><path d="M20 40v-8a4 4 0 0 1 8 0v8"/><path d="M6 40h36"/>'),
      sichal: hicon('<path d="M24 42s-13-11.5-13-21a13 13 0 0 1 26 0c0 9.5-13 21-13 21z"/><circle cx="24" cy="21" r="5"/>'),
      mydues: hicon('<circle cx="20" cy="20" r="11"/><path d="M15 20h10M15 24h10M17 15l3 6 3-6"/><path d="M31 15a11 11 0 1 1-9 17"/>'),
      com: hicon('<circle cx="17" cy="17" r="6"/><circle cx="33" cy="19" r="5"/><path d="M6 38a11 11 0 0 1 22 0"/><path d="M28 38a9 9 0 0 1 14-7"/>'),
      doc: hicon('<path d="M14 6h14l8 8v28H14z"/><path d="M28 6v8h8"/><path d="M19 22h10M19 28h10M19 34h6"/>'),
      report: hicon('<rect x="12" y="8" width="24" height="34" rx="3"/><path d="M19 6h10v6H19z"/><path d="M18 22h12M18 28h12M18 34h8"/>'),
      dues: hicon('<path d="M8 40h32"/><rect x="11" y="26" width="6" height="14"/><rect x="21" y="18" width="6" height="22"/><rect x="31" y="10" width="6" height="30"/>')
    };

    function hubCard(id, title, sub, extra) {
      return '<button type="button" class="hub-card' + (extra && extra.hidden ? ' hidden' : '') +
        '" data-hub="' + id + '"' + (extra && extra.cid ? ' id="' + extra.cid + '"' : '') + '>' +
        (extra && extra.badge ? '<span class="hub-badge hidden" id="' + extra.badge + '"></span>' : '') +
        HICONS[id] +
        '<span class="hc-t"><span>' + title +
        (sub ? '<span class="hc-s">' + sub + '</span>' : '') + '</span>' +
        '<span class="hc-arrow">&#8594;</span></span></button>';
    }

    /* 메인 화면과 전체 대시보드 모두 카드 허브형으로 그린다 */
    {
      var cards = '';
      cards += hubCard('noti', '나의 알림', '', { badge: 'hub-badge-noti' });
      cards += hubCard('notice', '노회 공지', '');
      cards += hubCard('sched', '노회 일정', '');
      if (!isSuper) {
        cards += hubCard('church', '나의 교회', '');
        cards += hubCard('sichal', '나의 시찰', '납부 현황');
        cards += hubCard('mydues', '나의 상회비', '세례의무금');
        cards += hubCard('com', '내가 맡은 부서', '');
      }
      cards += hubCard('doc', '서류 발급', '');
      cards += hubCard('report', '교회상황 보고서', '');
      cards += hubCard('dues', '상회비 전체', '관리 현황', { hidden: true, cid: 'hub-card-dues' });

      box.innerHTML =
        '<div id="hub-home" class="dash-hub">' +
        '<div class="hub-left">' +
        '<div class="hub-label">&#10013; Dashboard</div>' +
        '<h2 class="hub-title">' + esc(SHS.honorific(user)) + ',<br>시화산노회의 <strong>소식과 현황</strong>을<br>확인해보세요.</h2>' +
        '<p class="hub-sub">알림 · 일정 · 납부 현황 · 서류를 한자리에 모았습니다.</p>' +
        '</div>' +
        '<div class="hub-grid">' + cards + '</div>' +
        '</div>' +
        '<div id="hub-detail" class="hidden">' +
        '<div class="hub-detail-head">' +
        '<button type="button" class="btn ghost sm" id="hub-back">&#8592; 대시보드</button>' +
        '<h2 id="hub-detail-title" style="margin:0"></h2></div>' +
        '<div class="hub-panel hidden" data-hp="noti"><div id="dash-noti"></div></div>' +
        '<div class="hub-panel hidden" data-hp="notice"><div id="dash-notice">' + LOADING + '</div></div>' +
        '<div class="hub-panel hidden" data-hp="sched"><div id="dash-sched">' + LOADING + '</div></div>' +
        (isSuper ? '' :
          '<div class="hub-panel hidden" data-hp="church"><div id="dash-church">' + LOADING + '</div></div>' +
          '<div class="hub-panel hidden" data-hp="sichal"><div id="dash-sichal">' + LOADING + '</div></div>' +
          '<div class="hub-panel hidden" data-hp="mydues"><div id="dash-mydues">' + LOADING + '</div>' +
          '<h3 class="dash-h" style="margin-top:14px">나의 세례의무금</h3>' +
          '<div id="dash-mybap">' + LOADING + '</div></div>' +
          '<div class="hub-panel hidden" data-hp="com"><div id="dash-com"></div></div>') +
        '<div class="hub-panel hidden" data-hp="doc"><div id="dash-doc">' + LOADING + '</div></div>' +
        '<div class="hub-panel hidden" data-hp="report"><div id="dash-report">' + LOADING + '</div></div>' +
        '<div class="hub-panel hidden" data-hp="dues"><section id="dash-dues-sec" class="hidden">' +
        '<p class="dash-more" style="margin-top:0"><a href="officer.html#sec-%EC%83%81%ED%9A%8C%EB%B9%84-%EA%B4%80%EB%A6%AC">관리 화면으로</a></p>' +
        '<div id="dash-dues-body">' + LOADING + '</div></section></div>' +
        '</div>';

      var HUB_TITLES = {
        noti: '나의 알림', notice: '노회 공지', sched: '노회 일정', church: '나의 교회',
        sichal: '나의 시찰 · 납부 현황', mydues: '나의 상회비 · 세례의무금',
        com: '내가 맡은 부서', doc: '서류 발급', report: '교회상황 보고서', dues: '상회비 전체'
      };
      /* 상세로 들어가면 주소 뒤에 #hub-항목 이 붙어, 브라우저의
       * <뒤로 가기>를 눌러도 이전 단계(허브)로 돌아온다. */
      function showHub(id) {
        var panel = id && box.querySelector('.hub-panel[data-hp="' + id + '"]');
        if (!panel) {
          document.getElementById('hub-detail').classList.add('hidden');
          document.getElementById('hub-home').classList.remove('hidden');
          return;
        }
        document.getElementById('hub-home').classList.add('hidden');
        document.getElementById('hub-detail').classList.remove('hidden');
        box.querySelectorAll('.hub-panel').forEach(function (p) {
          p.classList.toggle('hidden', p.dataset.hp !== id);
        });
        document.getElementById('hub-detail-title').textContent = HUB_TITLES[id] || '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      function hubFromHash() {
        var m = (location.hash || '').match(/^#hub-([a-z]+)$/);
        showHub(m ? m[1] : null);
      }
      box.querySelectorAll('.hub-card').forEach(function (b) {
        b.addEventListener('click', function () { location.hash = 'hub-' + b.dataset.hub; });
      });
      document.getElementById('hub-back').addEventListener('click', function () {
        if (/^#hub-/.test(location.hash)) history.back();
        else showHub(null);
      });
      window.addEventListener('hashchange', hubFromHash);
      hubFromHash();
    }

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
      if (canDues) {
        var duesSec = document.getElementById('dash-dues-sec');
        if (duesSec) duesSec.classList.remove('hidden');
        var duesCard = document.getElementById('hub-card-dues');
        if (duesCard) duesCard.classList.remove('hidden');
      } else if (sicSec) sicSec.classList.add('span2');
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

      /* ----- 나의 세례의무금 (해마다 한 번 총회에 내는 세례교인헌금) ----- */
      SHSCloud.init().then(function (c) {
        return Promise.all([
          c.from('bapdues').select('*').in('year', [yr, yr - 1])
            .then(function (x) { return x; }, function () { return { data: [] }; }),
          c.from('site_settings').select('*').in('key', ['bapdues_pay', 'bapdues_deadline'])
            .then(function (x) { return x; }, function () { return { data: [] }; })
        ]);
      }).then(function (rs) {
        var el = document.getElementById('dash-mybap');
        if (!el) return;
        var all = (rs[0] && rs[0].data) || [];
        var pay = {}, deadlines = {};
        ((rs[1] && rs[1].data) || []).forEach(function (x) {
          if (x.key === 'bapdues_pay' && x.value) pay = x.value;
          if (x.key === 'bapdues_deadline' && x.value) deadlines = x.value;
        });
        function key(s) { return String(s || '').replace(/\s|교회$/g, ''); }
        var myKey = key(user.church || '');
        if (!myKey || !all.length) {
          el.innerHTML = '<p class="dash-none">세례의무금 자료가 아직 없습니다.</p>';
          return;
        }
        var bapYr = all.some(function (b) { return b.year === yr && key(b.church) === myKey; }) ? yr : yr - 1;
        var mine = all.filter(function (b) { return b.year === bapYr && key(b.church) === myKey; })[0];
        if (!mine) {
          el.innerHTML = '<p class="dash-none">우리 교회는 올해 세례의무금 배정에 없습니다. ' +
            '궁금하신 점은 노회 회계에게 문의해 주세요.</p>';
          return;
        }
        var target = Number(mine.target || 0), paidAmt = Number(mine.paid || 0);
        var done = target > 0 && paidAmt >= target;
        var part = paidAmt > 0 && !done;
        var state = done
          ? '<span class="mydues-ok" style="display:inline">납부 완료' +
            (mine.paid_on ? ' (' + SHS.esc(mine.paid_on) + ')' : '') + '</span>'
          : (part
            ? '<span style="color:#b0731f">일부 납부 — ' + paidAmt.toLocaleString('ko-KR') + '원 / 잔액 ' +
              Math.max(0, target - paidAmt).toLocaleString('ko-KR') + '원</span>'
            : '<span class="mydues-late" style="display:inline;margin:0">미납</span>');
        el.innerHTML =
          '<div class="mydues-head"><strong>' + SHS.esc(mine.church) + '</strong>' +
          ' · ' + bapYr + '년' + (bapYr !== yr ? ' <span style="color:var(--gray-5)">(지난해 배정 기준)</span>' : '') +
          ' · 세례교인 ' + Number(mine.members || 0) + '명</div>' +
          '<p style="margin:4px 0">배정액 <strong>' + target.toLocaleString('ko-KR') + '원</strong> — ' + state + '</p>' +
          (function () {
            /* 시행기한과 남은 기간 (총회 공문) */
            var dl = deadlines[String(bapYr)];
            if (!dl) return '';
            var dld = new Date(dl + 'T00:00:00');
            var left = Math.round((dld - new Date().setHours(0, 0, 0, 0)) / 86400000);
            var dlTxt = dld.getFullYear() + '년 ' + (dld.getMonth() + 1) + '월 ' + dld.getDate() + '일';
            if (done) return '<p style="font-size:0.85rem;margin:4px 0;color:var(--gray-5)">시행기한 ' + dlTxt + '</p>';
            return '<p style="font-size:0.85rem;margin:4px 0">시행기한 <strong>' + dlTxt + '</strong> — ' +
              (left > 0 ? '<strong style="color:' + (left <= 14 ? '#b0731f' : 'var(--navy)') + '">' + left + '일 남음</strong>'
                : (left === 0 ? '<strong style="color:#a33">오늘까지</strong>'
                              : '<strong style="color:#a33">' + (-left) + '일 지남</strong>')) + '</p>';
          })() +
          (pay.account
            ? '<p style="font-size:0.85rem;margin:4px 0">납부 계좌: <strong>' +
              SHS.esc((pay.bank || '') + ' ' + pay.account + ' (' + (pay.holder || '') + ')') + '</strong></p>'
            : '') +
          '<p class="mydues-sum" style="margin-top:4px"><span class="mydues-note">해마다 한 번 총회에 내는 세례교인헌금입니다. ' +
          '납부 확인이 실제와 다르면 노회 회계에게 알려 주세요.</span></p>';
      }).catch(function () {
        var el = document.getElementById('dash-mybap');
        if (el) el.innerHTML = '<p class="dash-none">세례의무금 현황을 불러오지 못했습니다.</p>';
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
          (sic ? '<a href="' + link + '&ch=' + encodeURIComponent(myChurch) +
            '#church">교회 정보 보기·고치기</a>' : '') + '</div>';
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
        '</dl>' +
        '<div id="dash-sicfin"><p class="dash-none">시찰별 납부 현황을 불러오는 중...</p></div>' +
        '</div>' +
        '<div class="dash-more"><a href="' + link + '#church">시찰 화면으로</a>' +
        ' · <a href="' + link + '#doc">자료실</a>' +
        ' · <a href="' + link + '#minutes">회의록</a></div>';
      loadSicFin(sic);
    }

    /* ---------- 시찰별 납부 현황 (상회비 · 세례의무금) ----------
     * 서버 함수(49 sichal_finance)가 시찰별로 모아 준다.
     * 시찰 이름을 누르면 그 시찰의 교회별 상세가 열린다. */
    function loadSicFin(mySic) {
      var box = document.getElementById('dash-sicfin');
      if (!box) return;
      var yr = new Date().getFullYear();
      var mo = new Date().getMonth() + 1;
      var ORDER = ['북부시찰', '상록시찰', '남부시찰', '기타'];

      function wonf(n) { return Number(n || 0).toLocaleString('ko-KR'); }
      function bar(pct, color) {
        return '<div style="background:var(--gray-2,#e8eaef);border-radius:3px;height:7px;overflow:hidden">' +
          '<div style="height:100%;width:' + Math.min(100, pct) + '%;background:' + color + '"></div></div>';
      }

      SHSCloud.init().then(function (c) {
        return c.rpc('sichal_finance', { p_year: yr });
      }).then(function (r) {
        var rows = (r && r.data) || [];
        if (r && r.error) throw r.error;
        if (!rows.length) { box.innerHTML = ''; return; }
        function ord(s) { var i = ORDER.indexOf(s); return i < 0 ? 99 : i; }
        rows.sort(function (a, b) {
          return ord(a.out_sichal) - ord(b.out_sichal) ||
            String(a.out_sichal).localeCompare(b.out_sichal, 'ko');
        });

        var h = '<div style="border-top:1px solid var(--gray-2,#e8eaef);margin-top:12px;padding-top:10px">' +
          '<div style="font-size:0.85rem;font-weight:700;color:var(--navy);margin-bottom:8px">' +
          yr + '년 납부 현황 <span style="font-weight:400;color:var(--gray-5);font-size:0.76rem">' +
          '시찰 이름을 누르면 교회별 상세가 열립니다</span></div>';

        /* 노회 전체 진행률 */
        var tDuesPlan = 0, tDuesPaid = 0, tBapTarget = 0, tBapPaid = 0, tBapJoin = 0, tBapN = 0;
        rows.forEach(function (x) {
          tDuesPlan += Number(x.out_dues_plan || 0); tDuesPaid += Number(x.out_dues_paid || 0);
          tBapTarget += Number(x.out_bap_target || 0); tBapPaid += Number(x.out_bap_paid || 0);
          tBapJoin += Number(x.out_bap_join || 0); tBapN += Number(x.out_bap_churches || 0);
        });
        var tDuesDue = tDuesPlan / 12 * mo;
        var tDuesPct = tDuesDue ? Math.round(tDuesPaid / tDuesDue * 100) : 0;
        var tBapPct = tBapTarget ? Math.round(tBapPaid / tBapTarget * 100) : 0;
        h += '<div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--gray-2,#e8eaef)">' +
          '<span style="font-size:0.85rem;font-weight:700;color:var(--navy)">노회 전체</span>' +
          '<div style="display:flex;gap:10px;margin-top:4px;flex-wrap:wrap">' +
          '<div style="flex:1 1 130px;min-width:120px">' +
          '<div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--gray-6)">' +
          '<span>상회비</span><span><strong>' + tDuesPct + '%</strong> <span style="color:var(--gray-5)">(' +
          wonf(tDuesPaid) + '만원)</span></span></div>' + bar(tDuesPct, '#5d5041') + '</div>' +
          '<div style="flex:1 1 130px;min-width:120px">' +
          '<div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--gray-6)">' +
          '<span>세례의무금</span><span><strong>' + tBapPct + '%</strong> <span style="color:var(--gray-5)">(' +
          tBapJoin + '/' + tBapN + '곳)</span></span></div>' + bar(tBapPct, '#b9974e') + '</div>' +
          '</div></div>';
        /* 시찰별 막대는 내가 속한 시찰만 보여 준다 */
        rows.filter(function (x) { return x.out_sichal === mySic; }).forEach(function (x) {
          /* 상회비: 이번 달까지 부과된 금액 대비 납부율 */
          var duesDue = Number(x.out_dues_plan || 0) / 12 * mo;
          var duesPct = duesDue ? Math.round(Number(x.out_dues_paid || 0) / duesDue * 100) : 0;
          var bapPct = Number(x.out_bap_target || 0)
            ? Math.round(Number(x.out_bap_paid || 0) / Number(x.out_bap_target) * 100) : 0;
          var isMine = x.out_sichal === mySic;
          h += '<div style="margin-bottom:9px' + (isMine ? ';background:var(--gray-1,#f4f6fa);border-radius:6px;padding:6px 8px' : '') + '">' +
            '<a href="#" data-sicfin="' + esc(x.out_sichal) + '" ' +
            'style="font-size:0.85rem;font-weight:700;color:var(--navy);text-decoration:underline">' +
            esc(x.out_sichal) + '</a>' +
            (isMine ? ' <span style="font-size:0.72rem;color:var(--gold,#b9974e)">나의 시찰</span>' : '') +
            '<div style="display:flex;gap:10px;margin-top:4px;flex-wrap:wrap">' +
            '<div style="flex:1 1 130px;min-width:120px">' +
            '<div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--gray-6)">' +
            '<span>상회비</span><span>' + duesPct + '% <span style="color:var(--gray-5)">(' +
            wonf(x.out_dues_paid) + '만원)</span></span></div>' + bar(duesPct, '#5d5041') + '</div>' +
            '<div style="flex:1 1 130px;min-width:120px">' +
            '<div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--gray-6)">' +
            '<span>세례의무금</span><span>' + bapPct + '% <span style="color:var(--gray-5)">(' +
            x.out_bap_join + '/' + x.out_bap_churches + '곳)</span></span></div>' + bar(bapPct, '#b9974e') + '</div>' +
            '</div>' +
            '<div class="hidden" data-sicdetail="' + esc(x.out_sichal) + '" style="margin-top:6px"></div>' +
            '</div>';
        });
        h += '<p style="font-size:0.7rem;color:var(--gray-5);margin:2px 0 0">상회비는 이번 달까지 부과된 금액 대비, ' +
          '세례의무금은 올해 목표금액 대비 납부율입니다.</p></div>';
        box.innerHTML = h;

        box.querySelectorAll('a[data-sicfin]').forEach(function (a) {
          a.addEventListener('click', function (ev) {
            ev.preventDefault();
            var name = a.dataset.sicfin;
            var det = box.querySelector('[data-sicdetail="' + name + '"]');
            if (!det) return;
            if (!det.classList.contains('hidden')) { det.classList.add('hidden'); return; }
            det.classList.remove('hidden');
            if (det.dataset.loaded) return;
            det.innerHTML = '<p class="dash-none">불러오는 중...</p>';
            SHSCloud.init().then(function (c) {
              return c.rpc('sichal_finance_detail', { p_year: yr, p_sichal: name });
            }).then(function (r2) {
              det.dataset.loaded = '1';
              var list = (r2 && r2.data) || [];
              if (!list.length) { det.innerHTML = '<p class="dash-none">자료가 없습니다.</p>'; return; }
              var t = '<div style="overflow-x:auto"><table class="tbl" style="font-size:0.78rem">' +
                '<thead><tr><th class="left">교회</th><th>상회비<br>(납부/이번 달)</th>' +
                '<th>세례의무금<br>(납입/목표)</th><th>상태</th></tr></thead><tbody>';
              list.forEach(function (d) {
                var bapDone = Number(d.out_bap_target) > 0 && Number(d.out_bap_paid) >= Number(d.out_bap_target);
                var bapPart = Number(d.out_bap_paid) > 0 && !bapDone;
                var late = Math.max(0, mo - Number(d.out_months || 0));
                t += '<tr><td class="left">' + esc(d.out_church) + '</td>' +
                  '<td>' + d.out_months + '/' + mo + '개월' +
                  (Number(d.out_monthly) ? ' · ' + wonf(d.out_dues_paid) + '만원' : '') + '</td>' +
                  '<td>' + wonf(d.out_bap_paid) + ' / ' + wonf(d.out_bap_target) + '원</td>' +
                  '<td>' +
                  (late > 0 ? '<span style="color:#b0731f">상회비 ' + late + '개월 미납</span>'
                            : '<span style="color:#2a7a2a">상회비 완납</span>') + '<br>' +
                  (bapDone ? '<span style="color:#2a7a2a">세례의무금 완납</span>'
                    : (bapPart ? '<span style="color:#b0731f">세례의무금 일부</span>'
                               : '<span style="color:var(--gray-5)">세례의무금 미납</span>')) +
                  '</td></tr>';
              });
              t += '</tbody></table></div>';
              det.innerHTML = t;
            }).catch(function () {
              det.innerHTML = '<p class="dash-none">상세를 불러오지 못했습니다.</p>';
            });
          });
        });
      }).catch(function () {
        box.innerHTML = '';
      });
    }

    /* ---------- 나의 알림 ---------- */
    function drawNoti(rows) {
      var el = document.getElementById('dash-noti');
      var unread = rows.filter(function (n) { return !n.read_at; });
      /* 허브 카드의 안 읽은 알림 수 배지 */
      var badge = document.getElementById('hub-badge-noti');
      if (badge) {
        badge.textContent = unread.length;
        badge.classList.toggle('hidden', !unread.length);
      }
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

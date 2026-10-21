/* 상회비 3개월 이상 미납 — 납부촉구 공문 · 월례회 보고서 (supabase/137_dues_notice.sql)
 *
 * 노회규칙 제28조(상회비 납부)·제29조(상회비 미납 규정)
 *   · 기한(그 달 말)이 지난 미납이 3개월 이상인 교회 — 135 의 dues29_churches(연도) 를 그대로 쓴다
 *     (이번 달은 아직 기한 전, 지난달분은 유예일(기본 3일) 뒤부터 미납으로 센다).
 *   · 교회를 누르면 그 교회 당회장께 보내는 납부촉구 공문이 저절로 만들어진다.
 *     인쇄·PDF 저장, 받는 곳 주소(교회 주소 → 없으면 담임목사 주소)와 봉투용 주소 쪽.
 *   · 공문 발송은 서기가 한다 — 「발송 기록」(dues_notices)을 남기면 회계·노회장에게 알림이 간다.
 *   · 회계는 월례회 때 「3개월 이상 미납 보고서」를 만들어 보고한다(dues_reports) —
 *     회계·서기·노회장이 알림으로 받고, 서기는 아직 공문을 보내지 않은 교회에 발송한다.
 *
 * 쓰는 곳: officer.html 상회비 관리 (SHSDuesNotice.mount(slot, { year, user }))
 * 137 sql 을 실행하기 전에도 공문 만들기·인쇄·PDF 는 된다 (발송 기록·보고만 막힌다).
 */
var SHSDuesNotice = (function () {
  'use strict';

  var MIN_MONTHS = 3;                /* 납부촉구 공문 대상 — 기한 지난 미납 3개월 이상 */
  var OFFICE = {
    addr: '경기도 안산시 단원구 와동공원로1안길 13-7 (반월교회 교육관 1층)',
    tel: '031-486-9993', fax: '031-486-9993', site: 'sihwasan.org'
  };
  var FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

  /* ---------- 작은 도구 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseYmd(s) {
    var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  function koDate(d, dow) {
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일' + (dow ? '(' + DOW[d.getDay()] + ')' : '');
  }
  function koDate0(d) { return d.getFullYear() + '년 ' + pad2(d.getMonth() + 1) + '월 ' + pad2(d.getDate()) + '일'; }
  function dots(d) { return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.'; }
  function manwon(n) { return Number(n || 0).toLocaleString('ko-KR') + '만원'; }
  function won(n) { return (Number(n || 0) * 10000).toLocaleString('ko-KR') + '원'; }
  function normChurch(s) { return String(s || '').replace(/\s/g, '').replace(/교회$/, ''); }
  function churchName(s) { s = String(s || '').trim(); return /교회$/.test(s) ? s : s + '교회'; }
  function firstName(s) { return String(s || '').trim().split(/[\s(]/)[0] || ''; }
  function isActing(p) { return /\(\s*임\s*\)|임시/.test(String(p || '')); }
  function monthsLabel(fy, months) {
    var ms = (months || []).slice();
    if (!ms.length) return '';
    var hasNext = ms.some(function (m) { return m < 4; });
    if (!hasNext) return fy + '년 ' + ms.join('·') + '월';
    var a = ms.filter(function (m) { return m >= 4; }), b = ms.filter(function (m) { return m < 4; });
    return (a.length ? fy + '년 ' + a.join('·') + '월, ' : '') + (fy + 1) + '년 ' + b.join('·') + '월';
  }
  /* 미리 보기의 A4 종이를 창 폭에 맞춰 줄인다 (인쇄·PDF 는 따로 만든 원래 크기) */
  function fitPreview(box) {
    if (!box || !box.isConnected) return;
    var w = box.clientWidth - 32;
    var z = w > 0 ? Math.min(1, w / 794) : 1;
    box.querySelectorAll('.dn-paper').forEach(function (pp) { pp.style.zoom = z < 1 ? String(Math.round(z * 1000) / 1000) : ''; });
  }
  function fitOnResize(box) {
    function on() { if (!box.isConnected) { window.removeEventListener('resize', on); return; } fitPreview(box); }
    window.addEventListener('resize', on);
  }
  function kstMonth() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }

  var pdfLoading = null;
  function loadPdfTool() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    if (pdfLoading) return pdfLoading;
    pdfLoading = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js';
      sc.onload = function () { resolve(window.html2pdf); };
      sc.onerror = function () { pdfLoading = null; reject(new Error('PDF 도구를 불러오지 못했습니다.')); };
      document.head.appendChild(sc);
    });
    return pdfLoading;
  }

  /* ---------- 누가 ---------- */
  function isViewer(u) {
    if (!u) return false;
    if (['president', 'clerk', 'staff', 'superadmin'].indexOf(u.role) !== -1) return true;
    var t = String(u.title || '').trim();
    return u.role === 'officer' && (t === '회계' || t === '부회계');
  }
  function isReporter(u) {   /* 보고서 쓰기 — 관리자·회계 (is_dues_manager) */
    if (!u) return false;
    if (['president', 'clerk', 'staff', 'superadmin'].indexOf(u.role) !== -1) return true;
    return u.role === 'officer' && String(u.title || '').trim() === '회계';
  }
  function isSender(u) { return !!u && (u.role === 'clerk' || u.role === 'superadmin'); }   /* 발송 — 서기 */

  /* ---------- 모양 (한 번만 넣는다) ---------- */
  function ensureStyle() {
    if (document.getElementById('dn-style')) return;
    var st = document.createElement('style');
    st.id = 'dn-style';
    st.textContent =
      '.dn-tbl td.dn-ch{cursor:pointer;color:var(--navy);font-weight:700;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px}' +
      '.dn-tbl td, .dn-tbl th{white-space:nowrap}.dn-tbl td.left{white-space:normal}.dn-tbl .btn,.dn-ov .btn{user-select:none}' +
      '.dn-sent{color:#2c7a3f;font-size:0.84rem}.dn-unsent{color:var(--red,#b03a3a);font-size:0.84rem;font-weight:600}' +
      '.dn-ov{position:fixed;inset:0;background:rgba(20,18,15,0.55);z-index:2000;overflow:auto;padding:24px 14px;overscroll-behavior:contain}' +
      '.dn-box{background:var(--white,#fff);max-width:1240px;margin:0 auto;border-radius:12px;padding:18px 18px 22px;box-shadow:0 10px 36px rgba(0,0,0,0.3)}' +
      '.dn-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}' +
      '.dn-top h3{margin:0;flex:1 1 auto;color:var(--navy)}' +
      '.dn-wrap{display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);gap:20px;align-items:start}' +
      '@media (max-width:960px){.dn-wrap{grid-template-columns:minmax(0,1fr)}}' +
      '.dn-form .field{margin-bottom:9px}.dn-form label{display:block;font-size:0.82rem;color:var(--gray-6,#5f5a52);margin-bottom:3px;font-weight:600}' +
      '.dn-form input,.dn-form select,.dn-form textarea{width:100%;box-sizing:border-box}' +
      '.dn-form textarea{font-size:0.88rem;line-height:1.6;resize:vertical}' +
      '.dn-row{display:flex;gap:8px}.dn-row .field{flex:1 1 0;min-width:0}' +
      '.dn-hint{font-size:0.78rem;color:var(--gray-5);margin:-4px 0 9px}' +
      '.dn-addr{border:1px solid var(--gray-2,#e5e4df);border-radius:8px;padding:10px 12px;background:var(--gray-1,#f7f6f3);margin-bottom:10px}' +
      '.dn-addr strong{color:var(--navy)}' +
      '.dn-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0 12px}' +
      '.dn-actions .btn{min-height:40px;user-select:none}' +
      '.dn-paper-wrap{background:#e7e2da;padding:16px;border-radius:10px;overflow-x:auto}' +
      /* A4 한 장 (794 × 1123px @96dpi) */
      '.dn-paper{background:#fff;color:#111;width:794px;min-height:1123px;margin:0 auto 14px;box-sizing:border-box;' +
      'padding:62px 70px 34px;box-shadow:0 3px 14px rgba(0,0,0,0.18);font-family:"Batang","바탕","Nanum Myeongjo","Noto Serif KR",serif;' +
      'font-size:15px;line-height:1.72;display:flex;flex-direction:column;word-break:keep-all}' +
      '.dn-paper .dn-h1,.dn-paper .dn-h2,.dn-paper .dn-meta,.dn-paper th,.dn-paper .dn-sign,.dn-paper .dn-foot,.dn-paper .dn-org-pre,' +
      '.dn-paper .dn-seal,.dn-paper .dn-env{font-family:"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo",sans-serif}' +
      '.dn-h1{text-align:center;font-size:24px;font-weight:700;letter-spacing:1px;line-height:1.4}' +
      '.dn-h2{text-align:center;font-size:21px;line-height:1.4;margin-bottom:22px}' +
      '.dn-meta{font-size:15px;line-height:1.65;padding-bottom:12px;border-bottom:1px solid #888;margin-bottom:16px}' +
      '.dn-lab{white-space:pre}' +
      '.dn-p{display:flex;gap:6px;margin:2px 0 6px}.dn-p .n{flex:0 0 auto;min-width:20px}.dn-p .t{flex:1 1 auto;min-width:0;white-space:pre-wrap}' +
      '.dn-below{text-align:center;margin:10px 0 8px;white-space:pre}' +
      '.dn-ptbl{width:100%;border-collapse:collapse;margin:0 0 6px;font-size:14px}' +
      '.dn-ptbl th,.dn-ptbl td{border:1px solid #555;padding:5px 8px;text-align:center}' +
      '.dn-ptbl th{background:#efeae2;font-weight:600}.dn-ptbl tr.sum td{font-weight:700;background:#f7f3ec}' +
      '.dn-ptbl td.left{text-align:left}' +
      '.dn-note{font-size:12.5px;color:#555;margin:0 0 12px 6px}' +
      '.dn-sign{margin-top:auto;padding-top:22px}' +
      '.dn-org{display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap}' +
      '.dn-org-pre{font-size:12px;line-height:1.25;text-align:center}' +
      '.dn-org-name{font-family:"Batang","바탕",serif;font-size:32px;font-weight:700;letter-spacing:8px;white-space:nowrap}' +
      '.dn-seal{font-size:15px}' +
      '.dn-sealbox{width:64px;height:64px;border:1.5px dashed #b03a3a;color:#b03a3a;display:inline-flex;align-items:center;justify-content:center;font-size:13px}' +
      '.dn-sign-lines{width:max-content;margin:12px 34px 0 auto;font-size:16px;line-height:1.85}' +
      '.dn-foot{margin-top:20px;border-top:1px solid #999;padding-top:8px;font-size:11.5px;color:#555;text-align:center;line-height:1.5}' +
      /* 봉투용 받는 곳 쪽 */
      '.dn-env{justify-content:center}.dn-env-from{font-size:14px;line-height:1.7;color:#333;margin-bottom:auto}' +
      '.dn-env-to{margin:120px 0 0 40%;font-size:22px;line-height:1.75}.dn-env-to .zip{font-size:18px;letter-spacing:3px}' +
      '.dn-env-to .who{font-size:26px;font-weight:700;margin-top:6px}' +
      '.dn-env-tip{margin-top:auto;font-size:12px;color:#777;text-align:center}' +
      /* 보고서 */
      '.dn-rep .dn-h2{margin-bottom:10px}.dn-rep-sub{text-align:center;font-size:14px;color:#444;margin-bottom:18px}' +
      '.dn-rep-sum{font-size:14.5px;margin:0 0 10px}' +
      '@media (max-width:860px){.dn-paper-wrap{padding:8px}}' +
      '#dues-print{display:none}';
    document.head.appendChild(st);
  }

  /* 인쇄 — 몸통 바로 아래에 인쇄용 자리(#dues-print)를 두고 그것만 종이에 앉힌다.
   * (상회비 납입현황 인쇄와 같은 자리 이름을 써서, 그쪽 인쇄 모양이 남아 있어도 서로 가리지 않는다) */
  function printPapers(html, what) {
    var old = document.getElementById('dues-print');
    if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.id = 'dues-print';
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    var st = document.createElement('style');
    st.id = 'dn-print-style';
    st.textContent = '@media print{@page{size:A4 portrait;margin:0}' +
      'body>*:not(#dues-print){display:none!important}#dues-print{display:block!important}' +
      '#dues-print .dn-paper{box-shadow:none;margin:0;width:210mm;min-height:296mm;padding:22mm 24mm 14mm;page-break-after:always;break-after:page}' +
      '#dues-print .dn-paper:last-child{page-break-after:auto;break-after:auto}}';
    document.head.appendChild(st);   /* 맨 끝에 두어 다른 인쇄 모양보다 앞서게 */
    function done() {
      window.removeEventListener('afterprint', done);
      wrap.remove(); st.remove();
    }
    window.addEventListener('afterprint', done);
    if (window.SHSCloud) SHSCloud.log('view', '상회비 ' + what + ' 인쇄', '');
    window.print();
    setTimeout(function () { if (document.getElementById('dn-print-style')) done(); }, 60000);
  }

  function savePdf(html, filename, btn, what) {
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '만드는 중...'; }
    function fin() { if (btn) { btn.disabled = false; btn.textContent = label; } }
    var stage = document.createElement('div');
    stage.style.cssText = 'position:absolute;left:-11000px;top:0;width:794px;background:#fff';
    stage.innerHTML = '<div class="dn-pdf">' + html.replace(/class="dn-paper/g, 'style="box-shadow:none;margin:0;min-height:1100px" class="dn-paper') + '</div>';
    document.body.appendChild(stage);
    var keepX = window.scrollX || 0, keepY = window.scrollY || 0;
    loadPdfTool().then(function (html2pdf) {
      window.scrollTo(0, 0);
      return html2pdf().set({
        margin: 0, filename: filename,
        pagebreak: { mode: ['css', 'legacy'], before: '.dn-break' },
        html2canvas: { scale: 2, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      }).from(stage.firstChild).save();
    }).then(function () {
      stage.remove(); fin(); window.scrollTo(keepX, keepY);
      if (window.SHSCloud) SHSCloud.log('view', '상회비 ' + what + ' PDF 저장', filename);
    }).catch(function (err) {
      stage.remove(); fin(); window.scrollTo(keepX, keepY);
      alert('PDF를 만들지 못했습니다: ' + (err.message || err));
    });
  }

  /* 큰 창 — 배경 클릭(배경에서 누르고 배경에서 뗐을 때만)·Esc·닫기로 닫는다.
   * 칸을 고친 뒤면 닫기 전에 한 번 묻는다. 열린 동안 뒤 화면은 움직이지 않고, Tab 은 창 안에서만 돈다. */
  var openCount = 0;
  function overlay(title, bodyHtml) {
    var ov = document.createElement('div');
    ov.className = 'dn-ov';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', title);
    ov.innerHTML = '<div class="dn-box"><div class="dn-top"><h3>' + esc(title) + '</h3>' +
      '<button type="button" class="btn ghost sm dn-x">닫기</button></div>' + bodyHtml + '</div>';
    var back = document.activeElement;
    var keepOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.appendChild(ov);
    openCount++;
    var level = openCount;
    var dirty = false, closed = false;
    ov.addEventListener('input', function () { dirty = true; });
    function close(force) {
      if (closed) return;
      if (!force && dirty && !confirm('고친 내용이 있습니다. 창을 닫을까요?')) return;
      closed = true;
      openCount--;
      document.removeEventListener('keydown', onKey);
      ov.remove();
      document.body.style.overflow = keepOverflow;
      if (back && back.focus) try { back.focus(); } catch (e2) { /* 없어진 단추 */ }
    }
    function focusables() {
      return Array.prototype.filter.call(
        ov.querySelectorAll('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])'),
        function (x) { return !x.disabled && x.offsetParent !== null; });
    }
    function onKey(ev) {
      if (level !== openCount) return;            /* 맨 위 창만 */
      if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
      if (ev.key === 'Tab') {
        var f = focusables();
        if (!f.length) return;
        var i = f.indexOf(document.activeElement);
        if (ev.shiftKey && (i <= 0)) { ev.preventDefault(); f[f.length - 1].focus(); }
        else if (!ev.shiftKey && (i === -1 || i === f.length - 1)) { ev.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    var downOnBack = false;
    ov.addEventListener('mousedown', function (ev) { downOnBack = ev.target === ov; });
    ov.addEventListener('click', function (ev) { if (downOnBack && ev.target === ov) close(); downOnBack = false; });
    ov.querySelector('.dn-x').addEventListener('click', function () { close(); });
    var first = ov.querySelector('.dn-box input, .dn-box select, .dn-box textarea') || ov.querySelector('.dn-x');
    if (first) try { first.focus(); } catch (e3) { /* 그대로 */ }
    return { el: ov, close: close, clean: function () { dirty = false; } };
  }

  /* ---------- 자료 ---------- */
  /* 받는 곳 주소 — 교회 명부(sichal_churches)의 교회 주소, 없으면 회원 명단의 담임(임시당회장) 주소 */
  function addressOf(ch, data) {
    var key = normChurch(ch.out_church);
    var sc = (data.churches || []).filter(function (x) { return normChurch(x.name) === key; })[0];
    if (sc && sc.address) return { addr: sc.address, zip: '', src: '교회 주소 (교회 명부)', phone: sc.phone || '' };
    var who = firstName(ch.out_pastor);
    var hits = (data.roster || []).filter(function (r) { return r.name === who && r.address; });
    var r = hits.filter(function (x) { return normChurch(x.church) === key; })[0] || hits[0];
    if (r) {
      return { addr: r.address, zip: r.postcode || '', phone: '',
               src: (isActing(ch.out_pastor) ? '임시당회장' : '담임목사') + ' ' + who + ' 목사 주소 (회원 명단 — 교회 주소가 아직 없음)' };
    }
    var ca = (data.roster || []).filter(function (x) { return normChurch(x.church) === key && x.church_addr; })[0];
    if (ca) return { addr: ca.church_addr, zip: '', src: '교회 주소 (회원 명단)', phone: '' };
    return { addr: '', zip: '', src: '주소가 등록되어 있지 않습니다 — 직접 적어 주세요', phone: '' };
  }
  function sichalHead(ch, data) {
    var s = (data.sichals || []).filter(function (x) { return x.name === ch.out_sichal; })[0];
    if (!s || !s.head) return '';
    var nm = firstName(s.head);
    var pos = /장로/.test(s.head) ? '장로' : '목사';
    return ch.out_sichal + '장 ' + nm + ' ' + pos;
  }
  function recvOf(ch) {
    var who = firstName(ch.out_pastor);
    return churchName(ch.out_church) + ' ' + (isActing(ch.out_pastor) ? '임시당회장' : '당회장') +
      (who ? ' ' + who + ' 목사' : '');
  }
  function officers(data) {
    var src = data.officers || [];
    function find(role) { return src.filter(function (o) { return o && String(o.role || '').trim() === role; })[0] || null; }
    var p = find('노회장'), c = find('서기'), t = find('회계');
    return {
      president: (p && p.name) || '', presidentPos: (p && p.position) || '목사',
      clerk: (c && c.name) || '', clerkPos: (c && c.position) || '목사',
      treasurer: (t && t.name) || '', treasurerPos: (t && t.position) || '장로'
    };
  }
  function lastNotice(church, data) {
    return (data.notices || []).filter(function (n) { return n.church === church; })[0] || null;
  }

  function load(c, year) {
    function soft(p) { return p.then(function (x) { return x; }, function () { return { data: null }; }); }
    return Promise.all([
      c.rpc('dues29_churches', { p_year: year }),
      soft(c.from('dues_notices').select('*').eq('fy', year).order('sent_on', { ascending: false }).order('id', { ascending: false })),
      soft(c.from('dues_reports').select('*').eq('fy', year).order('month', { ascending: false }).limit(6)),
      soft(c.from('sichal_churches').select('name,address,pastor,phone,sichal')),
      soft(c.from('roster').select('name,church,category,position,address,postcode,church_addr,active').eq('active', true)),
      soft(c.from('sichals').select('name,head,clerk,treasurer')),
      soft(c.from('site_settings').select('key,value').in('key', ['officers', 'sessions', 'dues_pay']))
    ]).then(function (rs) {
      if (rs[0].error) throw rs[0].error;
      var st = {};
      ((rs[6] && rs[6].data) || []).forEach(function (r) { st[r.key] = r.value; });
      var all = rs[0].data || [];
      return {
        year: year,
        all: all,
        due: all.filter(function (x) { return Number(x.out_late_count || 0) >= MIN_MONTHS && Number(x.out_monthly || 0) > 0; }),
        zero: all.filter(function (x) { return Number(x.out_late_count || 0) >= MIN_MONTHS && !(Number(x.out_monthly || 0) > 0); }),
        notices: (rs[1] && rs[1].data) || [],
        noticesReady: !!(rs[1] && rs[1].data),
        reports: (rs[2] && rs[2].data) || [],
        churches: (rs[3] && rs[3].data) || [],
        roster: (rs[4] && rs[4].data) || [],
        sichals: (rs[5] && rs[5].data) || [],
        officers: st.officers || [],
        sessions: st.sessions || null,
        pay: st.dues_pay || {}
      };
    });
  }

  /* ---------- 공문 ---------- */
  function defaults(ch, data) {
    var t = today();
    var o = officers(data);
    var cur = data.sessions && data.sessions.current ? data.sessions.current : '';
    var ad = addressOf(ch, data);
    return {
      noPrefix: '시화산노 제 ' + cur + '-', noNum: '',
      date: ymd(t),
      recv: recvOf(ch),
      ref: sichalHead(ch, data),
      title: '상회비 미납분 납부 촉구',
      deadline: ymd(addDays(t, 14)),
      bank: data.pay.bank || '', account: data.pay.account || '', holder: data.pay.holder || '시화산노회',
      addr: ad.addr, zip: ad.zip, addrSrc: ad.src,
      seal: 'omit', env: true,
      president: o.president, presidentPos: o.presidentPos,
      clerk: o.clerk, clerkPos: o.clerkPos,
      treasurer: o.treasurer, treasurerPos: o.treasurerPos,
      extra: ''
    };
  }

  function letterModel(ch, f, data) {
    var base = parseYmd(f.date) || today();
    var dl = parseYmd(f.deadline);
    var fy = data.year;
    var months = (ch.out_late_months || []).map(Number);
    var monthly = Number(ch.out_monthly || 0);
    var total = Number(ch.out_late_amount || months.length * monthly);
    var cname = churchName(ch.out_church);
    var n = 0;
    function para(t) { t = String(t || '').trim(); return t ? { n: ++n, t: t } : null; }
    var p = [
      para('성삼위 하나님의 은총이 귀 교회와 성도님들 위에 항상 함께 하시기를 기원합니다.'),
      para('노회규칙 제28조(상회비 납부)에 따라 각 지교회 상회비는 매월 납입 시 그 달 말까지 납부하여야 합니다. ' +
        '그런데 ' + koDate(base) + ' 현재 ' + cname + '의 ' + fy + '년 회기(' + fy + '년 4월~' + (fy + 1) + '년 3월) 상회비 가운데 ' +
        '아래와 같이 ' + months.length + '개월분, 모두 ' + manwon(total) + '(' + won(total) + ')이 납부 확인되지 않았습니다.')
    ].filter(Boolean);
    var after = [
      para('노회규칙 제29조(상회비 미납 규정)에 따라 상회비 미납 중에는 각종 서류나 증명서의 발급과 접수가 중지되며, ' +
        '미납교회는 노회 임원 및 총대, 시찰·상비부 임원을 할 수 없습니다. 노회의 살림과 사역을 위하여 ' +
        (dl ? koDate(dl, true) + '까지 ' : '') + '미납 상회비를 납부하여 주시기 바랍니다.'),
      para(f.account
        ? '납부 계좌 : ' + [f.bank, f.account].filter(Boolean).join(' ') + (f.holder ? ' (예금주 ' + f.holder + ')' : '') +
          '\n입금하실 때 보내는 분 이름에 교회 이름을 적어 주시면 확인이 빠릅니다.'
        : ''),
      para('이미 납부하셨거나 납부 내역이 다르면 노회 회계' +
        (f.treasurer ? ' ' + f.treasurer + ' ' + (f.treasurerPos || '장로') : '') +
        '에게 확인을 요청하여 주시기 바랍니다. (노회 사무실 ' + OFFICE.tel + ')'),
      para(f.extra)
    ].filter(Boolean);
    var last = after.length ? after[after.length - 1] : p[p.length - 1];
    if (last) last.t += '  끝.';

    var docNo = (f.noPrefix || '') + (String(f.noNum || '').trim() || '　　') + ' 호';
    return {
      church: cname,
      meta: [
        ['', docNo],
        ['일  시', koDate0(base)],
        ['발  신', '시화산노회장'],
        ['수  신', f.recv || recvOf(ch)]
      ].concat(f.ref ? [['참  조', f.ref]] : []).concat([['제  목', f.title || '']]),
      paras: p, after: after, monthsText: monthsLabel(fy, months), total: total, monthly: monthly, months: months,
      note: '※ ' + koDate(base) + ' 기준 · 기한(그 달 말)이 지난 미납분입니다. 이번 달분은 이번 달 말까지 납부하시면 됩니다.',
      sign: {
        seal: f.seal || 'omit',
        lines: [
          '노회장 ' + (f.president || '') + ' ' + (f.presidentPos || '목사'),
          '서　기 ' + (f.clerk || '') + ' ' + (f.clerkPos || '목사')
        ]
      },
      env: f.env ? { zip: f.zip || '', addr: f.addr || '', who: f.recv || recvOf(ch) } : null
    };
  }

  function multiline(t) { return esc(t).replace(/\n/g, '<br>'); }
  function footHtml() {
    return '<div class="dn-foot">대한예수교장로회 시화산노회 · 노회 사무실 : ' + esc(OFFICE.addr) + '<br>' +
      'TEL ' + esc(OFFICE.tel) + ' · FAX ' + esc(OFFICE.fax) + ' · ' + esc(OFFICE.site) + '</div>';
  }
  function signHtml(sign) {
    return '<div class="dn-sign"><div class="dn-org">' +
      '<span class="dn-org-pre">대한예수교<br>장&nbsp;로&nbsp;회</span>' +
      '<span class="dn-org-name">시 화 산 노 회</span>' +
      (sign.seal === 'box' ? '<span class="dn-sealbox" title="직인을 찍는 자리">직인</span>' : '<span class="dn-seal">(직인생략)</span>') +
      '</div><div class="dn-sign-lines">' + sign.lines.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('') +
      '</div></div>';
  }
  function letterHtml(L) {
    function para(p2) {
      return '<div class="dn-p"><span class="n">' + p2.n + '.</span><span class="t">' + multiline(p2.t) + '</span></div>';
    }
    var h = '<div class="dn-paper">' +
      '<div class="dn-h1">대한예수교장로회 시화산노회</div>' +
      '<div class="dn-h2">상회비 납부 촉구</div>' +
      '<div class="dn-meta">' + L.meta.map(function (r) {
        return '<div>' + (r[0] ? '<span class="dn-lab">' + esc(r[0]) + '</span> : ' : '') + esc(r[1]) + '</div>';
      }).join('') + '</div>' +
      '<div class="dn-body">' + L.paras.map(para).join('') +
      '<div class="dn-below">- 아    래 -</div>' +
      '<table class="dn-ptbl"><thead><tr><th>교회</th><th>미납 달</th><th>개월</th><th>월 상회비</th><th>미납액</th></tr></thead><tbody>' +
      '<tr><td>' + esc(L.church) + '</td><td>' + esc(L.monthsText) + '</td><td>' + L.months.length + '</td>' +
      '<td>' + esc(manwon(L.monthly)) + '</td><td><strong>' + esc(manwon(L.total)) + '</strong></td></tr>' +
      '</tbody></table>' +
      '<div class="dn-note">' + esc(L.note) + '</div>' +
      L.after.map(para).join('') + '</div>' +
      signHtml(L.sign) + footHtml() + '</div>';
    if (L.env) {
      h += '<div class="dn-paper dn-env dn-break">' +
        '<div class="dn-env-from">보내는 곳<br><strong>대한예수교장로회 시화산노회</strong><br>' + esc(OFFICE.addr) + '<br>TEL ' + esc(OFFICE.tel) + '</div>' +
        '<div class="dn-env-to">' +
        (L.env.zip ? '<div class="zip">(' + esc(L.env.zip) + ')</div>' : '') +
        '<div>' + (L.env.addr ? esc(L.env.addr) : '<span style="color:#b03a3a">주소를 적어 주세요</span>') + '</div>' +
        '<div class="who">' + esc(L.env.who) + ' 귀하</div></div>' +
        '<div class="dn-env-tip">봉투에 붙이거나 창봉투로 보내실 때 쓰는 받는 곳 쪽입니다.</div></div>';
    }
    return h;
  }

  /* ---------- 공문 창 ---------- */
  function openLetter(ch, data, user, reload) {
    var f = defaults(ch, data);
    var past = (data.notices || []).filter(function (n) { return n.church === ch.out_church; });
    var sender = isSender(user);
    var body =
      '<div class="dn-wrap"><div class="dn-form admin-card" style="padding:16px">' +
      '<div class="dn-addr"><div style="font-size:0.8rem;color:var(--gray-5);margin-bottom:2px">받는 곳</div>' +
      '<div><strong id="dn-a-who"></strong></div>' +
      '<div id="dn-a-addr" style="font-size:0.92rem"></div>' +
      '<div style="font-size:0.76rem;color:var(--gray-5);margin-top:3px">' + esc(f.addrSrc) + '</div></div>' +
      '<div class="dn-row"><div class="field"><label for="dn-zip">우편번호</label><input id="dn-zip" value="' + esc(f.zip) + '" maxlength="7"></div>' +
      '<div class="field" style="flex:3 1 0"><label for="dn-addr">주소</label><input id="dn-addr" value="' + esc(f.addr) + '" placeholder="받는 곳 주소"></div></div>' +
      '<div class="dn-row"><div class="field" style="flex:2 1 0"><label for="dn-pre">문서번호 앞</label><input id="dn-pre" value="' + esc(f.noPrefix) + '"></div>' +
      '<div class="field"><label for="dn-num">번호</label><input id="dn-num" value="" placeholder="예: 12" inputmode="numeric"></div></div>' +
      '<div class="dn-row"><div class="field"><label for="dn-date">일시</label><input type="date" id="dn-date" value="' + esc(f.date) + '"></div>' +
      '<div class="field"><label for="dn-dl">납부 기한</label><input type="date" id="dn-dl" value="' + esc(f.deadline) + '"></div></div>' +
      '<div class="field"><label for="dn-recv">수신</label><input id="dn-recv" value="' + esc(f.recv) + '"></div>' +
      '<div class="field"><label for="dn-ref">참조 (비우면 뺍니다)</label><input id="dn-ref" value="' + esc(f.ref) + '"></div>' +
      '<div class="field"><label for="dn-title">제목</label><input id="dn-title" value="' + esc(f.title) + '"></div>' +
      '<div class="dn-row"><div class="field"><label for="dn-bank">납부 은행</label><input id="dn-bank" value="' + esc(f.bank) + '" placeholder="예: NH농협"></div>' +
      '<div class="field" style="flex:2 1 0"><label for="dn-acct">계좌번호</label><input id="dn-acct" value="' + esc(f.account) + '"></div></div>' +
      '<div class="field"><label for="dn-holder">예금주</label><input id="dn-holder" value="' + esc(f.holder) + '"></div>' +
      (f.account ? '' : '<p class="dn-hint">상회비 납부 계좌가 사이트 설정에 아직 없습니다. 적으면 공문에 들어가고, ' +
        '관리자는 아래 「이 계좌를 기본으로」로 저장해 둘 수 있습니다.</p>') +
      '<div class="field"><label for="dn-extra">덧붙일 말 (선택)</label><textarea id="dn-extra" rows="2"></textarea></div>' +
      '<div class="dn-row"><div class="field"><label for="dn-seal">직인</label><select id="dn-seal">' +
      '<option value="omit">(직인생략)</option><option value="box">직인 찍을 자리</option></select></div>' +
      '<div class="field" style="align-self:flex-end"><label style="display:flex;gap:6px;align-items:center;font-weight:400">' +
      '<input type="checkbox" id="dn-env" style="width:auto"' + (f.env ? ' checked' : '') + '> 봉투용 받는 곳 쪽도</label></div></div>' +
      '<div class="dn-row"><div class="field"><label for="dn-pres">노회장</label><input id="dn-pres" value="' + esc(f.president) + '"></div>' +
      '<div class="field"><label for="dn-clerk">서기</label><input id="dn-clerk" value="' + esc(f.clerk) + '"></div></div>' +
      (past.length
        ? '<div style="font-size:0.84rem;margin-top:4px"><strong>지난 발송</strong>' + past.map(function (n) {
            return '<div>' + esc(String(n.sent_on || '')) + ' · ' + esc(n.doc_no || '번호 없음') + ' · ' +
              esc((n.late_months || []).join('·')) + '월 ' + esc(manwon(n.late_amount)) + (n.sent_by ? ' · ' + esc(n.sent_by) : '') + '</div>';
          }).join('') + '</div>'
        : '') +
      '</div><div>' +
      '<div class="dn-actions">' +
      '<button type="button" class="btn" id="dn-print">인쇄</button>' +
      '<button type="button" class="btn ghost" id="dn-pdf">PDF 저장</button>' +
      (sender
        ? '<button type="button" class="btn ghost" id="dn-send">발송 기록</button>'
        : '<span style="font-size:0.82rem;color:var(--gray-5)">발송(기록)은 서기가 합니다.</span>') +
      (user && ['president', 'clerk', 'staff', 'superadmin'].indexOf(user.role) !== -1
        ? '<button type="button" class="btn ghost sm" id="dn-savepay">이 계좌를 기본으로</button>' : '') +
      '<span class="form-msg" id="dn-msg"></span></div>' +
      '<div class="dn-paper-wrap" id="dn-preview"></div></div></div>';

    var mo = overlay(churchName(ch.out_church) + ' 납부촉구 공문 — ' + (ch.out_late_months || []).join('·') + '월분 ' +
      manwon(ch.out_late_amount), body);
    var el = mo.el;
    function v(id) { var x = el.querySelector('#' + id); return x ? x.value : ''; }
    function read() {
      return {
        noPrefix: v('dn-pre'), noNum: v('dn-num'), date: v('dn-date'), deadline: v('dn-dl'),
        recv: v('dn-recv').trim(), ref: v('dn-ref').trim(), title: v('dn-title').trim(),
        bank: v('dn-bank').trim(), account: v('dn-acct').trim(), holder: v('dn-holder').trim(),
        addr: v('dn-addr').trim(), zip: v('dn-zip').trim(), extra: v('dn-extra'),
        seal: v('dn-seal'), env: el.querySelector('#dn-env').checked,
        president: v('dn-pres').trim(), presidentPos: f.presidentPos,
        clerk: v('dn-clerk').trim(), clerkPos: f.clerkPos,
        treasurer: f.treasurer, treasurerPos: f.treasurerPos
      };
    }
    var model = null;
    function draw() {
      var ff = read();
      model = letterModel(ch, ff, data);
      el.querySelector('#dn-preview').innerHTML = letterHtml(model);
      fitPreview(el.querySelector('#dn-preview'));
      el.querySelector('#dn-a-who').textContent = ff.recv || recvOf(ch);
      el.querySelector('#dn-a-addr').textContent = (ff.zip ? '(' + ff.zip + ') ' : '') + (ff.addr || '주소 없음 — 위 칸에 적어 주세요');
    }
    el.querySelectorAll('input,select,textarea').forEach(function (x) {
      x.addEventListener('input', draw);
      x.addEventListener('change', draw);
    });
    fitOnResize(el.querySelector('#dn-preview'));
    draw();

    function fileName() {
      return '상회비_납부촉구_' + churchName(ch.out_church) + '_' + (v('dn-date') || ymd(today())) + '.pdf';
    }
    el.querySelector('#dn-print').addEventListener('click', function () { draw(); mo.clean(); printPapers(letterHtml(model), '납부촉구 공문'); });
    el.querySelector('#dn-pdf').addEventListener('click', function () { draw(); mo.clean(); savePdf(letterHtml(model), fileName(), this, '납부촉구 공문'); });

    var sp = el.querySelector('#dn-savepay');
    if (sp) sp.addEventListener('click', function () {
      if (sp.disabled) return;
      sp.disabled = true;
      var ff = read();
      var msg = el.querySelector('#dn-msg');
      SHSCloud.init().then(function (c) {
        return c.from('site_settings').upsert({ key: 'dues_pay', value: { bank: ff.bank, account: ff.account, holder: ff.holder } });
      }).then(function (r) {
        if (r.error) throw r.error;
        data.pay = { bank: ff.bank, account: ff.account, holder: ff.holder };
        sp.disabled = false;
        msg.className = 'form-msg ok'; msg.textContent = ' 상회비 납부 계좌를 기본으로 저장했습니다.';
        SHSCloud.log('update', '상회비 납부 계좌', ff.bank + ' ' + ff.account);
      }).catch(function (err) {
        sp.disabled = false;
        msg.className = 'form-msg err'; msg.textContent = ' 저장하지 못했습니다: ' + (err.message || err);
      });
    });

    var sb = el.querySelector('#dn-send');
    if (sb) sb.addEventListener('click', function () {
      var ff = read();
      var msg = el.querySelector('#dn-msg');
      var docNo = (ff.noPrefix || '') + (String(ff.noNum || '').trim() || '') + (String(ff.noNum || '').trim() ? ' 호' : '');
      if (!String(ff.noNum || '').trim() &&
          !confirm('문서번호가 비어 있습니다. 번호 없이 발송을 기록할까요?')) return;
      if (!confirm(churchName(ch.out_church) + '에 납부촉구 공문을 발송한 것으로 기록합니다.\n' +
          '받는 곳: ' + (ff.addr || '(주소 없음)') + '\n\n기록하면 회계·노회장에게 알림이 갑니다.')) return;
      sb.disabled = true;
      msg.className = 'form-msg'; msg.textContent = ' 기록하는 중...';
      var who = user ? (user.name || '') + ' ' + (user.role === 'clerk' ? '서기' : (user.title || '')) : '';
      SHSCloud.init().then(function (c) {
        return c.from('dues_notices').insert({
          fy: data.year, church: ch.out_church, doc_no: docNo.trim() || null,
          late_months: (ch.out_late_months || []).map(Number), late_amount: Number(ch.out_late_amount || 0),
          recipient: ff.recv || recvOf(ch), address: ((ff.zip ? '(' + ff.zip + ') ' : '') + ff.addr).trim() || null,
          sent_on: ff.date || ymd(today()), sent_by: who.trim() || null
        }).select('id');
      }).then(function (r) {
        if (r.error) throw r.error;
        SHSCloud.log('create', '상회비 납부촉구 공문 발송', churchName(ch.out_church) + ' ' + docNo);
        msg.className = 'form-msg ok'; msg.textContent = ' 발송을 기록했습니다. 회계·노회장에게 알림이 갔습니다.';
        mo.clean();
        if (reload) reload();
      }).catch(function (err) {
        sb.disabled = false;
        msg.className = 'form-msg err';
        msg.textContent = ' 기록하지 못했습니다' +
          (/dues_notices|schema cache|does not exist/.test(String(err.message || '')) ? ' (137 sql 을 아직 실행하지 않았습니다)' : '') +
          ': ' + (err.message || err);
      });
    });
  }

  /* ---------- 월례회 보고서 ---------- */
  function reportRows(data) {
    return data.due.map(function (ch) {
      var n = lastNotice(ch.out_church, data);
      return {
        church: ch.out_church, sichal: ch.out_sichal || '', pastor: ch.out_pastor || '',
        months: (ch.out_late_months || []).map(Number), months_label: monthsLabel(data.year, ch.out_late_months),
        count: Number(ch.out_late_count || 0), amount: Number(ch.out_late_amount || 0),
        sent: n ? String(n.sent_on || '') : '', doc_no: n ? (n.doc_no || '') : ''
      };
    });
  }
  function reportHtml(data, rows, o) {
    var t = today();
    var total = 0, left = 0;
    rows.forEach(function (r) { total += r.amount; if (!r.sent) left++; });
    var mm = String(o.month || kstMonth()).split('-');
    var h = '<div class="dn-paper dn-rep">' +
      '<div class="dn-h1">대한예수교장로회 시화산노회</div>' +
      '<div class="dn-h2">상회비 3개월 이상 미납 보고</div>' +
      '<div class="dn-rep-sub">' + Number(mm[0]) + '년 ' + Number(mm[1]) + '월 월례회 · ' + dots(t) + ' 기준 · ' +
      data.year + '년 회기 (' + data.year + '년 4월~' + (data.year + 1) + '년 3월)</div>' +
      '<p class="dn-rep-sum">노회규칙 제28조에 따라 상회비는 그 달 말까지 납부하여야 하며, 기한이 지난 미납이 ' +
      '<strong>3개월 이상</strong>인 교회는 <strong>' + rows.length + '곳</strong>, 미납 합계 <strong>' + esc(manwon(total)) + '</strong>입니다. ' +
      (rows.length
        ? (left
          ? '이 가운데 ' + left + '곳은 아직 납부촉구 공문을 보내지 않았으므로 서기가 발송합니다(노회규칙 제29조).'
          : '모든 교회에 납부촉구 공문을 보냈습니다.')
        : '') + '</p>' +
      '<table class="dn-ptbl"><thead><tr><th>번호</th><th>시찰</th><th>교회</th><th>담임</th><th>미납 달</th><th>개월</th><th>미납액</th><th>공문</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (r, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.sichal) + '</td><td class="left">' + esc(churchName(r.church)) + '</td>' +
          '<td>' + esc(r.pastor) + '</td><td>' + esc(r.months.join('·')) + '월</td><td>' + r.count + '</td>' +
          '<td>' + esc(manwon(r.amount)) + '</td><td>' + (r.sent ? esc(r.sent.slice(5).replace('-', '.')) + ' 발송' : '미발송') + '</td></tr>';
      }).join('') : '<tr><td colspan="8">3개월 이상 미납 교회가 없습니다.</td></tr>') +
      '<tr class="sum"><td colspan="5">합계</td><td>' + rows.reduce(function (a, r) { return a + r.count; }, 0) + '</td>' +
      '<td>' + esc(manwon(total)) + '</td><td>' + (rows.length - left) + '/' + rows.length + '</td></tr>' +
      '</tbody></table>' +
      '<div class="dn-note">※ 기한(그 달 말)이 지난 미납분입니다. 이번 달분은 이번 달 말까지 낼 수 있어 세지 않았고, ' +
      '지난달분은 입금 기록을 위한 유예일(3일)이 지난 뒤부터 셉니다. 월 상회비가 0원인 교회는 뺐습니다.</div>' +
      (data.zero.length ? '<div class="dn-note">※ 월 상회비가 정해지지 않아 뺀 교회: ' +
        esc(data.zero.map(function (x) { return churchName(x.out_church); }).join(', ')) + '</div>' : '') +
      (o.note ? '<div class="dn-p"><span class="t">' + multiline('덧붙임: ' + o.note) + '</span></div>' : '') +
      '<div class="dn-sign"><div class="dn-sign-lines">' +
      '<div>보고 : 회계 ' + esc(o.treasurer || '') + ' ' + esc(o.treasurerPos || '장로') + '</div>' +
      '<div>받는 분 : 노회장 ' + esc(o.president || '') + ' ' + esc(o.presidentPos || '목사') + ' · 서기 ' +
      esc(o.clerk || '') + ' ' + esc(o.clerkPos || '목사') + '</div></div></div>' +
      footHtml() + '</div>';
    return h;
  }

  function openReport(data, user, reload) {
    var o = officers(data);
    var month = kstMonth();
    var saved = (data.reports || []).filter(function (r) { return r.month === month; })[0] || null;
    var canWrite = isReporter(user);
    var body =
      '<div class="dn-wrap"><div class="dn-form admin-card" style="padding:16px">' +
      '<div class="field"><label for="dr-month">월례회 (보고하는 달)</label><input type="month" id="dr-month" value="' + esc(month) + '"></div>' +
      '<div class="dn-row"><div class="field"><label for="dr-tr">보고 — 회계</label><input id="dr-tr" value="' + esc(o.treasurer) + '"></div>' +
      '<div class="field"><label for="dr-pres">노회장</label><input id="dr-pres" value="' + esc(o.president) + '"></div>' +
      '<div class="field"><label for="dr-clerk">서기</label><input id="dr-clerk" value="' + esc(o.clerk) + '"></div></div>' +
      '<div class="field"><label for="dr-note">덧붙일 말 (선택)</label><textarea id="dr-note" rows="3">' + esc((saved && saved.note) || '') + '</textarea></div>' +
      '<p class="dn-hint" style="margin-top:0">「보고하기」를 누르면 이 보고가 저장되고 회계·서기·노회장에게 알림이 갑니다. ' +
      '서기는 알림을 받고 아직 공문을 보내지 않은 교회에 납부촉구 공문을 발송합니다.</p>' +
      (saved ? '<p class="dn-hint" style="margin-top:0">이 달 보고: ' + esc(String(saved.reported_at || '').slice(0, 16).replace('T', ' ')) +
        ' · ' + esc(saved.reported_by || '') + ' — 다시 누르면 지금 내용으로 고쳐 다시 알립니다.</p>' : '') +
      ((data.reports || []).length
        ? '<div style="font-size:0.84rem"><strong>지난 보고</strong>' + data.reports.map(function (r) {
            return '<div>' + esc(r.month) + ' · ' + r.churches + '곳 ' + esc(manwon(r.total_amount)) + (r.reported_by ? ' · ' + esc(r.reported_by) : '') + '</div>';
          }).join('') + '</div>' : '') +
      '</div><div><div class="dn-actions">' +
      '<button type="button" class="btn" id="dr-print">인쇄</button>' +
      '<button type="button" class="btn ghost" id="dr-pdf">PDF 저장</button>' +
      (canWrite ? '<button type="button" class="btn ghost" id="dr-send">보고하기 (회계·서기·노회장에게 알림)</button>'
                : '<span style="font-size:0.82rem;color:var(--gray-5)">보고는 회계가 합니다.</span>') +
      '<span class="form-msg" id="dr-msg"></span></div>' +
      '<div class="dn-paper-wrap" id="dr-preview"></div></div></div>';
    var mo = overlay('월례회 보고서 — 상회비 3개월 이상 미납', body);
    var el = mo.el;
    var rows = reportRows(data);
    function v(id) { return el.querySelector('#' + id).value; }
    function opts() {
      return { month: v('dr-month') || month, note: v('dr-note').trim(),
               treasurer: v('dr-tr').trim(), treasurerPos: o.treasurerPos,
               president: v('dr-pres').trim(), presidentPos: o.presidentPos,
               clerk: v('dr-clerk').trim(), clerkPos: o.clerkPos };
    }
    function draw() {
      el.querySelector('#dr-preview').innerHTML = reportHtml(data, rows, opts());
      fitPreview(el.querySelector('#dr-preview'));
    }
    fitOnResize(el.querySelector('#dr-preview'));
    el.querySelectorAll('input,textarea').forEach(function (x) { x.addEventListener('input', draw); });
    draw();
    el.querySelector('#dr-print').addEventListener('click', function () { mo.clean(); printPapers(reportHtml(data, rows, opts()), '월례회 미납 보고서'); });
    el.querySelector('#dr-pdf').addEventListener('click', function () {
      mo.clean();
      savePdf(reportHtml(data, rows, opts()), '상회비_3개월이상_미납보고_' + (v('dr-month') || month) + '.pdf', this, '월례회 미납 보고서');
    });
    var sb = el.querySelector('#dr-send');
    if (sb) sb.addEventListener('click', function () {
      var op = opts();
      var msg = el.querySelector('#dr-msg');
      if (!/^\d{4}-\d{2}$/.test(op.month)) { msg.className = 'form-msg err'; msg.textContent = ' 월례회 달을 골라 주세요.'; return; }
      if (!confirm(op.month + ' 월례회 상회비 미납 보고를 올립니다.\n3개월 이상 미납 ' + rows.length + '곳 — 회계·서기·노회장에게 알림이 갑니다.')) return;
      sb.disabled = true;
      msg.className = 'form-msg'; msg.textContent = ' 보고하는 중...';
      var total = rows.reduce(function (a, r) { return a + r.amount; }, 0);
      var who = user ? ((user.name || '') + ' ' + (user.title || (user.role === 'clerk' ? '서기' : ''))).trim() : '';
      SHSCloud.init().then(function (c) {
        return c.from('dues_reports').upsert({
          month: op.month, fy: data.year, rows: rows, churches: rows.length, total_amount: total,
          reported_by: who || null,
          reported_at: new Date().toISOString(), note: op.note || null
        }, { onConflict: 'month' }).select('id').single().then(function (r) {
          if (r.error) throw r.error;
          return c.rpc('dues_report_notify', { p_id: r.data.id });
        });
      }).then(function (r) {
        if (r.error) throw r.error;
        SHSCloud.log('create', '상회비 월례회 미납 보고', op.month + ' ' + rows.length + '곳 ' + total + '만원');
        msg.className = 'form-msg ok'; msg.textContent = ' 보고했습니다. ' + (r.data || 0) + '분께 알림이 갔습니다.';
        mo.clean();
        sb.disabled = false;
        if (reload) reload();
      }).catch(function (err) {
        sb.disabled = false;
        msg.className = 'form-msg err';
        msg.textContent = ' 보고하지 못했습니다' +
          (/dues_reports|dues_report_notify|schema cache|does not exist/.test(String(err.message || '')) ? ' (137 sql 을 아직 실행하지 않았습니다)' : '') +
          ': ' + (err.message || err);
      });
    });
  }

  /* ---------- 상회비 관리 안의 자리 ---------- */
  function panelHtml(data, user) {
    var h = '<div class="admin-card" style="margin:14px 0 18px;border-left:4px solid ' + (data.due.length ? '#b0731f' : '#2c7a3f') + '">' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">' +
      '<h4 style="margin:0;flex:1 1 auto">납부촉구 공문 — 3개월 이상 미납 ' +
      '<span style="font-weight:400;font-size:0.84rem;color:var(--gray-5)">노회규칙 제28·29조 · 기한 지난 미납 3개월 이상</span></h4>' +
      '<button type="button" class="btn ghost sm" id="dn-report">월례회 보고서</button></div>';
    if (!data.due.length) {
      h += '<p class="mydues-ok" style="margin:0">' + data.year + '년 회기에 3개월 이상 미납인 교회가 없습니다.</p>';
    } else {
      var sent = data.due.filter(function (ch) { return lastNotice(ch.out_church, data); }).length;
      h += '<p style="margin:0 0 8px;font-size:0.9rem">대상 <strong>' + data.due.length + '곳</strong> · 공문 발송 ' + sent + '/' + data.due.length +
        '. 교회 이름을 누르면 그 교회 당회장께 보낼 공문이 저절로 만들어집니다 (인쇄·PDF 저장·받는 곳 주소). ' +
        '<strong>발송은 서기</strong>가 하고, 회계는 월례회 때 <strong>월례회 보고서</strong>로 보고합니다.</p>' +
        '<div style="overflow-x:auto"><table class="tbl dn-tbl"><thead><tr><th style="width:44px">번호</th><th>시찰</th><th>교회</th><th>담임</th>' +
        '<th>미납 달</th><th>개월</th><th>미납액</th><th>공문</th><th style="width:80px"></th></tr></thead><tbody>';
      data.due.forEach(function (ch, i) {
        var n = lastNotice(ch.out_church, data);
        h += '<tr><td>' + (i + 1) + '</td><td>' + esc(ch.out_sichal) + '</td>' +
          '<td class="left dn-ch" data-dnch="' + esc(ch.out_church) + '" tabindex="0" role="button" title="공문 만들기">' + esc(churchName(ch.out_church)) + '</td>' +
          '<td>' + esc(ch.out_pastor || '') + '</td>' +
          '<td style="color:var(--red,#b03a3a);font-weight:700">' + esc((ch.out_late_months || []).join('·')) + '월</td>' +
          '<td>' + Number(ch.out_late_count || 0) + '</td><td>' + esc(manwon(ch.out_late_amount)) + '</td>' +
          '<td>' + (n ? '<span class="dn-sent">' + esc(String(n.sent_on || '').slice(5).replace('-', '.')) + ' 발송' +
            (n.doc_no ? ' · ' + esc(n.doc_no) : '') + '</span>' : '<span class="dn-unsent">미발송</span>') + '</td>' +
          '<td><button type="button" class="btn sm" data-dnch="' + esc(ch.out_church) + '">공문</button></td></tr>';
      });
      h += '</tbody></table></div>';
      if (data.zero.length) {
        h += '<p style="font-size:0.8rem;color:var(--gray-5);margin:6px 0 0">월 상회비가 0원으로 되어 있어 공문 대상에서 뺀 교회: ' +
          esc(data.zero.map(function (x) { return churchName(x.out_church); }).join(', ')) + ' — 상회비 설정에서 월액을 정하면 대상에 들어옵니다.</p>';
      }
    }
    if (!data.noticesReady) {
      h += '<p style="font-size:0.8rem;color:var(--gray-5);margin:6px 0 0">공문 만들기·인쇄·PDF 는 지금도 됩니다. ' +
        '발송 기록과 월례회 보고 알림은 서버 준비(137 sql)가 끝나면 쓸 수 있습니다.</p>';
    }
    if (isSender(user)) {
      h += '<p style="font-size:0.8rem;color:var(--gray-5);margin:6px 0 0">공문을 보낸 뒤 공문 창의 <strong>발송 기록</strong>을 누르면 ' +
        '이 표에 발송일이 적히고 회계·노회장에게 알림이 갑니다.</p>';
    }
    return h + '</div>';
  }

  function mount(slot, opts) {
    if (!slot) return;
    opts = opts || {};
    var user = opts.user;
    if (!isViewer(user) || !(window.SHSCloud && SHSCloud.enabled && SHSCloud.enabled())) { slot.innerHTML = ''; return; }
    ensureStyle();
    var year = opts.year;
    function reload() {
      SHSCloud.init().then(function (c) { return load(c, year); }).then(function (data) {
        slot.innerHTML = panelHtml(data, user);
        slot.querySelectorAll('[data-dnch]').forEach(function (x) {
          function open() {
            var ch = data.due.filter(function (d) { return d.out_church === x.dataset.dnch; })[0];
            if (ch) openLetter(ch, data, user, reload);
          }
          x.addEventListener('click', open);
          if (x.tagName === 'TD') x.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
          });
        });
        var rb = slot.querySelector('#dn-report');
        if (rb) rb.addEventListener('click', function () { openReport(data, user, reload); });
      }).catch(function (err) {
        slot.innerHTML = '<p style="font-size:0.84rem;color:var(--gray-5)">납부촉구 공문 자리를 불러오지 못했습니다: ' +
          esc(err.message || err) + '</p>';
      });
    }
    reload();
  }

  return {
    mount: mount, MIN_MONTHS: MIN_MONTHS,
    /* 시험용 */
    _letterModel: letterModel, _letterHtml: letterHtml, _reportHtml: reportHtml, _reportRows: reportRows,
    _defaults: defaults, _addressOf: addressOf, _recvOf: recvOf, _monthsLabel: monthsLabel
  };
})();

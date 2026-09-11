/* 회계 장부 (상비부·시찰 공용)
 *
 * 이월금으로 시작해서 수입과 지출을 한 줄씩 적어 나가면
 * 남은 돈이 저절로 셈해진다.
 *
 *   남은 돈 = 이월금 + 수입 합계 − 지출 합계
 *
 * 해가 바뀌면 그 해의 장부를 새로 쓴다. 지난해 장부는 그대로 남아 있고,
 * '지난해 잔액 가져오기'를 누르면 지난해 남은 돈이 올해 이월금이 된다.
 *
 * 봄·가을 감사 대상이므로 감사 칸(js/audit-mark.js)을 함께 붙인다.
 * 감사가 끝난 장부는 고치거나 지울 수 없다. (막는 일은 데이터베이스가 한다)
 *
 *   SHSLedger.mount(자리, {
 *     kind:   'sichal' | 'ministers'(시찰 교역자회) | 'committee' | 'presbytery',
 *     owner:  '북부시찰' | '재정부' | '노회',   (교역자회 장부의 owner 도 시찰 이름)
 *     label:  화면·기록에 보일 이름 (없으면 owner, 교역자회는 '북부시찰 교역자회')
 *     user:   지금 로그인한 사람,
 *     isAuditor: 감사부인가,
 *     committees: 상비부 이름 목록 (노회 장부의 배정 상대)
 *   })
 *
 * 노회(presbytery) 장부는 노회 재정부가 쓴다. 과목을 고르고 적요를 따로 적으며,
 * 상회비·세례의무금 납부가 수입으로 저절로 적히고, <상비부 배정> 지출은
 * 그 상비부 장부에 수입으로 함께 적힌다. (74_presbytery_ledger.sql)
 *
 * 항목마다 영수증 사진을 붙일 수 있다. 휴대전화로 찍어 올리면 긴 변 1600px
 * jpg로 줄여 비공개 보관함(receipts)에 담고, 항목의 <영수증> 단추를 누르면
 * 크게 본다. 그 장부를 볼 수 있는 사람만 꺼내 볼 수 있다. (75_ledger_receipts.sql)
 *
 * 적을 수 있는 사람은 화면이 짐작하지 않고 데이터베이스에 물어본다.
 *   is_ledger_owner(종류, 이름)
 *     상비부 : 부장·서기·회계
 *     시찰   : 시찰장·서기·회계 (교역자회 장부도 같다)
 * 그래야 화면에 보이는 것과 실제로 저장되는 것이 어긋나지 않는다.
 */
var SHSLedger = (function () {
  'use strict';

  var KINDS = ['수입', '지출'];

  function esc(s) { return SHS.esc(s); }
  function won(n) { return (Number(n) || 0).toLocaleString('ko-KR'); }
  function kindOf(k) { return ['committee', 'sichal', 'presbytery', 'ministers'].indexOf(k) >= 0 ? k : 'sichal'; }

  /* PDF 도구(html2pdf)는 처음 쓸 때 한 번만 내려받는다 */
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

  /* ---------- 영수증 자동 읽기 (cloudflare/receipts → Claude) ----------
   * 창구 주소가 없으면 조용히 건너뛴다. 읽은 값은 입력칸에 미리 채우고,
   * 저장은 언제나 회계가 확인한 뒤에 한다. */
  function ocrBase() { return (window.SHS_RECEIPTS && SHS_RECEIPTS.base) || ''; }
  function ocrEnabled() { return !!ocrBase(); }
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1] || ''); };
      fr.onerror = function () { reject(new Error('사진을 읽지 못했습니다.')); };
      fr.readAsDataURL(blob);
    });
  }
  function ocrToken() {
    return SHSCloud.init().then(function (c) {
      return c.auth.getSession().then(function (r) {
        return (r && r.data && r.data.session && r.data.session.access_token) || null;
      });
    }).catch(function () { return null; });
  }
  /* 줄인 사진(jpg)을 창구에 보내 {taken_on, vendor, amount, items, payment, confidence, note} 를 받는다 */
  function readReceipt(blob, bookId) {
    if (!ocrEnabled() || !bookId) return Promise.resolve(null);
    return Promise.all([blobToBase64(blob), ocrToken()]).then(function (xs) {
      if (!xs[1]) throw new Error('로그인이 확인되지 않았습니다.');
      return fetch(ocrBase() + '/read', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + xs[1], 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: bookId, media_type: 'image/jpeg', image: xs[0] })
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || !d.ok) throw new Error((d && d.error) || ('HTTP ' + r.status));
        return d.result || null;
      });
    });
  }
  function ocrSummary(o) {
    if (!o) return '';
    var parts = [];
    if (o.taken_on) parts.push(o.taken_on);
    if (o.vendor) parts.push(o.vendor);
    if (o.amount != null) parts.push(won(o.amount) + '원');
    if (o.payment) parts.push(o.payment);
    return parts.join(' · ');
  }

  /* 보관함의 영수증 사진을 문서 안에 넣을 수 있는 글자(data URL)로 바꾼다 */
  function fetchDataUrl(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (resolve) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { resolve(null); };
        fr.readAsDataURL(blob);
      });
    }).catch(function () { return null; });
  }

  /* 영수증 사진을 긴 변 1600px 이하 jpg로 줄인다 (글자가 읽히는 크기, 파일은 작게) */
  function shrinkImage(f) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(f.type)) { reject(new Error('이미지 파일만 올릴 수 있습니다.')); return; }
      var img = new Image();
      var url = URL.createObjectURL(f);
      img.onload = function () {
        var MAX = 1600;
        var sc = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.naturalWidth * sc));
        cv.height = Math.max(1, Math.round(img.naturalHeight * sc));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(function (b) {
          if (b) resolve(b); else reject(new Error('사진을 변환하지 못했습니다.'));
        }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('사진 파일을 읽지 못했습니다.')); };
      img.src = url;
    });
  }

  /* 다른 곳에서 저절로 적힌 항목인지 — 표시말과 어디서 관리하는지 */
  function linkInfo(x) {
    if (x.fee_id) return { tag: '회비 연동', where: '납부 현황에서 관리' };
    if (x.link_kind === 'dues') return { tag: '상회비 연동', where: '상회비 관리에서 관리' };
    if (x.link_kind === 'bapdues') return { tag: '세례의무금 연동', where: '세례의무금 관리에서 관리' };
    if (x.link_kind === 'alloc') return { tag: '재정부 배정', where: '노회 재정부 장부에서 관리' };
    return null;
  }

  function mount(box, opts) {
    if (!box) return;
    var ownerKind = kindOf(opts.kind);
    /* 화면과 기록에 보일 이름 — 교역자회 장부는 owner(시찰 이름) 뒤에 '교역자회'를 붙인다 */
    var ownerLabel = opts.label || (ownerKind === 'ministers' ? opts.owner + ' 교역자회' : opts.owner);
    /* 노회 장부는 과목을 고르고 적요를 따로 적는다. 상비부 배정도 여기서 한다. */
    var useCats = ownerKind === 'presbytery';
    var cats = { '수입': [], '지출': [] };   /* 과목 목록 (ledger_categories) */
    var catRows = [];
    var books = [], book = null, entries = [];
    var receipts = {};        /* 항목 번호 → 영수증 목록 */
    var upTarget = null;      /* 줄의 <올리기>를 눌렀을 때 어느 항목에 붙일지 */
    var pendingFiles = [];    /* 입력 칸에 끌어다 놓거나 고른 사진들 — 저장할 때 함께 올라간다 */
    var payouts = {};         /* 항목 번호 → 지급 확인(받는 사람) 목록 */
    var members = null;       /* 노회 명단 — 받는 사람을 고를 때 처음 한 번 읽는다 */
    var accKnown = false;     /* 계정 유무를 알 수 있었는가 (명단과 계정을 견줄 수 있을 때만) */
    var pendingPayees = [];   /* 입력 칸에서 고른 받는 사람들 — 저장할 때 함께 적는다 */
    /* 항목 목록 — 기본 항목에 더해, 직접 적어 저장한 항목이 저절로 등재된다 */
    var CAT_BASE = {
      '수입': ['회비', '찬조', '노회 지원금', '이자', '기타'],
      '지출': ['사업비', '회의비', '교통비', '식비', '간식비', '숙박비', '총대비', '상회비', '사례비', '월급', '휴가비', '인쇄비', '경조비', '기타']
    };
    var catUsed = { '수입': [], '지출': [] };
    /* 회계연도는 4월에 시작해 다음 해 3월에 끝난다. year는 시작 연도다.
     * 부르는 쪽(감사함 등)이 year 를 주면 그 해부터 연다. */
    var now0 = new Date();
    var year = parseInt(opts.year, 10) ||
      (now0.getMonth() + 1 >= 4 ? now0.getFullYear() : now0.getFullYear() - 1);
    var viewKind = '수입';   /* 지금 보고 있는 탭 — 수입 또는 지출 */

    function fyLabel(y) { return y + ' 회계연도 (' + y + '.4 ~ ' + (y + 1) + '.3)'; }
    /* 적을 수 있는가. 데이터베이스에 물어본 답으로 채운다. */
    var canEdit = !!opts.canEdit;

    var isReviewer = false;   /* 감사부장·감사부 서기 — 회기 마감을 승인한다 */
    function isAdmin() {
      return !!(window.SHSAuth && SHSAuth.canManageMembers && SHSAuth.canManageMembers(opts.user));
    }
    function askCanEdit() {
      return SHSCloud.init().then(function (c) {
        return Promise.all([
          c.rpc('is_ledger_owner', { p_kind: ownerKind, p_owner: opts.owner }),
          c.rpc('is_audit_reviewer').then(function (x) { return x; }, function () { return { data: false }; })
        ]);
      }).then(function (rs) {
        var r = rs[0];
        if (r && !r.error && typeof r.data === 'boolean') canEdit = r.data;
        isReviewer = !!(rs[1] && !rs[1].error && rs[1].data === true);
      }, function () { /* 못 물어보면 부르는 쪽이 준 값을 그대로 쓴다 */ });
    }
    function dt(s) { return String(s || '').replace('T', ' ').slice(0, 16); }

    /* 이 장부를 누가 쓰는지 알려 주는 말 */
    function who() {
      if (ownerKind === 'presbytery') return '노회 회계';
      return opts.kind === 'committee' ? '상비부 회계' : '시찰장·서기·회계';
    }

    function load() {
      box.innerHTML = '<p style="color:var(--gray-5)">회계 장부를 불러오는 중...</p>';
      return SHSCloud.init().then(function (c) {
        return c.from('ledger_books').select('*')
                .eq('owner_kind', ownerKind).eq('owner', opts.owner)
                .order('year', { ascending: false });
      }).then(function (r) {
        if (r.error) {
          box.innerHTML = '<p style="color:var(--gray-5)">회계 장부를 불러오지 못했습니다: ' +
            esc(r.error.message) +
            '<br>Supabase에서 <strong>36_audit_ledger.sql</strong>을 아직 실행하지 않으셨다면 먼저 실행해 주세요.</p>';
          return;
        }
        books = r.data || [];
        book = books.filter(function (b) { return b.year === year; })[0] || null;
        var ids = books.map(function (b) { return b.id; });
        return SHSCloud.init().then(function (c) {
          return Promise.all([
            book ? c.from('ledger_entries').select('*').eq('book_id', book.id)
                    .order('entry_date').order('id')
                 : Promise.resolve({ data: [] }),
            /* 여태 적어 온 항목 이름 — 목록에 저절로 등재된다 (자동 연동 기록은 뺀다) */
            ids.length ? c.from('ledger_entries').select('kind,title,category').in('book_id', ids)
                          .is('fee_id', null).is('link_kind', null)
                          .then(function (x) { return x; }, function () { return { data: [] }; })
                       : Promise.resolve({ data: [] }),
            /* 노회 장부의 과목 목록 */
            useCats ? c.from('ledger_categories').select('*')
                        .eq('owner_kind', ownerKind).eq('owner', opts.owner)
                        .order('sort').order('id')
                        .then(function (x) { return x; }, function () { return { data: [] }; })
                    : Promise.resolve({ data: [] }),
            /* 이 장부의 영수증 (표가 아직 없으면 빈 목록) */
            book ? c.from('ledger_receipts').select('*').eq('book_id', book.id).order('id')
                    .then(function (x) { return x.error ? { data: [] } : x; }, function () { return { data: [] }; })
                 : Promise.resolve({ data: [] }),
            /* 이 장부의 지급 확인 (표가 아직 없으면 빈 목록) */
            book ? c.from('ledger_payouts').select('*').eq('book_id', book.id).order('id')
                    .then(function (x) { return x.error ? { data: [] } : x; }, function () { return { data: [] }; })
                 : Promise.resolve({ data: [] })
          ]);
        }).then(function (rs) {
          entries = (rs[0] && rs[0].data) || [];
          catRows = (rs[2] && rs[2].data) || [];
          cats = { '수입': [], '지출': [] };
          catRows.forEach(function (r) {
            if (cats[r.kind] && cats[r.kind].indexOf(r.name) === -1) cats[r.kind].push(r.name);
          });
          KINDS.forEach(function (k) { if (!cats[k].length) cats[k] = CAT_BASE[k].slice(); });
          receipts = {};
          ((rs[3] && rs[3].data) || []).forEach(function (r) {
            (receipts[r.entry_id] = receipts[r.entry_id] || []).push(r);
          });
          payouts = {};
          ((rs[4] && rs[4].data) || []).forEach(function (r) {
            (payouts[r.entry_id] = payouts[r.entry_id] || []).push(r);
          });
          catUsed = { '수입': [], '지출': [] };
          ((rs[1] && rs[1].data) || []).forEach(function (x) {
            var k = x.kind === '수입' ? '수입' : '지출';
            var cg = String(x.category || '').trim();
            if (useCats && cg && cats[k].indexOf(cg) === -1) cats[k].push(cg);
            var t = String(x.title || '').trim();
            if (t && catUsed[k].indexOf(t) === -1 && CAT_BASE[k].indexOf(t) === -1) {
              catUsed[k].push(t);
            }
          });
          catUsed['수입'].sort(); catUsed['지출'].sort();
          draw();
        });
      });
    }

    function sums() {
      var inc = 0, out = 0;
      entries.forEach(function (x) {
        if (x.kind === '수입') inc += Number(x.amount) || 0;
        else out += Number(x.amount) || 0;
      });
      var open = book ? Number(book.opening_balance) || 0 : 0;
      return { open: open, inc: inc, out: out, left: open + inc - out };
    }

    function yearList() {
      var ys = {};
      books.forEach(function (b) { ys[b.year] = 1; });
      ys[year] = 1;
      ys[now0.getMonth() + 1 >= 4 ? now0.getFullYear() : now0.getFullYear() - 1] = 1;
      return Object.keys(ys).map(Number).sort(function (a, b) { return b - a; });
    }

    function draw() {
      var lock = SHSAuditMark.locked(book);
      var closed = !!(book && book.closed_yn);
      var canWrite = canEdit && !lock && !closed;
      var s = sums();

      var h = '<p style="color:var(--gray-5);font-size:0.88rem">' +
        '회계연도는 <strong>4월부터 다음 해 3월까지</strong>이며, 회계연도 마감을 누르면 ' +
        '남은 돈이 다음 회계연도 이월금으로 저절로 넘어갑니다. ' +
        '<strong>봄·가을 정기노회 전에 감사부의 감사를 받습니다.</strong></p>';

      h += '<div class="inline-form" style="margin-bottom:6px">' +
        '<div class="field" style="flex:0 0 260px"><label>회계 연도</label>' +
        '<select id="lg-year">' + yearList().map(function (y) {
          return '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>' + fyLabel(y) + '</option>';
        }).join('') + '</select></div>' +
        (books.length ? '' :
          '<div class="field"><label>&nbsp;</label>' +
          '<div style="padding-top:9px;color:var(--gray-5);font-size:0.88rem">아직 만들어 둔 장부가 없습니다.</div></div>') +
        '</div>';

      if (!book) {
        h += '<div class="notice-banner">' + fyLabel(year) + ' 장부가 아직 없습니다.' +
          (canEdit ? ' 아래에서 만들어 주세요.' : ' 장부는 ' + who() + '가 만듭니다.') + '</div>';
        if (canEdit) {
          h += '<div class="admin-card"><h3 style="margin-top:0">' + fyLabel(year) + ' 장부 만들기</h3>' +
            '<div class="inline-form">' +
            '<div class="field" style="flex:0 0 220px"><label>이월금 (원)</label>' +
            '<input type="number" id="lg-open" value="0" step="1"></div>' +
            '<button class="btn" id="lg-new">장부 만들기</button>' +
            '</div>' +
            '<p style="font-size:0.82rem;color:var(--gray-5)">' +
            (books.filter(function (b) { return b.year === year - 1; }).length
              ? '만든 뒤 <strong>지난해 잔액 가져오기</strong>를 누르면 ' + (year - 1) + '년 남은 돈이 이월금으로 들어옵니다.'
              : (year - 1) + '년 장부가 없어 이월금은 손으로 적어 주셔야 합니다.') +
            '</p>' +
            '<div class="form-msg" id="lg-nmsg"></div></div>';
        }
        box.innerHTML = h;
        bindYear();
        if (canEdit) bindNew();
        return;
      }

      /* 요약 */
      h += '<div class="ledger-sum">' +
        '<div><span>이월금</span><strong>' + won(s.open) + '</strong></div>' +
        '<div><span>수입</span><strong class="inc">+' + won(s.inc) + '</strong></div>' +
        '<div><span>지출</span><strong class="out">−' + won(s.out) + '</strong></div>' +
        '<div class="left"><span>남은 돈</span><strong>' + won(s.left) + '</strong></div>' +
        '</div>';

      if (lock) {
        h += '<div class="notice-banner">이 장부는 <strong>감사가 끝났습니다.</strong> ' +
          '더 이상 고치거나 지울 수 없습니다.</div>';
      } else if (closed) {
        h += '<div class="notice-banner">이 장부는 <strong>' + fyLabel(year) + ' 마감</strong>되었습니다. ' +
          '남은 돈 ' + won(s.left) + '원이 ' + (year + 1) + ' 회계연도 이월금으로 넘어갔습니다.' +
          (book.close_approved_at
            ? '<div style="font-size:0.84rem;margin-top:4px">감사부 승인: ' + esc(dt(book.close_approved_at)) +
              ' ' + esc(book.close_approved_by || '') +
              (book.close_opinion ? ' · 의견: ' + esc(book.close_opinion) : '') +
              (book.close_requested_by ? ' <span style="color:var(--gray-5)">(요청 ' + esc(dt(book.close_requested_at)) +
                ' ' + esc(book.close_requested_by) + ')</span>' : '') + '</div>'
            : '') +
          (isReviewer || isAdmin()
            ? ' <button class="btn ghost sm" id="lg-reopen" style="margin-left:8px">마감 취소</button>'
            : '') +
          '</div>';
      } else if (book.close_requested_at) {
        /* 마감 승인을 기다리는 중 — 감사부장·서기에게는 승인·반려 단추가 보인다 */
        h += '<div class="notice-banner" style="border-left:4px solid #d9a33b">' +
          '<strong>마감 승인 요청 중</strong> — ' + esc(dt(book.close_requested_at)) + ' ' +
          esc(book.close_requested_by || '') + ' 님이 ' + fyLabel(year) + ' 마감 승인을 요청했습니다.' +
          (book.close_request_note ? ' <span style="color:var(--gray-6)">요청 말씀: ' + esc(book.close_request_note) + '</span>' : '') +
          ' 감사부장·감사부 서기가 승인하면 남은 돈 ' + won(s.left) + '원이 ' + (year + 1) +
          ' 회계연도 이월금으로 넘어가고 장부가 잠깁니다.' +
          (isReviewer || isAdmin()
            ? '<div class="inline-form" style="margin-top:10px;align-items:flex-end">' +
              '<div class="field"><label>감사 의견 (선택)</label><input type="text" id="lg-opinion" placeholder="예: 증빙 확인, 이상 없음"></div>' +
              '<button class="btn sm" id="lg-approve">회기 마감 승인</button>' +
              '<button class="btn ghost sm" id="lg-reject">반려</button></div>'
            : '') +
          (canEdit
            ? '<div style="margin-top:8px"><button class="btn ghost sm" id="lg-reqcancel">요청 취소</button></div>'
            : '') +
          '<div class="form-msg" id="lg-cmsg"></div></div>';
      } else if (book.close_opinion && !book.close_approved_at) {
        /* 반려된 적이 있으면 그 사유를 보여 준다 */
        h += '<div class="notice-banner" style="border-left:4px solid #a33">지난 마감 요청이 <strong>반려</strong>되었습니다. ' +
          '사유: ' + esc(book.close_opinion) + ' — 장부를 고친 뒤 다시 마감 승인을 요청해 주세요.</div>';
      }

      if (canWrite) {
        h += '<div class="inline-form" style="margin-bottom:10px">' +
          '<div class="field" style="flex:0 0 220px"><label>이월금 (원)</label>' +
          '<input type="number" id="lg-open" value="' + (Number(book.opening_balance) || 0) + '" step="1"></div>' +
          '<button class="btn ghost" id="lg-opensave">이월금 저장</button>' +
          (books.filter(function (b) { return b.year === year - 1; }).length
            ? '<button class="btn ghost" id="lg-carry">지난해 잔액 가져오기</button>' : '') +
          (book.close_requested_at ? '' : '<button class="btn ghost" id="lg-close">마감 승인 요청</button>') +
          '</div><div class="form-msg" id="lg-omsg"></div>';
      }

      /* 수입·지출을 탭으로 나눠 본다 */
      var incRows = entries.filter(function (x) { return x.kind === '수입'; });
      var outRows = entries.filter(function (x) { return x.kind !== '수입'; });
      /* 수입은 초록, 지출은 붉은 알약 탭으로 한눈에 구분한다 (css .lg-kind-tabs) */
      var nRc = 0;
      entries.forEach(function (x) { nRc += (receipts[x.id] || []).length; });
      h += '<div class="tabs lg-kind-tabs" id="lg-tabs" style="margin:14px 0 12px">' +
        KINDS.map(function (k) {
          var n = k === '수입' ? incRows.length : outRows.length;
          return '<button class="' + (k === '수입' ? 'lg-tab-inc' : 'lg-tab-out') +
            (viewKind === k ? ' active' : '') + '" data-lk="' + k + '">' +
            (k === '수입' ? '＋ ' : '－ ') + k + '<span class="lg-tab-n">(' + n + '건)</span></button>';
        }).join('') +
        /* 영수증 보관함·재정보고서 — 장부 곁에 두어 바로 넘겨 본다 */
        '<span class="lg-tab-gap"></span>' +
        '<button class="lg-tab-etc' + (viewKind === 'receipts' ? ' active' : '') + '" data-lk="receipts">' +
        '&#128206; 영수증 보관함<span class="lg-tab-n">(' + nRc + '장)</span></button>' +
        '<button class="lg-tab-etc' + (viewKind === 'report' ? ' active' : '') + '" data-lk="report">' +
        '&#128196; 재정보고서</button>' +
        '</div>';

      var ledgerView = viewKind === '수입' || viewKind === '지출';
      if (viewKind === 'receipts') h += archiveHtml(outRows);
      else if (viewKind === 'report') h += '<div id="lg-report" style="margin-top:4px"></div>';

      /* 입력 섹션이 먼저, 그 아래에 장부가 쌓인다 */
      if (ledgerView && canWrite) h += entryForm();

      var shown = viewKind === '수입' ? incRows : outRows;
      var shownSum = 0;
      shown.forEach(function (x) { shownSum += Number(x.amount) || 0; });

      if (!ledgerView) {
        /* 보관함·보고서 탭에서는 장부 표를 그리지 않는다 */
      } else if (!shown.length) {
        h += '<p style="color:var(--gray-5)">적어 둔 ' + viewKind + '이 없습니다.' +
          (canWrite ? ' 위 입력 칸에 기록하시면 이 자리에 장부가 만들어집니다.' : '') + '</p>';
      } else {
        h += '<table class="tbl"><thead><tr><th style="width:120px">일자</th>' +
          (useCats ? '<th style="width:130px">과목</th>' : '') +
          '<th style="width:140px">' + (viewKind === '지출' ? '지출처' : '교회') + '</th>' +
          '<th>' + (useCats ? '적요' : '항목') + '</th>' +
          '<th style="width:140px">금액 (원)</th><th style="width:200px">비고</th>' +
          (viewKind === '지출' ? '<th style="width:92px">영수증</th>' : '') +
          (canWrite ? '<th style="width:110px">관리</th>' : '') + '</tr></thead><tbody>';
        shown.forEach(function (x) {
          var amt = Number(x.amount) || 0;
          var ln = linkInfo(x);   /* 다른 곳과 연동된 항목인가 */
          h += '<tr><td>' + esc(x.entry_date || '-') + '</td>' +
            (useCats
              ? '<td>' + (x.category ? esc(x.category) : '<span style="color:var(--gray-5)">-</span>') + '</td>'
              : '') +
            '<td>' + (x.church ? esc(x.church) : '<span style="color:var(--gray-5)">-</span>') + '</td>' +
            '<td class="left">' + esc(x.title) +
            (x.category && !useCats && !ln
              ? ' <span style="font-size:0.8rem;color:var(--gray-5)">(' + esc(x.category) + ')</span>' : '') +
            (x.alloc_to
              ? ' <span style="font-size:0.78rem;color:var(--navy)">→ ' + esc(x.alloc_to) + '</span>' : '') +
            (ln ? ' <span style="font-size:0.74rem;color:#b03a3a">' + ln.tag + '</span>' : '') +
            '</td>' +
            '<td class="' + (viewKind === '수입' ? 'lg-inc' : 'lg-out') + '" style="text-align:right">' +
            (viewKind === '수입' ? '+' : '−') + won(amt) + '</td>' +
            '<td class="left">' + (x.note ? esc(x.note) : '<span style="color:var(--gray-5)">-</span>') + '</td>' +
            (viewKind === '지출'
              ? '<td' + (canWrite && !ln ? ' class="lg-dropcell" data-lgdrop="' + x.id + '" title="영수증 사진을 여기에 끌어다 놓아도 됩니다"' : '') +
                '>' + receiptCell(x, ln, canWrite) + '</td>'
              : '') +
            (canWrite
              ? (ln
                  /* 연동 항목은 원본(납부 현황·노회 장부)에서 고치면 함께 바뀐다 */
                  ? '<td><span style="font-size:0.78rem;color:var(--gray-5)">' + ln.where + '</span></td>'
                  : '<td><button class="btn ghost sm" data-lgedit="' + x.id + '">수정</button> ' +
                    '<button class="btn danger sm" data-lgdel="' + x.id + '">삭제</button></td>')
              : '') +
            '</tr>';
        });
        h += '<tr style="font-weight:700;background:var(--gray-1,#f4f5f8)"><td>합계</td>' +
          (useCats ? '<td></td>' : '') + '<td></td><td></td>' +
          '<td class="' + (viewKind === '수입' ? 'lg-inc' : 'lg-out') + '" style="text-align:right">' +
          (viewKind === '수입' ? '+' : '−') + won(shownSum) + '</td><td></td>' +
          (viewKind === '지출' ? '<td></td>' : '') +
          (canWrite ? '<td></td>' : '') + '</tr>';
        h += '</tbody></table>';
      }

      h += '<div id="lg-audit" style="margin-top:16px">' +
        SHSAuditMark.panel(book, { isAuditor: opts.isAuditor }) + '</div>';
      /* 줄의 <올리기>가 쓰는 숨은 파일 입력 (카메라나 사진첩이 열린다) */
      if (canWrite) h += '<input type="file" id="lg-upfile" accept="image/*" multiple class="hidden">';

      box.innerHTML = h;
      bindYear();
      bindTabs();
      bindReceipts(canWrite);
      if (canWrite) { bindOpening(); if (ledgerView) { bindEntryForm(); bindEntryList(); if (useCats) bindCats(); } }
      if (viewKind === 'receipts') bindArchive(canWrite);
      if (viewKind === 'report') report(document.getElementById('lg-report'), { kind: opts.kind, owner: opts.owner, label: opts.label, year: year });

      /* 마감 취소 — 잘못 마감했을 때 임원이 되돌린다 */
      var ro = document.getElementById('lg-reopen');
      if (ro) ro.addEventListener('click', function () {
        if (!confirm(fyLabel(year) + ' 마감을 취소하시겠습니까?\n' +
                     '다음 회계연도 이월금은 그대로 두므로, 장부를 고친 뒤 다시 마감 승인을 요청해 주세요.')) return;
        SHSCloud.init().then(function (c) {
          return c.rpc('reopen_ledger_year', { p_book: book.id });
        }).then(function (r) {
          if (r.error) { alert(r.error.message); return; }
          SHSCloud.log('update', '회계연도 마감 취소', ownerLabel + ' ' + year + ' 회계연도');
          load();
        });
      });
      SHSAuditMark.bind(document.getElementById('lg-audit'), {
        kind: 'ledger_books', label: ownerLabel + ' ' + year + '년 회계 장부', after: load
      });

      /* 회기 마감 승인 — 감사부장·서기가 누르면 그 자리에서 이월·잠금까지 된다 */
      var ap = document.getElementById('lg-approve');
      if (ap) ap.addEventListener('click', function () {
        var s3 = sums();
        if (!confirm(fyLabel(year) + ' 마감을 승인합니다.\n\n남은 돈 ' + won(s3.left) + '원이 ' + (year + 1) +
              ' 회계연도 이월금으로 넘어가고, 이 장부에는 더 적을 수 없습니다.\n\n계속하시겠습니까?')) return;
        var op = document.getElementById('lg-opinion');
        var cm = document.getElementById('lg-cmsg');
        cm.className = 'form-msg'; cm.textContent = '승인 중입니다...';
        SHSCloud.init().then(function (c) {
          return c.rpc('approve_ledger_close', { p_book: book.id, p_opinion: op ? op.value.trim() : '' });
        }).then(function (r) {
          if (r.error) { cm.className = 'form-msg err'; cm.textContent = r.error.message; return; }
          SHSCloud.log('update', '회기 마감 승인', ownerLabel + ' ' + year + ' 회계연도 → 이월금 ' + won(r.data) + '원');
          load();
        });
      });
      var rj = document.getElementById('lg-reject');
      if (rj) rj.addEventListener('click', function () {
        var reason = prompt('반려 사유를 적어 주세요 (요청한 회계에게 알림으로 갑니다)', '');
        if (reason === null) return;
        var cm = document.getElementById('lg-cmsg');
        cm.className = 'form-msg'; cm.textContent = '반려 중입니다...';
        SHSCloud.init().then(function (c) {
          return c.rpc('reject_ledger_close', { p_book: book.id, p_reason: reason.trim() });
        }).then(function (r) {
          if (r.error) { cm.className = 'form-msg err'; cm.textContent = r.error.message; return; }
          SHSCloud.log('update', '회기 마감 반려', ownerLabel + ' ' + year + ' 회계연도');
          load();
        });
      });
      var rc = document.getElementById('lg-reqcancel');
      if (rc) rc.addEventListener('click', function () {
        if (!confirm('마감 승인 요청을 취소하시겠습니까?')) return;
        SHSCloud.init().then(function (c) {
          return c.rpc('cancel_ledger_close_request', { p_book: book.id });
        }).then(function (r) {
          if (r.error) { alert(r.error.message); return; }
          SHSCloud.log('update', '회기 마감 요청 취소', ownerLabel + ' ' + year + ' 회계연도');
          load();
        });
      });
    }

    function bindYear() {
      var sel = document.getElementById('lg-year');
      if (sel) sel.addEventListener('change', function () {
        year = parseInt(this.value, 10);
        load();
      });
    }

    /* ----- 영수증 보관함 — 이 회계연도의 영수증 사진을 한눈에 ----- */
    function archiveHtml(rows) {
      var cards = [], missing = [], nRc = 0, sumRc = 0;
      rows.forEach(function (x) {
        var list = receipts[x.id] || [];
        var po = payouts[x.id] || [];
        if (list.length) { nRc += list.length; sumRc += Number(x.amount) || 0; }
        else if (!po.length && !linkInfo(x)) missing.push(x);
        list.forEach(function (r, i) {
          var read = [r.taken_on, r.vendor].filter(Boolean).join(' · ');
          cards.push('<div class="lg-arc-card" data-lgarc="' + x.id + '" data-lgat="' + i + '" title="크게 보기">' +
            '<div class="lg-arc-thumb"><img data-lgpath="' + esc(r.file_path) + '" alt=""></div>' +
            '<div class="lg-arc-meta">' +
            '<div><strong>' + esc(x.entry_date || '') + '</strong> ' + esc(x.title) + '</div>' +
            '<div class="lg-out" style="font-weight:700">−' + won(x.amount) + '원' +
            (list.length > 1 ? ' <small style="font-weight:400;color:var(--gray-5)">' + (i + 1) + '/' + list.length + '</small>' : '') + '</div>' +
            (read ? '<div style="color:var(--gray-5)">' + esc(read) + '</div>' : '') +
            '</div></div>');
        });
      });
      var h = '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;margin:0 0 10px">' +
        '<strong style="font-size:1.02rem">영수증 보관함 — ' + fyLabel(year) + '</strong>' +
        '<span style="color:var(--gray-5);font-size:0.88rem">영수증 ' + nRc + '장 · 영수증이 붙은 지출 ' + won(sumRc) + '원</span></div>';
      h += cards.length
        ? '<div class="lg-arc">' + cards.join('') + '</div>'
        : '<p style="color:var(--gray-5)">아직 올린 영수증이 없습니다. 지출을 적을 때 사진을 붙이거나, 지출 줄의 「+」로 올릴 수 있습니다.</p>';
      if (missing.length) {
        h += '<details style="margin-top:16px"><summary style="cursor:pointer;color:#b03a3a;font-weight:600">' +
          '증빙이 없는 지출 ' + missing.length + '건 <small style="font-weight:400;color:var(--gray-5)">— 영수증도 지급 확인도 없는 항목</small></summary>' +
          '<table class="tbl" style="margin-top:8px;font-size:0.88rem"><thead><tr><th style="width:110px">일자</th>' +
          '<th>항목</th><th style="width:130px">금액 (원)</th></tr></thead><tbody>' +
          missing.map(function (x) {
            return '<tr><td>' + esc(x.entry_date || '') + '</td><td class="left">' + esc(x.title) +
              (x.note ? ' <small style="color:var(--gray-5)">' + esc(x.note) + '</small>' : '') + '</td>' +
              '<td class="lg-out" style="text-align:right">−' + won(x.amount) + '</td></tr>';
          }).join('') + '</tbody></table>' +
          '<p style="font-size:0.8rem;color:var(--gray-5)">지출 탭에서 줄의 「+」로 영수증을 붙이거나, 회의비·거마비는 「수령확인」으로 받는 사람의 확인을 받아 두세요.</p></details>';
      }
      return h;
    }
    /* 보관함 사진은 비공개 저장소에 있으므로 잠시 쓰는 주소를 받아 보여 준다 */
    function bindArchive(canWrite) {
      var imgs = box.querySelectorAll('img[data-lgpath]');
      var paths = [];
      imgs.forEach(function (im) { if (paths.indexOf(im.dataset.lgpath) < 0) paths.push(im.dataset.lgpath); });
      if (paths.length) {
        SHSCloud.init().then(function (c) {
          var st = c.storage.from('receipts');
          if (typeof st.createSignedUrls === 'function') return st.createSignedUrls(paths, 600);
          return Promise.all(paths.map(function (pth) {
            return st.createSignedUrl(pth, 600).then(function (r) {
              return { path: pth, signedUrl: r && r.data && r.data.signedUrl };
            });
          })).then(function (arr) { return { data: arr }; });
        }).then(function (res) {
          var map = {};
          ((res && res.data) || []).forEach(function (r) { if (r.signedUrl) map[r.path] = r.signedUrl; });
          imgs.forEach(function (im) {
            var u = map[im.dataset.lgpath];
            if (u) im.src = u; else im.parentNode.innerHTML = '<span class="lg-arc-miss">사진을 불러오지 못했습니다</span>';
          });
        }, function () {});
      }
      box.querySelectorAll('.lg-arc-card').forEach(function (card) {
        card.addEventListener('click', function () {
          openReceipts(card.dataset.lgarc, canWrite, parseInt(card.dataset.lgat, 10) || 0);
        });
      });
    }

    function bindTabs() {
      box.querySelectorAll('#lg-tabs button').forEach(function (b) {
        b.addEventListener('click', function () {
          viewKind = b.dataset.lk;
          draw();
        });
      });
    }

    function bindNew() {
      document.getElementById('lg-new').addEventListener('click', function () {
        var msg = document.getElementById('lg-nmsg');
        var open = parseInt(document.getElementById('lg-open').value, 10) || 0;
        msg.className = 'form-msg'; msg.textContent = '만드는 중입니다...';
        SHSCloud.init().then(function (c) {
          return c.from('ledger_books').insert({
            owner_kind: ownerKind, owner: opts.owner, year: year,
            opening_balance: open, updated_by: opts.user.name
          }).select();
        }).then(function (r) {
          var w = SHS.wrote(r);
          if (!w.ok) { msg.className = 'form-msg err'; msg.textContent = w.why; return; }
          SHSCloud.log('create', '회계 장부 개설', ownerLabel + ' ' + year + '년');
          load();
        });
      });
    }

    function bindOpening() {
      document.getElementById('lg-opensave').addEventListener('click', function () {
        var msg = document.getElementById('lg-omsg');
        var open = parseInt(document.getElementById('lg-open').value, 10) || 0;
        msg.className = 'form-msg'; msg.textContent = '저장 중입니다...';
        SHSCloud.init().then(function (c) {
          return c.from('ledger_books')
                  .update({ opening_balance: open, updated_at: new Date().toISOString(),
                            updated_by: opts.user.name })
                  .eq('id', book.id).select();
        }).then(function (r) {
          var w = SHS.wrote(r);
          if (!w.ok) { msg.className = 'form-msg err'; msg.textContent = w.why; return; }
          SHSCloud.log('update', '이월금 수정', ownerLabel + ' ' + year + '년 → ' + won(open) + '원');
          load();
        });
      });
      var cy = document.getElementById('lg-carry');
      if (cy) cy.addEventListener('click', function () {
        if (!confirm((year - 1) + ' 회계연도 남은 돈을 ' + year + ' 회계연도 이월금으로 가져옵니다.\n계속하시겠습니까?')) return;
        var msg = document.getElementById('lg-omsg');
        msg.className = 'form-msg'; msg.textContent = '가져오는 중입니다...';
        SHSCloud.init().then(function (c) {
          return c.rpc('carry_over_balance', { p_book: book.id });
        }).then(function (r) {
          if (r.error) { msg.className = 'form-msg err'; msg.textContent = r.error.message; return; }
          SHSCloud.log('update', '지난해 잔액 이월', ownerLabel + ' ' + year + '년 ← ' + won(r.data) + '원');
          load();
        });
      });

      /* 마감 승인 요청 — 감사부장·서기가 승인하면 남은 돈이 다음 회계연도 이월금으로 넘어간다 */
      var cl = document.getElementById('lg-close');
      if (cl) cl.addEventListener('click', function () {
        var s2 = sums();
        var note = prompt(fyLabel(year) + ' 마감 승인을 감사부장·감사부 서기에게 요청합니다.\n\n' +
          '남은 돈 ' + won(s2.left) + '원이 승인과 함께 ' + (year + 1) + ' 회계연도 이월금으로 넘어가고, ' +
          '마감된 장부에는 더 적을 수 없습니다.\n\n감사부에 전할 말씀이 있으면 적어 주세요 (없으면 비워 두고 확인)', '');
        if (note === null) return;
        var msg = document.getElementById('lg-omsg');
        msg.className = 'form-msg'; msg.textContent = '요청을 보내는 중입니다...';
        SHSCloud.init().then(function (c) {
          return c.rpc('request_ledger_close', { p_book: book.id, p_note: note.trim() });
        }).then(function (r) {
          if (r.error) {
            msg.className = 'form-msg err';
            msg.textContent = r.error.message + ' (78_ledger_close_approval.sql 실행이 필요할 수 있습니다)';
            return;
          }
          SHSCloud.log('update', '회기 마감 승인 요청', ownerLabel + ' ' + year + ' 회계연도');
          load();
        });
      });
    }

    var ALLOC_CAT = '상비부 배정';   /* 이 과목의 지출은 상비부 장부에 수입으로 함께 적힌다 */

    function entryForm() {
      var today = new Date().toISOString().slice(0, 10);
      /* 노회 장부: 과목을 고르고, 상비부 배정이면 어느 상비부인지 고른다 */
      var catField = useCats
        ? '<div class="field" style="flex:0 0 200px"><label>과목 (고르거나 직접 입력)</label>' +
          '<input type="text" id="lg-cat" list="lg-catlist" placeholder="' +
          (viewKind === '수입' ? '예: 상회비, 찬조금' : '예: 상비부 배정, 사무비') + '">' +
          '<datalist id="lg-catlist">' + cats[viewKind].map(function (x) {
            return '<option value="' + esc(x) + '"></option>';
          }).join('') + '</datalist></div>' +
          (viewKind === '지출'
            ? '<div class="field hidden" id="lg-alloc-f" style="flex:0 0 200px"><label>배정 상비부</label>' +
              '<select id="lg-alloc"><option value="">고르세요</option>' +
              (opts.committees || []).map(function (x) {
                return '<option value="' + esc(x) + '">' + esc(x) + '</option>';
              }).join('') + '</select></div>'
            : '')
        : '';
      return '<div class="admin-card" style="margin-bottom:16px">' +
        '<h3 style="margin-top:0;color:' + (viewKind === '수입' ? '#1a6d3a' : '#b03a3a') + '" id="lg-ftitle">' +
        viewKind + ' 적기</h3>' +
        '<input type="hidden" id="lg-id" value="">' +
        '<div class="inline-form">' +
        '<div class="field" style="flex:0 0 160px"><label>일자</label>' +
        '<input type="date" id="lg-date" value="' + today + '"></div>' +
        catField +
        /* 수입은 낸 교회, 지출은 돈이 나간 곳(상호·기관·사람) */
        '<div class="field" style="flex:0 0 170px"><label>' + (viewKind === '지출' ? '지출처 (선택)' : '교회명 (선택)') + '</label>' +
        '<input type="text" id="lg-church" list="lg-churches" placeholder="' + (viewKind === '지출' ? '지출처를 적으세요' : '교회를 고르거나 적으세요') + '">' +
        '<datalist id="lg-churches">' +
        (opts.churches || []).map(function (x) {
          return '<option value="' + esc(x) + '"></option>';
        }).join('') + '</datalist></div>' +
        '<div class="field"><label>' + (useCats ? '적요' : '항목 (고르거나 직접 입력)') + '</label>' +
        '<input type="text" id="lg-title" list="lg-cats" placeholder="' +
        (useCats
          ? (viewKind === '수입' ? '예: ○○교회 찬조금' : '예: 정기노회 식사비')
          : (viewKind === '수입' ? '예: 회비, 찬조' : '예: 사업비, 식비')) + '">' +
        '<datalist id="lg-cats">' +
        (useCats ? [] : CAT_BASE[viewKind].concat(catUsed[viewKind])).map(function (x) {
          return '<option value="' + esc(x) + '"></option>';
        }).join('') +
        '</datalist></div>' +
        '<div class="field" style="flex:0 0 170px"><label>금액 (원)</label>' +
        '<input type="number" id="lg-amt" min="0" step="1"></div>' +
        '</div>' +
        '<div class="field"><label>비고 (선택)</label><input type="text" id="lg-note"></div>' +
        /* 영수증 사진은 지출에만 붙인다 — 수입은 증빙이 필요 없다 */
        (viewKind === '지출' ? '<div class="field"><label>영수증 사진 (선택)</label>' +
        '<div class="lg-drop" id="lg-drop" tabindex="0" role="button">' +
        '<input type="file" id="lg-file" accept="image/*" multiple class="hidden">' +
        '<div id="lg-drop-text">여기에 영수증 사진을 <strong>끌어다 놓거나</strong> 눌러서 고르세요 ' +
        '<span style="color:var(--gray-5)">(휴대전화에서는 바로 찍을 수 있습니다 · 여러 장 가능)</span></div>' +
        '<div class="lg-drop-list" id="lg-drop-list"></div></div>' +
        '<div id="lg-ocr" class="lg-ocr"></div>' +
        '<div style="font-size:0.78rem;color:var(--gray-5);margin-top:3px">' +
        (ocrEnabled() ? '사진을 놓으면 일자·사용처·금액을 자동으로 읽어 미리 채웁니다(확인 후 저장). ' : '') +
        '저장하면 사진이 함께 올라가고, ' +
        '줄의 <strong>영수증</strong> 단추로 언제든 다시 볼 수 있습니다. ' +
        '이미 적은 줄에는 영수증 칸에 사진을 바로 끌어다 놓아도 됩니다.</div></div>' : '') +
        (viewKind === '지출' ? payeeForm() : '') +
        '<button class="btn" id="lg-save">저장</button> ' +
        '<button class="btn ghost hidden" id="lg-cancel">취소</button>' +
        '<div class="form-msg" id="lg-msg"></div>' +
        (useCats ? catManager() : '') +
        '</div>';
    }

    /* ================= 지급 확인 =================
     * 회의비·거마비처럼 영수증이 없는 지출은 받는 사람을 적어 둔다.
     * 계정이 있으면 알림이 가고 본인이 수령 확인을 누른다. (76_ledger_payouts.sql) */
    function payeeForm() {
      /* 붉은 상자 — 영수증 대신 받는 사람의 확인으로 증빙하는, 성격이 다른 지출임을 드러낸다 */
      return '<details id="lg-payout" style="margin:4px 0 14px;border:1.5px solid #e0a9a9;background:#fdf3f3;border-radius:8px;padding:10px 14px"' +
        (pendingPayees.length ? ' open' : '') + '>' +
        '<summary style="cursor:pointer;font-size:0.92rem;font-weight:700;color:#b03a3a">지급 확인 받기 — ' +
        '회의비·거마비처럼 영수증이 없는 지출</summary>' +
        '<div style="margin-top:8px">' +
        '<p style="font-size:0.82rem;color:var(--gray-5);margin:0 0 8px">받는 사람은 <strong>한 명씩</strong> 이름을 적고 「적은 사람 추가」를 누르거나, ' +
        '<strong>여럿을 한 번에</strong> 「회원 일괄 선택」으로 고릅니다. 고른 사람은 아래 <strong>추가된 명단</strong>에 모입니다.</p>' +
        '<div class="inline-form">' +
        '<div class="field"><label>받는 사람 한 명씩 적기 (이름을 적어 목록에서 고르세요)</label>' +
        '<input type="text" id="lg-payee" list="lg-members" placeholder="이름을 적으면 목록이 나옵니다" autocomplete="off">' +
        '<datalist id="lg-members"></datalist></div>' +
        '<div class="field" style="flex:0 0 150px"><label>1인 금액 (원)</label>' +
        '<input type="number" id="lg-payamt" min="0" step="1000"></div>' +
        '<div class="field" style="flex:0 0 auto"><label>&nbsp;</label>' +
        '<button type="button" class="btn ghost sm" id="lg-payadd">적은 사람 추가</button> ' +
        '<button type="button" class="btn ghost sm" id="lg-paybulk">회원 일괄 선택</button></div>' +
        '</div>' +
        '<div id="lg-paylist-head" style="margin-top:12px;font-size:0.88rem;font-weight:700;color:var(--navy)"></div>' +
        '<div class="lg-chips" id="lg-paylist" style="margin-top:6px"></div>' +
        '<div class="form-msg" id="lg-paymsg"></div>' +
        '<p style="font-size:0.78rem;color:var(--gray-5);margin:6px 0 0">저장하면 받는 분마다 알림이 가고, 본인이 ' +
        '<strong>수령 확인</strong>을 누르면 영수증을 대신합니다. 계정이 없는 회원은 회계가 수기로 확인 처리합니다.</p>' +
        '</div></details>';
    }

    function memberLabel(m) { return m.name + ' (' + (m.church || '') + ')'; }

    /* 노회 명단과 계정 유무 — 처음 한 번만 읽는다 */
    function loadMembers() {
      if (members) return Promise.resolve(members);
      return SHSCloud.init().then(function (c) {
        return Promise.all([
          c.from('roster').select('id,name,church,position,category,sichal,sort,officer_title,role')
            .eq('active', true).order('sort').order('id'),
          c.from('profiles').select('roster_id,name')
            .then(function (x) { return x; }, function () { return { data: null }; })
        ]);
      }).then(function (rs) {
        var acc = {}, accName = {};
        var profs = rs[1] && !rs[1].error ? rs[1].data : null;
        accKnown = !!profs;
        (profs || []).forEach(function (p) {
          if (p.roster_id) acc[p.roster_id] = 1;
          if (p.name) accName[p.name] = 1;
        });
        members = ((rs[0] && rs[0].data) || []).map(function (m) {
          return { roster_id: m.id, name: m.name, church: m.church || '', position: m.position || '',
                   category: m.category || '', sichal: m.sichal || '', sort: Number(m.sort) || 0,
                   title: m.officer_title || '', role: m.role || '',
                   has_account: !!(acc[m.id] || accName[m.name]) };
        });
        return members;
      }, function () { members = []; return members; });
    }

    /* 상비부 명부(부장·서기·회계·년조·위원) — 처음 한 번만 읽는다 */
    var committeeRows = null;
    function loadCommittees() {
      if (committeeRows) return Promise.resolve(committeeRows);
      return SHSCloud.init().then(function (c) {
        return c.from('committees').select('name,head,clerk,treasurer,y1,y2,y3,members,sort').order('sort');
      }).then(function (r) {
        committeeRows = (r && !r.error && r.data) || [];
        return committeeRows;
      }, function () { committeeRows = []; return committeeRows; });
    }

    /* 적은 글이 명단의 누구인지 — "이름 (교회)" 또는 이름만(한 사람일 때) */
    function matchMember(text) {
      var t = String(text || '').trim();
      if (!t || !members) return null;
      var hit = members.filter(function (m) { return memberLabel(m) === t; })[0];
      if (hit) return hit;
      var name = t.replace(/\s*\(.*$/, '').trim();
      var same = members.filter(function (m) { return m.name === name; });
      return same.length === 1 ? same[0] : null;
    }

    function fillMemberList(id) {
      var dl = document.getElementById(id || 'lg-members');
      if (!dl || !members) return;
      dl.innerHTML = members.map(function (m) {
        return '<option value="' + esc(memberLabel(m)) + '"></option>';
      }).join('');
    }

    function addPayee(m) {
      if (!m) return;
      if (pendingPayees.some(function (x) { return x.roster_id === m.roster_id; })) return;
      pendingPayees.push(m);
      renderPayees();
    }

    function renderPayees() {
      var list = document.getElementById('lg-paylist');
      if (!list) return;
      var head = document.getElementById('lg-paylist-head');
      if (head) {
        head.innerHTML = pendingPayees.length
          ? '추가된 명단 <span style="color:var(--accent)">' + pendingPayees.length + '명</span> ' +
            '<small style="font-weight:400;color:var(--gray-5)">— 저장을 누르면 이 분들께 지급 확인이 갑니다. ×로 뺄 수 있습니다.</small>'
          : '추가된 명단 <small style="font-weight:400;color:var(--gray-5)">— 아직 없습니다.</small>';
      }
      list.innerHTML = pendingPayees.map(function (m, i) {
        return '<span>' + esc(m.name) + ' <small style="color:var(--gray-5)">' + esc(m.church) + '</small>' +
          (accKnown && !m.has_account ? ' <small style="color:#b0731f">계정 없음</small>' : '') +
          ' <button type="button" data-lgpd="' + i + '" title="빼기">&times;</button></span>';
      }).join('');
      list.querySelectorAll('button[data-lgpd]').forEach(function (b) {
        b.addEventListener('click', function () {
          pendingPayees.splice(parseInt(b.dataset.lgpd, 10), 1);
          renderPayees();
        });
      });
    }

    function bindPayees() {
      var inp = document.getElementById('lg-payee');
      if (!inp) return;
      loadMembers().then(function () { fillMemberList('lg-members'); });
      function say(cls, text) {
        var el = document.getElementById('lg-paymsg');
        if (el) { el.className = 'form-msg' + (cls ? ' ' + cls : ''); el.textContent = text || ''; }
      }
      /* <더하기>는 이름 칸에 적은 한 사람을 넣는다. 빈 채로 누르면(일괄 선택 뒤에 흔히 그런다)
       * 이미 고른 사람은 저장할 때 함께 적힌다고 알려 주기만 한다. */
      function addFromInput() {
        var t = inp.value.trim();
        if (!t) {
          say('', pendingPayees.length
            ? '추가된 명단 ' + pendingPayees.length + '명은 아래 저장을 누르면 함께 적힙니다. 한 명 더 넣으려면 이름을 적은 뒤 이 단추를 누르세요.'
            : '이름을 적은 뒤 이 단추를 누르면 추가된 명단에 들어갑니다. 여럿은 회원 일괄 선택으로 고르세요.');
          inp.focus(); return;
        }
        var m = matchMember(t);
        if (!m) { say('err', '"' + t + '"을(를) 명단에서 찾지 못했습니다. 목록에서 "이름 (교회)"를 골라 주세요.'); inp.focus(); return; }
        if (pendingPayees.some(function (x) { return x.roster_id === m.roster_id; })) {
          say('', m.name + ' 님은 이미 추가된 명단에 있습니다.'); inp.value = ''; inp.focus(); return;
        }
        addPayee(m); inp.value = ''; inp.focus(); say('', '');
      }
      document.getElementById('lg-payadd').addEventListener('click', addFromInput);
      inp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); addFromInput(); }
      });
      document.getElementById('lg-paybulk').addEventListener('click', function () {
        openMemberPicker(function (list) {
          list.forEach(addPayee);
          say('', list.length ? list.length + '명을 추가된 명단에 넣었습니다. 아래 저장을 누르면 함께 적힙니다.' : '');
        });
      });
      renderPayees();
    }

    /* 항목을 저장한 뒤 받는 사람들을 적는다 (알림은 데이터베이스가 보낸다) */
    function savePayees(entryId) {
      if (!pendingPayees.length) return Promise.resolve();
      var amtEl = document.getElementById('lg-payamt');
      var amt = parseInt(amtEl ? amtEl.value : '0', 10) || 0;
      var rows = pendingPayees.map(function (m) {
        return { entry_id: entryId, book_id: book.id, roster_id: m.roster_id || null,
                 recipient: m.name, recipient_church: m.church || null, amount: amt,
                 created_by: opts.user.name };
      });
      var n = rows.length;
      pendingPayees = [];
      return SHSCloud.init().then(function (c) {
        return c.from('ledger_payouts').insert(rows);
      }).then(function (r) {
        if (r.error) { alert('항목은 저장되었지만 지급 확인을 적지 못했습니다: ' + r.error.message); return; }
        SHSCloud.log('create', '지급 확인 등록', ownerLabel + ' ' + year + '년 / 항목 ' + entryId + ' ' + n + '명');
      });
    }

    /* ----- 회원 일괄 선택 창 ----- */
    var memMdl = null, memSel = {}, memDone = null;
    function memberPicker() {
      if (memMdl) return memMdl;
      var stale = document.getElementById('lg-mem-mdl');
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
      memMdl = document.createElement('div');
      memMdl.className = 'mdl';
      memMdl.id = 'lg-mem-mdl';
      memMdl.innerHTML =
        '<div class="mdl-box wide">' +
        '<button class="mdl-close" id="lg-mem-close">&times;</button>' +
        '<h2 id="lg-mem-title">회원 일괄 선택</h2>' +
        '<div class="inline-form" style="margin-bottom:8px">' +
        '<div class="field" style="flex:0 0 190px"><label>명부</label><select id="lg-mem-src"><option value="all">노회 회원 명단</option></select></div>' +
        '<div class="field" style="flex:0 0 150px"><label>시찰</label><select id="lg-mem-sichal"><option value="">전체</option></select></div>' +
        '<div class="field" style="flex:0 0 150px"><label>구분</label><select id="lg-mem-cat"><option value="">전체</option></select></div>' +
        '<div class="field"><label>찾기</label><input type="text" id="lg-mem-q" placeholder="이름·교회"></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap">' +
        '<button type="button" class="btn ghost sm" id="lg-mem-all">보이는 회원 모두 선택</button>' +
        '<button type="button" class="btn ghost sm" id="lg-mem-none">모두 해제</button>' +
        '<span id="lg-mem-cnt" style="font-size:0.86rem;color:var(--gray-6)"></span></div>' +
        '<div class="lg-mem-list" id="lg-mem-list"></div>' +
        '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">' +
        '<button type="button" class="btn ghost" id="lg-mem-cancel">닫기</button>' +
        '<button type="button" class="btn" id="lg-mem-ok">선택 확정</button></div>' +
        '</div>';
      document.body.appendChild(memMdl);
      function close() { memMdl.classList.remove('open'); }
      memMdl.querySelector('#lg-mem-close').addEventListener('click', close);
      memMdl.querySelector('#lg-mem-cancel').addEventListener('click', close);
      memMdl.addEventListener('click', function (ev) { if (ev.target === memMdl) close(); });
      ['lg-mem-sichal', 'lg-mem-cat'].forEach(function (id) {
        memMdl.querySelector('#' + id).addEventListener('change', renderMemberList);
      });
      memMdl.querySelector('#lg-mem-src').addEventListener('change', applySource);
      memMdl.querySelector('#lg-mem-q').addEventListener('input', renderMemberList);
      memMdl.querySelector('#lg-mem-all').addEventListener('click', function () {
        visibleMembers().forEach(function (m) { if (!m.missing) memSel[m.roster_id] = 1; });
        renderMemberList();
      });
      memMdl.querySelector('#lg-mem-none').addEventListener('click', function () {
        memSel = {}; renderMemberList();
      });
      memMdl.querySelector('#lg-mem-ok').addEventListener('click', function () {
        var picked = (members || []).filter(function (m) { return memSel[m.roster_id]; });
        close();
        if (memDone) memDone(picked);
      });
      return memMdl;
    }
    /* 어느 명부를 보여 줄지 — 노회 명단 / 노회 임원 / 상비부.
     * 상비부 장부에서 열면 그 상비부 위원만 보인다(memLock). */
    var memLock = null;
    var TITLE_ORDER = ['노회장', '부노회장', '서기', '부서기', '회록서기', '회록부서기', '회계', '부회계', '간사'];
    function dup(m) { var o = {}; for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) o[k] = m[k]; return o; }
    function firstName(t) { return String(t || '').trim().split(/\s+/)[0] || ''; }
    function splitNames(t) {
      return String(t || '').split(/[,，、·\/\n]+/).map(firstName).filter(Boolean);
    }
    function currentSource() {
      if (memLock) return 'c:' + memLock;
      var sel = memMdl.querySelector('#lg-mem-src');
      return (sel && sel.value) || 'all';
    }
    /* 노회 임원 — 명단의 노회 직책(노회장·서기·회계…)이 있는 사람, 간사 포함 */
    function officerMembers() {
      return (members || []).filter(function (m) {
        return m.title || ['president', 'clerk', 'staff'].indexOf(m.role) >= 0;
      }).map(function (m) {
        var o = dup(m);
        o.tags = [m.title || (m.role === 'staff' ? '간사' : m.role === 'president' ? '노회장' : '서기')];
        o.group = '노회 임원';
        return o;
      }).sort(function (a, b) {
        var ia = TITLE_ORDER.indexOf(a.tags[0]), ib = TITLE_ORDER.indexOf(b.tags[0]);
        if (ia < 0) ia = 99; if (ib < 0) ib = 99;
        return ia - ib || a.sort - b.sort || a.roster_id - b.roster_id;
      });
    }
    /* 상비부 위원 — 상비부 표의 부장·서기·회계·1~3년조·위원 글을 명단과 이름으로 맞춘다.
     * 같은 이름이 둘이면 둘 다 보여 주고(교회로 구분), 명단에 없으면 고를 수 없게 표시한다. */
    function committeeMembers(name) {
      var c = (committeeRows || []).filter(function (x) { return x.name === name; })[0];
      if (!c) return [];
      var byName = {};
      (members || []).forEach(function (m) { (byName[m.name] = byName[m.name] || []).push(m); });
      var out = [], seen = {};
      function add(nm, tag, group) {
        if (!nm) return;
        var hits = byName[nm] || [];
        if (!hits.length) {
          var k = 'x:' + nm;
          if (seen[k]) { if (seen[k].tags.indexOf(tag) < 0) seen[k].tags.push(tag); return; }
          seen[k] = { roster_id: 'x-' + out.length, name: nm, church: '', tags: [tag], group: group, missing: true };
          out.push(seen[k]);
          return;
        }
        hits.forEach(function (m) {
          if (seen[m.roster_id]) { if (seen[m.roster_id].tags.indexOf(tag) < 0) seen[m.roster_id].tags.push(tag); return; }
          var o = dup(m); o.tags = [tag]; o.group = group;
          seen[m.roster_id] = o; out.push(o);
        });
      }
      var OFF = '부장 · 서기 · 회계';
      add(firstName(c.head), '부장', OFF);
      add(firstName(c.clerk), '서기', OFF);
      add(firstName(c.treasurer), '회계', OFF);
      splitNames(c.y1).forEach(function (n) { add(n, '1년조', '1년조'); });
      splitNames(c.y2).forEach(function (n) { add(n, '2년조', '2년조'); });
      splitNames(c.y3).forEach(function (n) { add(n, '3년조', '3년조'); });
      splitNames(c.members).forEach(function (n) { add(n, '위원', '위원'); });
      return out;
    }
    function sourceMembers() {
      var src = currentSource();
      if (src === 'officers') return officerMembers();
      if (src.indexOf('c:') === 0) return committeeMembers(src.slice(2));
      return members || [];
    }
    /* 명부를 바꾸면 시찰·구분 거름은 노회 명단에서만 쓰인다 */
    function applySource() {
      var all = currentSource() === 'all';
      ['lg-mem-sichal', 'lg-mem-cat'].forEach(function (id) {
        var el = memMdl.querySelector('#' + id);
        el.parentNode.style.display = all ? '' : 'none';
        if (!all) el.value = '';
      });
      renderMemberList();
    }
    function visibleMembers() {
      var sc = memMdl.querySelector('#lg-mem-sichal').value;
      var ct = memMdl.querySelector('#lg-mem-cat').value;
      var q = memMdl.querySelector('#lg-mem-q').value.trim();
      return sourceMembers().filter(function (m) {
        if (sc && m.sichal !== sc) return false;
        if (ct && m.category !== ct) return false;
        if (q && (m.name + ' ' + m.church + ' ' + (m.tags || []).join(' ')).indexOf(q) === -1) return false;
        return true;
      });
    }
    function renderMemberList() {
      var list = memMdl.querySelector('#lg-mem-list');
      var src = currentSource();
      var vis = visibleMembers();
      var groups = {}, order = [];
      vis.forEach(function (m) {
        var g = m.group || m.sichal || '시찰 없음';
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push(m);
      });
      var empty = src.indexOf('c:') === 0
        ? (committeeMembers(src.slice(2)).length
            ? '조건에 맞는 위원이 없습니다.'
            : esc(src.slice(2)) + '의 위원 명단이 아직 없습니다. 노회 관리자가 상비부 관리에서 부장·서기·회계와 위원을 적어 주시면 여기에 보입니다.')
        : '조건에 맞는 회원이 없습니다.';
      list.innerHTML = order.map(function (g) {
        return '<div class="lg-mem-group">' + esc(g) + ' <small>' + groups[g].length + '명</small></div>' +
          groups[g].map(function (m) {
            var sub = m.tags && m.tags.length
              ? m.tags.join('·') + (m.church ? ' · ' + m.church : '')
              : m.church + (m.category ? ' · ' + m.category : '');
            return '<label' + (m.missing ? ' style="opacity:.55;cursor:default"' : '') + '>' +
              '<input type="checkbox" data-lgmem="' + m.roster_id + '"' +
              (m.missing ? ' disabled' : '') + (memSel[m.roster_id] ? ' checked' : '') + '> ' + esc(m.name) +
              ' <small>' + esc(sub) + '</small>' +
              (m.missing ? ' <small style="color:#b0731f">명단에 없음</small>'
                : (accKnown && !m.has_account ? ' <small style="color:#b0731f">계정 없음</small>' : '')) +
              '</label>';
          }).join('');
      }).join('') || '<p style="color:var(--gray-5)">' + empty + '</p>';
      list.querySelectorAll('input[data-lgmem]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          if (cb.checked) memSel[cb.dataset.lgmem] = 1; else delete memSel[cb.dataset.lgmem];
          updateMemCount();
        });
      });
      updateMemCount();
    }
    function updateMemCount() {
      var n = Object.keys(memSel).length;
      memMdl.querySelector('#lg-mem-cnt').textContent = n ? n + '명 선택' : '';
    }
    function openMemberPicker(onDone, preselectedIds) {
      memDone = onDone;
      memSel = {};
      (preselectedIds || []).forEach(function (id) { memSel[id] = 1; });
      Promise.all([loadMembers(), loadCommittees()]).then(function () {
        var m = memberPicker();
        var scs = {}, cts = {};
        members.forEach(function (x) { if (x.sichal) scs[x.sichal] = 1; if (x.category) cts[x.category] = 1; });
        m.querySelector('#lg-mem-sichal').innerHTML = '<option value="">전체</option>' +
          Object.keys(scs).map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
        m.querySelector('#lg-mem-cat').innerHTML = '<option value="">전체</option>' +
          Object.keys(cts).map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
        /* 상비부 장부에서는 그 상비부 위원만. 노회·시찰 장부에서는 명부를 고른다. */
        memLock = opts.kind === 'committee' ? opts.owner : null;
        var srcSel = m.querySelector('#lg-mem-src');
        srcSel.parentNode.style.display = memLock ? 'none' : '';
        if (!memLock) {
          srcSel.innerHTML = '<option value="all">노회 회원 명단</option><option value="officers">노회 임원</option>' +
            (committeeRows || []).map(function (c) {
              return '<option value="c:' + esc(c.name) + '">상비부 · ' + esc(c.name) + '</option>';
            }).join('');
          srcSel.value = 'all';
        }
        m.querySelector('#lg-mem-title').textContent = memLock ? memLock + ' 위원 선택' : '회원 일괄 선택';
        m.querySelector('#lg-mem-q').value = '';
        /* 시찰 장부는 그 시찰부터 보여 준다 */
        var scSel = m.querySelector('#lg-mem-sichal');
        scSel.value = ((opts.kind === 'sichal' || opts.kind === 'ministers') && scs[opts.owner]) ? opts.owner : '';
        applySource();
        m.classList.add('open');
      });
    }

    /* ----- 한 항목의 지급 확인 창 (받는 사람 목록 · 수기 확인 · 더하기) ----- */
    var poMdl = null, poEntry = null, poCanWrite = false;
    function payoutModal() {
      if (poMdl) return poMdl;
      poMdl = document.createElement('div');
      poMdl.className = 'mdl';
      poMdl.id = 'lg-po-mdl';
      poMdl.innerHTML = '<div class="mdl-box wide"><button class="mdl-close" id="lg-po-close">&times;</button>' +
        '<div id="lg-po-body"></div></div>';
      document.body.appendChild(poMdl);
      poMdl.querySelector('#lg-po-close').addEventListener('click', function () { poMdl.classList.remove('open'); });
      poMdl.addEventListener('click', function (ev) { if (ev.target === poMdl) poMdl.classList.remove('open'); });
      return poMdl;
    }
    function openPayouts(entryId, canWrite) {
      poEntry = entryId; poCanWrite = canWrite;
      payoutModal().classList.add('open');
      renderPayoutModal();
      if (canWrite) loadMembers().then(function () { fillMemberList('lg-members2'); });
    }
    function renderPayoutModal() {
      var x = findEntry(poEntry);
      var list = payouts[poEntry] || [];
      var body = poMdl.querySelector('#lg-po-body');
      if (!x) { body.innerHTML = '<p>항목을 찾을 수 없습니다.</p>'; return; }
      var sum = 0, ok = 0;
      list.forEach(function (p) { sum += Number(p.amount) || 0; if (p.status === '확인') ok++; });
      var h = '<h2 style="font-size:1.15rem">지급 확인 — ' + esc(x.title) + '</h2>' +
        '<p style="font-size:0.86rem;color:var(--gray-6);margin:-8px 0 12px">' +
        esc(x.entry_date || '') + (x.category ? ' · ' + esc(x.category) : '') +
        ' · 항목 금액 <strong>' + won(x.amount) + '원</strong>' +
        (list.length ? ' · 지급 합계 ' + won(sum) + '원 · 수령 확인 ' + ok + '/' + list.length + '명' : '') +
        (list.length && sum !== Number(x.amount)
          ? ' <span style="color:#b03a3a">(항목 금액과 다릅니다)</span>' : '') + '</p>';
      if (list.length) {
        h += '<div style="overflow-x:auto"><table class="tbl" style="font-size:0.88rem"><thead><tr>' +
          '<th class="left">받는 사람</th><th style="width:110px">금액 (원)</th><th style="width:170px">수령 확인</th>' +
          (poCanWrite ? '<th style="width:150px">관리</th>' : '') + '</tr></thead><tbody>';
        list.forEach(function (p) {
          h += '<tr><td class="left">' + esc(p.recipient) +
            (p.recipient_church ? ' <small style="color:var(--gray-5)">' + esc(p.recipient_church) + '</small>' : '') +
            (!p.recipient_user ? ' <small style="color:#b0731f">계정 없음</small>' : '') + '</td>' +
            '<td style="text-align:right">' + won(p.amount) + '</td>' +
            '<td>' + (p.status === '확인'
              ? '<span class="role-badge" style="color:#2a7a2a;border-color:#2a7a2a">확인</span> ' +
                '<small style="color:var(--gray-5)">' + esc(String(p.confirmed_at || '').replace('T', ' ').slice(0, 16)) +
                (p.confirmed_by ? ' · ' + esc(p.confirmed_by) : '') +
                (p.confirm_note ? '<br>' + esc(p.confirm_note) : '') + '</small>'
              : '<span class="role-badge" style="color:var(--gray-5)">대기</span>' +
                (p.recipient_user ? ' <small style="color:var(--gray-5)">알림 보냄</small>' : '')) + '</td>' +
            (poCanWrite
              ? '<td>' + (p.status === '확인'
                  ? '<button type="button" class="btn ghost sm" data-lgpoundo="' + p.id + '">대기로</button> '
                  : '<button type="button" class="btn ghost sm" data-lgpook="' + p.id + '">수기 확인</button> ') +
                '<button type="button" class="btn danger sm" data-lgpodel="' + p.id + '">지우기</button></td>'
              : '') + '</tr>';
        });
        h += '</tbody></table></div>';
      } else {
        h += '<p style="color:var(--gray-5)">아직 받는 사람을 적지 않았습니다.</p>';
      }
      if (poCanWrite) {
        h += '<div class="inline-form" style="margin-top:12px;align-items:flex-end">' +
          '<div class="field"><label>받는 사람 더하기</label>' +
          '<input type="text" id="lg-payee2" list="lg-members2" placeholder="이름을 적어 고르세요" autocomplete="off">' +
          '<datalist id="lg-members2"></datalist></div>' +
          '<div class="field" style="flex:0 0 140px"><label>1인 금액 (원)</label>' +
          '<input type="number" id="lg-payamt2" min="0" step="1000" value="' +
          (list.length ? Number(list[list.length - 1].amount) || '' : '') + '"></div>' +
          '<button type="button" class="btn ghost sm" id="lg-payadd2">적은 사람 추가</button>' +
          '<button type="button" class="btn ghost sm" id="lg-paybulk2">회원 일괄 선택</button>' +
          '</div><div class="form-msg" id="lg-po-msg"></div>' +
          '<p style="font-size:0.78rem;color:var(--gray-5)">계정이 있는 회원에게는 바로 알림이 갑니다. ' +
          '계정이 없거나 직접 확인한 경우 <strong>수기 확인</strong>으로 처리하세요.</p>';
      }
      body.innerHTML = h;
      if (!poCanWrite) return;

      function insertPayees(list2, amt) {
        if (!list2.length) return;
        if (!(amt > 0)) { var mm = document.getElementById('lg-po-msg'); mm.className = 'form-msg err'; mm.textContent = '1인 금액을 적어 주세요.'; return; }
        var have = {};
        (payouts[poEntry] || []).forEach(function (p) { if (p.roster_id) have[p.roster_id] = 1; });
        var rows = list2.filter(function (m) { return !have[m.roster_id]; }).map(function (m) {
          return { entry_id: poEntry, book_id: book.id, roster_id: m.roster_id || null,
                   recipient: m.name, recipient_church: m.church || null, amount: amt, created_by: opts.user.name };
        });
        if (!rows.length) return;
        SHSCloud.init().then(function (c) {
          return c.from('ledger_payouts').insert(rows);
        }).then(function (r) {
          if (r.error) { alert(r.error.message); return; }
          SHSCloud.log('create', '지급 확인 등록', ownerLabel + ' ' + year + '년 / 항목 ' + poEntry + ' ' + rows.length + '명');
          load().then(renderPayoutModal);
        });
      }
      document.getElementById('lg-payadd2').addEventListener('click', function () {
        var inp2 = document.getElementById('lg-payee2');
        var mm = document.getElementById('lg-po-msg');
        var t = inp2.value.trim();
        if (!t) {
          mm.className = 'form-msg'; mm.textContent = '이름을 적은 뒤 이 단추를 누르세요. 여럿은 회원 일괄 선택으로 고르세요.';
          inp2.focus(); return;
        }
        var m = matchMember(t);
        if (!m) {
          mm.className = 'form-msg err'; mm.textContent = '"' + t + '"을(를) 명단에서 찾지 못했습니다. 목록에서 "이름 (교회)"를 골라 주세요.';
          inp2.focus(); return;
        }
        mm.className = 'form-msg'; mm.textContent = '';
        insertPayees([m], parseInt(document.getElementById('lg-payamt2').value, 10) || 0);
      });
      document.getElementById('lg-paybulk2').addEventListener('click', function () {
        var amt = parseInt(document.getElementById('lg-payamt2').value, 10) || 0;
        openMemberPicker(function (picked) { insertPayees(picked, amt); },
          (payouts[poEntry] || []).map(function (p) { return p.roster_id; }).filter(Boolean));
      });
      body.querySelectorAll('button[data-lgpook]').forEach(function (b) {
        b.addEventListener('click', function () {
          var note = prompt('수기 확인 사유를 적어 주세요 (예: 현금 지급, 본인 확인)', '현금 지급 · 본인 확인');
          if (note === null) return;
          SHSCloud.init().then(function (c) {
            return c.from('ledger_payouts').update({
              status: '확인', confirmed_at: new Date().toISOString(),
              confirmed_by: opts.user.name + ' (수기)', confirm_note: note.trim() || null
            }).eq('id', b.dataset.lgpook);
          }).then(function (r) {
            if (r.error) { alert(r.error.message); return; }
            SHSCloud.log('update', '지급 수기 확인', ownerLabel + ' ' + year + '년 / 지급 ' + b.dataset.lgpook);
            load().then(renderPayoutModal);
          });
        });
      });
      body.querySelectorAll('button[data-lgpoundo]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('수령 확인을 대기로 되돌리시겠습니까?')) return;
          SHSCloud.init().then(function (c) {
            return c.from('ledger_payouts').update({
              status: '대기', confirmed_at: null, confirmed_by: null, confirm_note: null
            }).eq('id', b.dataset.lgpoundo);
          }).then(function (r) {
            if (r.error) { alert(r.error.message); return; }
            load().then(renderPayoutModal);
          });
        });
      });
      body.querySelectorAll('button[data-lgpodel]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('이 받는 사람을 지우시겠습니까?')) return;
          SHSCloud.init().then(function (c) {
            return c.from('ledger_payouts').delete().eq('id', b.dataset.lgpodel);
          }).then(function (r) {
            if (r.error) { alert(r.error.message); return; }
            SHSCloud.log('delete', '지급 확인 삭제', ownerLabel + ' ' + year + '년 / 지급 ' + b.dataset.lgpodel);
            load().then(renderPayoutModal);
          });
        });
      });
    }

    /* ================= 영수증 ================= */
    function receiptCell(x, ln, canWrite) {
      var list = receipts[x.id] || [];
      var h = '';
      if (list.length) {
        h += '<button type="button" class="btn ghost sm" data-lgrc="' + x.id + '" title="영수증 보기">' +
          '&#128206; ' + list.length + '장</button>';
      }
      var po = payouts[x.id] || [];
      if (po.length) {
        var ok = po.filter(function (p) { return p.status === '확인'; }).length;
        h += (h ? ' ' : '') + '<button type="button" class="btn ghost sm" data-lgpo="' + x.id + '" title="지급 확인 보기"' +
          (ok === po.length ? ' style="color:#2a7a2a;border-color:#2a7a2a"' : '') +
          '>수령 ' + ok + '/' + po.length + '</button>';
      } else if (canWrite && !ln && x.kind === '지출' && !list.length) {
        /* 수령 확인은 영수증 없이 지급한 경우에만 — 영수증이 붙어 있으면 단추를 내지 않는다 */
        h += (h ? ' ' : '') + '<button type="button" class="btn ghost sm" data-lgpo="' + x.id + '" ' +
          'title="받는 사람을 적어 수령 확인을 받는다" style="color:var(--gray-5)">수령확인</button>';
      }
      if (canWrite && !ln) {
        h += (h ? ' ' : '') + '<button type="button" class="btn ghost sm" data-lgup="' + x.id + '" ' +
          'title="영수증 사진 올리기" style="padding-left:6px;padding-right:6px">+</button>';
      }
      return h || '<span style="color:var(--gray-5)">-</span>';
    }

    /* 사진 한 장을 줄여서 보관함에 올리고 영수증 표에 적는다.
     * 자동 읽기가 켜져 있으면 읽은 일자·사용처·금액도 함께 적어 둔다. */
    function uploadReceipt(entryId, f) {
      var path = book.id + '/' + entryId + '/' + Date.now() + '-' +
        Math.random().toString(36).slice(2, 8) + '.jpg';
      var size = 0, ocr = f.__ocr || null;
      return shrinkImage(f).then(function (blob) {
        size = blob.size;
        /* 입력칸에서 미리 읽어 둔 것이 없으면 여기서 읽는다 (실패해도 올리기는 계속) */
        var p = (ocr || f.__ocrTried) ? Promise.resolve(ocr)
              : readReceipt(blob, book.id).then(function (o) { return o; }, function () { return null; });
        return p.then(function (o) {
          ocr = o;
          return SHSCloud.init().then(function (c) {
            return c.storage.from('receipts')
              .upload(path, blob, { upsert: false, contentType: 'image/jpeg' })
              .then(function (r) {
                if (r.error) throw r.error;
                var row = {
                  entry_id: entryId, book_id: book.id, file_path: path,
                  file_name: f.name || null, file_size: size, created_by: opts.user.name
                };
                if (ocr) {
                  row.taken_on = /^\d{4}-\d{2}-\d{2}$/.test(String(ocr.taken_on || '')) ? ocr.taken_on : null;
                  row.vendor = ocr.vendor || null;
                  row.amount = ocr.amount != null ? Math.round(Number(ocr.amount)) : null;
                  row.ocr = ocr;
                }
                return c.from('ledger_receipts').insert(row).select();
              });
          });
        });
      }).then(function (r) {
        var w = SHS.wrote(r);
        if (!w.ok) throw new Error(w.why);
        SHSCloud.log('create', '영수증 등록', ownerLabel + ' ' + year + '년 / 항목 ' + entryId);
      });
    }

    /* 여러 장을 차례로 올린다 */
    function uploadReceipts(entryId, files) {
      var list = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); });
      var p = Promise.resolve();
      list.forEach(function (f) { p = p.then(function () { return uploadReceipt(entryId, f); }); });
      return p;
    }

    /* 끌어다 놓은 파일 중 사진만 */
    function droppedImages(ev) {
      var dt = ev.dataTransfer;
      if (!dt || !dt.files) return [];
      return Array.prototype.slice.call(dt.files).filter(function (f) { return /^image\//.test(f.type); });
    }

    /* 입력 칸의 놓는 자리 — 고르거나 끌어다 놓은 사진을 모아 두고 이름을 보여 준다 */
    function renderPending() {
      var list = document.getElementById('lg-drop-list');
      if (!list) return;
      list.innerHTML = pendingFiles.map(function (f, i) {
        return '<span>' + esc(f.name || '사진') + ' <button type="button" data-lgpf="' + i + '" title="빼기">&times;</button></span>';
      }).join('');
      list.querySelectorAll('button[data-lgpf]').forEach(function (b) {
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          pendingFiles.splice(parseInt(b.dataset.lgpf, 10), 1);
          renderPending();
        });
      });
    }
    function addPending(files) {
      var added = [];
      Array.prototype.slice.call(files || []).forEach(function (f) {
        if (/^image\//.test(f.type)) { pendingFiles.push(f); added.push(f); }
      });
      renderPending();
      if (ocrEnabled() && book && added.length) prefillFromReceipt(added[0]);
    }

    /* 자동 읽기 — 첫 사진을 읽어 비어 있는 일자·적요(사용처)·금액을 채운다.
     * 이미 적은 값은 건드리지 않고, 읽은 내용을 보여 주어 회계가 확인하게 한다. */
    function prefillFromReceipt(f) {
      var info = document.getElementById('lg-ocr');
      if (!info) return;
      info.className = 'lg-ocr';
      info.innerHTML = '영수증을 읽는 중입니다… <small>(몇 초 걸립니다)</small>';
      shrinkImage(f).then(function (blob) {
        return readReceipt(blob, book.id);
      }).then(function (o) {
        f.__ocrTried = true;
        if (!o) { info.innerHTML = ''; return; }
        f.__ocr = o;
        var filled = [];
        var dEl = document.getElementById('lg-date');
        var tEl = document.getElementById('lg-title');
        var aEl = document.getElementById('lg-amt');
        var today = new Date().toISOString().slice(0, 10);
        if (dEl && /^\d{4}-\d{2}-\d{2}$/.test(String(o.taken_on || '')) &&
            (!dEl.value || dEl.value === today)) { dEl.value = o.taken_on; filled.push('일자'); }
        if (tEl && o.vendor && !tEl.value.trim()) { tEl.value = o.vendor; filled.push(useCats ? '적요' : '항목'); }
        if (aEl && o.amount != null && !aEl.value) { aEl.value = Math.round(Number(o.amount)); filled.push('금액'); }
        info.className = 'lg-ocr ok';
        info.innerHTML = '<strong>영수증에서 읽음</strong> ' + esc(ocrSummary(o)) +
          (o.items && o.items.length
            ? ' <small style="color:var(--gray-5)">· 품목 ' + o.items.slice(0, 4).map(function (it) { return esc(it.name); }).join(', ') +
              (o.items.length > 4 ? ' 외 ' + (o.items.length - 4) : '') + '</small>' : '') +
          (filled.length ? '<br><small>' + filled.join('·') + ' 칸을 채웠습니다. 맞는지 확인한 뒤 저장해 주세요.</small>' : '') +
          (o.confidence === 'low' || o.note
            ? '<br><small style="color:#b0731f">' + (o.confidence === 'low' ? '확신이 낮습니다. ' : '') + esc(o.note || '') + '</small>' : '');
      }).catch(function (err) {
        f.__ocrTried = true;
        info.className = 'lg-ocr err';
        info.innerHTML = '자동 읽기를 하지 못했습니다: ' + esc((err && err.message) || '') +
          ' <small>(사진은 그대로 올라갑니다)</small> ' +
          '<button type="button" class="btn ghost sm" id="lg-ocr-retry">다시 읽기</button>';
        var rb = document.getElementById('lg-ocr-retry');
        if (rb) rb.addEventListener('click', function () { prefillFromReceipt(f); });
      });
    }
    function bindDrop() {
      var zone = document.getElementById('lg-drop');
      var input = document.getElementById('lg-file');
      if (!zone || !input) return;
      zone.addEventListener('click', function (ev) {
        if (ev.target.closest && ev.target.closest('button')) return;
        input.value = ''; input.click();
      });
      zone.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.value = ''; input.click(); }
      });
      input.addEventListener('change', function () { addPending(input.files); });
      zone.addEventListener('dragover', function (ev) { ev.preventDefault(); zone.classList.add('over'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('over'); });
      zone.addEventListener('drop', function (ev) {
        ev.preventDefault(); zone.classList.remove('over');
        addPending(droppedImages(ev));
      });
      /* 놓는 자리 밖에 떨어뜨려도 브라우저가 사진 페이지로 넘어가지 않게 한다 */
      if (!window.__lgDropGuard) {
        window.__lgDropGuard = true;
        document.addEventListener('dragover', function (ev) { ev.preventDefault(); });
        document.addEventListener('drop', function (ev) { ev.preventDefault(); });
      }
    }

    /* 항목에 붙은 영수증 파일을 보관함에서 지운다 (항목 삭제 전에 부른다) */
    function removeReceiptFiles(entryId) {
      var list = receipts[entryId] || [];
      if (!list.length) return Promise.resolve();
      return SHSCloud.init().then(function (c) {
        return c.storage.from('receipts').remove(list.map(function (r) { return r.file_path; }));
      }).then(function () {}, function () {});
    }

    /* 크게 보기 — 한 항목의 영수증을 차례로 넘겨 본다 */
    var lb = null, lbList = [], lbAt = 0, lbEntry = null, lbCanWrite = false;
    function lightbox() {
      if (lb) return lb;
      lb = document.createElement('div');
      lb.className = 'lightbox';
      lb.id = 'lg-lb';
      lb.innerHTML =
        '<button class="lb-close" id="lg-lb-close" aria-label="닫기">&times;</button>' +
        '<button class="lb-nav prev" id="lg-lb-prev" aria-label="이전">&#8249;</button>' +
        '<img id="lg-lb-img" src="" alt="영수증">' +
        '<button class="lb-nav next" id="lg-lb-next" aria-label="다음">&#8250;</button>' +
        '<div class="lb-cap" id="lg-lb-cap"></div>' +
        '<div class="lb-tools" id="lg-lb-tools"><button id="lg-lb-del" class="danger">이 영수증 지우기</button></div>';
      document.body.appendChild(lb);
      lb.querySelector('#lg-lb-close').addEventListener('click', closeLb);
      lb.addEventListener('click', function (ev) { if (ev.target === lb) closeLb(); });
      lb.querySelector('#lg-lb-prev').addEventListener('click', function () { showLb(lbAt - 1); });
      lb.querySelector('#lg-lb-next').addEventListener('click', function () { showLb(lbAt + 1); });
      lb.querySelector('#lg-lb-del').addEventListener('click', function () {
        var r = lbList[lbAt];
        if (!r) return;
        if (!confirm('이 영수증 사진을 지우시겠습니까?')) return;
        SHSCloud.init().then(function (c) {
          return c.storage.from('receipts').remove([r.file_path]).then(function () {
            return c.from('ledger_receipts').delete().eq('id', r.id);
          });
        }).then(function (res) {
          if (res.error) { alert(res.error.message); return; }
          SHSCloud.log('delete', '영수증 삭제', ownerLabel + ' ' + year + '년 / 항목 ' + lbEntry);
          closeLb();
          load();
        });
      });
      document.addEventListener('keydown', function (ev) {
        if (!lb.classList.contains('open')) return;
        if (ev.key === 'Escape') closeLb();
        if (ev.key === 'ArrowLeft') showLb(lbAt - 1);
        if (ev.key === 'ArrowRight') showLb(lbAt + 1);
      });
      return lb;
    }
    function closeLb() { if (lb) { lb.classList.remove('open'); lb.querySelector('#lg-lb-img').src = ''; } }
    function showLb(i) {
      if (!lbList.length) return;
      lbAt = (i + lbList.length) % lbList.length;
      var r = lbList[lbAt];
      var img = lb.querySelector('#lg-lb-img');
      var cap = lb.querySelector('#lg-lb-cap');
      var x = findEntry(lbEntry) || {};
      cap.textContent = (x.title || '') + (x.amount != null ? ' · ' + won(x.amount) + '원' : '') +
        ' — 영수증 ' + (lbAt + 1) + '/' + lbList.length +
        (r.file_name ? ' · ' + r.file_name : '') +
        (r.created_by ? ' · ' + r.created_by : '') +
        ((r.taken_on || r.vendor || r.amount != null)
          ? ' | 읽은 내용: ' + ocrSummary({ taken_on: r.taken_on, vendor: r.vendor, amount: r.amount }) : '');
      lb.querySelector('#lg-lb-prev').classList.toggle('hidden', lbList.length < 2);
      lb.querySelector('#lg-lb-next').classList.toggle('hidden', lbList.length < 2);
      lb.querySelector('#lg-lb-tools').classList.toggle('hidden', !lbCanWrite);
      img.src = '';
      SHSCloud.init().then(function (c) {
        return c.storage.from('receipts').createSignedUrl(r.file_path, 600);
      }).then(function (res) {
        if (res.error || !res.data) { cap.textContent += ' (사진을 불러오지 못했습니다)'; return; }
        img.src = res.data.signedUrl;
      });
    }
    function openReceipts(entryId, canWrite, at) {
      lbList = receipts[entryId] || [];
      if (!lbList.length) return;
      lbEntry = entryId; lbCanWrite = canWrite;
      lightbox().classList.add('open');
      showLb(at || 0);
    }

    function bindReceipts(canWrite) {
      box.querySelectorAll('button[data-lgrc]').forEach(function (b) {
        b.addEventListener('click', function () { openReceipts(b.dataset.lgrc, canWrite); });
      });
      box.querySelectorAll('button[data-lgpo]').forEach(function (b) {
        b.addEventListener('click', function () { openPayouts(b.dataset.lgpo, canWrite); });
      });
      var up = document.getElementById('lg-upfile');
      if (!up) return;
      box.querySelectorAll('button[data-lgup]').forEach(function (b) {
        b.addEventListener('click', function () { upTarget = b.dataset.lgup; up.value = ''; up.click(); });
      });
      up.addEventListener('change', function () {
        if (!up.files || !up.files.length || !upTarget) return;
        uploadToRow(upTarget, up.files);
      });
      box.querySelectorAll('td.lg-dropcell').forEach(function (td) {
        td.addEventListener('dragover', function (ev) { ev.preventDefault(); td.classList.add('over'); });
        td.addEventListener('dragleave', function () { td.classList.remove('over'); });
        td.addEventListener('drop', function (ev) {
          ev.preventDefault(); td.classList.remove('over');
          var files = droppedImages(ev);
          if (files.length) uploadToRow(td.dataset.lgdrop, files);
        });
      });
    }

    /* 줄 하나에 사진을 올린다 (단추로 골랐든 끌어다 놓았든) */
    function uploadToRow(entryId, files) {
      var b2 = box.querySelector('button[data-lgup="' + entryId + '"]');
      if (b2) { b2.disabled = true; b2.textContent = '올리는 중…'; }
      uploadReceipts(entryId, files).then(load, function (err) {
        alert((err && err.message) || '영수증을 올리지 못했습니다.');
        load();
      });
    }

    /* 과목 더하기·지우기 — 접어 두었다가 필요할 때 연다 */
    function catManager() {
      var mine = catRows.filter(function (r) { return r.kind === viewKind; });
      return '<details style="margin-top:12px"><summary style="cursor:pointer;font-size:0.86rem;color:var(--navy)">' +
        viewKind + ' 과목 설정</summary>' +
        '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">' +
        (mine.length
          ? mine.map(function (r) {
              return '<span class="role-badge">' + esc(r.name) +
                ' <button type="button" data-lgcatdel="' + r.id + '" title="지우기" ' +
                'style="border:none;background:none;color:#a33;cursor:pointer;padding:0 2px">×</button></span>';
            }).join('')
          : '<span style="font-size:0.82rem;color:var(--gray-5)">저장된 과목이 없어 기본 과목을 보여 드립니다.</span>') +
        '<input type="text" id="lg-newcat" placeholder="새 과목" style="width:150px"> ' +
        '<button type="button" class="btn ghost sm" id="lg-addcat">더하기</button>' +
        '</div><div class="form-msg" id="lg-catmsg"></div></details>';
    }

    function bindCats() {
      var add = document.getElementById('lg-addcat');
      if (add) add.addEventListener('click', function () {
        var msg = document.getElementById('lg-catmsg');
        var name = document.getElementById('lg-newcat').value.trim();
        if (!name) { msg.className = 'form-msg err'; msg.textContent = '과목 이름을 적어 주세요.'; return; }
        var sort = catRows.filter(function (r) { return r.kind === viewKind; }).length + 1;
        SHSCloud.init().then(function (c) {
          return c.from('ledger_categories').insert({
            owner_kind: ownerKind, owner: opts.owner, kind: viewKind, name: name, sort: sort
          }).select();
        }).then(function (r) {
          var w = SHS.wrote(r);
          if (!w.ok) { msg.className = 'form-msg err'; msg.textContent = w.why; return; }
          SHSCloud.log('create', '회계 과목 추가', ownerLabel + ' ' + viewKind + ' / ' + name);
          load();
        });
      });
      box.querySelectorAll('button[data-lgcatdel]').forEach(function (b) {
        b.addEventListener('click', function () {
          var r = catRows.filter(function (x) { return String(x.id) === b.dataset.lgcatdel; })[0];
          if (!r) return;
          if (!confirm('"' + r.name + '" 과목을 목록에서 지우시겠습니까?\n이미 적어 둔 항목은 그대로 남습니다.')) return;
          SHSCloud.init().then(function (c) {
            return c.from('ledger_categories').delete().eq('id', r.id);
          }).then(function (res) {
            if (res.error) { alert(res.error.message); return; }
            SHSCloud.log('delete', '회계 과목 삭제', ownerLabel + ' ' + viewKind + ' / ' + r.name);
            load();
          });
        });
      });
    }

    /* 과목이 <상비부 배정>일 때만 상비부 고르는 칸을 보인다 */
    function syncAllocField() {
      var cat = document.getElementById('lg-cat');
      var f = document.getElementById('lg-alloc-f');
      if (!cat || !f) return;
      f.classList.toggle('hidden', cat.value !== ALLOC_CAT);
    }

    function clearEntryForm() {
      ['lg-id', 'lg-church', 'lg-amt', 'lg-title', 'lg-note'].forEach(function (id) {
        document.getElementById(id).value = '';
      });
      var al = document.getElementById('lg-alloc');
      if (al) al.value = '';
      syncAllocField();
      pendingFiles = [];
      renderPending();
      pendingPayees = [];
      renderPayees();
      document.getElementById('lg-ftitle').textContent = viewKind + ' 적기';
      document.getElementById('lg-cancel').classList.add('hidden');
    }

    function bindEntryForm() {
      document.getElementById('lg-cancel').addEventListener('click', clearEntryForm);
      bindDrop();
      bindPayees();
      var catSel = document.getElementById('lg-cat');
      if (catSel) {
        catSel.addEventListener('change', syncAllocField);
        catSel.addEventListener('input', syncAllocField);
        syncAllocField();
      }
      document.getElementById('lg-save').addEventListener('click', function () {
        var msg = document.getElementById('lg-msg');
        var id = document.getElementById('lg-id').value;
        var d = {
          book_id: book.id,
          entry_date: document.getElementById('lg-date').value || null,
          kind: viewKind,
          church: document.getElementById('lg-church').value.trim() || null,
          title: document.getElementById('lg-title').value.trim(),
          amount: parseInt(document.getElementById('lg-amt').value, 10) || 0,
          note: document.getElementById('lg-note').value.trim() || null,
          updated_at: new Date().toISOString()
        };
        if (useCats) {
          d.category = catSel ? catSel.value.trim() : null;
          if (!d.category) { msg.className = 'form-msg err'; msg.textContent = '과목을 고르거나 적어 주세요.'; return; }
          /* 적요를 비우면 과목 이름을 적요로 쓴다 */
          if (!d.title) d.title = d.category || '';
          var al = document.getElementById('lg-alloc');
          d.alloc_to = (viewKind === '지출' && d.category === ALLOC_CAT && al) ? (al.value || null) : null;
          if (viewKind === '지출' && d.category === ALLOC_CAT && !d.alloc_to) {
            msg.className = 'form-msg err'; msg.textContent = '배정할 상비부를 골라 주세요.'; return;
          }
        }
        if (!d.title) { msg.className = 'form-msg err'; msg.textContent = '항목을 적어 주세요.'; return; }
        if (viewKind === '지출' && pendingPayees.length) {
          var pa = document.getElementById('lg-payamt');
          if (!(parseInt(pa ? pa.value : '0', 10) > 0)) {
            msg.className = 'form-msg err'; msg.textContent = '받는 사람의 1인 금액을 적어 주세요.'; return;
          }
        }
        if (d.amount < 0) { msg.className = 'form-msg err'; msg.textContent = '금액은 0원 이상이어야 합니다.'; return; }
        if (!id) d.created_by = opts.user.name;
        var files = pendingFiles.slice();
        msg.className = 'form-msg'; msg.textContent = '저장 중입니다...';
        SHSCloud.init().then(function (c) {
          return id ? c.from('ledger_entries').update(d).eq('id', id).select()
                    : c.from('ledger_entries').insert(d).select();
        }).then(function (r) {
          var w = SHS.wrote(r);
          if (!w.ok) { msg.className = 'form-msg err'; msg.textContent = w.why; return; }
          SHSCloud.log(id ? 'update' : 'create', '회계 ' + d.kind + ' ' + (id ? '수정' : '등록'),
            ownerLabel + ' ' + year + '년 / ' + d.title + ' ' + won(d.amount) + '원');
          var savedId = id || (r.data && r.data[0] && r.data[0].id);
          rememberCat(d.category).then(function () {
            return savedId ? savePayees(savedId) : null;
          }).then(function () {
            if (!files.length || !savedId) { load(); return; }
            /* 항목은 저장되었고, 이어서 영수증 사진을 올린다 */
            msg.textContent = '항목은 저장되었습니다. 영수증 사진 ' + files.length + '장을 올리는 중입니다...';
            pendingFiles = [];
            uploadReceipts(savedId, files).then(load, function (err) {
              alert('항목은 저장되었지만 영수증을 올리지 못했습니다: ' + ((err && err.message) || ''));
              load();
            });
          });
        });
      });
    }

    /* 손으로 적은 새 과목은 목록에 저장해 두어 다음에 고를 수 있게 한다 */
    function rememberCat(name) {
      if (!useCats || !name || cats[viewKind].indexOf(name) !== -1) return Promise.resolve();
      var sort = catRows.filter(function (r) { return r.kind === viewKind; }).length + 1;
      return SHSCloud.init().then(function (c) {
        return c.from('ledger_categories').insert({
          owner_kind: ownerKind, owner: opts.owner, kind: viewKind, name: name, sort: sort
        });
      }).then(function () {}, function () {});
    }

    function findEntry(id) {
      return entries.filter(function (x) { return String(x.id) === String(id); })[0];
    }

    function bindEntryList() {
      box.querySelectorAll('button[data-lgedit]').forEach(function (b) {
        b.addEventListener('click', function () {
          var x = findEntry(b.dataset.lgedit);
          if (!x) return;
          document.getElementById('lg-id').value = x.id;
          document.getElementById('lg-date').value = x.entry_date || '';
          document.getElementById('lg-church').value = x.church || '';
          document.getElementById('lg-amt').value = x.amount;
          document.getElementById('lg-title').value = x.title;
          document.getElementById('lg-note').value = x.note || '';
          var cs = document.getElementById('lg-cat');
          if (cs && x.category) cs.value = x.category;
          var al = document.getElementById('lg-alloc');
          if (al) al.value = x.alloc_to || '';
          syncAllocField();
          document.getElementById('lg-ftitle').textContent = viewKind + ' 수정';
          document.getElementById('lg-cancel').classList.remove('hidden');
          document.getElementById('lg-ftitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
      box.querySelectorAll('button[data-lgdel]').forEach(function (b) {
        b.addEventListener('click', function () {
          var x = findEntry(b.dataset.lgdel);
          if (!x) return;
          var nrc = (receipts[x.id] || []).length;
          if (!confirm('"' + x.title + '" (' + won(x.amount) + '원) 항목을 지우시겠습니까?' +
                       (nrc ? '\n붙어 있는 영수증 ' + nrc + '장도 함께 지워집니다.' : ''))) return;
          removeReceiptFiles(x.id).then(function () {
            return SHSCloud.init();
          }).then(function (c) {
            return c.from('ledger_entries').delete().eq('id', x.id);
          }).then(function (r) {
            if (r.error) { alert(r.error.message); return; }
            SHSCloud.log('delete', '회계 항목 삭제', ownerLabel + ' ' + year + '년 / ' + x.title);
            load();
          });
        });
      });
    }

    /* 감사 기간과 저장 권한을 먼저 확인하고 그린다 */
    Promise.all([SHSAuditMark.ready(), askCanEdit()]).then(load, load);
  }

  /* ================= 재정보고서 =================
   * 장부 내용을 수입·지출 두 단으로 정리한 보고서.
   * 장부 입력·관리는 임원이 하지만, 보고서는 회원이 상시로 열람한다.
   *
   *   SHSLedger.report(자리, { kind, owner })
   */
  function report(box, opts) {
    if (!box) return;
    var ownerKind = kindOf(opts.kind);
    /* 화면과 기록에 보일 이름 — 교역자회 장부는 owner(시찰 이름) 뒤에 '교역자회'를 붙인다 */
    var ownerLabel = opts.label || (ownerKind === 'ministers' ? opts.owner + ' 교역자회' : opts.owner);
    var now0 = new Date();
    var year = parseInt(opts.year, 10) ||
      (now0.getMonth() + 1 >= 4 ? now0.getFullYear() : now0.getFullYear() - 1);
    var receipts = {}, payouts = {};   /* 항목 번호 → 영수증 / 지급 확인 */
    function fyLabel(y) { return y + ' 회계연도 (' + y + '.4 ~ ' + (y + 1) + '.3)'; }

    function load() {
      box.innerHTML = '<p style="color:var(--gray-5)">재정보고서를 불러오는 중...</p>';
      var books = [], book = null, entries = [];
      SHSCloud.init().then(function (c) {
        return c.from('ledger_books').select('*')
                .eq('owner_kind', ownerKind).eq('owner', opts.owner)
                .order('year', { ascending: false });
      }).then(function (r) {
        if (r.error) throw r.error;
        books = r.data || [];
        book = books.filter(function (b) { return b.year === year; })[0] || null;
        if (!book) return { data: [] };
        return SHSCloud.init().then(function (c) {
          return c.from('ledger_entries').select('*').eq('book_id', book.id)
                  .order('entry_date').order('id');
        });
      }).then(function (r2) {
        entries = (r2 && r2.data) || [];
        if (!book) return [{ data: [] }, { data: [] }];
        /* 증빙: 영수증 사진과 지급 확인 명단 (표가 없으면 빈 목록) */
        return SHSCloud.init().then(function (c) {
          return Promise.all([
            c.from('ledger_receipts').select('*').eq('book_id', book.id).order('id')
              .then(function (x) { return x.error ? { data: [] } : x; }, function () { return { data: [] }; }),
            c.from('ledger_payouts').select('*').eq('book_id', book.id).order('id')
              .then(function (x) { return x.error ? { data: [] } : x; }, function () { return { data: [] }; })
          ]);
        });
      }).then(function (rs) {
        receipts = {}; payouts = {};
        ((rs[0] && rs[0].data) || []).forEach(function (r) {
          (receipts[r.entry_id] = receipts[r.entry_id] || []).push(r);
        });
        ((rs[1] && rs[1].data) || []).forEach(function (r) {
          (payouts[r.entry_id] = payouts[r.entry_id] || []).push(r);
        });
        draw(books, book, entries);
      }).catch(function (x) {
        box.innerHTML = '<p style="color:var(--gray-5)">재정보고서를 불러오지 못했습니다: ' +
          esc((x && x.message) || '') + '</p>';
      });
    }

    function draw(books, book, entries) {
      var inc = entries.filter(function (x) { return x.kind === '수입'; });
      var out = entries.filter(function (x) { return x.kind !== '수입'; });
      var sumIn = 0, sumOut = 0;
      inc.forEach(function (x) { sumIn += Number(x.amount) || 0; });
      out.forEach(function (x) { sumOut += Number(x.amount) || 0; });
      var open = book ? Number(book.opening_balance) || 0 : 0;
      var left = open + sumIn - sumOut;

      var ys = {};
      books.forEach(function (b) { ys[b.year] = 1; });
      ys[year] = 1;
      var yearOpts = Object.keys(ys).map(Number).sort(function (a, b) { return b - a; });

      /* 적요: 날짜 · 교회 · 비고를 한 줄로 */
      /* 항목마다 증빙 번호를 매긴다 (영수증이나 지급 확인이 있는 것만, 날짜 순) */
      var attNo = {};
      entries.slice().sort(function (a, b) {
        return String(a.entry_date || '').localeCompare(String(b.entry_date || '')) || (a.id - b.id);
      }).forEach(function (x) {
        if ((receipts[x.id] || []).length || (payouts[x.id] || []).length) {
          attNo[x.id] = Object.keys(attNo).length + 1;
        }
      });
      function brief(x) {
        var parts = [];
        if (x.entry_date) parts.push(String(x.entry_date).slice(5).replace('-', '.'));
        if (x.church) parts.push(x.church);
        if (x.note) parts.push(x.note);
        var s = parts.length ? esc(parts.join(' · ')) : '';
        var rc = (receipts[x.id] || []).length, po = payouts[x.id] || [];
        if (rc || po.length) {
          var ok = po.filter(function (p) { return p.status === '확인'; }).length;
          s += (s ? ' ' : '') + '<span style="white-space:nowrap;color:#b03a3a">[증빙 ' + attNo[x.id] +
            (rc ? ' · 영수증 ' + rc + '장' : '') + (po.length ? ' · 수령 ' + ok + '/' + po.length : '') + ']</span>';
        }
        return s;
      }
      function cellRow(x) {
        if (!x) return '<td></td><td></td><td></td>';
        return '<td class="left">' + (x.category ? esc(x.category) + ' · ' : '') + esc(x.title) + '</td>' +
          '<td class="left" style="font-size:0.8rem;color:var(--gray-6)">' + brief(x) + '</td>' +
          '<td style="text-align:right">' + won(x.amount) + '</td>';
      }

      /* 과목별 집계 — 과목을 적는 장부(노회 장부)에서만 나온다 */
      function byCat(list) {
        var m = {}, order = [];
        list.forEach(function (x) {
          var k = x.category || '기타';
          if (!(k in m)) { m[k] = 0; order.push(k); }
          m[k] += Number(x.amount) || 0;
        });
        return order.map(function (k) { return { name: k, sum: m[k] }; });
      }
      var catTable = '';
      if (entries.some(function (x) { return x.category; })) {
        var ci = byCat(inc), co = byCat(out);
        var cn = Math.max(ci.length, co.length);
        catTable = '<h4 style="margin:10px 0 4px;font-size:0.92rem">과목별 집계</h4>' +
          '<div style="overflow-x:auto"><table class="tbl" style="font-size:0.86rem;margin-bottom:14px"><thead><tr>' +
          '<th style="width:38%">수입 과목</th><th style="width:12%">금액</th>' +
          '<th style="width:38%">지출 과목</th><th style="width:12%">금액</th></tr></thead><tbody>';
        for (var ci2 = 0; ci2 < cn; ci2++) {
          catTable += '<tr>' +
            (ci[ci2] ? '<td class="left">' + esc(ci[ci2].name) + '</td><td style="text-align:right">' + won(ci[ci2].sum) + '</td>' : '<td></td><td></td>') +
            (co[ci2] ? '<td class="left">' + esc(co[ci2].name) + '</td><td style="text-align:right">' + won(co[ci2].sum) + '</td>' : '<td></td><td></td>') +
            '</tr>';
        }
        catTable += '<tr style="font-weight:700;background:var(--gray-1,#f4f5f8)">' +
          '<td>수입합계</td><td style="text-align:right">' + won(sumIn) + '</td>' +
          '<td>지출합계</td><td style="text-align:right">' + won(sumOut) + '</td></tr>' +
          '</tbody></table></div>';
      }

      var h = '<div class="inline-form" style="margin-bottom:10px;align-items:flex-end">' +
        '<div class="field" style="flex:0 0 260px"><label>회계 연도</label>' +
        '<select id="fr-year">' + yearOpts.map(function (y) {
          return '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>' + fyLabel(y) + '</option>';
        }).join('') + '</select></div>' +
        '<button class="btn ghost" id="fr-print">인쇄</button>' +
        '<button class="btn ghost" id="fr-pdf">PDF 저장</button>' +
        '</div>';

      if (!book) {
        h += '<p style="color:var(--gray-5)">' + fyLabel(year) + ' 장부가 아직 없습니다.</p>';
        box.innerHTML = h;
        bind();
        return;
      }

      var rows = Math.max(inc.length, out.length, 1);
      var t = '<div id="fr-sheet">' +
        '<h3 style="text-align:center;margin:6px 0 2px">재정보고서</h3>' +
        '<p style="text-align:center;font-size:0.84rem;color:var(--gray-6);margin:0 0 10px">' +
        esc(ownerLabel) + ' · ' + fyLabel(year) +
        (book.closed_yn ? ' · 마감' : '') +
        (book.audited_yn ? ' · 감사필' : '') + '</p>' +
        catTable +
        '<div style="overflow-x:auto"><table class="tbl" style="font-size:0.86rem"><thead><tr>' +
        '<th style="width:16%">수입항목</th><th style="width:22%">적요</th><th style="width:12%">금액</th>' +
        '<th style="width:16%">지출항목</th><th style="width:22%">적요</th><th style="width:12%">금액</th>' +
        '</tr></thead><tbody>';
      if (!entries.length) {
        t += '<tr><td colspan="6" style="text-align:center;color:var(--gray-5);padding:16px">' +
          '기록된 수입·지출이 없습니다.</td></tr>';
      } else {
        for (var i = 0; i < rows; i++) {
          t += '<tr>' + cellRow(inc[i]) + cellRow(out[i]) + '</tr>';
        }
      }
      t += '<tr style="font-weight:700;background:var(--gray-1,#f4f5f8)">' +
        '<td>수입합계</td><td></td><td style="text-align:right">' + won(sumIn) + '</td>' +
        '<td>지출합계</td><td></td><td style="text-align:right">' + won(sumOut) + '</td></tr>' +
        '<tr style="font-weight:700;background:var(--gray-1,#f4f5f8)">' +
        '<td>이월금</td><td></td><td style="text-align:right">' + won(open) + '</td>' +
        '<td>차인잔액</td><td></td><td style="text-align:right">' + won(left) + '</td></tr>' +
        '<tr style="font-weight:700;background:var(--gray-1,#f4f5f8)">' +
        '<td>합계</td><td></td><td style="text-align:right">' + won(open + sumIn) + '</td>' +
        '<td>합계</td><td></td><td style="text-align:right">' + won(sumOut + left) + '</td></tr>';
      t += '</tbody></table></div>' +
        '<p style="font-size:0.78rem;color:var(--gray-5);margin-top:6px">차인잔액 = 이월금 + 수입합계 − 지출합계. ' +
        (ownerKind === 'presbytery' ? '세례의무금은 총회 부과금으로 노회가 관리만 하며 이 보고서의 수입에 넣지 않습니다. ' : '') +
        '장부 입력·관리는 임원이 하며, 이 보고서는 회원이 상시로 열람합니다.</p></div>';

      box.innerHTML = h + t;
      bind();

      function bind() {
        var sel = document.getElementById('fr-year');
        if (sel) sel.addEventListener('change', function () {
          year = parseInt(this.value, 10);
          load();
        });
        /* 증빙(영수증 사진·지급 확인 명단)이 있으면 함께 출력할지 묻는다 */
        function askAttachments() {
          var rc = 0, po = 0;
          entries.forEach(function (x) {
            rc += (receipts[x.id] || []).length;
            if ((payouts[x.id] || []).length) po++;
          });
          if (!rc && !po) return Promise.resolve(false);
          var what = [];
          if (rc) what.push('영수증 사진 ' + rc + '장');
          if (po) what.push('지급 확인 명단 ' + po + '건');
          return Promise.resolve(confirm(what.join('과 ') + '도 함께 출력할까요?\n\n' +
            '확인 = 보고서 뒤에 증빙을 붙여 출력\n취소 = 보고서만 출력'));
        }

        /* 증빙 쪽 — 항목마다 영수증 사진과 지급 확인 명단 */
        function attachmentsHtml() {
          var ids = Object.keys(attNo).sort(function (a, b) { return attNo[a] - attNo[b]; });
          if (!ids.length) return Promise.resolve('');
          var jobs = ids.map(function (id) {
            var x = entries.filter(function (e2) { return String(e2.id) === String(id); })[0];
            var rcs = receipts[id] || [], pos = payouts[id] || [];
            return Promise.all(rcs.map(function (r) {
              return SHSCloud.init().then(function (c) {
                return c.storage.from('receipts').createSignedUrl(r.file_path, 600);
              }).then(function (res) {
                return res && res.data ? fetchDataUrl(res.data.signedUrl) : null;
              }, function () { return null; });
            })).then(function (urls) {
              var h2 = '<div class="att">' +
                '<h4>증빙 ' + attNo[id] + ' · ' + esc(x.entry_date || '') +
                (x.category ? ' · ' + esc(x.category) : '') + ' · ' + esc(x.title) +
                ' · ' + won(x.amount) + '원' + (x.church ? ' (' + esc(x.church) + ')' : '') + '</h4>';
              urls.forEach(function (u, i) {
                h2 += '<div class="att-img">' +
                  (u ? '<img src="' + u + '" alt="영수증">'
                     : '<p class="att-miss">영수증 사진을 불러오지 못했습니다 (' + esc(rcs[i].file_name || '') + ')</p>') +
                  '</div>';
              });
              if (pos.length) {
                var sum = 0, ok = 0;
                pos.forEach(function (p) { sum += Number(p.amount) || 0; if (p.status === '확인') ok++; });
                h2 += '<p class="att-sub">지급 확인 명단 — ' + pos.length + '명 · 지급 합계 ' + won(sum) +
                  '원 · 수령 확인 ' + ok + '명' + (ok < pos.length ? ' · 미확인 ' + (pos.length - ok) + '명' : '') + '</p>' +
                  '<table><thead><tr><th style="width:8%">번호</th><th class="left">받는 사람</th><th>교회</th>' +
                  '<th style="width:14%">금액 (원)</th><th style="width:34%">수령 확인</th></tr></thead><tbody>';
                pos.forEach(function (p, i) {
                  h2 += '<tr><td>' + (i + 1) + '</td><td class="left">' + esc(p.recipient) + '</td>' +
                    '<td>' + esc(p.recipient_church || '') + '</td>' +
                    '<td style="text-align:right">' + won(p.amount) + '</td>' +
                    '<td class="left">' + (p.status === '확인'
                      ? '확인 ' + esc(String(p.confirmed_at || '').replace('T', ' ').slice(0, 16)) +
                        (p.confirmed_by ? ' · ' + esc(p.confirmed_by) : '') +
                        (p.confirm_note ? ' · ' + esc(p.confirm_note) : '')
                      : '미확인') + '</td></tr>';
                });
                h2 += '</tbody></table>';
              }
              return h2 + '</div>';
            });
          });
          return Promise.all(jobs).then(function (parts) {
            return '<div class="att-head"><h3>증빙 서류</h3>' +
              '<p>' + esc(ownerLabel) + ' · ' + fyLabel(year) + ' · 증빙 ' + ids.length + '건 — ' +
              '보고서의 [증빙 번호]와 같은 번호입니다. 회의비·거마비는 받는 분의 수령 확인이 영수증을 대신합니다.</p></div>' +
              parts.join('');
          });
        }

        /* 쪽이 넘어가는 자리에서 줄(행)이 잘리지 않게 — 인쇄와 PDF 둘 다 같은 규칙 */
        var ATT_CSS = 'tr{page-break-inside:avoid;break-inside:avoid}thead{display:table-header-group}' +
          'h3,h4{page-break-after:avoid;break-after:avoid}' +
          '.att-head{page-break-before:always;margin-top:8px}' +
          '.att{page-break-inside:avoid;margin:14px 0 18px;border-top:1px solid #999;padding-top:8px}' +
          '.att h4{margin:0 0 6px;font-size:13px}' +
          '.att-img{page-break-inside:avoid;text-align:center;margin:6px 0}' +
          '.att-img img{max-width:100%;max-height:120mm}' +
          '.att-miss{color:#a33;font-size:12px}' +
          '.att-sub{font-size:12px;margin:8px 0 4px}';
        var SHEET_CSS = 'body{font-family:"Malgun Gothic","맑은 고딕",sans-serif;padding:24px;color:#111}' +
          'table{width:100%;border-collapse:collapse;font-size:12px}' +
          'th,td{border:1px solid #333;padding:4px 6px}' +
          'th{background:#f2f2f2}h3{text-align:center}' +
          'td.left,th.left{text-align:left}td{text-align:center}' + ATT_CSS;

        var pr = document.getElementById('fr-print');
        if (pr) pr.addEventListener('click', function () {
          var sheet = document.getElementById('fr-sheet');
          if (!sheet) return;
          askAttachments().then(function (withAtt) {
            pr.disabled = true; pr.textContent = '준비 중…';
            return (withAtt ? attachmentsHtml() : Promise.resolve('')).then(function (att) {
              pr.disabled = false; pr.textContent = '인쇄';
              var w = window.open('', '_blank', 'width=900,height=700');
              if (!w) { alert('인쇄 창이 막혔습니다. 팝업을 허용해 주세요.'); return; }
              w.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
                '<title>재정보고서 - ' + esc(ownerLabel) + '</title>' +
                '<style>' + SHEET_CSS + '</style></head><body>' +
                sheet.innerHTML + att + '</body></html>');
              w.document.close();
              w.focus();
              setTimeout(function () { w.print(); }, att ? 900 : 300);
              if (window.SHSCloud) SHSCloud.log('view', '재정보고서 인쇄', ownerLabel + ' ' + year + '년' + (att ? ' (증빙 포함)' : ''));
            });
          });
        });

        var pf = document.getElementById('fr-pdf');
        if (pf) pf.addEventListener('click', function () {
          var sheet = document.getElementById('fr-sheet');
          if (!sheet) return;
          askAttachments().then(function (withAtt) {
            pf.disabled = true; pf.textContent = '만드는 중…';
            var stage = document.createElement('div');
            stage.style.cssText = 'position:absolute;left:-11000px;top:0;width:800px;background:#fff;padding:10px';
            /* 화면을 아래로 내린 채 만들면 그림 도구(html2canvas)가 내린 만큼을 첫 쪽 위에 빈칸으로
             * 넣어 버린다. 만드는 동안만 맨 위로 올렸다가 끝나면 제자리로 돌린다. */
            var sx = window.scrollX || 0, sy = window.scrollY || 0;
            function done() {
              stage.remove(); pf.disabled = false; pf.textContent = 'PDF 저장';
              window.scrollTo(sx, sy);
            }
            return (withAtt ? attachmentsHtml() : Promise.resolve('')).then(function (att) {
              stage.innerHTML = '<style>' + ATT_CSS + '</style><div>' + sheet.innerHTML + att + '</div>';
              document.body.appendChild(stage);
              return loadPdfTool();
            }).then(function (html2pdf) {
              window.scrollTo(0, 0);
              return html2pdf().set({
                margin: 8,
                filename: ownerLabel + ' ' + year + ' 회계연도 재정보고서' + (withAtt ? ' (증빙 포함)' : '') + '.pdf',
                pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'h4', '.att-img'] },
                html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true, scrollX: 0, scrollY: 0 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
              }).from(stage.firstElementChild.nextElementSibling || stage).save();
            }).then(function () {
              done();
              if (window.SHSCloud) SHSCloud.log('view', '재정보고서 PDF 저장', ownerLabel + ' ' + year + '년' + (withAtt ? ' (증빙 포함)' : ''));
            }).catch(function (err) {
              done();
              alert('PDF를 만들지 못했습니다: ' + ((err && err.message) || err));
            });
          });
        });
      }
    }

    load();
  }

  return { mount: mount, report: report };
})();

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
 *     kind:   'sichal' | 'committee' | 'presbytery',
 *     owner:  '북부시찰' | '재정부' | '노회',
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
 *     시찰   : 시찰장·서기·회계
 * 그래야 화면에 보이는 것과 실제로 저장되는 것이 어긋나지 않는다.
 */
var SHSLedger = (function () {
  'use strict';

  var KINDS = ['수입', '지출'];

  function esc(s) { return SHS.esc(s); }
  function won(n) { return (Number(n) || 0).toLocaleString('ko-KR'); }
  function kindOf(k) { return ['committee', 'sichal', 'presbytery'].indexOf(k) >= 0 ? k : 'sichal'; }

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
    /* 노회 장부는 과목을 고르고 적요를 따로 적는다. 상비부 배정도 여기서 한다. */
    var useCats = ownerKind === 'presbytery';
    var cats = { '수입': [], '지출': [] };   /* 과목 목록 (ledger_categories) */
    var catRows = [];
    var books = [], book = null, entries = [];
    var receipts = {};        /* 항목 번호 → 영수증 목록 */
    var upTarget = null;      /* 줄의 <올리기>를 눌렀을 때 어느 항목에 붙일지 */
    var pendingFiles = [];    /* 입력 칸에 끌어다 놓거나 고른 사진들 — 저장할 때 함께 올라간다 */
    /* 항목 목록 — 기본 항목에 더해, 직접 적어 저장한 항목이 저절로 등재된다 */
    var CAT_BASE = {
      '수입': ['회비', '찬조', '노회 지원금', '이자', '기타'],
      '지출': ['사업비', '교통비', '식비', '인쇄비', '경조비', '기타']
    };
    var catUsed = { '수입': [], '지출': [] };
    /* 회계연도는 4월에 시작해 다음 해 3월에 끝난다. year는 시작 연도다. */
    var now0 = new Date();
    var year = now0.getMonth() + 1 >= 4 ? now0.getFullYear() : now0.getFullYear() - 1;
    var viewKind = '수입';   /* 지금 보고 있는 탭 — 수입 또는 지출 */

    function fyLabel(y) { return y + ' 회계연도 (' + y + '.4 ~ ' + (y + 1) + '.3)'; }
    /* 적을 수 있는가. 데이터베이스에 물어본 답으로 채운다. */
    var canEdit = !!opts.canEdit;

    function askCanEdit() {
      return SHSCloud.init().then(function (c) {
        return c.rpc('is_ledger_owner', { p_kind: ownerKind, p_owner: opts.owner });
      }).then(function (r) {
        if (r && !r.error && typeof r.data === 'boolean') canEdit = r.data;
      }, function () { /* 못 물어보면 부르는 쪽이 준 값을 그대로 쓴다 */ });
    }

    /* 이 장부를 누가 쓰는지 알려 주는 말 */
    function who() {
      if (ownerKind === 'presbytery') return '노회 회계·부회계';
      return opts.kind === 'committee'
        ? SHS.headTitle(opts.owner) + '·서기·회계'
        : '시찰장·서기·회계';
    }

    function load() {
      box.innerHTML = '<p style="color:var(--gray-5)">회계 장부를 불러오는 중...</p>';
      SHSCloud.init().then(function (c) {
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
          (canEdit
            ? ' <button class="btn ghost sm" id="lg-reopen" style="margin-left:8px">마감 취소</button>'
            : '') +
          '</div>';
      }

      if (canWrite) {
        h += '<div class="inline-form" style="margin-bottom:10px">' +
          '<div class="field" style="flex:0 0 220px"><label>이월금 (원)</label>' +
          '<input type="number" id="lg-open" value="' + (Number(book.opening_balance) || 0) + '" step="1"></div>' +
          '<button class="btn ghost" id="lg-opensave">이월금 저장</button>' +
          (books.filter(function (b) { return b.year === year - 1; }).length
            ? '<button class="btn ghost" id="lg-carry">지난해 잔액 가져오기</button>' : '') +
          '<button class="btn ghost" id="lg-close">회계연도 마감</button>' +
          '</div><div class="form-msg" id="lg-omsg"></div>';
      }

      /* 수입·지출을 탭으로 나눠 본다 */
      var incRows = entries.filter(function (x) { return x.kind === '수입'; });
      var outRows = entries.filter(function (x) { return x.kind !== '수입'; });
      h += '<div class="tabs" id="lg-tabs" style="margin:14px 0 12px">' +
        KINDS.map(function (k) {
          var n = k === '수입' ? incRows.length : outRows.length;
          return '<button class="' + (viewKind === k ? 'active' : '') + '" data-lk="' + k + '">' +
            k + ' (' + n + '건)</button>';
        }).join('') + '</div>';

      /* 입력 섹션이 먼저, 그 아래에 장부가 쌓인다 */
      if (canWrite) h += entryForm();

      var shown = viewKind === '수입' ? incRows : outRows;
      var shownSum = 0;
      shown.forEach(function (x) { shownSum += Number(x.amount) || 0; });

      if (!shown.length) {
        h += '<p style="color:var(--gray-5)">적어 둔 ' + viewKind + '이 없습니다.' +
          (canWrite ? ' 위 입력 칸에 기록하시면 이 자리에 장부가 만들어집니다.' : '') + '</p>';
      } else {
        h += '<table class="tbl"><thead><tr><th style="width:120px">일자</th>' +
          (useCats ? '<th style="width:130px">과목</th>' : '') +
          '<th style="width:140px">교회</th>' +
          '<th>' + (useCats ? '적요' : '항목') + '</th>' +
          '<th style="width:140px">금액 (원)</th><th style="width:200px">비고</th>' +
          '<th style="width:92px">영수증</th>' +
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
            '<td' + (canWrite && !ln ? ' class="lg-dropcell" data-lgdrop="' + x.id + '" title="영수증 사진을 여기에 끌어다 놓아도 됩니다"' : '') +
            '>' + receiptCell(x, ln, canWrite) + '</td>' +
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
          (viewKind === '수입' ? '+' : '−') + won(shownSum) + '</td><td></td><td></td>' +
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
      if (canWrite) { bindOpening(); bindEntryForm(); bindEntryList(); if (useCats) bindCats(); }

      /* 마감 취소 — 잘못 마감했을 때 임원이 되돌린다 */
      var ro = document.getElementById('lg-reopen');
      if (ro) ro.addEventListener('click', function () {
        if (!confirm(fyLabel(year) + ' 마감을 취소하시겠습니까?\n' +
                     '다음 회계연도 이월금은 그대로 두므로, 장부를 고친 뒤 다시 마감해 주세요.')) return;
        SHSCloud.init().then(function (c) {
          return c.rpc('reopen_ledger_year', { p_book: book.id });
        }).then(function (r) {
          if (r.error) { alert(r.error.message); return; }
          SHSCloud.log('update', '회계연도 마감 취소', opts.owner + ' ' + year + ' 회계연도');
          load();
        });
      });
      SHSAuditMark.bind(document.getElementById('lg-audit'), {
        kind: 'ledger_books', label: opts.owner + ' ' + year + '년 회계 장부', after: load
      });
    }

    function bindYear() {
      var sel = document.getElementById('lg-year');
      if (sel) sel.addEventListener('change', function () {
        year = parseInt(this.value, 10);
        load();
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
          SHSCloud.log('create', '회계 장부 개설', opts.owner + ' ' + year + '년');
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
          SHSCloud.log('update', '이월금 수정', opts.owner + ' ' + year + '년 → ' + won(open) + '원');
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
          SHSCloud.log('update', '지난해 잔액 이월', opts.owner + ' ' + year + '년 ← ' + won(r.data) + '원');
          load();
        });
      });

      /* 회계연도 마감 — 남은 돈이 다음 회계연도 이월금으로 넘어간다 */
      var cl = document.getElementById('lg-close');
      if (cl) cl.addEventListener('click', function () {
        var s2 = sums();
        if (!confirm(fyLabel(year) + '를 마감합니다.\n\n남은 돈 ' + won(s2.left) + '원이 ' +
              (year + 1) + ' 회계연도 이월금으로 저절로 넘어가고,\n마감된 장부에는 더 적을 수 없습니다.\n\n' +
              '계속하시겠습니까?')) return;
        var msg = document.getElementById('lg-omsg');
        msg.className = 'form-msg'; msg.textContent = '마감 중입니다...';
        SHSCloud.init().then(function (c) {
          return c.rpc('close_ledger_year', { p_book: book.id });
        }).then(function (r) {
          if (r.error) {
            msg.className = 'form-msg err';
            msg.textContent = r.error.message +
              ' (60_sichal_fee_ledger.sql 실행이 필요할 수 있습니다)';
            return;
          }
          SHSCloud.log('update', '회계연도 마감',
            opts.owner + ' ' + year + ' 회계연도 → 이월금 ' + won(r.data) + '원');
          year = year + 1;
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
        '<h3 style="margin-top:0" id="lg-ftitle">' + viewKind + ' 적기</h3>' +
        '<input type="hidden" id="lg-id" value="">' +
        '<div class="inline-form">' +
        '<div class="field" style="flex:0 0 160px"><label>일자</label>' +
        '<input type="date" id="lg-date" value="' + today + '"></div>' +
        catField +
        '<div class="field" style="flex:0 0 170px"><label>교회명 (선택)</label>' +
        '<input type="text" id="lg-church" list="lg-churches" placeholder="예: 반석교회">' +
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
        '<div class="field"><label>영수증 사진 (선택)</label>' +
        '<div class="lg-drop" id="lg-drop" tabindex="0" role="button">' +
        '<input type="file" id="lg-file" accept="image/*" multiple class="hidden">' +
        '<div id="lg-drop-text">여기에 영수증 사진을 <strong>끌어다 놓거나</strong> 눌러서 고르세요 ' +
        '<span style="color:var(--gray-5)">(휴대전화에서는 바로 찍을 수 있습니다 · 여러 장 가능)</span></div>' +
        '<div class="lg-drop-list" id="lg-drop-list"></div></div>' +
        '<div style="font-size:0.78rem;color:var(--gray-5);margin-top:3px">저장하면 사진이 함께 올라가고, ' +
        '줄의 <strong>영수증</strong> 단추로 언제든 다시 볼 수 있습니다. ' +
        '이미 적은 줄에는 영수증 칸에 사진을 바로 끌어다 놓아도 됩니다.</div></div>' +
        '<button class="btn" id="lg-save">저장</button> ' +
        '<button class="btn ghost hidden" id="lg-cancel">취소</button>' +
        '<div class="form-msg" id="lg-msg"></div>' +
        (useCats ? catManager() : '') +
        '</div>';
    }

    /* ================= 영수증 ================= */
    function receiptCell(x, ln, canWrite) {
      var list = receipts[x.id] || [];
      var h = '';
      if (list.length) {
        h += '<button type="button" class="btn ghost sm" data-lgrc="' + x.id + '" title="영수증 보기">' +
          '&#128206; ' + list.length + '장</button>';
      }
      if (canWrite && !ln) {
        h += (h ? ' ' : '') + '<button type="button" class="btn ghost sm" data-lgup="' + x.id + '" ' +
          'title="영수증 사진 올리기" style="padding-left:6px;padding-right:6px">+</button>';
      }
      return h || '<span style="color:var(--gray-5)">-</span>';
    }

    /* 사진 한 장을 줄여서 보관함에 올리고 영수증 표에 적는다 */
    function uploadReceipt(entryId, f) {
      var path = book.id + '/' + entryId + '/' + Date.now() + '-' +
        Math.random().toString(36).slice(2, 8) + '.jpg';
      var size = 0;
      return shrinkImage(f).then(function (blob) {
        size = blob.size;
        return SHSCloud.init().then(function (c) {
          return c.storage.from('receipts')
            .upload(path, blob, { upsert: false, contentType: 'image/jpeg' })
            .then(function (r) {
              if (r.error) throw r.error;
              return c.from('ledger_receipts').insert({
                entry_id: entryId, book_id: book.id, file_path: path,
                file_name: f.name || null, file_size: size, created_by: opts.user.name
              }).select();
            });
        });
      }).then(function (r) {
        var w = SHS.wrote(r);
        if (!w.ok) throw new Error(w.why);
        SHSCloud.log('create', '영수증 등록', opts.owner + ' ' + year + '년 / 항목 ' + entryId);
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
      Array.prototype.slice.call(files || []).forEach(function (f) {
        if (/^image\//.test(f.type)) pendingFiles.push(f);
      });
      renderPending();
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
          SHSCloud.log('delete', '영수증 삭제', opts.owner + ' ' + year + '년 / 항목 ' + lbEntry);
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
        (r.created_by ? ' · ' + r.created_by : '');
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
    function openReceipts(entryId, canWrite) {
      lbList = receipts[entryId] || [];
      if (!lbList.length) return;
      lbEntry = entryId; lbCanWrite = canWrite;
      lightbox().classList.add('open');
      showLb(0);
    }

    function bindReceipts(canWrite) {
      box.querySelectorAll('button[data-lgrc]').forEach(function (b) {
        b.addEventListener('click', function () { openReceipts(b.dataset.lgrc, canWrite); });
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
          SHSCloud.log('create', '회계 과목 추가', opts.owner + ' ' + viewKind + ' / ' + name);
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
            SHSCloud.log('delete', '회계 과목 삭제', opts.owner + ' ' + viewKind + ' / ' + r.name);
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
      document.getElementById('lg-ftitle').textContent = viewKind + ' 적기';
      document.getElementById('lg-cancel').classList.add('hidden');
    }

    function bindEntryForm() {
      document.getElementById('lg-cancel').addEventListener('click', clearEntryForm);
      bindDrop();
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
            opts.owner + ' ' + year + '년 / ' + d.title + ' ' + won(d.amount) + '원');
          var savedId = id || (r.data && r.data[0] && r.data[0].id);
          rememberCat(d.category).then(function () {
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
            SHSCloud.log('delete', '회계 항목 삭제', opts.owner + ' ' + year + '년 / ' + x.title);
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
    var now0 = new Date();
    var year = now0.getMonth() + 1 >= 4 ? now0.getFullYear() : now0.getFullYear() - 1;
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
      function brief(x) {
        var parts = [];
        if (x.entry_date) parts.push(String(x.entry_date).slice(5).replace('-', '.'));
        if (x.church) parts.push(x.church);
        if (x.note) parts.push(x.note);
        return parts.length ? esc(parts.join(' · ')) : '';
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
        esc(opts.owner) + ' · ' + fyLabel(year) +
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
        '장부 입력·관리는 임원이 하며, 이 보고서는 회원이 상시로 열람합니다.</p></div>';

      box.innerHTML = h + t;
      bind();

      function bind() {
        var sel = document.getElementById('fr-year');
        if (sel) sel.addEventListener('change', function () {
          year = parseInt(this.value, 10);
          load();
        });
        var pr = document.getElementById('fr-print');
        if (pr) pr.addEventListener('click', function () {
          var sheet = document.getElementById('fr-sheet');
          if (!sheet) return;
          var w = window.open('', '_blank', 'noopener,width=900,height=700');
          if (!w) return;
          w.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
            '<title>재정보고서 - ' + esc(opts.owner) + '</title>' +
            '<style>body{font-family:"Malgun Gothic","맑은 고딕",sans-serif;padding:24px;color:#111}' +
            'table{width:100%;border-collapse:collapse;font-size:12px}' +
            'th,td{border:1px solid #333;padding:4px 6px}' +
            'th{background:#f2f2f2}h3{text-align:center}' +
            'td.left{text-align:left}td{text-align:center}</style></head><body>' +
            sheet.innerHTML + '</body></html>');
          w.document.close();
          w.focus();
          setTimeout(function () { w.print(); }, 300);
        });
      }
    }

    load();
  }

  return { mount: mount, report: report };
})();

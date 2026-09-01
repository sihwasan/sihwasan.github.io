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
 *     kind:   'sichal' | 'committee',
 *     owner:  '북부시찰' | '재정부',
 *     user:   지금 로그인한 사람,
 *     isAuditor: 감사부인가
 *   })
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

  function mount(box, opts) {
    if (!box) return;
    var ownerKind = opts.kind === 'committee' ? 'committee' : 'sichal';
    var books = [], book = null, entries = [];
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
            /* 여태 적어 온 항목 이름 — 목록에 저절로 등재된다 (회비 자동 기록은 뺀다) */
            ids.length ? c.from('ledger_entries').select('kind,title').in('book_id', ids)
                          .is('fee_id', null)
                          .then(function (x) { return x; }, function () { return { data: [] }; })
                       : Promise.resolve({ data: [] })
          ]);
        }).then(function (rs) {
          entries = (rs[0] && rs[0].data) || [];
          catUsed = { '수입': [], '지출': [] };
          ((rs[1] && rs[1].data) || []).forEach(function (x) {
            var k = x.kind === '수입' ? '수입' : '지출';
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
          '<th style="width:140px">교회</th>' +
          '<th>항목</th><th style="width:140px">금액 (원)</th><th style="width:200px">비고</th>' +
          (canWrite ? '<th style="width:110px">관리</th>' : '') + '</tr></thead><tbody>';
        shown.forEach(function (x) {
          var amt = Number(x.amount) || 0;
          h += '<tr><td>' + esc(x.entry_date || '-') + '</td>' +
            '<td>' + (x.church ? esc(x.church) : '<span style="color:var(--gray-5)">-</span>') + '</td>' +
            '<td class="left">' + esc(x.title) +
            (x.category && !x.fee_id
              ? ' <span style="font-size:0.8rem;color:var(--gray-5)">(' + esc(x.category) + ')</span>' : '') +
            (x.fee_id
              ? ' <span style="font-size:0.74rem;color:#b03a3a">회비 연동</span>' : '') +
            '</td>' +
            '<td class="' + (viewKind === '수입' ? 'lg-inc' : 'lg-out') + '" style="text-align:right">' +
            (viewKind === '수입' ? '+' : '−') + won(amt) + '</td>' +
            '<td class="left">' + (x.note ? esc(x.note) : '<span style="color:var(--gray-5)">-</span>') + '</td>' +
            (canWrite
              ? (x.fee_id
                  /* 회비 연동 항목은 회비 납부 현황에서 취소하면 함께 지워진다 */
                  ? '<td><span style="font-size:0.78rem;color:var(--gray-5)">납부 현황에서 관리</span></td>'
                  : '<td><button class="btn ghost sm" data-lgedit="' + x.id + '">수정</button> ' +
                    '<button class="btn danger sm" data-lgdel="' + x.id + '">삭제</button></td>')
              : '') +
            '</tr>';
        });
        h += '<tr style="font-weight:700;background:var(--gray-1,#f4f5f8)"><td>합계</td><td></td><td></td>' +
          '<td class="' + (viewKind === '수입' ? 'lg-inc' : 'lg-out') + '" style="text-align:right">' +
          (viewKind === '수입' ? '+' : '−') + won(shownSum) + '</td><td></td>' +
          (canWrite ? '<td></td>' : '') + '</tr>';
        h += '</tbody></table>';
      }

      h += '<div id="lg-audit" style="margin-top:16px">' +
        SHSAuditMark.panel(book, { isAuditor: opts.isAuditor }) + '</div>';

      box.innerHTML = h;
      bindYear();
      bindTabs();
      if (canWrite) { bindOpening(); bindEntryForm(); bindEntryList(); }

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

    function entryForm() {
      var today = new Date().toISOString().slice(0, 10);
      return '<div class="admin-card" style="margin-bottom:16px">' +
        '<h3 style="margin-top:0" id="lg-ftitle">' + viewKind + ' 적기</h3>' +
        '<input type="hidden" id="lg-id" value="">' +
        '<div class="inline-form">' +
        '<div class="field" style="flex:0 0 160px"><label>일자</label>' +
        '<input type="date" id="lg-date" value="' + today + '"></div>' +
        '<div class="field" style="flex:0 0 170px"><label>교회명 (선택)</label>' +
        '<input type="text" id="lg-church" list="lg-churches" placeholder="예: 반석교회">' +
        '<datalist id="lg-churches">' +
        (opts.churches || []).map(function (x) {
          return '<option value="' + esc(x) + '"></option>';
        }).join('') + '</datalist></div>' +
        '<div class="field"><label>항목 (고르거나 직접 입력)</label>' +
        '<input type="text" id="lg-title" list="lg-cats" placeholder="' +
        (viewKind === '수입' ? '예: 회비, 찬조' : '예: 사업비, 식비') + '">' +
        '<datalist id="lg-cats">' +
        CAT_BASE[viewKind].concat(catUsed[viewKind]).map(function (x) {
          return '<option value="' + esc(x) + '"></option>';
        }).join('') +
        '</datalist></div>' +
        '<div class="field" style="flex:0 0 170px"><label>금액 (원)</label>' +
        '<input type="number" id="lg-amt" min="0" step="1"></div>' +
        '</div>' +
        '<div class="field"><label>비고 (선택)</label><input type="text" id="lg-note"></div>' +
        '<button class="btn" id="lg-save">저장</button> ' +
        '<button class="btn ghost hidden" id="lg-cancel">취소</button>' +
        '<div class="form-msg" id="lg-msg"></div></div>';
    }

    function clearEntryForm() {
      ['lg-id', 'lg-church', 'lg-amt', 'lg-title', 'lg-note'].forEach(function (id) {
        document.getElementById(id).value = '';
      });
      document.getElementById('lg-ftitle').textContent = viewKind + ' 적기';
      document.getElementById('lg-cancel').classList.add('hidden');
    }

    function bindEntryForm() {
      document.getElementById('lg-cancel').addEventListener('click', clearEntryForm);
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
        if (!d.title) { msg.className = 'form-msg err'; msg.textContent = '항목을 적어 주세요.'; return; }
        if (d.amount < 0) { msg.className = 'form-msg err'; msg.textContent = '금액은 0원 이상이어야 합니다.'; return; }
        if (!id) d.created_by = opts.user.name;
        msg.className = 'form-msg'; msg.textContent = '저장 중입니다...';
        SHSCloud.init().then(function (c) {
          return id ? c.from('ledger_entries').update(d).eq('id', id).select()
                    : c.from('ledger_entries').insert(d).select();
        }).then(function (r) {
          var w = SHS.wrote(r);
          if (!w.ok) { msg.className = 'form-msg err'; msg.textContent = w.why; return; }
          SHSCloud.log(id ? 'update' : 'create', '회계 ' + d.kind + ' ' + (id ? '수정' : '등록'),
            opts.owner + ' ' + year + '년 / ' + d.title + ' ' + won(d.amount) + '원');
          load();
        });
      });
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
          document.getElementById('lg-ftitle').textContent = viewKind + ' 수정';
          document.getElementById('lg-cancel').classList.remove('hidden');
          document.getElementById('lg-ftitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
      box.querySelectorAll('button[data-lgdel]').forEach(function (b) {
        b.addEventListener('click', function () {
          var x = findEntry(b.dataset.lgdel);
          if (!x) return;
          if (!confirm('"' + x.title + '" (' + won(x.amount) + '원) 항목을 지우시겠습니까?')) return;
          SHSCloud.init().then(function (c) {
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

  return { mount: mount };
})();

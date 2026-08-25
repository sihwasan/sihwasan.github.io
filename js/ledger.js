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
 *     canEdit:  적을 수 있는가 (시찰장·서기 / 부장·서기·회계)
 *     isAuditor: 감사부인가
 *   })
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
    var year = new Date().getFullYear();

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
        if (!book) { entries = []; draw(); return; }
        return SHSCloud.init().then(function (c) {
          return c.from('ledger_entries').select('*').eq('book_id', book.id)
                  .order('entry_date').order('id');
        }).then(function (r2) {
          entries = (r2 && r2.data) || [];
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
      ys[new Date().getFullYear()] = 1;
      return Object.keys(ys).map(Number).sort(function (a, b) { return b - a; });
    }

    function draw() {
      var lock = SHSAuditMark.locked(book);
      var canWrite = opts.canEdit && !lock;
      var s = sums();

      var h = '<p style="color:var(--gray-5);font-size:0.88rem">' +
        '이월금으로 시작해 수입과 지출을 적으면 남은 돈이 저절로 셈해집니다. ' +
        '해가 바뀌면 새 장부를 쓰고, 지난해 남은 돈을 이월금으로 가져올 수 있습니다. ' +
        '<strong>봄·가을 정기노회 전에 감사부의 감사를 받습니다.</strong></p>';

      h += '<div class="inline-form" style="margin-bottom:6px">' +
        '<div class="field" style="flex:0 0 170px"><label>회계 연도</label>' +
        '<select id="lg-year">' + yearList().map(function (y) {
          return '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>' + y + '년</option>';
        }).join('') + '</select></div>' +
        (books.length ? '' :
          '<div class="field"><label>&nbsp;</label>' +
          '<div style="padding-top:9px;color:var(--gray-5);font-size:0.88rem">아직 만들어 둔 장부가 없습니다.</div></div>') +
        '</div>';

      if (!book) {
        h += '<div class="notice-banner">' + year + '년 장부가 아직 없습니다.' +
          (opts.canEdit ? ' 아래에서 만들어 주세요.' : ' 장부는 부장·서기(시찰장·서기)가 만듭니다.') + '</div>';
        if (opts.canEdit) {
          h += '<div class="admin-card"><h3 style="margin-top:0">' + year + '년 장부 만들기</h3>' +
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
        if (opts.canEdit) bindNew();
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
      }

      if (canWrite) {
        h += '<div class="inline-form" style="margin-bottom:10px">' +
          '<div class="field" style="flex:0 0 220px"><label>이월금 (원)</label>' +
          '<input type="number" id="lg-open" value="' + (Number(book.opening_balance) || 0) + '" step="1"></div>' +
          '<button class="btn ghost" id="lg-opensave">이월금 저장</button>' +
          (books.filter(function (b) { return b.year === year - 1; }).length
            ? '<button class="btn ghost" id="lg-carry">지난해 잔액 가져오기</button>' : '') +
          '</div><div class="form-msg" id="lg-omsg"></div>';
      }

      /* 항목 */
      if (!entries.length) {
        h += '<p style="color:var(--gray-5)">적어 둔 수입·지출이 없습니다.</p>';
      } else {
        var run = s.open;
        h += '<table class="tbl"><thead><tr><th style="width:110px">날짜</th>' +
          '<th style="width:70px">구분</th><th style="width:110px">항목</th><th>내용</th>' +
          '<th style="width:120px">금액</th><th style="width:120px">잔액</th>' +
          (canWrite ? '<th style="width:110px">관리</th>' : '') + '</tr></thead><tbody>';
        entries.forEach(function (x, i) {
          var amt = Number(x.amount) || 0;
          run += (x.kind === '수입' ? amt : -amt);
          h += '<tr><td>' + esc(x.entry_date || '-') + '</td>' +
            '<td><span class="role-badge">' + esc(x.kind) + '</span></td>' +
            '<td>' + esc(x.category || '-') + '</td>' +
            '<td class="left">' + esc(x.title) +
            (x.note ? '<div style="font-size:0.8rem;color:var(--gray-5)">' + esc(x.note) + '</div>' : '') +
            '</td>' +
            '<td class="' + (x.kind === '수입' ? 'lg-inc' : 'lg-out') + '">' +
            (x.kind === '수입' ? '+' : '−') + won(amt) + '</td>' +
            '<td>' + won(run) + '</td>' +
            (canWrite
              ? '<td><button class="btn ghost sm" data-lgedit="' + i + '">수정</button> ' +
                '<button class="btn danger sm" data-lgdel="' + i + '">삭제</button></td>'
              : '') +
            '</tr>';
        });
        h += '</tbody></table>';
      }

      if (canWrite) h += entryForm();
      h += '<div id="lg-audit" style="margin-top:16px">' +
        SHSAuditMark.panel(book, { isAuditor: opts.isAuditor }) + '</div>';

      box.innerHTML = h;
      bindYear();
      if (canWrite) { bindOpening(); bindEntryForm(); bindEntryList(); }
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

    function bindNew() {
      document.getElementById('lg-new').addEventListener('click', function () {
        var msg = document.getElementById('lg-nmsg');
        var open = parseInt(document.getElementById('lg-open').value, 10) || 0;
        msg.className = 'form-msg'; msg.textContent = '만드는 중입니다...';
        SHSCloud.init().then(function (c) {
          return c.from('ledger_books').insert({
            owner_kind: ownerKind, owner: opts.owner, year: year,
            opening_balance: open, updated_by: opts.user.name
          });
        }).then(function (r) {
          if (r.error) { msg.className = 'form-msg err'; msg.textContent = r.error.message; return; }
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
                  .eq('id', book.id);
        }).then(function (r) {
          if (r.error) { msg.className = 'form-msg err'; msg.textContent = r.error.message; return; }
          SHSCloud.log('update', '이월금 수정', opts.owner + ' ' + year + '년 → ' + won(open) + '원');
          load();
        });
      });
      var cy = document.getElementById('lg-carry');
      if (cy) cy.addEventListener('click', function () {
        if (!confirm((year - 1) + '년 남은 돈을 ' + year + '년 이월금으로 가져옵니다.\n계속하시겠습니까?')) return;
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
    }

    function entryForm() {
      var today = new Date().toISOString().slice(0, 10);
      return '<div class="admin-card" style="margin-top:18px">' +
        '<h3 style="margin-top:0" id="lg-ftitle">수입·지출 적기</h3>' +
        '<input type="hidden" id="lg-id" value="">' +
        '<div class="inline-form">' +
        '<div class="field" style="flex:0 0 160px"><label>날짜</label>' +
        '<input type="date" id="lg-date" value="' + today + '"></div>' +
        '<div class="field" style="flex:0 0 120px"><label>구분</label><select id="lg-kind">' +
        KINDS.map(function (k) { return '<option>' + k + '</option>'; }).join('') + '</select></div>' +
        '<div class="field" style="flex:0 0 150px"><label>항목</label>' +
        '<input type="text" id="lg-cat" list="lg-cats" placeholder="예: 회비">' +
        '<datalist id="lg-cats">' +
        ['회비', '노회 지원금', '사업비', '교통비', '식비', '인쇄비', '기타'].map(function (x) {
          return '<option value="' + x + '"></option>';
        }).join('') + '</datalist></div>' +
        '<div class="field" style="flex:0 0 170px"><label>금액 (원)</label>' +
        '<input type="number" id="lg-amt" min="0" step="1"></div>' +
        '</div>' +
        '<div class="field"><label>내용</label><input type="text" id="lg-title" placeholder="예: 3월 시찰회 회비"></div>' +
        '<div class="field"><label>비고 (선택)</label><input type="text" id="lg-note"></div>' +
        '<button class="btn" id="lg-save">저장</button> ' +
        '<button class="btn ghost hidden" id="lg-cancel">취소</button>' +
        '<div class="form-msg" id="lg-msg"></div></div>';
    }

    function clearEntryForm() {
      ['lg-id', 'lg-cat', 'lg-amt', 'lg-title', 'lg-note'].forEach(function (id) {
        document.getElementById(id).value = '';
      });
      document.getElementById('lg-ftitle').textContent = '수입·지출 적기';
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
          kind: document.getElementById('lg-kind').value,
          category: document.getElementById('lg-cat').value.trim() || null,
          title: document.getElementById('lg-title').value.trim(),
          amount: parseInt(document.getElementById('lg-amt').value, 10) || 0,
          note: document.getElementById('lg-note').value.trim() || null,
          updated_at: new Date().toISOString()
        };
        if (!d.title) { msg.className = 'form-msg err'; msg.textContent = '내용을 적어 주세요.'; return; }
        if (d.amount < 0) { msg.className = 'form-msg err'; msg.textContent = '금액은 0원 이상이어야 합니다.'; return; }
        if (!id) d.created_by = opts.user.name;
        msg.className = 'form-msg'; msg.textContent = '저장 중입니다...';
        SHSCloud.init().then(function (c) {
          return id ? c.from('ledger_entries').update(d).eq('id', id)
                    : c.from('ledger_entries').insert(d);
        }).then(function (r) {
          if (r.error) { msg.className = 'form-msg err'; msg.textContent = r.error.message; return; }
          SHSCloud.log(id ? 'update' : 'create', '회계 ' + d.kind + ' ' + (id ? '수정' : '등록'),
            opts.owner + ' ' + year + '년 / ' + d.title + ' ' + won(d.amount) + '원');
          load();
        });
      });
    }

    function bindEntryList() {
      box.querySelectorAll('button[data-lgedit]').forEach(function (b) {
        b.addEventListener('click', function () {
          var x = entries[+b.dataset.lgedit];
          document.getElementById('lg-id').value = x.id;
          document.getElementById('lg-date').value = x.entry_date || '';
          document.getElementById('lg-kind').value = x.kind;
          document.getElementById('lg-cat').value = x.category || '';
          document.getElementById('lg-amt').value = x.amount;
          document.getElementById('lg-title').value = x.title;
          document.getElementById('lg-note').value = x.note || '';
          document.getElementById('lg-ftitle').textContent = '수입·지출 수정';
          document.getElementById('lg-cancel').classList.remove('hidden');
          document.getElementById('lg-ftitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
      box.querySelectorAll('button[data-lgdel]').forEach(function (b) {
        b.addEventListener('click', function () {
          var x = entries[+b.dataset.lgdel];
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

    /* 손으로 열어 둔 감사 기간이 있는지 먼저 읽고 그린다 */
    SHSAuditMark.ready().then(load, load);
  }

  return { mount: mount };
})();

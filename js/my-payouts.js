/* 지급 수령 확인 (내 정보)
 *
 * 노회 재정부나 상비부가 회의비·거마비를 주면서 나를 <받는 사람>으로
 * 적으면 여기에 나타난다. 「수령 확인」을 누르면 그 확인이 영수증을
 * 대신하므로, 받은 뒤에만 눌러야 한다. (76_ledger_payouts.sql)
 *
 *   SHSMyPayouts.mount(자리, 지금 로그인한 사람)
 */
var SHSMyPayouts = (function () {
  'use strict';

  function esc(s) { return SHS.esc(s); }
  function won(n) { return (Number(n) || 0).toLocaleString('ko-KR'); }

  function mount(box, user) {
    if (!box) return;
    if (!(user && window.SHSCloud && SHSCloud.enabled())) {
      box.innerHTML = '<p style="color:var(--gray-5)">서버 로그인 후 보실 수 있습니다.</p>';
      return;
    }

    function load() {
      box.innerHTML = '<p style="color:var(--gray-5)">불러오는 중...</p>';
      SHSCloud.init().then(function (c) {
        return c.from('ledger_payouts').select('*')
                .order('status', { ascending: false })     /* 대기가 위, 확인이 아래 */
                .order('created_at', { ascending: false });
      }).then(function (r) {
        if (r.error) {
          box.innerHTML = '<p style="color:var(--gray-5)">지급 기록을 불러오지 못했습니다: ' + esc(r.error.message) + '</p>';
          return;
        }
        draw((r.data || []).filter(function (x) { return x.recipient_user; }));
      });
    }

    function draw(rows) {
      var h = '<p style="font-size:0.88rem;color:var(--gray-6)">회의비·거마비처럼 영수증이 없는 지급은 ' +
        '받는 분의 <strong>수령 확인</strong>이 영수증을 대신합니다. 돈을 받으신 뒤에 눌러 주세요.</p>';
      if (!rows.length) {
        box.innerHTML = h + '<p style="color:var(--gray-5)">받은 지급 기록이 없습니다.</p>';
        return;
      }
      var wait = rows.filter(function (x) { return x.status !== '확인'; }).length;
      if (wait) {
        h += '<div class="notice-banner">확인하지 않은 지급이 <strong>' + wait + '건</strong> 있습니다.</div>';
      }
      h += '<div style="overflow-x:auto"><table class="tbl"><thead><tr>' +
        '<th style="width:100px">일자</th><th style="width:120px">지급처</th><th>내용</th>' +
        '<th style="width:110px">금액 (원)</th><th style="width:150px">수령 확인</th></tr></thead><tbody>';
      rows.forEach(function (x) {
        h += '<tr><td>' + esc(x.entry_date || String(x.created_at || '').slice(0, 10)) + '</td>' +
          '<td>' + esc(x.owner_label || '') + '</td>' +
          '<td class="left">' + (x.entry_category ? '<strong>' + esc(x.entry_category) + '</strong> · ' : '') +
          esc(x.entry_title || '') + '</td>' +
          '<td style="text-align:right">' + won(x.amount) + '</td>' +
          '<td>' + (x.status === '확인'
            ? '<span class="role-badge" style="color:#2a7a2a;border-color:#2a7a2a">확인</span>' +
              '<div style="font-size:0.74rem;color:var(--gray-5)">' +
              esc(String(x.confirmed_at || '').replace('T', ' ').slice(0, 16)) + '</div>'
            : '<button class="btn sm" data-pyok="' + x.id + '">수령 확인</button>') + '</td></tr>';
      });
      h += '</tbody></table></div>';
      box.innerHTML = h;

      box.querySelectorAll('button[data-pyok]').forEach(function (b) {
        b.addEventListener('click', function () {
          var x = rows.filter(function (y) { return String(y.id) === b.dataset.pyok; })[0];
          if (!x) return;
          if (!confirm((x.owner_label || '노회') + '에서 ' + (x.entry_category || '지급') + ' ' + won(x.amount) +
                       '원을 받으셨습니까?\n수령 확인을 누르면 영수증을 대신하며 되돌릴 수 없습니다.')) return;
          b.disabled = true; b.textContent = '확인 중…';
          SHSCloud.init().then(function (c) {
            return c.rpc('confirm_payout', { p_id: x.id });
          }).then(function (r) {
            if (r.error) { alert(r.error.message); load(); return; }
            SHSCloud.log('update', '지급 수령 확인', (x.owner_label || '') + ' ' + (x.entry_title || '') + ' ' + won(x.amount) + '원');
            load();
          });
        });
      });
    }

    load();
  }

  return { mount: mount };
})();

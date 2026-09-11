/* 지급 수령 확인 (내 정보)
 *
 * 노회 재정부·상비부·시찰이 회의비·거마비를 주면서 나를 <받는 사람>으로
 * 적으면 여기에 나타난다. 「수령 확인」을 누르면 그 확인이 영수증을
 * 대신하므로, 받은 뒤에만 눌러야 한다. (76_ledger_payouts.sql)
 *
 *   위쪽  : 확인 대기 — 아직 수령 확인을 누르지 않은 지급
 *   아래쪽: 수령 내역 — 내가 확인한 지급 (연도별, 합계)
 *   맨 위 안내 자리(banner)에는 확인 대기가 있을 때만 붉은 안내를 띄운다.
 *
 *   SHSMyPayouts.mount(자리, 지금 로그인한 사람, 안내 자리)
 */
var SHSMyPayouts = (function () {
  'use strict';

  function esc(s) { return SHS.esc(s); }
  function won(n) { return (Number(n) || 0).toLocaleString('ko-KR'); }
  function ymd(s) { return String(s || '').slice(0, 10); }
  function stamp(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d)) return String(s).replace('T', ' ').slice(0, 16);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '.' + two(d.getMonth() + 1) + '.' + two(d.getDate()) +
      ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function yearOf(x) {
    var s = x.confirmed_at || x.entry_date || x.created_at || '';
    var y = parseInt(String(s).slice(0, 4), 10);
    return isNaN(y) ? null : y;
  }

  function mount(box, user, banner) {
    if (!box) return;
    if (!(user && window.SHSCloud && SHSCloud.enabled())) {
      box.innerHTML = '<p style="color:var(--gray-5)">서버 로그인 후 보실 수 있습니다.</p>';
      return;
    }

    var rows = [];
    var pickYear = null;      /* 수령 내역에서 고른 연도 ('all' = 전체) */
    var scrolled = false;

    function load() {
      box.innerHTML = '<p style="color:var(--gray-5)">불러오는 중...</p>';
      SHSCloud.init().then(function (c) {
        /* 내가 받는 사람으로 적힌 것만 — 장부를 볼 수 있는 임원이라도 남의 지급은 여기 섞지 않는다 */
        var q = c.from('ledger_payouts').select('*').order('created_at', { ascending: false });
        if (user.id) q = q.eq('recipient_user', user.id);
        return q;
      }).then(function (r) {
        if (r.error) {
          box.innerHTML = '<p style="color:var(--gray-5)">지급 기록을 불러오지 못했습니다: ' + esc(r.error.message) + '</p>';
          return;
        }
        rows = (r.data || []).filter(function (x) {
          return x.recipient_user && (!user.id || x.recipient_user === user.id);
        });
        draw();
        /* 알림의 <바로 가기>(mypage.html#payouts)로 왔으면 이 자리로 내려간다 */
        if (!scrolled && location.hash === '#payouts') {
          scrolled = true;
          var h2 = document.getElementById('payouts');
          if (h2) {
            setTimeout(function () {
              h2.scrollIntoView({ behavior: 'smooth', block: 'start' });
              box.style.transition = 'box-shadow 0.4s';
              box.style.boxShadow = '0 0 0 3px #e0a9a9';
              setTimeout(function () { box.style.boxShadow = ''; }, 2500);
            }, 150);
          }
        }
      });
    }

    function rowLabel(x) {
      return (x.entry_category ? '<strong>' + esc(x.entry_category) + '</strong> · ' : '') +
        esc(x.entry_title || '') +
        (x.created_by ? '<div style="font-size:0.74rem;color:var(--gray-5)">적은 사람 ' + esc(x.created_by) + '</div>' : '');
    }

    function draw() {
      var wait = rows.filter(function (x) { return x.status !== '확인'; });
      var done = rows.filter(function (x) { return x.status === '확인'; });

      /* 맨 위 안내 — 확인하지 않은 지급이 있을 때만 */
      if (banner) {
        banner.innerHTML = wait.length
          ? '<div class="notice-banner" style="border-color:#e0a9a9;background:#fdf3f3;color:#7a2a2a">' +
            '확인하지 않은 <strong>지급(회의비·거마비) ' + wait.length + '건</strong>이 있습니다. 돈을 받으셨으면 수령 확인을 눌러 주세요. ' +
            '<a class="btn sm" href="#payouts" style="margin-left:8px">수령 확인하러 가기</a></div>'
          : '';
      }

      var h = '<p style="font-size:0.88rem;color:var(--gray-6)">회의비·거마비처럼 영수증이 없는 지급은 ' +
        '받는 분의 <strong>수령 확인</strong>이 영수증을 대신합니다. 돈을 받으신 뒤에 눌러 주세요. ' +
        '확인한 내역은 아래 <strong>수령 내역</strong>에 계속 쌓여 언제든 다시 볼 수 있습니다.</p>';

      /* ---- 확인 대기 ---- */
      h += '<h3 style="font-size:1rem;margin:14px 0 6px;color:#b03a3a">확인 대기' +
        (wait.length ? ' <span class="role-badge" style="color:#b03a3a;border-color:#e0a9a9">' + wait.length + '건</span>' : '') + '</h3>';
      if (!wait.length) {
        h += '<p style="color:var(--gray-5);font-size:0.9rem">확인할 지급이 없습니다.</p>';
      } else {
        h += '<div style="overflow-x:auto"><table class="tbl" style="border:1.5px solid #e0a9a9"><thead><tr>' +
          '<th style="width:100px">지급일</th><th style="width:120px">지급처</th><th>내용</th>' +
          '<th style="width:110px">금액 (원)</th><th style="width:130px">수령 확인</th></tr></thead><tbody>';
        wait.forEach(function (x) {
          h += '<tr><td>' + esc(ymd(x.entry_date) || ymd(x.created_at)) + '</td>' +
            '<td>' + esc(x.owner_label || '') + '</td>' +
            '<td class="left">' + rowLabel(x) + '</td>' +
            '<td style="text-align:right">' + won(x.amount) + '</td>' +
            '<td><button class="btn sm" data-pyok="' + x.id + '">수령 확인</button></td></tr>';
        });
        h += '</tbody></table></div>';
      }

      /* ---- 수령 내역 (연도별) ---- */
      var years = [];
      done.forEach(function (x) { var y = yearOf(x); if (y && years.indexOf(y) === -1) years.push(y); });
      years.sort(function (a, b) { return b - a; });
      if (pickYear === null) pickYear = years.length ? String(years[0]) : 'all';
      var list = done.filter(function (x) { return pickYear === 'all' || String(yearOf(x)) === pickYear; });
      var sum = 0;
      list.forEach(function (x) { sum += Number(x.amount) || 0; });

      h += '<h3 style="font-size:1rem;margin:20px 0 6px;color:var(--navy)">수령 내역' +
        (done.length ? ' <span class="role-badge">모두 ' + done.length + '건</span>' : '') + '</h3>';
      if (!done.length) {
        h += '<p style="color:var(--gray-5);font-size:0.9rem">아직 수령 확인한 내역이 없습니다.</p>';
      } else {
        h += '<div class="inline-form" style="align-items:center;margin-bottom:6px">' +
          '<div class="field" style="flex:0 0 150px;margin:0"><label>연도</label><select id="py-year">' +
          years.map(function (y) { return '<option value="' + y + '"' + (String(y) === pickYear ? ' selected' : '') + '>' + y + '년</option>'; }).join('') +
          '<option value="all"' + (pickYear === 'all' ? ' selected' : '') + '>전체</option></select></div>' +
          '<div style="font-size:0.9rem;color:var(--gray-6);padding-top:16px">' +
          (pickYear === 'all' ? '전체' : pickYear + '년') + ' <strong>' + list.length + '건</strong> · 합계 <strong>' + won(sum) + '원</strong></div>' +
          '</div>';
        h += '<div style="overflow-x:auto"><table class="tbl"><thead><tr>' +
          '<th style="width:100px">지급일</th><th style="width:120px">지급처</th><th>내용</th>' +
          '<th style="width:110px">금액 (원)</th><th style="width:150px">확인 일시</th></tr></thead><tbody>';
        if (!list.length) {
          h += '<tr><td colspan="5" style="color:var(--gray-5)">이 연도에는 수령 내역이 없습니다.</td></tr>';
        }
        list.forEach(function (x) {
          var manual = /수기/.test(String(x.confirmed_by || ''));
          h += '<tr><td>' + esc(ymd(x.entry_date) || ymd(x.created_at)) + '</td>' +
            '<td>' + esc(x.owner_label || '') + '</td>' +
            '<td class="left">' + rowLabel(x) + '</td>' +
            '<td style="text-align:right">' + won(x.amount) + '</td>' +
            '<td><span class="role-badge" style="color:#2a7a2a;border-color:#2a7a2a">확인</span>' +
            '<div style="font-size:0.74rem;color:var(--gray-5)">' + esc(stamp(x.confirmed_at)) +
            (manual ? '<br>회계가 수기로 확인' : '') + '</div></td></tr>';
        });
        if (list.length) {
          h += '<tr><td colspan="3" style="text-align:right;font-weight:700">합계</td>' +
            '<td style="text-align:right;font-weight:700">' + won(sum) + '</td><td></td></tr>';
        }
        h += '</tbody></table></div>';
      }
      box.innerHTML = h;

      var sel = document.getElementById('py-year');
      if (sel) sel.addEventListener('change', function () { pickYear = sel.value; draw(); });

      box.querySelectorAll('button[data-pyok]').forEach(function (b) {
        b.addEventListener('click', function () {
          var x = rows.filter(function (y) { return String(y.id) === b.dataset.pyok; })[0];
          if (!x) return;
          if (!confirm((x.owner_label || '노회') + '에서 ' + (x.entry_category || x.entry_title || '지급') + ' ' + won(x.amount) +
                       '원을 받으셨습니까?\n수령 확인을 누르면 영수증을 대신하며 되돌릴 수 없습니다.')) return;
          b.disabled = true; b.textContent = '확인 중…';
          SHSCloud.init().then(function (c) {
            return c.rpc('confirm_payout', { p_id: x.id });
          }).then(function (r) {
            if (r.error) { alert(r.error.message); load(); return; }
            SHSCloud.log('update', '지급 수령 확인', (x.owner_label || '') + ' ' + (x.entry_title || '') + ' ' + won(x.amount) + '원');
            pickYear = null;      /* 방금 확인한 해가 보이게 */
            load();
          });
        });
      });
    }

    load();
  }

  return { mount: mount };
})();

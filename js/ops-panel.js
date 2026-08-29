/* 시스템 운영 화면 (시스템 알림·운영 매뉴얼·운영 일정·정기노회 일정·감사)
 *
 * 예전에는 ops.html 안에만 있었으나, 사이트 관리와 한 화면에서 다루기 위해
 * 이 파일로 옮겨 두었다. 두 화면 모두 아래 한 줄로 부른다.
 *
 *   SHSOps.mount(자리, 지금 로그인한 사람)
 */
var SHSOps = (function () {
  'use strict';

  function mount(area, user) {
    if (!area) return;
    var e = SHS.esc;
  var e = SHS.esc;

  if (!user || !SHSAuth.canManageMembers(user)) {
    area.innerHTML =
      '<div class="notice-banner">시스템 운영 안내는 <strong>관리자 등급</strong>이 열람할 수 있습니다.' +
      (user ? '' : ' <a class="btn sm" style="margin-left:10px" href="login.html">로그인</a>') +
      '</div>';
    return;
  }
  if (!user.cloud) {
    area.innerHTML =
      '<div class="notice-banner">시스템 운영 안내는 서버 로그인(구글 또는 이메일)이 필요합니다. ' +
      '<a class="btn sm" style="margin-left:10px" href="login.html">로그인 화면으로</a></div>';
    return;
  }

  var isSuper = user.role === 'superadmin';
  var db = null;

  /* 감독(감사 기록)은 예전에 따로 있던 화면이었으나 여기 탭으로 들어왔다.
   * 열람 권한(canViewAudit)이 있는 분에게만 탭이 보인다. */
  var canAudit = SHSAuth.canViewAudit(user);

  area.innerHTML =
    '<div class="tabs">' +
    '<button class="active" data-tab="ops-alert">시스템 알림</button>' +
    '<button data-tab="ops-manual">운영 매뉴얼</button>' +
    '<button data-tab="ops-sched">운영 일정</button>' +
    '<button data-tab="ops-meet">정기노회 일정</button>' +
    '<button data-tab="ops-aw">감사 기간</button>' +
    (canAudit ? '<button data-tab="ops-audit">감독 (감사 기록)</button>' : '') +
    '</div>' +
    '<div class="tab-panel active" id="ops-alert"><p style="color:var(--gray-5)">불러오는 중...</p></div>' +
    '<div class="tab-panel" id="ops-manual"></div>' +
    '<div class="tab-panel" id="ops-sched"></div>' +
    '<div class="tab-panel" id="ops-meet"></div>' +
    '<div class="tab-panel" id="ops-aw"><p style="color:var(--gray-5)">불러오는 중...</p></div>' +
    (canAudit ? '<div class="tab-panel" id="ops-audit"></div>' : '');

  var auditReady = false;

  function showTab(id) {
    var btn = area.querySelector('.tabs button[data-tab="' + id + '"]');
    if (!btn) return false;
    area.querySelectorAll('.tabs button').forEach(function (x) { x.classList.remove('active'); });
    btn.classList.add('active');
    area.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === id);
    });
    /* 감사 기록은 양이 많으므로 그 탭을 처음 열 때에만 불러온다 */
    if (id === 'ops-audit' && !auditReady) {
      auditReady = true;
      SHSAuditView.mount(document.getElementById('ops-audit'), user);
    }
    return true;
  }

  area.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); });
  });

  /* 주소 뒤에 #ops-audit 처럼 붙여 오면 그 탭을 바로 연다.
   * (예전 감독 화면 주소로 들어온 분을 이리로 보내기 위함) */
  function fromHash() {
    var id = (location.hash || '').replace(/^#/, '');
    if (id) showTab(id);
  }
  window.addEventListener('hashchange', fromHash);
  fromHash();

  SHSCloud.init().then(function (c) {
    db = c;
    loadAlerts(); loadManual(); loadSchedule(); loadMeetings(); loadAuditWindow();
  });

  /* ---------- 감사 기간 ----------
   * 감사는 3월(봄)·9월(가을)에 저절로 열린다. 그 달 안에 마치지 못하는
   * 일이 있으므로, 노회 관리자가 여기서 손으로 열고 닫을 수 있다. */
  function loadAuditWindow() {
    var box = document.getElementById('ops-aw');
    db.from('site_settings').select('*').eq('key', 'audit_window').maybeSingle()
      .then(function (r) {
        var v = (r && r.data && r.data.value) || { open: false };
        drawAuditWindow(v, r && r.error);
      }, function () { drawAuditWindow({ open: false }, null); });
  }

  function drawAuditWindow(v, err) {
    var box = document.getElementById('ops-aw');
    var now = new Date();
    var m = now.getMonth() + 1;
    var byMonth = (m === 3 ? '봄' : (m === 9 ? '가을' : null));

    var h = '<h2>감사 기간</h2>' +
      '<p>봄·가을 정기노회 전에 감사부(감사헌의부)가 상비부·시찰의 ' +
      '<strong>회의록</strong>과 <strong>회계 장부</strong>를 감사합니다. ' +
      '감사 기간에만 감사부에게 <strong>감사필 처리</strong> 단추가 열립니다.</p>';

    if (err) {
      h += '<div class="notice-banner">감사 기간 설정을 읽지 못했습니다: ' + e(err.message || '') +
        '<br>Supabase에서 <strong>37_boards_and_audit_window.sql</strong>을 먼저 실행해 주세요.</div>';
      box.innerHTML = h;
      return;
    }

    h += '<div class="notice-banner">' +
      '<strong>달력대로</strong> — 3월이면 봄 감사, 9월이면 가을 감사가 저절로 열립니다. ' +
      '지금은 ' + now.getFullYear() + '년 ' + m + '월이므로 ' +
      (byMonth ? '<strong>' + byMonth + ' 감사 기간</strong>입니다.' : '감사 기간이 <strong>아닙니다</strong>.') +
      '</div>';

    h += '<div class="admin-card" style="max-width:720px">' +
      '<h3 style="margin-top:0">손으로 열어 두기</h3>' +
      '<p style="font-size:0.86rem;color:var(--gray-7)">' +
      '3월·9월을 넘겨 감사를 마쳐야 할 때 켜 주세요. 켜 두는 동안에는 달과 상관없이 ' +
      '감사부가 감사필을 찍을 수 있습니다. 감사를 마치면 <strong>꺼 주세요.</strong></p>' +
      '<div class="field"><label>' +
      '<input type="checkbox" id="aw-open"' + (v.open ? ' checked' : '') + '> ' +
      '지금 감사 기간으로 열어 둔다</label></div>' +
      '<div class="inline-form">' +
      '<div class="field" style="flex:0 0 160px"><label>회기 연도</label>' +
      '<input type="number" id="aw-year" min="2020" max="2100" value="' +
      (v.year || now.getFullYear()) + '"></div>' +
      '<div class="field" style="flex:0 0 160px"><label>봄·가을</label>' +
      '<select id="aw-period">' +
      ['봄', '가을'].map(function (x) {
        return '<option' + ((v.period || byMonth || '봄') === x ? ' selected' : '') + '>' + x + '</option>';
      }).join('') + '</select></div>' +
      '</div>' +
      '<div class="field"><label>메모 (선택 · 감사 칸에 함께 보입니다)</label>' +
      '<input type="text" id="aw-note" value="' + e(v.note || '') +
      '" placeholder="예: 3월 안에 마치지 못해 4월 10일까지 연장"></div>' +
      '<button class="btn" id="aw-save">저장</button>' +
      '<div class="form-msg" id="aw-msg"></div>' +
      (v.at ? '<p style="font-size:0.8rem;color:var(--gray-5);margin-top:10px">마지막 변경 : ' +
        e(String(v.at).slice(0, 10)) + (v.by ? ' · ' + e(v.by) : '') + '</p>' : '') +
      '</div>';

    box.innerHTML = h;
    document.getElementById('aw-save').addEventListener('click', function () {
      var msg = document.getElementById('aw-msg');
      var d = {
        open: document.getElementById('aw-open').checked,
        year: parseInt(document.getElementById('aw-year').value, 10) || now.getFullYear(),
        period: document.getElementById('aw-period').value,
        note: document.getElementById('aw-note').value.trim(),
        by: user.name,
        at: new Date().toISOString()
      };
      msg.className = 'form-msg'; msg.textContent = '저장 중입니다...';
      db.from('site_settings').upsert({ key: 'audit_window', value: d, updated_at: d.at })
        .then(function (r) {
          if (r.error) { msg.className = 'form-msg err'; msg.textContent = r.error.message; return; }
          SHSCloud.log('update', '감사 기간 ' + (d.open ? '열기' : '닫기'),
            d.year + '년 ' + d.period + (d.note ? ' / ' + d.note : ''));
          if (window.SHSAuditMark) SHSAuditMark.forget();
          loadAuditWindow();
        });
    });
  }

  /* ---------- 시스템 알림 (현재 표시 중 + 전체 규칙) ---------- */
  function loadAlerts() {
    Promise.all([
      db.from('ops_notices').select('*').order('sort'),
      db.from('site_settings').select('*').eq('key', 'ops_dates').single()
    ]).then(function (rs) {
      var box = document.getElementById('ops-alert');
      if (rs[0].error) { box.innerHTML = '<div class="notice-banner">불러오기 실패: ' + e(rs[0].error.message) + ' (06_system.sql 실행이 필요할 수 있습니다)</div>'; return; }
      var rows = rs[0].data || [];
      var dates = (rs[1].data && rs[1].data.value) || { springMonth: 4, springWeek: 2, fallMonth: 10, fallWeek: 2 };
      var active = SHS.opsActive(rows, dates);

      var html = '<h2>지금 확인이 필요한 알림</h2>';
      if (!active.length) {
        html += '<p style="color:var(--gray-5)">현재 기간에 해당하는 알림이 없습니다.</p>';
      } else {
        active.forEach(function (n) {
          html += '<div class="side-box" style="margin-bottom:14px;border-left:4px solid var(--accent)">' +
            '<div class="box-head">' + e(n.title) + ' <span style="font-weight:400;font-size:0.8rem;color:var(--gray-5)">(대상: ' + e(n.audience) + ' / ' + e(n.period) + ')</span></div>' +
            '<div class="box-body"><p>' + e(n.message || '') + '</p>' +
            '<button class="btn ghost sm" data-opsdone="' + n.doneKey + '">이번 회기 처리 완료 (알림 끄기)</button>' +
            '</div></div>';
        });
      }

      html += '<h2>등록된 알림 규칙</h2>';
      html += '<table class="tbl"><thead><tr><th>제목</th><th>대상</th><th>표시 기준</th><th>사용</th>' +
        (isSuper ? '<th style="width:80px">관리</th>' : '') + '</tr></thead><tbody>';
      rows.forEach(function (n) {
        html += '<tr><td class="left">' + e(n.title) + '</td><td>' + e(n.audience) + '</td>' +
          '<td class="left">' + e(SHS.opsRuleLabel(n)) + '</td>' +
          '<td>' + (n.active ? '사용' : '중지') + '</td>' +
          (isSuper ? '<td><button class="btn danger sm" data-opsdel="' + n.id + '" data-opst="' + e(n.title) + '">삭제</button></td>' : '') +
          '</tr>';
      });
      html += '</tbody></table>';

      if (isSuper) {
        html += '<h3>알림 규칙 추가</h3>' +
          '<div class="admin-card" style="max-width:820px"><div class="inline-form" style="margin-bottom:8px">' +
          '<div class="field"><label>제목</label><input type="text" id="op-title"></div>' +
          '<div class="field" style="flex:0 0 110px"><label>대상</label><input type="text" id="op-aud" value="간사"></div>' +
          '<div class="field" style="flex:0 0 170px"><label>기준</label><select id="op-rule">' +
          '<option value="spring">봄 정기노회</option><option value="fall">가을 정기노회</option>' +
          '<option value="before_spring">봄 노회 전</option><option value="before_fall">가을 노회 전</option>' +
          '<option value="fixed">특정 날짜</option></select></div>' +
          '<div class="field" style="flex:0 0 110px"><label>며칠 전부터</label><input type="number" id="op-off" value="0"></div>' +
          '<div class="field" style="flex:0 0 110px"><label>표시 일수</label><input type="number" id="op-win" value="21"></div>' +
          '<div class="field" style="flex:0 0 160px"><label>특정 날짜(해당 시)</label><input type="date" id="op-fixed"></div>' +
          '</div>' +
          '<div class="field"><label>알림 내용</label><textarea id="op-msg" rows="3"></textarea></div>' +
          '<button class="btn" id="op-add">추가</button><div class="form-msg" id="op-addmsg"></div></div>';
      }
      box.innerHTML = html;

      box.querySelectorAll('button[data-opsdone]').forEach(function (b) {
        b.addEventListener('click', function () {
          localStorage.setItem(b.dataset.opsdone, '1');
          SHSCloud.log('update', '시스템 알림 처리 완료', b.dataset.opsdone);
          loadAlerts();
        });
      });
      if (isSuper) {
        box.querySelectorAll('button[data-opsdel]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (!confirm('알림 규칙 "' + b.dataset.opst + '" 을(를) 삭제하시겠습니까?')) return;
            db.from('ops_notices').delete().eq('id', b.dataset.opsdel).then(function (res) {
              if (res.error) { alert(res.error.message); return; }
              SHSCloud.log('delete', '시스템 알림 규칙 삭제', b.dataset.opst);
              loadAlerts();
            });
          });
        });
        var addBtn = document.getElementById('op-add');
        if (addBtn) addBtn.addEventListener('click', function () {
          var msg = document.getElementById('op-addmsg');
          var d = {
            title: document.getElementById('op-title').value.trim(),
            audience: document.getElementById('op-aud').value.trim() || '간사',
            rule: document.getElementById('op-rule').value,
            offset_days: parseInt(document.getElementById('op-off').value, 10) || 0,
            window_days: parseInt(document.getElementById('op-win').value, 10) || 21,
            fixed_date: document.getElementById('op-fixed').value || null,
            message: document.getElementById('op-msg').value.trim(),
            sort: rows.length + 1
          };
          if (!d.title) { msg.className = 'form-msg err'; msg.textContent = '제목을 입력해 주세요.'; return; }
          db.from('ops_notices').insert(d).then(function (res) {
            if (res.error) { msg.className = 'form-msg err'; msg.textContent = res.error.message; return; }
            SHSCloud.log('create', '시스템 알림 규칙 추가', d.title);
            loadAlerts();
          });
        });
      }
    });
  }

  /* ---------- 운영 매뉴얼 ---------- */
  function loadManual() {
    db.from('ops_manual').select('*').order('sort').then(function (r) {
      var box = document.getElementById('ops-manual');
      if (r.error) { box.innerHTML = '<div class="notice-banner">불러오기 실패: ' + e(r.error.message) + '</div>'; return; }
      var rows = r.data || [];
      var html = '<h2>시스템 운영 매뉴얼</h2>' +
        '<p>홈페이지 관리 업무를 처음 맡아도 이 매뉴얼대로 하면 됩니다.</p>';
      rows.forEach(function (m) {
        html += '<div class="side-box" style="margin-bottom:14px"><div class="box-head">' + e(m.title) + '</div>' +
          '<div class="box-body">' +
          m.body.split('\n').map(function (l) { return '<p style="margin-bottom:6px">' + e(l) + '</p>'; }).join('');
        if (isSuper) {
          html += '<div style="margin-top:10px">' +
            '<button class="btn ghost sm" data-mnedit="' + m.id + '">수정</button> ' +
            '<button class="btn danger sm" data-mndel="' + m.id + '" data-mnt="' + e(m.title) + '">삭제</button></div>';
        }
        html += '</div></div>';
      });
      if (isSuper) {
        html += '<h3 id="mn-form-title">매뉴얼 항목 추가</h3>' +
          '<div class="admin-card" style="max-width:820px">' +
          '<input type="hidden" id="mn-id">' +
          '<div class="field"><label>제목</label><input type="text" id="mn-title"></div>' +
          '<div class="field"><label>내용 (줄바꿈으로 단계 구분)</label><textarea id="mn-body" rows="6"></textarea></div>' +
          '<button class="btn" id="mn-save">저장</button> ' +
          '<button class="btn ghost hidden" id="mn-cancel">새 항목으로 전환</button>' +
          '<div class="form-msg" id="mn-msg"></div></div>';
      }
      box.innerHTML = html;

      if (!isSuper) return;
      document.getElementById('mn-save').addEventListener('click', function () {
        var msg = document.getElementById('mn-msg');
        var id = document.getElementById('mn-id').value;
        var d = {
          title: document.getElementById('mn-title').value.trim(),
          body: document.getElementById('mn-body').value.trim(),
          updated_at: new Date().toISOString()
        };
        if (!d.title || !d.body) { msg.className = 'form-msg err'; msg.textContent = '제목과 내용을 입력해 주세요.'; return; }
        if (!id) d.sort = rows.length + 1;
        var op = id ? db.from('ops_manual').update(d).eq('id', id) : db.from('ops_manual').insert(d);
        op.then(function (res) {
          if (res.error) { msg.className = 'form-msg err'; msg.textContent = res.error.message; return; }
          SHSCloud.log(id ? 'update' : 'create', '운영 매뉴얼 ' + (id ? '수정' : '추가'), d.title);
          loadManual();
        });
      });
      document.getElementById('mn-cancel').addEventListener('click', function () {
        document.getElementById('mn-id').value = '';
        document.getElementById('mn-title').value = '';
        document.getElementById('mn-body').value = '';
        document.getElementById('mn-form-title').textContent = '매뉴얼 항목 추가';
        this.classList.add('hidden');
      });
      box.querySelectorAll('button[data-mnedit]').forEach(function (b) {
        b.addEventListener('click', function () {
          var m = rows.filter(function (x) { return String(x.id) === b.dataset.mnedit; })[0];
          if (!m) return;
          document.getElementById('mn-id').value = m.id;
          document.getElementById('mn-title').value = m.title;
          document.getElementById('mn-body').value = m.body;
          document.getElementById('mn-form-title').textContent = '매뉴얼 수정';
          document.getElementById('mn-cancel').classList.remove('hidden');
          document.getElementById('mn-form-title').scrollIntoView({ behavior: 'smooth' });
        });
      });
      box.querySelectorAll('button[data-mndel]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('매뉴얼 "' + b.dataset.mnt + '" 을(를) 삭제하시겠습니까?')) return;
          db.from('ops_manual').delete().eq('id', b.dataset.mndel).then(function (res) {
            if (res.error) { alert(res.error.message); return; }
            SHSCloud.log('delete', '운영 매뉴얼 삭제', b.dataset.mnt);
            loadManual();
          });
        });
      });
    });
  }

  /* ---------- 정기노회 일정 (날짜·장소 확정 → 40일 전 알림) ---------- */
  function loadMeetings() {
    var box = document.getElementById('ops-meet');
    db.from('meetings').select('*').order('meet_date', { ascending: true, nullsFirst: false })
      .then(function (r) {
        if (r.error) {
          box.innerHTML = '<div class="notice-banner">정기노회 일정을 불러오지 못했습니다: ' + e(r.error.message) +
            ' (18 정기노회 서류 알림 등록이 필요할 수 있습니다)</div>';
          return;
        }
        var rows = r.data || [];
        var KINDS = ['봄 정기노회', '가을 정기노회', '임시노회'];
        function kindOpts(v) {
          return KINDS.map(function (k) {
            return '<option' + (k === v ? ' selected' : '') + '>' + e(k) + '</option>';
          }).join('');
        }

        var html = '<h2>정기노회 일정</h2>' +
          '<div class="notice-banner">날짜와 장소를 적고 <strong>확정</strong>에 표시하면, ' +
          '그 날로부터 <strong>40일 전부터</strong> 알림이 자동으로 나갑니다.<br>' +
          '· <strong>시찰장과 서기</strong>에게 — 이번 회기에 접수할 서류 안내<br>' +
          '· <strong>부목사가 있는 교회의 담임목사</strong>에게 — 부목사 계속 청빙 청원 안내<br>' +
          '같은 알림이 두 번 가지는 않습니다. (근거: 노회규칙 제36조 서류 제출)</div>';

        rows.forEach(function (m) {
          var left = '';
          if (m.meet_date) {
            var d = Math.round((new Date(m.meet_date + 'T00:00:00') - new Date().setHours(0, 0, 0, 0)) / 86400000);
            left = d > 0 ? (d + '일 남음') : (d === 0 ? '오늘' : (-d) + '일 지남');
          }
          html += '<div class="admin-card" style="margin-bottom:14px" data-mt="' + m.id + '">' +
            '<div class="inline-form" style="margin-bottom:6px">' +
            '<div class="field" style="flex:0 0 150px"><label>구분</label><select data-mf="kind">' + kindOpts(m.kind) + '</select></div>' +
            '<div class="field" style="flex:0 0 110px"><label>회기 연도</label><input type="number" data-mf="year" value="' + e(m.year == null ? '' : m.year) + '"></div>' +
            '<div class="field" style="flex:0 0 170px"><label>날짜</label><input type="date" data-mf="meet_date" value="' + e(m.meet_date || '') + '"></div>' +
            '<div class="field"><label>장소</label><input type="text" data-mf="place" value="' + e(m.place || '') + '" placeholder="예: 반월교회"></div>' +
            '<div class="field" style="flex:0 0 130px"><label>알림 시작</label><input type="number" data-mf="lead_days" value="' + e(m.lead_days == null ? 40 : m.lead_days) + '"></div>' +
            '</div>' +
            '<label style="font-size:0.88rem;font-weight:400;display:block;margin-bottom:10px">' +
            '<input type="checkbox" data-mf="confirmed" style="width:auto;margin-right:6px"' + (m.confirmed ? ' checked' : '') + '>' +
            '날짜와 장소가 <strong>확정</strong>되었습니다 (표시하면 알림이 나갑니다)' +
            (left ? ' <span style="color:var(--gray-5)">— ' + e(left) + '</span>' : '') +
            '</label>' +
            '<button class="btn sm" data-msave="' + m.id + '">저장</button> ' +
            '<button class="btn danger sm" data-mdel="' + m.id + '" data-mk="' + e(m.kind) + '">삭제</button>' +
            '<div class="form-msg" data-mmsg="' + m.id + '"></div></div>';
        });

        html += '<div class="admin-card"><h3 style="margin-top:0">일정 추가</h3>' +
          '<div class="inline-form">' +
          '<div class="field" style="flex:0 0 150px"><label>구분</label><select id="mn-kind">' + kindOpts('봄 정기노회') + '</select></div>' +
          '<div class="field" style="flex:0 0 110px"><label>회기 연도</label><input type="number" id="mn-year" value="' + new Date().getFullYear() + '"></div>' +
          '<div class="field" style="flex:0 0 170px"><label>날짜</label><input type="date" id="mn-date"></div>' +
          '<div class="field"><label>장소</label><input type="text" id="mn-place"></div>' +
          '<button class="btn" id="mn-add">추가</button>' +
          '</div><div class="form-msg" id="mn-msg"></div></div>';

        box.innerHTML = html;

        box.querySelectorAll('button[data-msave]').forEach(function (b) {
          b.addEventListener('click', function () {
            var card = b.closest('[data-mt]');
            var msg = box.querySelector('[data-mmsg="' + b.dataset.msave + '"]');
            function v(f) { return card.querySelector('[data-mf="' + f + '"]').value.trim(); }
            var d = {
              kind: v('kind'),
              year: Number(v('year')) || null,
              meet_date: v('meet_date') || null,
              place: v('place') || null,
              lead_days: Number(v('lead_days')) || 40,
              confirmed: card.querySelector('[data-mf="confirmed"]').checked,
              updated_at: new Date().toISOString(), updated_by: user.name
            };
            if (d.confirmed && (!d.meet_date || !d.place)) {
              msg.className = 'form-msg err';
              msg.textContent = '확정하시려면 날짜와 장소를 모두 적어 주세요.';
              return;
            }
            msg.className = 'form-msg'; msg.textContent = '저장 중입니다...';
            db.from('meetings').update(d).eq('id', b.dataset.msave).then(function (res) {
              if (res.error) { msg.className = 'form-msg err'; msg.textContent = res.error.message; return; }
              SHSCloud.log('update', '정기노회 일정 수정',
                d.kind + ' ' + (d.meet_date || '') + ' ' + (d.place || '') + (d.confirmed ? ' (확정)' : ''));
              if (d.confirmed) {
                db.rpc('run_reminders').then(function (rr) {
                  var n = (rr && rr.data) || 0;
                  msg.className = 'form-msg ok';
                  msg.textContent = n > 0
                    ? '저장되었습니다. 알림 ' + n + '건을 보냈습니다.'
                    : '저장되었습니다. (아직 알림 시작일이 되지 않았거나 이미 보낸 알림입니다)';
                  loadMeetings();
                }, function () {
                  msg.className = 'form-msg ok';
                  msg.textContent = '저장되었습니다.';
                  loadMeetings();
                });
              } else {
                msg.className = 'form-msg ok';
                msg.textContent = '저장되었습니다.';
                loadMeetings();
              }
            });
          });
        });

        box.querySelectorAll('button[data-mdel]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (!confirm('"' + b.dataset.mk + '" 일정을 삭제하시겠습니까?')) return;
            db.from('meetings').delete().eq('id', b.dataset.mdel).then(function (res) {
              if (res.error) { alert(res.error.message); return; }
              SHSCloud.log('delete', '정기노회 일정 삭제', b.dataset.mk);
              loadMeetings();
            });
          });
        });

        document.getElementById('mn-add').addEventListener('click', function () {
          var msg = document.getElementById('mn-msg');
          var d = {
            kind: document.getElementById('mn-kind').value,
            year: Number(document.getElementById('mn-year').value) || null,
            meet_date: document.getElementById('mn-date').value || null,
            place: document.getElementById('mn-place').value.trim() || null,
            confirmed: false,
            updated_at: new Date().toISOString(), updated_by: user.name
          };
          db.from('meetings').insert(d).then(function (res) {
            if (res.error) { msg.className = 'form-msg err'; msg.textContent = res.error.message; return; }
            SHSCloud.log('create', '정기노회 일정 등록', d.kind + ' ' + (d.meet_date || ''));
            loadMeetings();
          });
        });
      });
  }

  /* ---------- 운영 일정 (정기노회 기준일) ---------- */
  function loadSchedule() {
    db.from('site_settings').select('*').eq('key', 'ops_dates').single().then(function (r) {
      var box = document.getElementById('ops-sched');
      var d = (r.data && r.data.value) || { springMonth: 4, springWeek: 2, fallMonth: 10, fallWeek: 2 };
      var y = new Date().getFullYear();
      var spring = SHS.nthMonday(y, d.springMonth, d.springWeek);
      var fall = SHS.nthMonday(y, d.fallMonth, d.fallWeek);
      function fmt(dt) { return dt.getFullYear() + '년 ' + (dt.getMonth() + 1) + '월 ' + dt.getDate() + '일 (월)'; }

      var html = '<h2>정기노회 기준일</h2>' +
        '<p>시스템 알림은 아래 기준일에 맞추어 자동으로 표시됩니다.</p>' +
        '<table class="tbl" style="max-width:640px"><tbody>' +
        '<tr><th style="width:160px">봄 정기노회</th><td class="left">' + d.springMonth + '월 ' + d.springWeek + '째 주 월요일 — 올해 ' + fmt(spring) + '</td></tr>' +
        '<tr><th>가을 정기노회</th><td class="left">' + d.fallMonth + '월 ' + d.fallWeek + '째 주 월요일 — 올해 ' + fmt(fall) + '</td></tr>' +
        '</tbody></table>';

      if (isSuper) {
        html += '<h3>기준일 변경</h3>' +
          '<div class="admin-card" style="max-width:640px"><div class="inline-form">' +
          '<div class="field" style="flex:0 0 120px"><label>봄: 월</label><input type="number" id="od-sm" min="1" max="12" value="' + d.springMonth + '"></div>' +
          '<div class="field" style="flex:0 0 120px"><label>봄: 주차</label><input type="number" id="od-sw" min="1" max="5" value="' + d.springWeek + '"></div>' +
          '<div class="field" style="flex:0 0 120px"><label>가을: 월</label><input type="number" id="od-fm" min="1" max="12" value="' + d.fallMonth + '"></div>' +
          '<div class="field" style="flex:0 0 120px"><label>가을: 주차</label><input type="number" id="od-fw" min="1" max="5" value="' + d.fallWeek + '"></div>' +
          '<button class="btn" id="od-save">저장</button>' +
          '</div><div class="form-msg" id="od-msg"></div></div>';
      }
      box.innerHTML = html;

      if (!isSuper) return;
      document.getElementById('od-save').addEventListener('click', function () {
        var v = {
          springMonth: parseInt(document.getElementById('od-sm').value, 10) || 4,
          springWeek: parseInt(document.getElementById('od-sw').value, 10) || 3,
          fallMonth: parseInt(document.getElementById('od-fm').value, 10) || 10,
          fallWeek: parseInt(document.getElementById('od-fw').value, 10) || 3
        };
        db.from('site_settings').upsert({ key: 'ops_dates', value: v, updated_at: new Date().toISOString() })
          .then(function (res) {
            var msg = document.getElementById('od-msg');
            if (res.error) { msg.className = 'form-msg err'; msg.textContent = res.error.message; return; }
            SHSCloud.log('update', '정기노회 기준일 변경',
              '봄 ' + v.springMonth + '월 ' + v.springWeek + '주 / 가을 ' + v.fallMonth + '월 ' + v.fallWeek + '주');
            msg.className = 'form-msg ok';
            msg.textContent = '저장되었습니다.';
            loadSchedule();
          });
      });
    });
  }
  }

  return { mount: mount };
})();

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
  /* 권한 위임(이·취임)은 노회장과 최고관리자만 다룬다 */
  var canHand = user.role === 'president' || user.role === 'superadmin';

  /* 정기노회 일정·기준일은 아래 '노회 일정 설정' 탭에서 다룬다 (mountSchedule 참조) */
  area.innerHTML =
    '<div class="tabs sub-tabs">' +
    '<button class="active" data-tab="ops-alert">시스템 알림 설정</button>' +
    '<button data-tab="ops-meeting">노회 일정 설정</button>' +
    '<button data-tab="ops-manual">운영 매뉴얼</button>' +
    (canHand ? '<button data-tab="ops-hand">노회장 권한 위임</button>' : '') +
    '<button data-tab="ops-aw">감사 기간</button>' +
    (canAudit ? '<button data-tab="ops-audit">감독 (감사 기록)</button>' : '') +
    '</div>' +
    '<div class="tab-panel active" id="ops-alert"><p style="color:var(--gray-5)">불러오는 중...</p></div>' +
    '<div class="tab-panel" id="ops-meeting"></div>' +
    '<div class="tab-panel" id="ops-manual"></div>' +
    (canHand ? '<div class="tab-panel" id="ops-hand"></div>' : '') +
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
    loadAlerts(); loadManual(); loadAuditWindow();
    if (canHand) loadHandover();
  });
  /* 정기노회 일정(40일 전 알림)·기준일 */
  mountSchedule(document.getElementById('ops-meeting'), user);

  /* ---------- 노회장 권한 위임 (이·취임) ----------
   * 봄 정기노회 뒤 신구 임원 교체 때, 전 노회장이 위임 항목마다 동의하고
   * 신임 노회장을 지명한다. 신임 노회장이 대시보드에서 취임 서약 후
   * 수락하는 순간 홈페이지 등급이 교체되고, 퇴임하는 목사 노회장과
   * 장로 부노회장은 증경노회장단에 자동으로 오른다. */
  var HAND_ITEMS = [
    { k: 'account', t: '노회장 계정 권한 이전',
      d: '서류 발급 승인권과 임원방·관리 화면 접근권이 신임 노회장에게 넘어갑니다.' },
    { k: 'name', t: '증명서 발급 명의 변경',
      d: '이후 발급되는 모든 증명서의 노회장 명의가 신임 노회장으로 바뀝니다.' },
    { k: 'seal', t: '노회장 직인 날인권 이전',
      d: '증명서에 찍는 노회장 도장의 사용권을 넘깁니다. 신임 노회장은 내 정보에서 본인 도장을 등록합니다.' },
    { k: 'physical', t: '실물 인수인계 확인',
      d: '노회 직인·중요 문서 등 실물 인수인계를 마쳤음을 확인합니다.' },
    { k: 'finance', t: '재정 관련 인수인계',
      d: '노회 통장·회계 장부·미결 지출 등 재정의 인수인계를 마쳤음을 확인합니다.' },
    { k: 'secrecy', t: '비밀 유지 서약',
      d: '재임 중 알게 된 회원 개인정보와 노회 기밀을 퇴임 후에도 지키겠습니다.' }
  ];

  function handThankCard(d) {
    return '<div class="admin-card" style="max-width:680px;border-left:4px solid var(--gold,#b9974e);margin-bottom:18px">' +
      '<h3 style="margin:0 0 8px">위임 완료 — 감사드립니다</h3>' +
      '<p style="margin:0 0 6px;line-height:1.75"><strong>' + e(d.from_name || '') + ' 전임 노회장님</strong>, ' +
      '재임 기간 동안 노회를 위해 수고를 아끼지 않으시고 무거운 직무를 감당해 주셔서 진심으로 감사드립니다. ' +
      '증경노회장단에 모셨습니다. 늘 평안하시기를 빕니다.</p>' +
      '<p style="margin:0;line-height:1.75"><strong>' + e(d.to_name || '') + ' 신임 노회장님</strong>, ' +
      '취임을 축하드립니다. 노회의 새 회기를 잘 이끌어 주시기를 부탁드립니다.</p>' +
      '<p style="font-size:0.82rem;color:var(--gray-5);margin:8px 0 0">완료일 ' +
      e(String(d.accepted_at || '').slice(0, 10)) + '</p></div>';
  }

  function loadHandover() {
    var box = document.getElementById('ops-hand');
    if (!box) return;
    db.from('handovers').select('*').order('id', { ascending: false }).limit(10).then(function (r) {
      if (r.error) {
        box.innerHTML = '<div class="notice-banner">불러오기 실패: ' + e(r.error.message) + '</div>';
        return;
      }
      var rows = r.data || [];
      var pending = rows.filter(function (x) { return x.status === '요청'; })[0];
      var lastDone = rows.filter(function (x) { return x.status === '완료'; })[0];

      var h = '<h2>노회장 권한 위임 (이·취임)</h2>' +
        '<p>봄 정기노회 뒤 신구 임원 교체 때 씁니다. 전 노회장께서 아래 항목마다 동의하시고 ' +
        '신임 노회장을 지명하시면, 신임 노회장께서 대시보드에서 취임 서약 후 수락하는 순간 ' +
        '홈페이지 권한이 교체됩니다. 퇴임하시는 목사 노회장과 장로 부노회장은 ' +
        '<strong>증경노회장단</strong>에 자동으로 오릅니다.</p>';

      /* 두 달 안에 마친 위임이 있으면 감사 인사를 보여 준다 */
      if (lastDone && Date.now() - new Date(lastDone.accepted_at).getTime() < 62 * 86400000) {
        h += handThankCard(lastDone);
      }

      if (pending) {
        h += '<div class="admin-card" style="max-width:680px">' +
          '<h3 style="margin:0 0 8px">위임 진행 중</h3>' +
          '<p style="margin:0 0 10px;line-height:1.7">' + e(pending.from_name || '전임 노회장') +
          ' 노회장께서 <strong>' + e(pending.to_name || '') + '</strong> 님을 신임 노회장으로 지명하셨습니다. ' +
          '신임 노회장께서 대시보드의 취임 서약 카드에서 수락하시면 위임이 완료됩니다.</p>' +
          '<p style="font-size:0.84rem;color:var(--gray-5);margin:0 0 12px">요청일 ' +
          e(String(pending.created_at).slice(0, 10)) + ' · 동의 항목 ' +
          ((pending.items || []).length) + '개</p>' +
          '<button class="btn danger sm" id="hd-cancel">위임 요청 취소</button>' +
          '<div class="form-msg" id="hd-msg"></div></div>';
      } else {
        h += '<div class="admin-card" style="max-width:680px">' +
          '<h3 style="margin:0 0 12px">1. 위임 항목 동의</h3>' +
          HAND_ITEMS.map(function (it) {
            return '<label style="display:flex;gap:9px;align-items:flex-start;margin:0 0 10px;' +
              'font-size:0.92rem;cursor:pointer">' +
              '<input type="checkbox" class="hd-item" data-k="' + it.k + '" style="margin-top:3px">' +
              '<span><strong>' + it.t + '</strong><br>' +
              '<span style="color:var(--gray-6);font-size:0.85rem">' + it.d + '</span></span></label>';
          }).join('') +
          '<h3 style="margin:18px 0 10px">2. 신임 노회장 지명</h3>' +
          '<div class="inline-form"><div class="field" style="flex:1 1 260px">' +
          '<label>신임 노회장 (홈페이지 계정)</label>' +
          '<select id="hd-to"><option value="">— 선택 —</option></select></div></div>' +
          '<p style="font-size:0.84rem;color:var(--gray-5)">홈페이지에 가입된 계정만 지명할 수 있습니다. ' +
          '수락하는 순간 노회장 등급이 넘어가고, 전임 노회장은 일반 정회원 등급이 됩니다.</p>' +
          '<button class="btn" id="hd-start">위임 요청 보내기</button>' +
          '<div class="form-msg" id="hd-msg"></div></div>';
      }

      if (rows.length) {
        h += '<h3 style="margin:22px 0 8px">위임 기록</h3>' +
          '<table class="tbl" style="max-width:680px"><thead><tr>' +
          '<th style="width:110px">요청일</th><th>전임 → 신임</th>' +
          '<th style="width:90px">상태</th></tr></thead><tbody>' +
          rows.map(function (x) {
            return '<tr><td>' + e(String(x.created_at).slice(0, 10)) + '</td>' +
              '<td class="left">' + e(x.from_name || '-') + ' → ' + e(x.to_name || '-') +
              (x.cancel_note ? ' <span style="color:var(--gray-5);font-size:0.8rem">(' +
                e(x.cancel_note) + ')</span>' : '') + '</td>' +
              '<td>' + e(x.status) + '</td></tr>';
          }).join('') + '</tbody></table>';
      }
      box.innerHTML = h;

      function hmsg(ok, t) {
        var m = document.getElementById('hd-msg');
        if (!m) return;
        m.className = 'form-msg ' + (ok ? 'ok' : 'err');
        m.textContent = t;
      }

      if (pending) {
        document.getElementById('hd-cancel').addEventListener('click', function () {
          var why = prompt('취소 사유를 남기시겠습니까? (선택)', '');
          if (why === null) return;
          db.rpc('cancel_handover', { p_id: pending.id, p_note: why.trim() || null })
            .then(function (res) {
              if (res.error) { hmsg(false, res.error.message); return; }
              loadHandover();
            });
        });
      } else {
        /* 지명 대상: 홈페이지 계정 목록 */
        db.from('profiles').select('id,name,church,role').order('name').then(function (pr) {
          var sel = document.getElementById('hd-to');
          if (!sel) return;
          ((pr && pr.data) || []).forEach(function (x) {
            if (x.id === user.id || x.role === 'pending') return;
            var o = document.createElement('option');
            o.value = x.id;
            o.textContent = x.name + (x.church ? ' (' + x.church + ')' : '');
            sel.appendChild(o);
          });
        }, function () {});

        document.getElementById('hd-start').addEventListener('click', function () {
          var boxes = Array.prototype.slice.call(box.querySelectorAll('.hd-item'));
          if (boxes.some(function (b) { return !b.checked; })) {
            hmsg(false, '모든 위임 항목에 동의하셔야 요청할 수 있습니다.');
            return;
          }
          var to = document.getElementById('hd-to');
          if (!to.value) { hmsg(false, '신임 노회장을 선택해 주세요.'); return; }
          var toName = to.options[to.selectedIndex].textContent;
          if (!confirm(toName + ' 님을 신임 노회장으로 지명하고 위임을 요청하시겠습니까?')) return;
          var items = HAND_ITEMS.map(function (it) {
            return { k: it.k, t: it.t, agreed: true };
          });
          db.rpc('start_handover', { p_to: to.value, p_items: items }).then(function (res) {
            if (res.error) { hmsg(false, res.error.message); return; }
            loadHandover();
          });
        });
      }
    });
  }

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

  /* ---------- 시스템 알림 설정 (현재 표시 중 + 전체 규칙 + 그룹 발송) ----------
   * 대상 그룹은 명부와 연동된다 (48_notify_groups.sql):
   *   시찰장·시찰 서기  — 시찰 명부(sichals)와 지정 시찰 임원
   *   상비부장·상비부 서기 — 상비부·위원회 명부(committees)와 지정 임원
   *   임원·관리자·간사   — 계정 등급 */
  var OPS_GROUPS = ['간사', '관리자', '임원', '시찰장', '시찰 서기', '상비부장', '상비부 서기', '전 회원'];

  function sendToGroup(group, title, body, done) {
    db.rpc('send_notice_to_group', {
      p_group: group, p_kind: '운영', p_title: title, p_body: body
    }).then(function (res) {
      if (res.error) { done(false, res.error.message); return; }
      var n = Number(res.data || 0);
      SHSCloud.log('create', '그룹 알림 발송', group + ' — ' + title + ' (' + n + '명)');
      done(true, n > 0
        ? group + ' ' + n + '명에게 알림함으로 보냈습니다.'
        : '보낼 대상이 없거나, 같은 제목을 방금 이미 보냈습니다.');
    });
  }

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
            '<button class="btn ghost sm" data-opsdone="' + n.doneKey + '">이번 회기 처리 완료 (알림 끄기)</button> ' +
            (OPS_GROUPS.indexOf(n.audience) !== -1
              ? '<button class="btn sm" data-opssend="' + e(n.audience) + '" data-st="' + e(n.title) +
                '" data-sb="' + e(n.message || '') + '">' + e(n.audience) + '에게 알림함으로 보내기</button>'
              : '') +
            '<span class="form-msg" style="display:inline-block;margin-left:8px" data-sendmsg="' + e(n.title) + '"></span>' +
            '</div></div>';
        });
      }

      /* 그룹을 골라 알림함으로 바로 보내기 (명부 연동) */
      html += '<h2>그룹에게 알림 보내기</h2>' +
        '<p style="font-size:0.88rem;color:var(--gray-7)">대상은 명부와 연동됩니다 — ' +
        '시찰장·시찰 서기는 시찰 명부에서, 상비부장·상비부 서기는 상비부·위원회 명부에서, ' +
        '임원·관리자는 계정 등급에서 찾아 보냅니다.</p>' +
        '<div class="admin-card" style="max-width:820px">' +
        '<div class="inline-form" style="margin-bottom:8px">' +
        '<div class="field" style="flex:0 0 150px"><label>대상</label><select id="gs-aud">' +
        OPS_GROUPS.map(function (g) { return '<option>' + g + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label>제목</label><input type="text" id="gs-title"></div>' +
        '</div>' +
        '<div class="field"><label>내용</label><textarea id="gs-body" rows="3"></textarea></div>' +
        '<button class="btn" id="gs-send">알림함으로 보내기</button>' +
        '<div class="form-msg" id="gs-msg"></div></div>';

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
          '<div class="field" style="flex:0 0 130px"><label>대상 (명부 연동)</label><select id="op-aud">' +
          OPS_GROUPS.map(function (g) { return '<option>' + g + '</option>'; }).join('') + '</select></div>' +
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

      /* 표시 중인 알림을 그 대상 그룹에게 알림함으로 보내기 */
      box.querySelectorAll('button[data-opssend]').forEach(function (b) {
        b.addEventListener('click', function () {
          var aud = b.dataset.opssend;
          if (!confirm(aud + ' 그룹에게 "' + b.dataset.st + '" 알림을 보내시겠습니까?')) return;
          b.disabled = true;
          var m = box.querySelector('[data-sendmsg="' + b.dataset.st + '"]');
          sendToGroup(aud, b.dataset.st, b.dataset.sb, function (ok, t) {
            b.disabled = false;
            if (m) { m.className = 'form-msg ' + (ok ? 'ok' : 'err'); m.style.display = 'inline-block'; m.textContent = t; }
            else alert(t);
          });
        });
      });

      /* 그룹에게 바로 보내기 */
      var gsBtn = document.getElementById('gs-send');
      if (gsBtn) gsBtn.addEventListener('click', function () {
        var msg = document.getElementById('gs-msg');
        var aud = document.getElementById('gs-aud').value;
        var title = document.getElementById('gs-title').value.trim();
        var body = document.getElementById('gs-body').value.trim();
        if (!title) { msg.className = 'form-msg err'; msg.textContent = '제목을 입력해 주세요.'; return; }
        if (!confirm(aud + ' 그룹에게 "' + title + '" 알림을 보내시겠습니까?')) return;
        gsBtn.disabled = true;
        msg.className = 'form-msg'; msg.textContent = '보내는 중입니다...';
        sendToGroup(aud, title, body, function (ok, t) {
          gsBtn.disabled = false;
          msg.className = 'form-msg ' + (ok ? 'ok' : 'err');
          msg.textContent = t;
          if (ok) { document.getElementById('gs-title').value = ''; document.getElementById('gs-body').value = ''; }
        });
      });

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

  }

  /* ================= 노회 일정 설정 =================
   * 사이트 관리 → 노회 운영 → 노회 일정 설정 탭에서 부른다.
   * 정기노회 일정(확정되면 40일 전 알림)과 정기노회 기준일을 함께 다룬다. */
  function mountSchedule(area, user) {
    if (!area) return;
    var e = SHS.esc;
    if (!user || !SHSAuth.canManageMembers(user) || !user.cloud) {
      area.innerHTML = '<div class="notice-banner">노회 일정 설정은 관리자 등급이 ' +
        '서버 로그인(구글 또는 이메일) 후 볼 수 있습니다.</div>';
      return;
    }
    var isSuper = user.role === 'superadmin';
    var db = null;

    area.innerHTML = '<div id="ops-meet"></div><div id="ops-sched" style="margin-top:22px"></div>';
    SHSCloud.init().then(function (c) {
      db = c;
      loadMeetings(); loadSchedule();
    });

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

  return { mount: mount, mountSchedule: mountSchedule };
})();

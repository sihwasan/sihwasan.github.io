/* 노회 회의관리 — 회기마다 출결 · 투표 · 회의 진행 · 거마비를 한곳에서
 *
 *   보는 사람 : 서기(입력) · 부서기(열람) · 노회장 · 간사 · 최고관리자
 *   서버      : assembly_list, assembly_admin (112_meeting_admin.sql) — 부서기가 읽을 수 있는 길
 *               서버가 아직 112 이전이면 서기는 assembly_state 로 대신 읽는다.
 *   회의 진행 : js/proceed-panel.js (부서기에게는 보기 전용)
 *
 *   주소 : meeting-admin.html?s=20 (회기) 또는 ?m=3 (오늘의 노회 번호)
 */
(function () {
  var e = SHS.esc;
  var root, C, user, canEdit = false, canView = false;
  var list = [], sessions = [], sel = null, data = null, tab = 'sum', filt = 'all', showTest = false;
  var oldServer = false, busy = false;

  function qs(k) {
    var m = location.search.match(new RegExp('[?&]' + k + '=([^&]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function hm(t) {
    if (!t) return '';
    var d = new Date(t);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function ymdhm(t) {
    if (!t) return '';
    var d = new Date(t);
    return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate() + ' ' + hm(t);
  }
  function won(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }
  function isViceClerk(u) { return u.role === 'officer' && String(u.title || '').trim() === '부서기'; }
  var ST = { open: '<span class="ma-badge live">입장 받는 중</span>', confirmed: '<span class="ma-badge on">명단 확정 · 회의 중</span>',
             closed: '<span class="ma-badge">마침</span>' };
  function stBadge(m) {
    if (!m) return '';
    return (m.recess && m.status !== 'closed' ? '<span class="ma-badge live">정회 중</span>' : '') + (ST[m.status] || '') +
      (m.status === 'closed' && m.confirmed === 0 && m.attendees > 0 ? '<span class="ma-badge warn">명단 미확정</span>' : '');
  }

  /* ---------- 불러오기 ---------- */
  function loadList() {
    return Promise.all([
      C.rpc('assembly_list').then(function (r) { return r; }, function () { return { error: 1 }; }),
      C.from('meeting_sessions').select('id,title,session_no,meet_on,place,status')
        .order('meet_on', { ascending: false }).then(function (r) { return r; }, function () { return { data: [] }; })
    ]).then(function (rs) {
      list = (rs[0] && !rs[0].error && rs[0].data) || [];
      sessions = (rs[1] && rs[1].data) || [];
    });
  }
  /* 회기 번호로 묶는다 — 출석(오늘의 노회)과 순서지(진행 매니저) */
  function groups() {
    var g = {}, order = [];
    function at(no) {
      var k = no == null ? 'x' : String(no);
      if (!g[k]) { g[k] = { no: no, meeting: null, session: null }; order.push(k); }
      return g[k];
    }
    list.forEach(function (m) { var x = at(m.session_no); if (!x.meeting) x.meeting = m; });
    sessions.forEach(function (s) { var x = at(s.session_no); if (!x.session) x.session = s; });
    return order.map(function (k) { return g[k]; }).sort(function (a, b) { return (b.no || 0) - (a.no || 0); });
  }

  function loadDetail() {
    data = null;
    var mid = sel && sel.meeting && sel.meeting.id;
    if (!mid) { draw(); return Promise.resolve(); }
    return C.rpc('assembly_admin', { p_meeting: mid }).then(function (r) {
      if (r.error && /schema cache|does not exist|Could not find/i.test(r.error.message || '')) {
        oldServer = true;
        /* 서버가 112 이전 — 서기는 오늘의 노회 상태로 대신 읽는다 (테스트·마지막 투표는 빠질 수 있음) */
        return C.rpc('assembly_state', { p_code: null, p_meeting: mid }).then(function (r2) {
          if (r2.error || !r2.data) return null;
          var d = r2.data;
          var votes = (d.history || []).slice().reverse();
          if (d.vote) votes.push(d.vote);
          return { can_edit: !!(d.me && d.me.mgr), meeting: d.meeting, attendees: d.attendees || [], votes: votes };
        });
      }
      if (r.error) { alert(r.error.message); return null; }
      return r.data;
    }).then(function (d) { data = d; draw(); });
  }

  /* ---------- 그리기 ---------- */
  function draw() {
    if (!sel) { drawList(); return; }
    var m = data && data.meeting, s = sel.session;
    var h = '<div class="ma-noprint" style="margin-bottom:12px"><button class="btn ghost sm" data-act="back">&#8592; 회기 목록</button></div>';
    if (oldServer) h += '<div class="notice-banner" style="border-left:4px solid #d9a33b;margin-bottom:12px">부서기 열람 · 정회/속회 · 다시 열기를 쓰려면 ' +
      '<code>supabase/112_meeting_admin.sql</code> 을 Supabase SQL Editor에서 실행해 주세요.</div>';
    if (!canEdit) h += '<div class="ma-ro">열람 전용 — 회의관리 입력은 서기가 합니다.</div>';
    h += '<div class="ma-head"><div><div class="ma-sub">제' + (sel.no || '?') + '회기</div>' +
      '<h2>' + e((m && m.title) || (s && s.title) || '정기노회') + '</h2>' +
      '<div class="ma-sub">' + e(String((m && m.meet_date) || (s && s.meet_on) || '').replace(/-/g, '.')) +
      (s && s.place ? ' · ' + e(s.place) : '') + '</div></div><div>' + stBadge(sel.meeting) + '</div></div>';

    var tabs = [['sum', '개요'], ['att', '출결'], ['vote', '투표'], ['proc', '회의 진행'], ['allow', '거마비']];
    h += '<div class="ma-tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" aria-selected="' + (tab === t[0]) + '" class="' + (tab === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div><div id="ma-pane"></div>';
    root.innerHTML = h;
    var pane = document.getElementById('ma-pane');
    if (tab === 'proc') { drawProc(pane); return; }
    if (!m) {
      pane.innerHTML = '<div class="notice-banner">이 회기에는 오늘의 노회(출석 QR) 기록이 없습니다.' +
        (canEdit ? ' <a href="today.html#qr">출석 QR 코드 만들기</a>' : '') + '</div>';
      return;
    }
    pane.innerHTML = tab === 'att' ? attHtml() : tab === 'vote' ? voteHtml() : tab === 'allow' ? allowHtml() : sumHtml();
  }

  function drawList() {
    var gs = groups();
    var h = '<p class="ma-sub">회기를 누르면 그 노회의 출결 · 투표 · 회의 진행 · 거마비를 한 화면에서 봅니다. ' +
      (canEdit ? '서기는 이곳에서 명단 확정 · 노회 마치기 · 다시 열기를 할 수 있습니다.' : '부서기는 열람만 합니다.') + '</p>';
    if (!gs.length) {
      h += '<div class="notice-banner">아직 기록된 노회가 없습니다.' + (canEdit ? ' <a href="today.html#qr">출석 QR 코드 만들기</a> · <a href="proceed.html">순서지 만들기</a>' : '') + '</div>';
    } else {
      h += '<div class="ma-boxes">' + gs.map(function (g, i) {
        var m = g.meeting, s = g.session;
        return '<button type="button" class="ma-box' + (m && m.today ? ' today' : '') + '" data-pick="' + i + '">' +
          '<div class="ma-box-no">' + (g.no ? '제' + g.no + '회기' : '회기 미지정') + '</div>' +
          '<div class="ma-box-t">' + e((m && m.title) || (s && s.title) || '') + '</div>' +
          '<div class="ma-sub">' + e(String((m && m.meet_date) || (s && s.meet_on) || '').replace(/-/g, '.')) + (m && m.today ? ' · <strong>오늘</strong>' : '') + '</div>' +
          '<div style="margin-top:6px">' + stBadge(m) + (s ? '<span class="ma-badge">순서지 ' + e(s.status) + '</span>' : '') + '</div>' +
          (m ? '<div class="ma-sub">입장 ' + m.attendees + '명' + (m.confirmed != null ? ' · 확정 ' + m.confirmed + '명' : '') + ' · 투표 ' + m.votes + '건</div>' : '<div class="ma-sub">출석 기록 없음</div>') +
          '</button>';
      }).join('') + '</div>';
    }
    root.innerHTML = h;
    root._groups = gs;
  }

  function counts() {
    var a = (data && data.attendees) || [];
    var nonObs = a.filter(function (x) { return x.seat !== 'observe'; });
    var conf = nonObs.filter(function (x) { return x.confirmed; });
    return {
      total: nonObs.length, conf: conf.length,
      pastor: conf.filter(function (x) { return x.kind === '목사'; }).length,
      elder: conf.filter(function (x) { return x.kind === '장로'; }).length,
      obs: a.filter(function (x) { return x.seat === 'observe'; }).length,
      late: a.filter(function (x) { return !x.confirmed; }).length,
      away: a.filter(function (x) { return x.present === false; }).length
    };
  }

  function sumHtml() {
    var m = data.meeting, c = counts();
    var votes = (data.votes || []).filter(function (v) { return !v.test; });
    var pass = votes.filter(function (v) { return v.result && v.result.passed; }).length;
    var h = '';
    if (m.status === 'closed' && !m.confirmed_at) {
      h += '<div class="ma-warn"><strong>출석자 명단을 확정하지 않은 채 마친 노회입니다.</strong>' +
        '<div class="ma-sub">' + (canEdit ? '「다시 열기」를 누른 뒤 「명단 확정하기」를 눌러 주세요. 입장 기록 ' + data.attendees.length + '명은 그대로 남아 있습니다.'
                                           : '서기가 다시 열어 명단을 확정해야 합니다.') + '</div></div>';
    } else if (m.status === 'open') {
      h += '<div class="ma-warn" style="border-color:#d9a33b;background:#fffaf0;color:#7a5a00"><strong>아직 출석자 명단을 확정하지 않았습니다.</strong>' +
        '<div class="ma-sub">회의가 시작되면 「명단 확정하기」를 눌러 주세요. 확정해야 노회를 마칠 수 있습니다.</div></div>';
    }
    h += '<div class="ma-cards">' +
      '<div class="ma-card"><span>입장</span><strong>' + c.total + '</strong>명</div>' +
      '<div class="ma-card"><span>확정 명단</span><strong>' + c.conf + '</strong>명</div>' +
      '<div class="ma-card"><span>목사 (확정)</span><strong>' + c.pastor + '</strong>명</div>' +
      '<div class="ma-card"><span>장로 총대 (확정)</span><strong>' + c.elder + '</strong>명</div>' +
      (c.obs ? '<div class="ma-card"><span>참관</span><strong>' + c.obs + '</strong>명</div>' : '') +
      '<div class="ma-card"><span>본 투표</span><strong>' + votes.length + '</strong>건<div class="ma-sub">가결 ' + pass + ' · 부결 ' + (votes.length - pass) + '</div></div>' +
      '</div>';
    h += '<table class="ma-tbl" style="max-width:640px"><tbody>' +
      '<tr><th>QR 생성</th><td>' + e(m.created_by || '') + ' ' + ymdhm(m.created_at) + '</td></tr>' +
      '<tr><th>명단 확정</th><td>' + (m.confirmed_at ? e(m.confirmed_by || '') + ' ' + ymdhm(m.confirmed_at) : '<span style="color:var(--red)">확정 안 됨</span>') + '</td></tr>' +
      (m.round > 1 ? '<tr><th>정회 · 속회</th><td>속회 ' + (m.round - 1) + '번' + (m.resumed_at ? ' · 마지막 속회 ' + hm(m.resumed_at) : '') + (c.away ? ' · 새 QR로 다시 입장하지 않은 분 ' + c.away + '명' : '') + '</td></tr>' : '') +
      (m.recess && m.status !== 'closed' ? '<tr><th>지금</th><td><span class="ma-badge live">정회 중</span> ' + hm(m.recess_at) + '부터</td></tr>' : '') +
      '<tr><th>노회 마침</th><td>' + (m.closed_at ? ymdhm(m.closed_at) : '-') + '</td></tr>' +
      (canEdit && m.code ? '<tr><th>출석 코드</th><td>' + e(m.code) + '</td></tr>' : '') +
      '</tbody></table>';
    if (canEdit) {
      h += '<div class="ma-btnrow">' +
        '<a class="btn" href="today.html#qr" data-act="today">오늘의 노회에서 열기</a>' +
        (m.status === 'open' ? '<button class="btn" data-act="confirm"' + (c.total + c.obs ? '' : ' disabled') + '>명단 확정하기</button>' : '') +
        (m.status === 'confirmed' && c.late ? '<button class="btn" data-act="confirm">확정 뒤 입장한 ' + c.late + '명 명단에 넣기</button>' : '') +
        (m.status !== 'closed' ? '<button class="btn ghost" data-act="close">노회 마치기</button>' : '') +
        (m.status === 'closed' ? '<button class="btn' + (m.confirmed_at ? ' ghost' : '') + '" data-act="reopen">다시 열기 (노회 마치기 되돌리기)</button>' : '') +
        '<a class="btn ghost" href="minutes-write.html">회의록 작성</a></div>';
    }
    return h;
  }

  function attHtml() {
    var a = data.attendees || [], m = data.meeting;
    var F = [['all', '전체 ' + a.length], ['목사', '목사'], ['장로', '장로 총대'], ['observe', '참관'], ['late', '미확정'], ['away', '재입장 전']];
    var rows = a.filter(function (x) {
      if (filt === 'all') return true;
      if (filt === 'observe') return x.seat === 'observe';
      if (filt === 'late') return !x.confirmed;
      if (filt === 'away') return x.present === false;
      return x.kind === filt && x.seat !== 'observe';
    });
    var c = counts();
    var h = '<div class="ma-sub">입장 ' + c.total + '명 · 확정 ' + c.conf + '명 (목사 ' + c.pastor + ' · 장로 총대 ' + c.elder + ')' +
      (c.obs ? ' · 참관 ' + c.obs + '명' : '') + (m.confirmed_at ? ' · ' + ymdhm(m.confirmed_at) + ' 확정' : ' · <strong style="color:var(--red)">명단 미확정</strong>') + '</div>' +
      '<div class="ma-filter">' + F.map(function (f) {
        return '<button type="button" class="' + (filt === f[0] ? 'on' : '') + '" data-filt="' + f[0] + '">' + f[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="ma-btnrow"><button class="btn ghost sm" data-act="print">인쇄</button><button class="btn ghost sm" data-act="csv">엑셀(CSV) 내려받기</button></div>';
    if (!rows.length) return h + '<div class="notice-banner">해당하는 분이 없습니다.</div>';
    h += '<div class="ma-tblwrap"><table class="ma-tbl"><thead><tr><th>번호</th><th>이름</th><th>직분</th><th>교회</th><th>구분</th><th>입장</th><th>현장</th><th>명단</th></tr></thead><tbody>' +
      rows.map(function (x, i) {
        return '<tr' + (x.confirmed ? '' : ' class="late"') + '><td>' + (i + 1) + '</td><td><strong>' + e(x.name || '') + '</strong></td>' +
          '<td>' + e(x.position || '') + '</td><td>' + e(x.church || '') + '</td>' +
          '<td>' + e(x.seat === 'observe' ? '참관' : (x.grade || '')) + (x.honor ? ' <span class="ma-badge">증경부노회장</span>' : '') + '</td>' +
          '<td>' + hm(x.entered_at) + '</td>' +
          '<td>' + (x.present === false ? '<span class="ma-badge live">재입장 전</span>' : x.reentered_at ? '재입장 ' + hm(x.reentered_at) : '현장') + '</td>' +
          '<td>' + (x.confirmed ? '<span class="ma-badge on">확정</span>' : '<span class="ma-badge warn">미확정</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return h;
  }

  function voteHtml() {
    var vs = (data.votes || []).filter(function (v) { return showTest || !v.test; });
    var tests = (data.votes || []).filter(function (v) { return v.test; }).length;
    var h = '<div class="ma-sub">본 투표 ' + (data.votes || []).filter(function (v) { return !v.test; }).length + '건' +
      (tests ? ' · 테스트 ' + tests + '건 <button class="btn ghost sm" data-act="tests">' + (showTest ? '테스트 숨기기' : '테스트도 보기') + '</button>' : '') + '</div>';
    if (!vs.length) return h + '<div class="notice-banner" style="margin-top:10px">투표 기록이 없습니다.</div>';
    return h + '<div style="margin-top:10px">' + vs.map(function (v, i) {
      var r = v.result;
      var abst = r && r.eligible != null ? Math.max(0, r.eligible - r.total) : null;
      var names = '';
      if (r && r.names && r.names.length) {
        var y = r.names.filter(function (n) { return n.choice === '찬성'; }).map(function (n) { return e(n.name); });
        var n2 = r.names.filter(function (n) { return n.choice === '반대'; }).map(function (n) { return e(n.name); });
        names = '<details><summary>기명 투표 내역</summary><div><b>찬성</b> ' + (y.join(', ') || '없음') + '</div><div><b>반대</b> ' + (n2.join(', ') || '없음') + '</div></details>';
      }
      return '<div class="ma-vote' + (v.test ? ' test' : '') + '">' +
        '<div><span class="ma-badge">' + (i + 1) + '</span><span class="ma-badge">' + e(v.mode) + '</span>' +
        '<span class="ma-badge">가결 기준 ' + (v.rule === '3분의2' ? '3분의 2' : '과반') + '</span>' +
        (v.test ? '<span class="ma-badge warn">테스트</span>' : '') +
        (v.status === '진행' ? '<span class="ma-badge live">투표 중</span>' : '') + '</div>' +
        '<h4>' + e(v.title) + '</h4>' +
        '<div class="ma-sub">' + hm(v.started_at) + (v.ended_at ? ' ~ ' + hm(v.ended_at) : '') + (v.created_by ? ' · ' + e(v.created_by) : '') + '</div>' +
        (r ? '<div style="margin-top:6px">찬성 <strong>' + r.yes + '</strong> · 반대 <strong>' + r.no + '</strong>' +
             (abst != null ? ' · 기권 ' + abst + ' (재석 ' + r.eligible + ')' : '') +
             ' <span class="ma-verdict ' + (r.passed ? 'pass' : 'fail') + '">' + (r.passed ? '가결' : '부결') + '</span></div>' + names
           : v.status === '진행' ? '' : '<div class="ma-sub">결과 집계 중</div>') +
        '</div>';
    }).join('') + '</div>';
  }

  function allowHtml() {
    var a = (data.attendees || []).filter(function (x) { return x.allow_status; });
    if (!a.length) return '<div class="notice-banner">거마비 지급 기록이 없습니다.</div>';
    var sum = 0, got = 0;
    a.forEach(function (x) { sum += x.allow_amount || 0; if (x.allow_status === '수령') got += x.allow_amount || 0; });
    return '<div class="ma-sub">지급 승인 ' + a.length + '명 ' + won(sum) + ' · 수령 확인 ' + won(got) + '</div>' +
      '<div class="ma-tblwrap"><table class="ma-tbl"><thead><tr><th>이름</th><th>교회</th><th>금액</th><th>상태</th><th>장부</th></tr></thead><tbody>' +
      a.map(function (x) {
        return '<tr><td><strong>' + e(x.name || '') + '</strong> ' + e(x.position || '') + '</td><td>' + e(x.church || '') + '</td>' +
          '<td>' + won(x.allow_amount) + '</td><td>' + (x.allow_status === '수령' ? '수령 ' + ymdhm(x.allow_received_at) : '수령 확인 대기') + '</td>' +
          '<td>' + (x.in_ledger ? '기입' : '-') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function drawProc(pane) {
    if (!sel.no) { pane.innerHTML = '<div class="notice-banner">회기 번호가 없는 기록입니다.</div>'; return; }
    pane.innerHTML = (canEdit ? '<div class="ma-sub" style="margin-bottom:10px">회의 당일 진행은 <a href="today.html#qr">오늘의 노회</a> 화면에서 출석 · 투표와 함께 하면 편합니다.</div>' : '') +
      '<div id="ma-proc"></div>';
    window.SHSProceed.mount(document.getElementById('ma-proc'), user, { readOnly: !canEdit, sessionNo: sel.no, embed: true });
  }

  /* ---------- 서기 일 ---------- */
  function rpc(btn, fn, args) {
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    C.rpc(fn, args).then(function (r) {
      busy = false;
      if (btn) btn.disabled = false;
      if (r.error) {
        alert(/schema cache|does not exist|Could not find/i.test(r.error.message || '')
          ? '이 기능은 서버 갱신이 필요합니다.\nsupabase/112_meeting_admin.sql 을 Supabase SQL Editor에서 실행해 주세요.'
          : r.error.message);
        return;
      }
      loadList().then(function () {
        sel.meeting = list.filter(function (x) { return x.id === sel.meeting.id; })[0] || sel.meeting;
        return loadDetail();
      });
    }, function () { busy = false; if (btn) btn.disabled = false; alert('서버에 연결하지 못했습니다.'); });
  }

  function csv() {
    var a = data.attendees || [];
    var rows = [['번호', '이름', '직분', '교회', '구분', '입장', '현장', '명단']].concat(a.map(function (x, i) {
      return [i + 1, x.name || '', x.position || '', x.church || '', x.seat === 'observe' ? '참관' : (x.grade || ''),
              hm(x.entered_at), x.present === false ? '재입장 전' : '현장', x.confirmed ? '확정' : '미확정'];
    }));
    var txt = '﻿' + rows.map(function (r) {
      return r.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
    }).join('\r\n');
    var b = new Blob([txt], { type: 'text/csv;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(b);
    link.download = '출석명단_제' + (sel.no || '') + '회기.csv';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 2000);
  }

  function onClick(ev) {
    var t = ev.target.closest ? ev.target.closest('[data-act],[data-tab],[data-pick],[data-filt]') : null;
    if (!t || t.disabled) return;
    if (t.hasAttribute('data-pick')) {
      sel = root._groups[Number(t.getAttribute('data-pick'))];
      tab = 'sum'; filt = 'all';
      history.replaceState(null, '', 'meeting-admin.html?s=' + (sel.no || ''));
      root.innerHTML = '<p style="color:var(--gray-5)">불러오는 중...</p>';
      loadDetail();
      return;
    }
    if (t.hasAttribute('data-tab')) { tab = t.getAttribute('data-tab'); draw(); return; }
    if (t.hasAttribute('data-filt')) { filt = t.getAttribute('data-filt'); draw(); return; }
    var act = t.getAttribute('data-act'), m = data && data.meeting;
    if (act === 'back') { sel = null; history.replaceState(null, '', 'meeting-admin.html'); drawList(); return; }
    if (act === 'tests') { showTest = !showTest; draw(); return; }
    if (act === 'print') { window.print(); return; }
    if (act === 'csv') { csv(); return; }
    if (!canEdit || !m) return;
    if (act === 'today') {
      /* 오늘의 노회 서기 화면에서 이 노회를 바로 연다 */
      try { sessionStorage.setItem('shs_asm_sel', m.id); } catch (x) {}
      return;
    }
    if (act === 'confirm') {
      var c = counts();
      if (confirm('입장한 ' + (c.total + c.obs) + '명으로 출석자 명단을 확정합니다.\n확정 명단은 회계에게 전달됩니다.')) rpc(t, 'assembly_confirm', { p_meeting: m.id });
    } else if (act === 'close') {
      var c2 = counts();
      if (m.status === 'open') { alert('출석자 명단을 아직 확정하지 않았습니다.\n「명단 확정하기」를 먼저 눌러 주세요.'); return; }
      if (c2.late) { alert('확정 뒤 입장한 ' + c2.late + '명을 먼저 명단에 넣어 주세요.'); return; }
      if (confirm('노회를 마칩니다.\n확정 명단 ' + c2.conf + '명 (목사 ' + c2.pastor + ' · 장로 총대 ' + c2.elder + ')\n잘못 마쳤으면 「다시 열기」로 되돌릴 수 있습니다.')) {
        rpc(t, 'assembly_close', { p_meeting: m.id });
      }
    } else if (act === 'reopen') {
      if (confirm('「' + m.title + '」을(를) 다시 엽니다.\n' + (m.confirmed_at ? '명단 확정 상태로 돌아갑니다.' : '입장 받는 상태로 돌아갑니다. 이어서 「명단 확정하기」를 눌러 주세요.'))) {
        rpc(t, 'assembly_reopen', { p_meeting: m.id });
      }
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    root = document.getElementById('ma-root');
    SHS.getUser().then(function (u) {
      user = u;
      if (!u) {
        root.innerHTML = '<div class="notice-banner">로그인해 주세요. <a class="btn sm" style="margin-left:10px" href="login.html">로그인</a></div>';
        return;
      }
      canEdit = u.role === 'clerk' || u.role === 'superadmin';
      canView = canEdit || isViceClerk(u) || u.role === 'president' || u.role === 'staff';
      if (!canView) {
        root.innerHTML = '<div class="notice-banner">노회 회의관리는 <strong>서기</strong>(입력)와 <strong>부서기</strong>(열람)가 이용할 수 있습니다.</div>';
        return;
      }
      if (!(window.SHSCloud && SHSCloud.enabled())) {
        root.innerHTML = '<div class="notice-banner">서버에 연결되어 있지 않습니다.</div>';
        return;
      }
      SHSCloud.init().then(function (c) {
        C = c;
        root.addEventListener('click', onClick);
        return loadList();
      }).then(function () {
        var want = qs('m'), sno = qs('s');
        if (want || sno) {
          var gs = groups();
          sel = gs.filter(function (g) {
            return (want && g.meeting && String(g.meeting.id) === want) || (sno && String(g.no) === sno);
          })[0] || null;
        }
        if (sel) loadDetail(); else drawList();
      });
    });
  });
})();

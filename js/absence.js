/* 노회 불참 이유서 (노회규칙 제35조, supabase/129_absence_reasons.sql)
 *
 * 「본회 회원은 노회 회집 불참 시에는 서기에게 그 이유서를 제출하여야 한다.」
 *
 *   SHSAbsence.dashCard(user)  대시보드(index.html·dashboard.html) — 정기노회가 공지되면
 *       (노회 일정 설정에서 확정 + 알림 기간 40일 안) 회의 당일까지 정회원에게 접수란을 연다.
 *       허브 위 서기 알림 자리(#hub-elder) 바로 아래에 스스로 자리를 만든다.
 *   SHSAbsence.mountClerk(el, user)  임원방 — 서기·최고관리자(확인 표시)와 부서기(열람)가 회의별로 본다.
 *
 * 서버 규칙(RLS)이 기간·대상·본인 확인을 모두 다시 확인한다. 화면은 안내만 한다.
 */
var SHSAbsence = (function () {
  var KINDS = ['질병·입원', '교회 사정', '경조사', '해외 체류', '개인 사정', '기타'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function today() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
  function dayDiff(a, b) { return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5); }
  function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
  function koDate(d) {
    var m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    var w = '일월화수목금토'.charAt(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay());
    return +m[1] + '년 ' + (+m[2]) + '월 ' + (+m[3]) + '일(' + w + ')';
  }
  function when(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function db() { return SHSCloud.init(); }
  function cloudOk() { return typeof SHSCloud !== 'undefined' && SHSCloud.enabled && SHSCloud.enabled(); }
  function meetName(m) { return (m.kind || '노회') + (m.year && String(m.kind || '').indexOf(String(m.year)) === -1 ? ' (' + m.year + ')' : ''); }
  function isOpen(m, t) {
    return !!(m && m.confirmed && m.meet_date && t <= m.meet_date && t >= addDays(m.meet_date, -(m.lead_days == null ? 40 : m.lead_days)));
  }

  /* 낼 수 있는 분: 정회원 이상(자격 유효) — 언권회원·일반회원·승인대기·최고관리자(노회 사무실 계정) 제외 */
  function eligible(u) {
    if (!u || !u.cloud) return false;
    if (['advisory', 'general', 'pending', 'superadmin'].indexOf(u.role) !== -1) return false;
    return !(window.SHS && SHS.isActiveMember) || SHS.isActiveMember(u);
  }

  /* =====================================================================
   *  대시보드 접수란
   * ===================================================================== */
  var D = { user: null, slot: null, meets: [], mine: {}, open: {}, busy: false, hideKey: '' };

  function dashCard(user) {
    if (!eligible(user) || !user.id || !cloudOk()) return;
    D.user = user;
    /* 허브(board.js)가 그려질 때까지 기다렸다가 서기 알림 자리 아래에 붙는다 */
    var tries = 0;
    (function wait() {
      var anchor = document.getElementById('hub-elder');
      if (!anchor) { if (tries++ < 40) setTimeout(wait, 250); return; }
      if (document.getElementById('hub-absence')) return;
      D.slot = document.createElement('div');
      D.slot.id = 'hub-absence';
      anchor.parentNode.insertBefore(D.slot, anchor.nextSibling);
      /* 허브의 상세(#hub-…)를 보는 동안에는 감춘다 (서기 알림 자리와 같게) */
      window.addEventListener('hashchange', syncHidden);
      syncHidden();
      D.slot.addEventListener('click', onDashClick);
      D.slot.addEventListener('submit', onDashSubmit);
      load();
    })();
  }
  function syncHidden() {
    if (D.slot) D.slot.classList.toggle('hidden', /^#hub-[a-z]+$/.test(location.hash || ''));
  }
  function load() {
    var t = today();
    db().then(function (c) {
      return c.from('meetings').select('id,kind,year,meet_date,place,confirmed,lead_days')
        .eq('confirmed', true).gte('meet_date', t).order('meet_date').then(function (r) {
          D.meets = ((r && r.data) || []).filter(function (m) { return isOpen(m, t); });
          if (!D.meets.length) return null;
          /* 서기·부서기는 서버 규칙상 모든 이유서를 읽으므로 반드시 본인 것만 고른다 */
          return c.from('absence_reasons').select('id,meeting_id,reason_kind,reason,status,checked_by,created_at,updated_at')
            .eq('user_id', D.user.id)
            .in('meeting_id', D.meets.map(function (m) { return m.id; }));
        });
    }).then(function (r) {
      if (r && r.error) return;   /* 129 sql 을 실행하기 전이면 접수란을 띄우지 않는다 */
      D.mine = {};
      ((r && r.data) || []).forEach(function (x) { D.mine[x.meeting_id] = x; });
      draw();
    }).catch(function () { /* 접수란은 덤 — 실패해도 대시보드는 그대로 */ });
  }
  function hidden(m) { try { return localStorage.getItem('shs_absence_hide_' + m.id) === '1'; } catch (x) { return false; } }
  function draw(msgFor, msg, isErr) {
    if (!D.slot) return;
    var t = today();
    var list = D.meets.filter(function (m) { return D.mine[m.id] || !hidden(m); });
    D.slot.innerHTML = list.map(function (m) {
      var mine = D.mine[m.id], left = dayDiff(m.meet_date, t);
      var h = '<div class="admin-card" style="border-left:4px solid var(--navy);margin-bottom:18px" data-meet="' + m.id + '">' +
        '<h3 style="margin:0 0 6px">' + esc(meetName(m)) + ' 불참 이유서</h3>' +
        '<p style="margin:0 0 10px;color:var(--gray-6)">' + esc(koDate(m.meet_date)) + (m.place ? ' · ' + esc(m.place) : '') +
        ' (' + (left > 0 ? left + '일 남음' : '오늘') + ') · 접수는 회의 당일까지</p>';
      if (mine && !D.open[m.id]) {
        h += '<p style="margin:0 0 6px;line-height:1.7"><strong>제출하셨습니다</strong> <span style="color:var(--gray-5)">(' + esc(when(mine.updated_at || mine.created_at)) + ')</span> · ' +
          (mine.status === '확인' ? '<span style="color:#1a6d3a;font-weight:700">서기 확인' + (mine.checked_by ? ' (' + esc(mine.checked_by) + ')' : '') + '</span>'
                                  : '<span style="color:var(--gray-6)">서기 확인 전</span>') + '</p>' +
          '<p style="margin:0 0 12px;line-height:1.7;white-space:pre-wrap">[' + esc(mine.reason_kind) + '] ' + esc(mine.reason) + '</p>' +
          '<div class="ab-acts" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
          '<button type="button" class="btn ghost sm" data-ab="edit">고치기</button>' +
          (mine.status === '접수' ? '<span class="ab-del"><button type="button" class="btn ghost sm" data-ab="del">거두기 (참석하게 되었습니다)</button></span>' : '') +
          '</div>';
      } else if (!D.open[m.id]) {
        h += '<p style="margin:0 0 12px;line-height:1.7">노회에 참석하지 못하시면 서기에게 <strong>불참 이유서</strong>를 제출해 주십시오 ' +
          '<span style="color:var(--gray-5)">(노회규칙 제35조)</span>. 참석하시는 분은 내지 않으셔도 됩니다.</p>' +
          '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
          '<button type="button" class="btn" data-ab="open">불참 이유서 쓰기</button>' +
          '<button type="button" class="btn ghost sm" data-ab="hide">참석합니다 (이 안내 닫기)</button></div>';
      } else {
        h += formHtml(m, mine);
      }
      if (msgFor === m.id && msg) h += '<div class="form-msg ' + (isErr ? 'err' : 'ok') + '" role="status" style="margin-top:10px">' + esc(msg) + '</div>';
      return h + '</div>';
    }).join('');
  }
  function formHtml(m, mine) {
    var kind = (mine && mine.reason_kind) || '';
    return '<form class="ab-form" data-meet="' + m.id + '" autocomplete="off">' +
      '<div class="field" style="max-width:260px"><label for="ab-kind-' + m.id + '">사유 구분</label>' +
      '<select id="ab-kind-' + m.id + '" required><option value="">고르십시오</option>' +
      KINDS.map(function (k) { return '<option' + (k === kind ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="ab-reason-' + m.id + '">불참 사유 <small style="color:var(--gray-5);font-weight:400">(서기만 봅니다 · 1,000자까지)</small></label>' +
      '<textarea id="ab-reason-' + m.id + '" rows="3" maxlength="1000" required style="width:100%">' + esc((mine && mine.reason) || '') + '</textarea></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px"><button type="submit" class="btn ab-save">' + (mine ? '고친 내용 제출' : '제출') + '</button>' +
      '<button type="button" class="btn ghost" data-ab="cancel">취소</button></div></form>';
  }
  function meetOf(el) { var c = el.closest('[data-meet]'); return c ? parseInt(c.dataset.meet, 10) : 0; }
  function onDashClick(ev) {
    var b = ev.target.closest('button[data-ab]');
    if (!b || D.busy) return;
    var id = meetOf(b), act = b.dataset.ab, m = D.meets.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    if (act === 'open' || act === 'edit') {
      D.open[id] = true; draw();
      var k = document.getElementById('ab-kind-' + id); if (k) k.focus();
      return;
    }
    if (act === 'cancel') {
      var f = b.closest('form');
      var dirty = f && (f.querySelector('textarea').value.trim() !== ((D.mine[id] && D.mine[id].reason) || ''));
      if (dirty && !confirm('쓰던 내용을 버리고 닫을까요?')) return;
      D.open[id] = false; draw();
      return;
    }
    if (act === 'hide') {
      try { localStorage.setItem('shs_absence_hide_' + id, '1'); } catch (x) {}
      draw();
      return;
    }
    if (act === 'del') {
      /* 거두기 전에 그 자리에서 한 번 더 묻는다 */
      b.parentNode.innerHTML = '<span style="display:inline-flex;flex-wrap:wrap;gap:8px;align-items:center">불참 이유서를 거둘까요? ' +
        '<button type="button" class="btn danger sm" data-ab="del-yes">거두기</button>' +
        '<button type="button" class="btn ghost sm" data-ab="del-no">취소</button></span>';
      var y = D.slot.querySelector('[data-ab="del-no"]'); if (y) y.focus();
      return;
    }
    if (act === 'del-no') { draw(); return; }
    if (act === 'del-yes') {
      D.busy = true; b.disabled = true; b.textContent = '거두는 중…';
      db().then(function (c) {
        return c.from('absence_reasons').delete().eq('id', D.mine[id].id).select('id');
      }).then(function (r) {
        D.busy = false;
        if (r.error || !r.data || !r.data.length) { draw(id, '거두지 못했습니다. 서기가 이미 확인했거나 접수 기간이 지났습니다.', true); return; }
        delete D.mine[id];
        draw(id, '불참 이유서를 거두었습니다.');
      }, function (e) { D.busy = false; draw(id, '거두지 못했습니다: ' + ((e && e.message) || e), true); });
    }
  }
  function onDashSubmit(ev) {
    var f = ev.target.closest('form.ab-form');
    if (!f) return;
    ev.preventDefault();
    if (D.busy) return;   /* 연타해도 한 번만 */
    var id = parseInt(f.dataset.meet, 10);
    var kind = document.getElementById('ab-kind-' + id).value;
    var reason = document.getElementById('ab-reason-' + id).value.trim();
    if (!kind) { document.getElementById('ab-kind-' + id).focus(); return; }
    if (reason.length < 2) { document.getElementById('ab-reason-' + id).focus(); return; }
    var btn = f.querySelector('.ab-save');
    D.busy = true; btn.disabled = true; btn.textContent = '제출하는 중…';
    var mine = D.mine[id];
    db().then(function (c) {
      var t = c.from('absence_reasons');
      return (mine ? t.update({ reason_kind: kind, reason: reason }).eq('id', mine.id)
                   : t.insert({ meeting_id: id, reason_kind: kind, reason: reason }))
        .select('id,meeting_id,reason_kind,reason,status,checked_by,created_at,updated_at');
    }).then(function (r) {
      D.busy = false;
      if (r.error || !r.data || !r.data.length) {
        btn.disabled = false; btn.textContent = mine ? '고친 내용 제출' : '제출';
        var m = (r.error && r.error.message) || '';
        var tail = f.querySelector('.form-msg') || f.appendChild(document.createElement('div'));
        tail.className = 'form-msg err'; tail.setAttribute('role', 'status'); tail.style.marginTop = '10px';
        tail.textContent = /duplicate|unique/.test(m) ? '이미 제출하셨습니다. 화면을 새로 고쳐 주세요.'
          : '제출하지 못했습니다. 접수 기간이 지났거나 정회원 자격이 확인되지 않습니다.' + (m ? ' (' + m + ')' : '');
        return;
      }
      D.mine[id] = r.data[0];
      D.open[id] = false;
      draw(id, mine ? '고친 불참 이유서를 서기에게 다시 제출했습니다.' : '불참 이유서를 서기에게 제출했습니다. 고맙습니다.');
    }, function (e) {
      D.busy = false; btn.disabled = false; btn.textContent = mine ? '고친 내용 제출' : '제출';
      draw(id, '제출하지 못했습니다: ' + ((e && e.message) || e), true);
    });
  }
  window.addEventListener('beforeunload', function (ev) {
    if (!D.slot) return;
    var dirty = [].some.call(D.slot.querySelectorAll('form.ab-form textarea'), function (t) {
      var id = meetOf(t);
      return t.value.trim() && t.value.trim() !== ((D.mine[id] && D.mine[id].reason) || '');
    });
    if (dirty) { ev.preventDefault(); ev.returnValue = ''; }
  });

  /* =====================================================================
   *  임원방 — 서기
   * ===================================================================== */
  var C = { el: null, user: null, meets: [], cur: null, rows: [], canCheck: false, busy: false };

  function isReader(u) {
    return !!u && (u.role === 'clerk' || u.role === 'superadmin' ||
      (u.role === 'officer' && String(u.title || '').trim() === '부서기'));
  }
  function mountClerk(el, user) {
    if (!el) return;
    C.el = el; C.user = user;
    C.canCheck = !!user && (user.role === 'clerk' || user.role === 'superadmin');
    if (!isReader(user)) { el.innerHTML = '<p style="color:var(--gray-5)">불참 이유서는 서기·부서기가 봅니다.</p>'; return; }
    if (!cloudOk()) { el.innerHTML = '<div class="notice-banner">서버 계정으로 로그인하신 뒤에 보실 수 있습니다.</div>'; return; }
    el.addEventListener('click', onClerkClick);
    el.innerHTML = '<p style="color:var(--gray-5)">불러오는 중...</p>';
    var t = today();
    db().then(function (c) {
      return c.from('meetings').select('id,kind,year,meet_date,place,confirmed,lead_days')
        .eq('confirmed', true).gte('meet_date', addDays(t, -400)).order('meet_date', { ascending: false });
    }).then(function (r) {
      C.meets = (r && r.data) || [];
      if (!C.meets.length) { el.innerHTML = '<p class="aiv-empty" style="color:var(--gray-5)">확정된 노회 일정이 없습니다. 노회 일정 설정에서 정기노회를 확정하면 접수가 시작됩니다.</p>'; return; }
      /* 지금 접수 중인 회의 → 다가오는 회의 → 가장 최근 회의 */
      var open = C.meets.filter(function (m) { return isOpen(m, t); }).sort(function (a, b) { return a.meet_date < b.meet_date ? -1 : 1; })[0];
      var next = C.meets.filter(function (m) { return m.meet_date >= t; }).sort(function (a, b) { return a.meet_date < b.meet_date ? -1 : 1; })[0];
      C.cur = (open || next || C.meets[0]).id;
      loadRows();
    }, function (e) { el.innerHTML = '<div class="notice-banner">불러오지 못했습니다: ' + esc((e && e.message) || e) + '</div>'; });
  }
  function loadRows() {
    db().then(function (c) {
      return c.from('absence_reasons').select('id,meeting_id,name,church,position,reason_kind,reason,status,checked_by,checked_at,created_at,updated_at')
        .eq('meeting_id', C.cur).order('created_at');
    }).then(function (r) {
      if (r.error) {
        C.el.innerHTML = /relation|does not exist|schema cache/.test(r.error.message || '')
          ? '<div class="notice-banner"><code>supabase/129_absence_reasons.sql</code> 을 실행하면 불참 이유서를 받을 수 있습니다.</div>'
          : '<div class="notice-banner">불러오지 못했습니다: ' + esc(r.error.message) + '</div>';
        return;
      }
      C.rows = r.data || [];
      drawClerk();
    });
  }
  function curMeet() { return C.meets.filter(function (m) { return m.id === C.cur; })[0]; }
  function summaryText() {
    var m = curMeet();
    return (m ? meetName(m) + ' ' + koDate(m.meet_date) + ' ' : '') + '불참 이유서 제출자 (' + C.rows.length + '명): ' +
      C.rows.map(function (x) { return x.name + (x.position ? ' ' + x.position : '') + '(' + (x.church || '') + ', ' + x.reason_kind + ')'; }).join(', ');
  }
  function drawClerk(msg, isErr) {
    var m = curMeet(), t = today();
    var checked = C.rows.filter(function (x) { return x.status === '확인'; }).length;
    var h = '<div class="tabs sub-tabs" id="ab-meets" style="margin-bottom:12px">' + C.meets.slice(0, 8).map(function (x) {
        return '<button type="button" data-abm="' + x.id + '"' + (x.id === C.cur ? ' class="active"' : '') + '>' + esc(meetName(x)) + ' ' + esc(String(x.meet_date).slice(5).replace('-', '/')) + '</button>';
      }).join('') + '</div>';
    if (m) {
      h += '<p style="margin:0 0 10px">' + esc(koDate(m.meet_date)) + (m.place ? ' · ' + esc(m.place) : '') + ' · ' +
        (isOpen(m, t) ? '<strong style="color:#1a6d3a">접수 중</strong> (회의 당일까지)'
          : m.meet_date > t ? '접수 전 (회의 ' + (m.lead_days == null ? 40 : m.lead_days) + '일 전부터)' : '접수 마감') +
        ' · 제출 <strong>' + C.rows.length + '명</strong>' + (C.rows.length ? ' (확인 ' + checked + ')' : '') + '</p>';
    }
    if (!C.rows.length) {
      h += '<p style="color:var(--gray-5);padding:10px 0">아직 제출된 불참 이유서가 없습니다. 정회원이 대시보드에서 제출하면 여기에 모이고 서기에게 알림이 갑니다.</p>';
    } else {
      h += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">' +
        '<button type="button" class="btn ghost sm" data-abc="copy">회의록용 명단 복사</button>' +
        '<button type="button" class="btn ghost sm" data-abc="csv">엑셀(CSV)로 받기</button>' +
        '<button type="button" class="btn ghost sm" data-abc="reload">새로 고침</button>' +
        '<span class="form-msg' + (isErr ? ' err' : ' ok') + '" role="status" id="ab-msg">' + esc(msg || '') + '</span></div>' +
        '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th style="width:40px">#</th><th style="width:120px">이름</th><th style="width:140px">교회</th>' +
        '<th style="width:100px">사유 구분</th><th>불참 사유</th><th style="width:90px">제출</th><th style="width:120px">서기 확인</th></tr></thead><tbody>' +
        C.rows.map(function (x, i) {
          return '<tr><td>' + (i + 1) + '</td><td>' + esc(x.name) + (x.position ? '<br><small style="color:var(--gray-5)">' + esc(x.position) + '</small>' : '') + '</td>' +
            '<td>' + esc(x.church || '') + '</td><td>' + esc(x.reason_kind) + '</td>' +
            '<td class="left" style="white-space:pre-wrap;word-break:break-word">' + esc(x.reason) + '</td>' +
            '<td><small>' + esc(when(x.updated_at || x.created_at)) + '</small></td><td>' +
            (x.status === '확인'
              ? '<span style="color:#1a6d3a;font-weight:700">확인</span>' + (x.checked_by ? '<br><small style="color:var(--gray-5)">' + esc(x.checked_by) + '</small>' : '') +
                (C.canCheck ? '<br><button type="button" class="btn ghost sm" data-abx="' + x.id + '" data-to="접수" style="margin-top:4px">확인 취소</button>' : '')
              : (C.canCheck ? '<button type="button" class="btn sm" data-abx="' + x.id + '" data-to="확인">확인</button>' : '<span style="color:var(--gray-5)">확인 전</span>')) +
            '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    C.el.innerHTML = h;
  }
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    return new Promise(function (ok, no) {
      var ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      var done = false; try { done = document.execCommand('copy'); } catch (x) {}
      document.body.removeChild(ta); if (done) ok(); else no(new Error('copy'));
    });
  }
  function csv() {
    function q(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var m = curMeet();
    var lines = [['번호', '이름', '직분', '교회', '사유 구분', '불참 사유', '제출', '서기 확인', '확인한 분'].join(',')];
    C.rows.forEach(function (x, i) {
      lines.push([i + 1, x.name, x.position, x.church, x.reason_kind, x.reason, when(x.updated_at || x.created_at), x.status, x.checked_by].map(q).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '불참이유서_' + (m ? String(m.meet_date) : today()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
  }
  function onClerkClick(ev) {
    var mb = ev.target.closest('button[data-abm]');
    if (mb) { C.cur = parseInt(mb.dataset.abm, 10); C.el.innerHTML = '<p style="color:var(--gray-5)">불러오는 중...</p>'; loadRows(); return; }
    var cb = ev.target.closest('button[data-abc]');
    if (cb) {
      if (cb.dataset.abc === 'reload') { loadRows(); return; }
      if (cb.dataset.abc === 'csv') { csv(); return; }
      if (cb.dataset.abc === 'copy') {
        copyText(summaryText()).then(function () { var e = document.getElementById('ab-msg'); if (e) { e.className = 'form-msg ok'; e.textContent = '복사했습니다. 회의록에 붙여 넣으세요.'; } },
          function () { var e = document.getElementById('ab-msg'); if (e) { e.className = 'form-msg err'; e.textContent = '복사하지 못했습니다.'; } });
      }
      return;
    }
    var xb = ev.target.closest('button[data-abx]');
    if (!xb || C.busy || !C.canCheck) return;
    C.busy = true; xb.disabled = true;
    var id = parseInt(xb.dataset.abx, 10), to = xb.dataset.to;
    db().then(function (c) {
      return c.from('absence_reasons').update({ status: to }).eq('id', id).select('id,status,checked_by,checked_at');
    }).then(function (r) {
      C.busy = false;
      if (r.error || !r.data || !r.data.length) { drawClerk('바꾸지 못했습니다' + (r.error ? ': ' + r.error.message : ' (2단계 인증 확인)'), true); return; }
      C.rows.forEach(function (x) { if (x.id === id) Object.assign(x, r.data[0]); });
      drawClerk(to === '확인' ? '확인 표시를 했습니다.' : '확인 표시를 거두었습니다.');
    }, function (e) { C.busy = false; drawClerk('바꾸지 못했습니다: ' + ((e && e.message) || e), true); });
  }

  return { dashCard: dashCard, mountClerk: mountClerk, eligible: eligible, isOpen: isOpen };
})();

/* 대시보드(허브가 있는 화면)에서는 스스로 붙는다 */
document.addEventListener('DOMContentLoaded', function () {
  if (!document.getElementById('dash-area') && !document.getElementById('db-area')) return;
  if (!(window.SHS && SHS.getUser)) return;
  SHS.getUser().then(function (u) { SHSAbsence.dashCard(u); }).catch(function () {});
});

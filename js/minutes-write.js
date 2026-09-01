/* =====================================================================
 *  회의록 작성 매니저 — 회록서기가 회의를 따라가며 회의록을 적는 화면
 *
 *  ① 회의 정보 → ② 개회예배 → ③ 회원점명 → ④ 회무처리 →
 *  ⑤ 폐회 · 별첨 → ⑥ 미리보기(복사 · 인쇄 · 회의록 목록에 올리기)
 *
 *  적는 동안의 내용은 presbytery_minutes.doc 에 통째로 담깁니다.
 *  글의 서식은 js/minutes-doc.js 가 맡습니다.
 * ===================================================================== */
document.addEventListener('DOMContentLoaded', function () {
 SHS.getUser().then(function (user) {
  var area = document.getElementById('mw-area');
  var e = SHS.esc;

  /* 회록서기(부회록서기 포함)와 노회장·서기·간사가 쓸 수 있다 */
  function isMinutesClerk(u) {
    if (!u) return false;
    if (SHSAuth.canManageMembers(u)) return true;
    return u.role === 'officer' && !!u.title && u.title.indexOf('회록서기') !== -1;
  }

  if (!user) {
    area.innerHTML = '<div class="notice-banner">회의록 작성 매니저는 <strong>회록서기</strong>가 ' +
      '이용하는 화면입니다. 로그인 후 이용해 주세요. ' +
      '<a class="btn sm" style="margin-left:10px" href="login.html">로그인</a></div>';
    return;
  }
  if (!isMinutesClerk(user)) {
    area.innerHTML = '<div class="notice-banner">회의록 작성 매니저는 <strong>회록서기 · 부회록서기</strong>와 ' +
      '노회장 · 서기 · 간사가 이용할 수 있습니다. ' +
      '현재 등급(' + SHS.displayRole(user.role, user.title) + ')으로는 열 수 없습니다.</div>';
    return;
  }
  if (!user.cloud || !window.SHSCloud || !SHSCloud.enabled()) {
    area.innerHTML = '<div class="notice-banner">회의록이 서버에 저장되므로 서버 로그인이 필요합니다. ' +
      '<a class="btn sm" style="margin-left:10px" href="login.html">로그인 화면으로</a></div>';
    return;
  }

  var canPublish = SHSAuth.canManageMembers(user);   /* 회의록 목록에 올리는 것은 서기·노회장 */
  function db() { return SHSCloud.init(); }
  function nowIso() { return new Date().toISOString(); }

  var rows = [];          /* 적어 둔 회의록들 */
  var sessions = [];      /* 노회 진행 매니저의 회의들 */
  var cur = null;         /* 지금 열어 둔 회의록 (표의 한 줄) */
  var doc = null;         /* 그 내용 */
  var step = 1;
  var HAS_TABLE = true;
  var rosterCnt = null;   /* 회원 명단에서 센 재적 {pt, et, vt} */

  var SICHALS = ((window.SHSData && SHSData.sichals) || []).map(function (s) { return s.name; });
  if (!SICHALS.length) SICHALS = ['북부시찰', '상록시찰', '남부시찰'];
  var BUSEO = ((window.SHSData && SHSData.committees) || []).map(function (c) { return c.name; });
  if (!BUSEO.length) BUSEO = ['감사헌의부', '정치부', '고시규칙부', '재정부'];

  /* ---------------- 값 넣고 빼기 ----------------
   * 'worship.hymn1' 처럼 점으로 이어진 자리를 읽고 쓴다. */
  function get(path) {
    var o = doc, p = path.split('.'), i;
    for (i = 0; i < p.length; i++) { if (o == null) return ''; o = o[p[i]]; }
    return o == null ? '' : o;
  }
  function set(path, v) {
    var o = doc, p = path.split('.'), i;
    for (i = 0; i < p.length - 1; i++) {
      if (o[p[i]] == null) o[p[i]] = {};
      o = o[p[i]];
    }
    o[p[p.length - 1]] = v;
  }

  /* 입력 칸 하나 */
  function fld(path, label, opt) {
    opt = opt || {};
    var id = 'f_' + path.replace(/\./g, '_');
    var w = opt.width ? 'flex:0 0 ' + opt.width : '';
    if (opt.type === 'textarea') {
      return '<div class="field" style="' + w + '"><label>' + e(label) + '</label>' +
        '<textarea id="' + id + '" data-path="' + path + '" rows="' + (opt.rows || 3) + '" ' +
        'placeholder="' + e(opt.ph || '') + '">' + e(get(path)) + '</textarea></div>';
    }
    if (opt.type === 'select') {
      return '<div class="field" style="' + w + '"><label>' + e(label) + '</label>' +
        '<select id="' + id + '" data-path="' + path + '">' +
        opt.options.map(function (o) {
          return '<option' + (String(get(path)) === o ? ' selected' : '') + '>' + e(o) + '</option>';
        }).join('') + '</select></div>';
    }
    if (opt.type === 'check') {
      return '<div class="field" style="' + w + '"><label>' + e(label) + '</label>' +
        '<label style="font-weight:400"><input type="checkbox" id="' + id + '" data-path="' + path + '"' +
        (get(path) ? ' checked' : '') + '> ' + e(opt.ph || '있음') + '</label></div>';
    }
    return '<div class="field" style="' + w + '"><label>' + e(label) + '</label>' +
      '<input type="' + (opt.type || 'text') + '" id="' + id + '" data-path="' + path + '" ' +
      'value="' + e(get(path)) + '" placeholder="' + e(opt.ph || '') + '"></div>';
  }

  /* 화면에 적힌 것을 문서로 거둬들인다 */
  function collect() {
    area.querySelectorAll('[data-path]').forEach(function (el) {
      set(el.dataset.path, el.type === 'checkbox' ? el.checked : el.value);
    });
    /* 회무처리 항목 */
    var box = document.getElementById('mw-items');
    if (box) {
      doc.items = [];
      box.querySelectorAll('[data-item]').forEach(function (row) {
        doc.items.push({
          type: row.querySelector('[data-it-type]').value,
          title: row.querySelector('[data-it-title]').value,
          who: (row.querySelector('[data-it-who]') || { value: '' }).value,
          body: (row.querySelector('[data-it-body]') || { value: '' }).value
        });
      });
    }
    /* 별첨 */
    var abox = document.getElementById('mw-attach');
    if (abox) {
      doc.attach = [];
      abox.querySelectorAll('[data-att]').forEach(function (row) {
        doc.attach.push({
          title: row.querySelector('[data-at-title]').value,
          body: row.querySelector('[data-at-body]').value
        });
      });
    }
  }

  /* ---------------- 불러오기 ---------------- */
  function load(openId) {
    db().then(function (c) {
      return Promise.all([
        c.from('presbytery_minutes').select('*')
          .order('meet_on', { ascending: false }).order('id', { ascending: false }),
        c.from('meeting_sessions').select('*')
          .order('meet_on', { ascending: false }).order('id', { ascending: false })
          .then(function (x) { return x; }, function () { return { data: [] }; }),
        /* 회원 명단 — 재적 수를 자동으로 채우기 위해 구분만 읽는다 */
        c.from('roster').select('category')
          .then(function (x) { return x; }, function () { return { data: [] }; })
      ]);
    }).then(function (rs) {
      if (rs[0].error) {
        HAS_TABLE = false;
        area.innerHTML = '<div class="notice-banner">회의록을 불러오지 못했습니다: ' +
          e(rs[0].error.message) +
          '<br><span style="font-size:0.85rem;color:var(--gray-5)">Supabase에서 ' +
          '<strong>64_minutes_manager.sql</strong>을 아직 실행하지 않으셨다면 먼저 실행해 주세요.</span></div>';
        return;
      }
      rows = rs[0].data || [];
      sessions = (rs[1] && rs[1].data) || [];
      /* 재적: 목사회원 = 목사·부목사·무임목사 / 장로회원 = 장로 /
       * 언권회원 = 원로목사·은퇴목사 (실제 회의록의 셈과 같다) */
      var cats = ((rs[2] && rs[2].data) || []).map(function (r) { return r.category; });
      if (cats.length) {
        rosterCnt = {
          pt: cats.filter(function (c) { return c === '목사' || c === '부목사' || c === '무임목사'; }).length,
          et: cats.filter(function (c) { return c === '장로'; }).length,
          vt: cats.filter(function (c) { return c === '원로목사' || c === '은퇴목사'; }).length
        };
      }
      if (openId) {
        cur = rows.filter(function (r) { return r.id === openId; })[0] || null;
      } else if (cur) {
        cur = rows.filter(function (r) { return r.id === cur.id; })[0] || null;
      }
      if (cur) { openDoc(cur); } else { drawList(); }
    });
  }

  /* 재적이 비어 있으면 회원 명단에서 센 수로 채운다 */
  function fillRoster(d) {
    if (!rosterCnt) return;
    if (!d.roll.pt) d.roll.pt = String(rosterCnt.pt);
    if (!d.roll.et) d.roll.et = String(rosterCnt.et);
    if (!d.roll.vt) d.roll.vt = String(rosterCnt.vt);
  }

  function openDoc(row) {
    cur = row;
    doc = Object.assign(SHSMinutes.blank(), row.doc || {});
    fillRoster(doc);
    step = 1;
    drawEdit();
  }

  /* ---------------- 목록 ---------------- */
  function drawList() {
    var h = '<p style="color:var(--gray-5);font-size:0.88rem">회의를 따라가며 회의록을 규격대로 적는 곳입니다. ' +
      '노회 진행 매니저에서 진행한 회의를 그대로 가져오면 순서와 처리 결과가 회무처리 항목으로 옮겨집니다.</p>';

    if (!rows.length) {
      h += '<p style="color:var(--gray-5)">적어 둔 회의록이 없습니다. 아래에서 새로 시작해 주세요.</p>';
    } else {
      h += '<table class="tbl"><thead><tr><th style="width:120px">날짜</th><th>회의록</th>' +
        '<th style="width:90px">상태</th><th style="width:150px">관리</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        h += '<tr><td>' + e(r.meet_on || '-') + '</td>' +
          '<td class="left"><strong>' + e(r.title) + '</strong></td>' +
          '<td><span class="mw-tag">' + e(r.status) + '</span></td>' +
          '<td><button class="btn sm" data-open="' + r.id + '">열기</button> ' +
          '<button class="btn danger sm" data-del="' + r.id + '">삭제</button></td></tr>';
      });
      h += '</tbody></table>';
    }

    h += '<div class="admin-card" style="margin-top:18px"><h3 style="margin-top:0">새 회의록 시작</h3>' +
      (sessions.length
        ? '<div class="field" style="max-width:520px"><label>노회 진행 매니저의 회의에서 가져오기</label>' +
          '<select id="mw-ns-session"><option value="">직접 적기</option>' +
          sessions.map(function (s) {
            return '<option value="' + s.id + '">' + e(s.title) +
              (s.meet_on ? ' — ' + e(s.meet_on) : '') + '</option>';
          }).join('') + '</select>' +
          '<p class="mw-hint">고르면 회의 이름 · 날짜 · 장소와 진행한 순서가 그대로 옮겨집니다. ' +
          '(<a href="proceed.html" style="text-decoration:underline">노회 진행 매니저</a>)</p></div>'
        : '<p class="mw-hint">노회 진행 매니저에 만들어 둔 회의가 없습니다. 직접 적으셔도 됩니다.</p>') +
      '<div class="inline-form">' +
      '<div class="field" style="flex:0 0 150px"><label>회의 종류</label><select id="mw-ns-kind">' +
      '<option>정기노회</option><option>임시노회</option></select></div>' +
      '<div class="field" style="flex:0 0 110px"><label>회기</label><input type="number" id="mw-ns-no"></div>' +
      '<div class="field" style="flex:0 0 110px"><label>차수 (임시)</label>' +
      '<input type="number" id="mw-ns-times" value="1"></div>' +
      '<div class="field" style="flex:0 0 170px"><label>회의 날짜</label>' +
      '<input type="date" id="mw-ns-date"></div>' +
      '<button class="btn" id="mw-ns-make" style="align-self:flex-end">회의록 시작</button>' +
      '</div><div class="form-msg" id="mw-ns-msg"></div></div>';

    area.innerHTML = h;
    bindList();
  }

  function bindList() {
    area.querySelectorAll('button[data-open]').forEach(function (b) {
      b.addEventListener('click', function () {
        openDoc(rows.filter(function (r) { return String(r.id) === b.dataset.open; })[0]);
      });
    });
    area.querySelectorAll('button[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = rows.filter(function (x) { return String(x.id) === b.dataset.del; })[0];
        if (!r) return;
        if (!confirm('"' + r.title + '"을 지우시겠습니까? 되돌릴 수 없습니다.')) return;
        db().then(function (c) {
          return c.from('presbytery_minutes').delete().eq('id', r.id);
        }).then(function (x) {
          if (x.error) { alert(x.error.message); return; }
          SHSCloud.log('delete', '회의록 초안 삭제', r.title);
          cur = null; load();
        });
      });
    });

    /* 진행 관리자의 회의를 고르면 회기 · 날짜를 채워 준다 */
    var ssel = document.getElementById('mw-ns-session');
    if (ssel) ssel.addEventListener('change', function () {
      var s = sessions.filter(function (x) { return String(x.id) === this.value; }.bind(this))[0];
      if (!s) return;
      if (s.session_no) document.getElementById('mw-ns-no').value = s.session_no;
      if (s.meet_on) document.getElementById('mw-ns-date').value = s.meet_on;
      document.getElementById('mw-ns-kind').value =
        /임시/.test(s.title || '') ? '임시노회' : '정기노회';
    });

    document.getElementById('mw-ns-make').addEventListener('click', function () {
      var msg = document.getElementById('mw-ns-msg');
      var sid = ssel ? ssel.value : '';
      var d = SHSMinutes.blank();
      d.kind = document.getElementById('mw-ns-kind').value;
      d.no = document.getElementById('mw-ns-no').value;
      d.times = document.getElementById('mw-ns-times').value || 1;
      d.meet_on = document.getElementById('mw-ns-date').value;
      /* 임원 명단에서 노회장 · 서기 · 회록서기를 채워 둔다 */
      ((window.SHSData && SHSData.officers) || []).forEach(function (o) {
        if (o.role === '노회장') d.moderator = SHSMinutes.withTitle(o.name, o.position);
        if (o.role === '서기') d.clerk = SHSMinutes.withTitle(o.name, o.position);
        if (o.role === '회록서기') d.minutes_clerk = SHSMinutes.withTitle(o.name, o.position);
      });
      fillRoster(d);
      if (!d.no) { msg.className = 'form-msg err'; msg.textContent = '회기를 적어 주세요.'; return; }
      msg.className = 'form-msg'; msg.textContent = '만드는 중입니다...';

      var work = Promise.resolve();
      if (sid) {
        work = db().then(function (c) {
          return c.from('meeting_items').select('*').eq('session_id', sid).order('sort').order('id');
        }).then(function (r) {
          var s = sessions.filter(function (x) { return String(x.id) === sid; })[0] || {};
          fromSession(d, s, (r && r.data) || []);
        });
      }
      work.then(function () {
        return db().then(function (c) {
          return c.from('presbytery_minutes').insert({
            session_id: sid ? Number(sid) : null,
            title: SHSMinutes.title(d), meet_on: d.meet_on || null,
            doc: d, created_by: user.name, updated_by: user.name
          }).select().single();
        });
      }).then(function (r) {
        if (r.error) { msg.className = 'form-msg err'; msg.textContent = r.error.message; return; }
        SHSCloud.log('create', '회의록 작성 시작', SHSMinutes.title(d));
        cur = null;
        load(r.data.id);
      });
    });
  }

  /* ---------------- 진행 관리자 → 회의록 ----------------
   * 진행한 순서를 회무처리 항목으로 옮긴다.
   * 시찰 · 상비부처럼 세부 체크가 있는 순서는 한 곳씩 나누어 적는다. */
  function fromSession(d, s, items) {
    if (s.place) d.church = s.place;
    /* 성수 보고(예: 목사 29/37 · 장로 16/26)에서 숫자를 읽어 온다 */
    if (s.quorum_note) {
      var pairs = String(s.quorum_note).match(/\d+\s*\/\s*\d+/g) || [];
      if (pairs[0]) {
        var a = pairs[0].split('/');
        d.roll.pp = a[0].trim(); d.roll.pt = a[1].trim();
      }
      if (pairs[1]) {
        var b = pairs[1].split('/');
        d.roll.ep = b[0].trim(); d.roll.et = b[1].trim();
      }
    }
    if (s.started_at) d.open_time = hhmmKo(s.started_at);
    if (s.ended_at) d.close.time = hhmmKo(s.ended_at);
    d.items = [];
    items.forEach(function (x) {
      if (x.status === '대기') return;          /* 다루지 않은 순서는 회의록에 적지 않는다 */
      var title = String(x.title || '');
      if (/개회예배|폐회예배|성찬/.test(title)) return;   /* 예배는 Ⅰ. 개회예배에 따로 적는다 */
      var checks = Array.isArray(x.checks) ? x.checks : [];
      if (checks.length) {
        checks.forEach(function (c) {
          if (!c.ok) return;
          d.items.push({ type: 'report', title: c.t + ' 보고',
            who: '서기', body: '' });
        });
        return;
      }
      var type = 'free';
      if (/회원점명|점명/.test(title)) type = 'roll';
      else if (/개회선언/.test(title)) type = 'declare';
      else if (/회순|회의순서/.test(title)) type = 'order';
      else if (/회의록|회록/.test(title)) type = 'adopt';
      else if (/보고/.test(title)) type = 'report';
      else if (/^정회/.test(title)) type = 'recess';
      else if (/^속회/.test(title)) type = 'resume';
      d.items.push({
        type: type, title: title,
        who: type === 'report' ? (x.leader || '서기') : '',
        body: x.status === '건너뜀' ? '다루지 않고 다음 회기로 넘기다.' : (x.result || '')
      });
    });
  }
  function hhmmKo(ts) {
    var dt = new Date(ts);
    var h = dt.getHours(), m = dt.getMinutes();
    return (h < 12 ? '오전 ' : '오후 ') + (h % 12 === 0 ? 12 : h % 12) + '시' +
      (m ? ' ' + m + '분' : '');
  }

  /* ---------------- 편집 화면 ---------------- */
  var STEPS = ['① 회의 정보', '② 개회예배', '③ 회원점명', '④ 회무처리', '⑤ 폐회 · 별첨', '⑥ 미리보기'];

  function drawEdit() {
    var h = '<div style="margin-bottom:12px"><button class="btn ghost sm" id="mw-back">&#8592; 회의록 목록</button></div>';
    h += '<div class="cm-head"><div class="cm-officers" style="align-items:center">' +
      '<span><strong>' + e(SHSMinutes.title(doc)) + '</strong></span>' +
      (doc.meet_on ? '<span>' + e(SHSMinutes.dateKo(doc.meet_on)) + '</span>' : '') +
      '<span class="mw-tag">' + e(cur.status) + '</span></div></div>';

    h += '<div class="mw-steps">' + STEPS.map(function (s, i) {
      return '<button data-step="' + (i + 1) + '"' + (step === i + 1 ? ' class="on"' : '') + '>' +
        e(s) + '</button>';
    }).join('') + '</div>';

    h += '<div class="admin-card">' + stepHtml() + '</div>';
    h += '<div style="margin-top:14px">' +
      '<button class="btn" id="mw-save">저장</button> ' +
      (step > 1 ? '<button class="btn ghost" id="mw-prev">&#8592; 앞 단계</button> ' : '') +
      (step < STEPS.length ? '<button class="btn ghost" id="mw-next">다음 단계 &#8594;</button>' : '') +
      '<span id="mw-msg" class="form-msg" style="margin-left:10px"></span></div>';

    area.innerHTML = h;
    bindEdit();
  }

  function stepHtml() {
    if (step === 1) {
      return '<h3 style="margin-top:0">① 회의 정보</h3>' +
        '<div class="inline-form">' +
        fld('kind', '회의 종류', { type: 'select', options: ['정기노회', '임시노회'], width: '150px' }) +
        fld('no', '회기', { type: 'number', width: '100px' }) +
        fld('times', '차수 (임시노회)', { type: 'number', width: '120px' }) +
        fld('meet_on', '회의 날짜', { type: 'date', width: '170px' }) +
        fld('open_time', '개회 시각', { width: '150px', ph: '오전 10시' }) +
        '</div>' +
        '<div class="inline-form">' +
        fld('church', '장소 (교회)', { width: '220px', ph: '섬기는교회' }) +
        fld('pastor', '그 교회 시무 목사', { width: '180px', ph: '김종수' }) +
        fld('tel', '전화', { width: '160px', ph: '031-356-6726' }) +
        '</div>' +
        '<div class="inline-form">' + fld('addr', '교회 주소', { ph: '경기도 화성시 수노을2로 15' }) + '</div>' +
        '<div class="inline-form">' +
        fld('moderator', '노회장', { width: '200px', ph: '박흥열' }) +
        fld('clerk', '서기', { width: '200px', ph: '권병렬' }) +
        fld('minutes_clerk', '회록서기', { width: '200px', ph: '김지수' }) +
        '</div>' +
        '<p class="mw-hint">이름만 적으시면 "○○○ 목사"로 붙습니다. 장로시면 "이신영 장로"처럼 직분까지 적어 주세요.</p>';
    }
    if (step === 2) {
      return '<h3 style="margin-top:0">② 개회예배</h3>' +
        '<div class="inline-form">' +
        fld('worship.from', '시작', { width: '150px', ph: '오전 10:00' }) +
        fld('worship.to', '마침', { width: '130px', ph: '10:30' }) +
        fld('worship.chair', '사회', { width: '240px', ph: '노회장 박흥열 목사' }) +
        fld('worship.end_time', '예배 마친 시각', { width: '170px', ph: '오전 11시 10분' }) +
        '</div>' +
        '<div class="inline-form">' +
        fld('worship.hymn1', '찬송 (첫째)', { width: '260px', ph: '35장(큰 영화로신 주)' }) +
        fld('worship.prayer', '기도', { width: '240px', ph: '부노회장 이신영 장로' }) +
        '</div>' +
        '<div class="inline-form">' +
        fld('worship.scripture', '성경봉독', { ph: '로마서 1:17 / 서기 권병렬 목사' }) +
        '</div>' +
        '<div class="inline-form">' +
        fld('worship.sermon', '설교 (제목 / 설교자)', { ph: '오직 믿음으로 / 노회장 박흥열 목사' }) +
        '</div>' +
        '<div class="inline-form">' +
        fld('worship.hymn2', '찬송 (둘째)', { width: '260px', ph: '292장(주 없이 살수 없네)' }) +
        fld('worship.benediction', '축도', { width: '260px', ph: '증경노회장 박양수 목사' }) +
        '</div>' +
        '<h3>성찬예식 (봄 정기노회)</h3>' +
        '<div class="inline-form">' +
        fld('communion.on', '성찬예식', { type: 'check', ph: '있었음', width: '140px' }) +
        fld('communion.from', '시작', { width: '140px', ph: '오전 10:40' }) +
        fld('communion.to', '마침', { width: '120px', ph: '11:10' }) +
        fld('communion.chair', '집례', { width: '240px', ph: '김종수 목사(증경 북부시찰장)' }) +
        '</div>' +
        '<div class="inline-form">' +
        fld('communion.hymn1', '찬송', { width: '240px' }) +
        fld('communion.prayer', '기도', { width: '220px' }) +
        fld('communion.scripture', '성경봉독', { width: '260px' }) +
        '</div>' +
        '<div class="inline-form">' +
        fld('communion.sermon', '설교 (제목 / 설교자)', {}) +
        '</div>' +
        '<div class="inline-form">' +
        fld('communion.bread', '분병 위원', { width: '260px', ph: '윤성복 김득철 김완수' }) +
        fld('communion.cup', '분잔 위원', { width: '260px', ph: '정재영 이신영 김동수' }) +
        fld('communion.hymn2', '찬송 (마침)', { width: '220px' }) +
        '</div>';
    }
    if (step === 3) {
      return '<h3 style="margin-top:0">③ 회원점명 · 회무처리 시작</h3>' +
        '<div class="inline-form">' +
        fld('business.time', '회무처리 시작 시각', { width: '190px', ph: '오전 11시 25분' }) +
        fld('business.hymn', '찬송', { width: '240px', ph: '309장(목마른 내 영혼)' }) +
        fld('business.prayer', '기도', { width: '260px', ph: '상록시찰장 손영득 목사' }) +
        '</div>' +
        '<h3>출석</h3>' +
        (rosterCnt
          ? '<p class="mw-hint">재적은 회원 명단에서 자동으로 가져왔습니다 — 목사회원 ' + rosterCnt.pt +
            '명(목사·부목사·무임목사) · 장로회원 ' + rosterCnt.et + '명 · 언권회원 ' + rosterCnt.vt +
            '명(원로·은퇴). 다르면 고쳐 적으세요.</p>'
          : '') +
        '<div class="inline-form">' +
        fld('roll.pt', '목사회원 재적', { type: 'number', width: '140px' }) +
        fld('roll.pp', '목사회원 출석', { type: 'number', width: '140px' }) +
        fld('roll.et', '장로회원 재적', { type: 'number', width: '140px' }) +
        fld('roll.ep', '장로회원 출석', { type: 'number', width: '140px' }) +
        fld('roll.vt', '언권회원 재적', { type: 'number', width: '140px' }) +
        fld('roll.vp', '언권회원 출석', { type: 'number', width: '140px' }) +
        '</div>' +
        '<p class="mw-hint">' + e(SHSMinutes.sentences.roll(doc)) + '</p>' +
        '<h3>참석자 명단</h3>' +
        '<div class="inline-form">' +
        fld('roll.pastors', '목사회원', { type: 'textarea', rows: 3, ph: '이름을 띄어쓰기로 적습니다' }) +
        fld('roll.assoc', '부목사', { type: 'textarea', rows: 3 }) +
        '</div>' +
        '<div class="inline-form">' +
        fld('roll.elders', '장로총대', { type: 'textarea', rows: 3 }) +
        fld('roll.emeritus', '원로 목사 (언권회원)', { type: 'textarea', rows: 2 }) +
        fld('roll.retired', '은퇴 목사 (언권회원)', { type: 'textarea', rows: 2 }) +
        '</div>';
    }
    if (step === 4) return step4();
    if (step === 5) {
      var att = doc.attach || [];
      var h = '<h3 style="margin-top:0">⑤ 폐회</h3>' +
        '<div class="inline-form">' +
        fld('close.prayer', '폐회기도', { width: '260px', ph: '남부시찰장 김성중 목사' }) +
        fld('close.time', '폐회 시각', { width: '180px', ph: '오후 5시 20분' }) +
        '</div>' +
        '<div class="inline-form">' + fld('close.decision', '폐회 결의', { ph: '미진안건 처리는 임원회에 맡기기로 하고 폐회하기로 하다.' }) + '</div>' +
        '<p class="mw-hint">' + e(SHSMinutes.sentences.closeQuote(doc)) + '</p>' +
        '<h3>별첨</h3><div id="mw-attach">';
      att.forEach(function (a, i) {
        h += '<div class="mw-row" data-att="' + i + '">' +
          '<div class="inline-form"><div class="field"><label>별첨' + (i + 1) + ' 제목</label>' +
          '<input type="text" data-at-title value="' + e(a.title || '') + '"></div>' +
          '<button class="btn ghost sm" data-att-rm="' + i + '" style="align-self:flex-end">지우기</button></div>' +
          '<div class="field"><label>내용</label><textarea data-at-body rows="5">' + e(a.body || '') + '</textarea></div>' +
          '</div>';
      });
      h += '</div><button class="btn ghost sm" id="mw-att-add">별첨 더하기</button>';
      return h;
    }
    /* ⑥ 미리보기 */
    var miss = SHSMinutes.missing(doc);
    return '<h3 style="margin-top:0">⑥ 미리보기</h3>' +
      (miss.length
        ? '<div class="notice-banner" style="border-color:#d9a33b">아직 비어 있는 곳: <strong>' +
          e(miss.join(', ')) + '</strong></div>'
        : '<div class="notice-banner">규격에 필요한 곳이 모두 채워졌습니다.</div>') +
      '<div style="margin-bottom:12px">' +
      '<button class="btn sm" id="mw-copy">글 복사 (한글에 붙여넣기)</button> ' +
      '<button class="btn ghost sm" id="mw-print-btn">인쇄 · PDF</button> ' +
      (canPublish
        ? '<button class="btn sm" id="mw-publish">회의록 목록에 올리기</button>'
        : '<span class="mw-hint" style="margin-left:8px">회의록 목록 등록은 서기 · 노회장이 합니다.</span>') +
      '</div>' + SHSMinutes.html(doc);
  }

  /* ---------------- ④ 회무처리 ---------------- */
  var TYPES = [
    ['roll', '회원점명 (문장 자동)'],
    ['declare', '개회선언 (문장 자동)'],
    ['order', '회의순서 채택 (문장 자동)'],
    ['report', '부서 · 시찰 보고 (문장 자동)'],
    ['adopt', '회의록 채택 (문장 자동)'],
    ['recess', '정회'],
    ['resume', '속회'],
    ['free', '직접 적기']
  ];

  function step4() {
    var h = '<h3 style="margin-top:0">④ 회무처리</h3>' +
      '<p class="mw-hint">회의에서 다룬 차례대로 항목을 놓습니다. 갈래를 고르면 회의록 문장이 저절로 지어지고, ' +
      '보탤 말은 본문에 적으시면 그대로 이어 붙습니다. (정회 · 속회는 번호 없이 적힙니다)</p>' +
      '<div style="margin:10px 0">' +
      '<button class="btn ghost sm" id="mw-add-basic">기본 순서 넣기</button> ' +
      '<button class="btn ghost sm" id="mw-add-sichal">시찰 보고 ' + SICHALS.length + '개 넣기</button> ' +
      '<button class="btn ghost sm" id="mw-add-buseo">상비부 보고 ' + BUSEO.length + '개 넣기</button> ' +
      '<button class="btn ghost sm" id="mw-add-one">항목 하나 더하기</button>' +
      (cur.session_id ? ' <button class="btn ghost sm" id="mw-from-session">노회 진행 매니저에서 다시 가져오기</button>' : '') +
      '</div><div id="mw-items">';

    (doc.items || []).forEach(function (it, i) {
      h += '<div class="mw-row" data-item="' + i + '">' +
        '<div class="inline-form" style="margin-bottom:4px">' +
        '<div class="field" style="flex:0 0 220px"><label>갈래</label><select data-it-type>' +
        TYPES.map(function (t2) {
          return '<option value="' + t2[0] + '"' + (it.type === t2[0] ? ' selected' : '') + '>' +
            e(t2[1]) + '</option>';
        }).join('') + '</select></div>' +
        '<div class="field"><label>항목 이름</label>' +
        '<input type="text" data-it-title value="' + e(it.title || '') + '" placeholder="예: 정치부 보고 (회의순서 p.40)"></div>' +
        '<div class="field" style="flex:0 0 200px"><label>보고자</label>' +
        '<input type="text" data-it-who value="' + e(it.who || '') + '" placeholder="서기 김동석 목사"></div>' +
        '<div style="align-self:flex-end;white-space:nowrap">' +
        '<button class="btn ghost sm" data-it-up="' + i + '">&#8593;</button>' +
        '<button class="btn ghost sm" data-it-down="' + i + '">&#8595;</button> ' +
        '<button class="btn danger sm" data-it-rm="' + i + '">삭제</button></div>' +
        '</div>' +
        '<div class="field"><label>본문 (자동 문장 뒤에 이어 붙습니다 — 안건별 처리 결과를 줄마다 적으세요)</label>' +
        '<textarea data-it-body rows="3" placeholder="1 반월교회 당회장 김지수씨가 제출한 노종한씨 장로고시 추천 청원은 가결하다">' +
        e(it.body || '') + '</textarea></div>' +
        '<p class="mw-hint">' + e(SHSMinutes.itemBody(doc, it).split('\n')[0] || '') + '</p>' +
        '</div>';
    });
    if (!(doc.items || []).length) {
      h += '<p style="color:var(--gray-5)">항목이 없습니다. 위의 <strong>기본 순서 넣기</strong>로 시작해 보세요.</p>';
    }
    return h + '</div>';
  }

  function addItems(list) {
    collect();
    doc.items = (doc.items || []).concat(list);
    drawEdit();
  }

  /* ---------------- 이어 붙이기 ---------------- */
  function bindEdit() {
    document.getElementById('mw-back').addEventListener('click', function () {
      collect(); save(function () { cur = null; load(); });
    });
    area.querySelectorAll('button[data-step]').forEach(function (b) {
      b.addEventListener('click', function () {
        collect();
        step = Number(b.dataset.step);
        drawEdit();
      });
    });
    var el;
    if ((el = document.getElementById('mw-prev'))) el.addEventListener('click', function () {
      collect(); step--; drawEdit();
    });
    if ((el = document.getElementById('mw-next'))) el.addEventListener('click', function () {
      collect(); step++; drawEdit();
    });
    document.getElementById('mw-save').addEventListener('click', function () {
      collect();
      save(function () {
        var m = document.getElementById('mw-msg');
        if (m) { m.className = 'form-msg ok'; m.textContent = '저장했습니다.'; }
      });
    });

    /* ④ 회무처리 */
    if ((el = document.getElementById('mw-add-basic'))) el.addEventListener('click', function () {
      addItems([
        { type: 'roll', title: '회원점명', who: '', body: '' },
        { type: 'declare', title: '개회선언', who: '', body: '' },
        { type: 'order', title: '회의순서보고 (회의순서 p.3)', who: '', body: '' },
        { type: 'free', title: '광고 · 지시 위원 선정', who: '', body: '' },
        { type: 'adopt', title: '회의록 채택', who: '', body: '' }
      ]);
    });
    if ((el = document.getElementById('mw-add-sichal'))) el.addEventListener('click', function () {
      addItems(SICHALS.map(function (s) {
        return { type: 'report', title: s + ' 보고', who: '서기', body: '' };
      }));
    });
    if ((el = document.getElementById('mw-add-buseo'))) el.addEventListener('click', function () {
      addItems(BUSEO.map(function (s) {
        return { type: 'report', title: s + ' 보고', who: '서기', body: '' };
      }));
    });
    if ((el = document.getElementById('mw-add-one'))) el.addEventListener('click', function () {
      addItems([{ type: 'free', title: '', who: '', body: '' }]);
    });
    if ((el = document.getElementById('mw-from-session'))) el.addEventListener('click', function () {
      if (!confirm('진행 관리자의 순서로 회무처리 항목을 다시 채웁니다. 지금 적어 둔 항목은 지워집니다.')) return;
      collect();
      db().then(function (c) {
        return c.from('meeting_items').select('*').eq('session_id', cur.session_id)
                .order('sort').order('id');
      }).then(function (r) {
        var s = sessions.filter(function (x) { return x.id === cur.session_id; })[0] || {};
        fromSession(doc, s, (r && r.data) || []);
        drawEdit();
      });
    });
    area.querySelectorAll('button[data-it-rm]').forEach(function (b) {
      b.addEventListener('click', function () {
        collect();
        doc.items.splice(Number(b.dataset.itRm), 1);
        drawEdit();
      });
    });
    function move(i, dir) {
      collect();
      var j = i + dir;
      if (j < 0 || j >= doc.items.length) return;
      var tmp = doc.items[i]; doc.items[i] = doc.items[j]; doc.items[j] = tmp;
      drawEdit();
    }
    area.querySelectorAll('button[data-it-up]').forEach(function (b) {
      b.addEventListener('click', function () { move(Number(b.dataset.itUp), -1); });
    });
    area.querySelectorAll('button[data-it-down]').forEach(function (b) {
      b.addEventListener('click', function () { move(Number(b.dataset.itDown), 1); });
    });

    /* ⑤ 별첨 */
    if ((el = document.getElementById('mw-att-add'))) el.addEventListener('click', function () {
      collect();
      doc.attach = (doc.attach || []).concat([{ title: '', body: '' }]);
      drawEdit();
    });
    area.querySelectorAll('button[data-att-rm]').forEach(function (b) {
      b.addEventListener('click', function () {
        collect();
        doc.attach.splice(Number(b.dataset.attRm), 1);
        drawEdit();
      });
    });

    /* ⑥ 미리보기 */
    if ((el = document.getElementById('mw-copy'))) el.addEventListener('click', function () {
      var txt = SHSMinutes.text(doc);
      var ta = document.createElement('textarea');
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (x) {}
      if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(function () {});
      document.body.removeChild(ta);
      this.textContent = '복사됨';
    });
    if ((el = document.getElementById('mw-print-btn'))) el.addEventListener('click', function () {
      document.getElementById('mw-print').innerHTML = SHSMinutes.html(doc);
      window.print();
    });
    if ((el = document.getElementById('mw-publish'))) el.addEventListener('click', function () {
      if (!confirm('회의록 목록(임원방 → 회의록)에 올리시겠습니까?')) return;
      var m = document.getElementById('mw-msg');
      db().then(function (c) {
        return c.from('minutes_board').insert({
          title: SHSMinutes.title(doc),
          meeting_date: doc.meet_on || null,
          body: SHSMinutes.text(doc)
        }).select();
      }).then(function (r) {
        var w = SHS.wrote(r);
        if (!w.ok) { if (m) { m.className = 'form-msg err'; m.textContent = w.why; } return; }
        SHSCloud.log('create', '회의록 등록', SHSMinutes.title(doc));
        save(function () {
          if (m) { m.className = 'form-msg ok'; m.textContent = '회의록 목록에 올렸습니다.'; }
        }, '등록');
      });
    });
  }

  /* ---------------- 저장 ---------------- */
  function save(then, status) {
    var patch = {
      title: SHSMinutes.title(doc), meet_on: doc.meet_on || null, doc: doc,
      updated_at: nowIso(), updated_by: user.name
    };
    if (status) patch.status = status;
    db().then(function (c) {
      return c.from('presbytery_minutes').update(patch).eq('id', cur.id).select();
    }).then(function (r) {
      var w = SHS.wrote(r);
      if (!w.ok) { alert(w.why); return; }
      cur = r.data[0];
      if (then) then();
    });
  }

  load();
 });
});

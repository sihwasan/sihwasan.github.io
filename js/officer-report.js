/* 임원 업무 보고서 화면 (officer-report.html)
 *
 * 매일 아침 6시 창구(cloudflare/ai/src/reports.js)가 임원마다 직책별 보고서를 써서 ai_reports 에 둔다 (128 sql).
 *   · 임원은 자기 보고서만, 노회장·서기·최고관리자는 모든 임원의 보고서를 본다 (서버 RLS — ai_report_reader).
 *   · 보고서의 「오늘 할 일」마다 「연락하기」: 받는 분 이름·문안을 고쳐 홈페이지 알림(rpc ai_task_notify)으로 보내거나
 *     문자용으로 복사한다. 전화번호는 회원 명단에서 찾아 바로 걸 수 있게 한다.
 *   · 「할 일」 탭: 회의록·결의에서 나온 일(ai_tasks)을 부서별로 끝날 때까지 챙긴다 — 상태 바꾸기·직접 등록,
 *     지우기는 노회장·서기만. 다른 임원은 자기 직무의 할 일만 고친다 (서버가 ai_task_can_edit 으로 판정).
 *   · 노회장·서기·최고관리자는 「지금 다시 만들기」로 창구에 바로 시킬 수 있다 (POST /reports/run, SSE).
 *
 * 화면: SHSOReport.mount(자리, 이용자)
 */
var SHSOReport = (function () {
  var WORKER = window.SHS_AI_URL || 'https://sihwasan-ai.sihwasan.workers.dev';
  var OFFICER_ROLES = ['superadmin', 'president', 'clerk', 'staff', 'officer'];
  var READER_ROLES = ['superadmin', 'president', 'clerk'];
  var OWNER_NAME = { president: '노회장', clerk: '서기', treasurer: '회계', minutes: '회록서기', staff: '간사', officer: '임원' };
  var DUTY_OWNER = { president: 'president', vice_president: 'president', clerk: 'clerk', vice_clerk: 'clerk',
    treasurer: 'treasurer', minutes: 'minutes', staff: 'staff', officer: 'officer' };
  var STATUSES = ['할 일', '진행 중', '연락함', '완료', '해당 없음'];
  var OPEN = ['할 일', '진행 중', '연락함'];
  var KINDS = ['상비부', '시찰', '기관', '교회', '임원', '회원', '기타'];

  var box = null, user = null, reader = false;
  var S = { tab: 'rep', list: [], date: null, pick: null, rep: null, tasks: [], tf: 'open', towner: '', phones: {}, busy: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function db() { return SHSCloud.init(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return ymd(new Date()); }
  function dayLabel(s) {
    var d = new Date(s + 'T00:00:00'), t = new Date(todayStr() + 'T00:00:00');
    var diff = Math.round((t - d) / 864e5);
    var w = '일월화수목금토'.charAt(d.getDay());
    return (diff === 0 ? '오늘' : diff === 1 ? '어제' : (d.getMonth() + 1) + '/' + d.getDate()) + ' (' + w + ')';
  }
  function dday(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return '';
    var n = Math.round((new Date(s + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 864e5);
    return n === 0 ? '오늘까지' : n > 0 ? 'D-' + n : Math.abs(n) + '일 지남';
  }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  /* 이 분이 고칠 수 있는 할 일 담당 (서버 ai_task_can_edit 과 같은 판정 — 화면에서 단추를 보일지만 정한다) */
  function canEdit(owner) {
    if (reader) return true;
    var t = String(user.title || '').trim();
    return owner === 'officer' ||
      (owner === 'treasurer' && (t === '회계' || t === '부회계')) ||
      (owner === 'minutes' && (t === '회록서기' || t === '회록부서기' || t === '부회록서기')) ||
      (owner === 'staff' && user.role === 'staff') ||
      (owner === 'clerk' && t === '부서기') ||
      (owner === 'president' && t === '부노회장');
  }
  function myOwner() {
    if (user.role === 'president') return 'president';
    if (user.role === 'clerk' || user.role === 'superadmin') return 'clerk';
    if (user.role === 'staff') return 'staff';
    var t = String(user.title || '').trim();
    if (t === '회계' || t === '부회계') return 'treasurer';
    if (t === '회록서기' || t === '회록부서기' || t === '부회록서기') return 'minutes';
    if (t === '부서기') return 'clerk';
    if (t === '부노회장') return 'president';
    return 'officer';
  }
  function msg(el, ok, text) {
    if (!el) return;
    el.className = 'form-msg ' + (ok ? 'ok' : 'err');
    el.textContent = text;
  }

  /* ---------- 화면 틀 ---------- */
  function mount(el, u) {
    box = el; user = u;
    if (!box) return;
    if (!u) { box.innerHTML = '<div class="notice-banner">임원 업무 보고서는 로그인한 <strong>임원</strong>이 볼 수 있습니다. <a class="btn sm" style="margin-left:10px" href="login.html">로그인</a></div>'; return; }
    if (OFFICER_ROLES.indexOf(u.role) === -1) {
      box.innerHTML = '<div class="notice-banner">임원 업무 보고서는 <strong>노회 임원</strong>이 볼 수 있습니다. (현재 등급: ' + esc(SHS.displayRole(u.role, u.title)) + ')</div>';
      return;
    }
    if (!u.cloud) { box.innerHTML = '<div class="notice-banner">서버 로그인(구글 또는 이메일) 후 이용할 수 있습니다.</div>'; return; }
    reader = READER_ROLES.indexOf(u.role) !== -1;
    box.innerHTML =
      '<p class="or-lead">매일 아침 6시, AI 가 노회 자료(회의록·결의·회칙·일정·회계·서류)를 살펴 임원마다 직책에 맞는 보고서를 씁니다. ' +
      (reader ? '노회장·서기는 모든 임원의 보고서를 볼 수 있습니다.' : '내 보고서는 나와 노회장·서기만 봅니다.') +
      ' 내용은 AI 가 정리한 것이니 중요한 일은 원자료로 확인해 주세요.</p>' +
      '<div class="tabs" id="or-tabs" role="tablist">' +
      '<button type="button" role="tab" data-tab="rep" class="active">보고서</button>' +
      '<button type="button" role="tab" data-tab="task">할 일<span class="or-n" id="or-task-n"></span></button></div>' +
      '<div id="or-rep"></div><div id="or-task" hidden></div>';
    box.addEventListener('click', onClick);
    box.addEventListener('submit', onSubmit);
    box.addEventListener('change', onChange);
    box.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { var p = ev.target.closest && ev.target.closest('.or-contact'); if (p) { ev.preventDefault(); closeContact(p); } }
    });
    window.addEventListener('beforeunload', function (ev) {
      var dirty = box.querySelector('.or-contact[data-dirty="1"], .or-add[data-dirty="1"]');
      if (dirty) { ev.preventDefault(); ev.returnValue = ''; }
    });
    box.addEventListener('input', function (ev) {
      var f = ev.target.closest('.or-contact, .or-add');
      if (f) f.dataset.dirty = '1';
    });
    if (location.hash === '#tasks') showTab('task');
    loadAll();
  }

  function showTab(t) {
    S.tab = t;
    box.querySelectorAll('#or-tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'); });
    box.querySelector('#or-rep').hidden = t !== 'rep';
    box.querySelector('#or-task').hidden = t !== 'task';
    try { history.replaceState(null, '', t === 'task' ? '#tasks' : location.pathname + location.search); } catch (e) {}
    if (t === 'task') drawTasks();
  }

  /* ---------- 불러오기 ---------- */
  function loadAll() {
    var rep = box.querySelector('#or-rep');
    rep.innerHTML = '<p class="or-muted">보고서를 불러오는 중...</p>';
    var since = ymd(new Date(Date.now() - 20 * 864e5));
    db().then(function (c) {
      return Promise.all([
        c.from('ai_reports').select('id,report_date,user_id,name,role,title,duty,headline,created_at,model')
          .gte('report_date', since).order('report_date', { ascending: false }).order('name').limit(400),
        loadTasks(c),
        reader ? c.rpc('ai_report_last_run') : Promise.resolve({ data: null })
      ]);
    }).then(function (rs) {
      if (rs[0].error) {
        rep.innerHTML = /relation|does not exist|schema cache|PGRST20/.test(rs[0].error.message || '')
          ? '<div class="notice-banner">보고서 표가 아직 없습니다. <code>supabase/128_officer_reports.sql</code> 을 Supabase SQL Editor 에서 실행해야 합니다.</div>'
          : '<div class="notice-banner">보고서를 불러오지 못했습니다: ' + esc(rs[0].error.message) + '</div>';
        return;
      }
      S.list = rs[0].data || [];
      S.lastRun = rs[2] && rs[2].data;
      var dates = dates0();
      if (!S.date || dates.indexOf(S.date) === -1) S.date = dates[0] || null;
      var mine = S.list.filter(function (r) { return r.report_date === S.date && r.user_id === user.id; })[0];
      if (!S.pick || !S.list.some(function (r) { return r.id === S.pick; })) {
        var first = mine || S.list.filter(function (r) { return r.report_date === S.date; })[0];
        S.pick = first ? first.id : null;
      }
      drawRep();
      openReport(S.pick);
    });
  }
  function loadTasks(c) {
    return (c ? Promise.resolve(c) : db()).then(function (cc) {
      return cc.from('ai_tasks').select('*').order('due_date', { ascending: true, nullsFirst: false }).order('id').limit(500);
    }).then(function (r) {
      if (r.error) { S.tasksErr = r.error.message; S.tasks = []; }
      else { S.tasksErr = ''; S.tasks = r.data || []; }
      var n = S.tasks.filter(function (t) { return OPEN.indexOf(t.status) !== -1; }).length;
      var el = box.querySelector('#or-task-n'); if (el) el.textContent = n ? String(n) : '';
      return r;
    });
  }
  function dates0() {
    var seen = {}, out = [];
    S.list.forEach(function (r) { if (!seen[r.report_date]) { seen[r.report_date] = 1; out.push(r.report_date); } });
    return out.slice(0, 14);
  }

  /* ---------- 보고서 탭 ---------- */
  function drawRep() {
    var rep = box.querySelector('#or-rep');
    var dates = dates0();
    var h = '';
    if (reader) {
      var lr = S.lastRun;
      h += '<div class="or-run"><div class="or-run-t">' +
        (lr ? '마지막 실행: ' + esc(when(lr.finished_at || lr.started_at)) + ' · ' + (lr.trigger === 'cron' ? '매일 아침 예약' : '수동' + (lr.by ? ' (' + esc(lr.by) + ')' : '')) +
          ' · 보고서 ' + (lr.reports || 0) + '건' + (lr.new_tasks ? ' · 새 할 일 ' + lr.new_tasks + '건' : '') +
          (lr.errors && lr.errors.length ? ' · <span class="or-bad">오류 ' + lr.errors.length + '건</span>' : '')
          : '아직 실행 기록이 없습니다. 매일 아침 6시에 저절로 만들어집니다.') + '</div>' +
        '<button type="button" class="btn sm" id="or-run-all">지금 다시 만들기</button></div>' +
        '<div class="or-progress" id="or-progress" hidden></div>' +
        (lr && lr.errors && lr.errors.length ? '<details class="or-errs"><summary>오류 보기</summary><ul>' +
          lr.errors.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>' : '');
    }
    if (!dates.length) {
      rep.innerHTML = h + '<p class="or-empty">아직 보고서가 없습니다. 매일 아침 6시에 만들어지며, 만들어지면 여기와 대시보드에 나타납니다.' +
        (reader ? ' 지금 바로 보려면 위의 「지금 다시 만들기」를 눌러 주세요 (몇 분 걸립니다).' : '') + '</p>';
      return;
    }
    h += '<div class="or-chips" id="or-dates" aria-label="날짜">' + dates.map(function (d) {
      return '<button type="button" data-date="' + d + '"' + (d === S.date ? ' class="on"' : '') + '>' + esc(dayLabel(d)) + '</button>';
    }).join('') + '</div>';
    var day = S.list.filter(function (r) { return r.report_date === S.date; });
    if (reader && day.length) {
      h += '<div class="or-chips or-people" id="or-people" aria-label="임원">' + day.map(function (r) {
        return '<button type="button" data-pick="' + r.id + '"' + (r.id === S.pick ? ' class="on"' : '') + '>' +
          esc(r.title || '') + ' ' + esc(r.name || '') + (r.user_id === user.id ? ' (나)' : '') + '</button>';
      }).join('') + '</div>';
    }
    if (!day.some(function (r) { return r.user_id === user.id; }) && !reader) {
      h += '<p class="or-empty">이 날은 내 보고서가 없습니다.</p>';
    }
    h += '<div id="or-view"></div>';
    rep.innerHTML = h;
  }

  function openReport(id) {
    var view = box.querySelector('#or-view');
    if (!view) return;
    if (!id) { view.innerHTML = ''; return; }
    view.innerHTML = '<p class="or-muted">여는 중...</p>';
    db().then(function (c) { return c.from('ai_reports').select('*').eq('id', id).single(); }).then(function (r) {
      if (r.error || !r.data) { view.innerHTML = '<div class="notice-banner">보고서를 열지 못했습니다: ' + esc(r.error && r.error.message) + '</div>'; return; }
      S.rep = r.data;
      drawReport();
    });
  }
  function taskOf(todo) {
    if (todo.task_id) { var t = S.tasks.filter(function (x) { return x.id === todo.task_id; })[0]; if (t) return t; }
    return S.tasks.filter(function (x) { return x.title === todo.title; })[0] || null;
  }
  function drawReport() {
    var view = box.querySelector('#or-view');
    var r = S.rep, c = r.content || {};
    var h = '<article class="or-report">' +
      '<div class="or-head"><div class="or-who">' + esc(r.title || '') + ' ' + esc(r.name || '') + ' · ' + esc(dayLabel(r.report_date)) + '</div>' +
      '<h2 class="or-hl">' + esc(c.headline || r.headline || '') + '</h2>' +
      '<div class="or-meta">' + esc(when(r.created_at)) + ' 작성' + (reader ? ' · <button type="button" class="or-link" data-run-one="' + esc(r.user_id) + '">이 분 것만 다시 만들기</button>' : '') + '</div></div>';
    (c.sections || []).forEach(function (s) {
      h += '<section class="or-sec"><h3>' + esc(s.title) + '</h3><ul>' + (s.items || []).map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></section>';
    });
    if ((c.checks || []).length) {
      h += '<section class="or-sec or-checks"><h3>고칠 점</h3><ul>' + c.checks.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></section>';
    }
    var todos = c.todos || [];
    h += '<section class="or-sec"><h3>오늘 할 일 <small>' + todos.length + '건</small></h3>';
    if (!todos.length) h += '<p class="or-muted">오늘 따로 할 일은 없습니다.</p>';
    todos.forEach(function (t, i) {
      var task = taskOf(t);
      var dd = dday(t.due);
      h += '<div class="or-todo" data-i="' + i + '">' +
        '<div class="or-todo-top"><span class="or-pri or-pri-' + (t.priority === '높음' ? 'hi' : t.priority === '낮음' ? 'lo' : 'mid') + '">' + esc(t.priority || '보통') + '</span>' +
        '<strong class="or-todo-t">' + esc(t.title) + '</strong>' +
        (dd ? '<span class="or-due' + (/지남/.test(dd) ? ' late' : '') + '">' + esc(dd) + '</span>' : '') + '</div>' +
        (t.target_name || t.target_kind ? '<div class="or-todo-m">' + esc([t.target_kind, t.target_name].filter(Boolean).join(' · ')) +
          (t.contact_name ? ' · 연락: ' + esc(t.contact_name) : '') + '</div>' : '') +
        (t.detail ? '<p class="or-todo-d">' + esc(t.detail) + '</p>' : '') +
        '<div class="or-acts">' +
        (t.contact_name || t.message ? '<button type="button" class="btn sm" data-contact="' + i + '">연락하기</button>' : '') +
        (task ? '<span class="or-st or-st-' + stCls(task.status) + '">할 일 목록: ' + esc(task.status) + '</span>' +
            (OPEN.indexOf(task.status) !== -1 && canEdit(task.owner) ? '<button type="button" class="btn ghost sm" data-done="' + task.id + '">완료</button>' : '')
          : '<button type="button" class="btn ghost sm" data-addtodo="' + i + '">할 일 목록에 넣기</button>') +
        '<span class="form-msg" role="status"></span></div>' +
        '<div class="or-contact-host"></div></div>';
    });
    h += '</section></article>';
    view.innerHTML = h;
  }
  function stCls(s) { return { '할 일': 'todo', '진행 중': 'doing', '연락함': 'sent', '완료': 'done', '해당 없음': 'na' }[s] || 'todo'; }

  /* ---------- 연락하기 (홈페이지 알림 · 문자용 복사 · 전화) ---------- */
  function openContact(host, init) {
    if (host.querySelector('.or-contact')) return;
    var names = String(init.names || '').trim();
    host.innerHTML = '<form class="or-contact" autocomplete="off">' +
      '<div class="field"><label>받는 분 <small>(이름, 여러 분이면 쉼표로)</small></label><input type="text" name="names" maxlength="200" value="' + esc(names) + '"></div>' +
      '<div class="or-phone" aria-live="polite"></div>' +
      '<div class="field"><label>제목</label><input type="text" name="title" maxlength="120" value="' + esc(init.title || '') + '"></div>' +
      '<div class="field"><label>내용</label><textarea name="body" rows="6" maxlength="2000">' + esc(init.body || '') + '</textarea></div>' +
      '<div class="or-acts"><button type="submit" class="btn sm">홈페이지 알림 보내기</button>' +
      '<button type="button" class="btn ghost sm" data-copy="1">문자용 복사</button>' +
      '<button type="button" class="btn ghost sm" data-close="1">닫기</button>' +
      '<span class="form-msg" role="status"></span></div>' +
      '<p class="or-hint">홈페이지 알림은 받는 분의 「알림함」에 들어갑니다. 계정이 없는 분께는 문자용으로 복사해 보내 주세요.</p></form>';
    var f = host.querySelector('form');
    f._task = init.task || null;
    showPhones(f);
    f.querySelector('input[name="names"]').addEventListener('change', function () { showPhones(f); });
    var t = f.querySelector('textarea'); if (t) t.focus();
  }
  function closeContact(f) {
    if (f.dataset.dirty === '1' && !confirm('쓰던 연락 내용을 버리고 닫을까요?')) return;
    var host = f.parentNode;
    var back = host && host.parentNode && host.parentNode.querySelector('[data-contact], [data-tcontact]');
    host.innerHTML = '';
    if (back) try { back.focus(); } catch (e) {}
  }
  function splitNames(s) {
    return String(s || '').split(/[,，、·\s]+/).map(function (x) { return x.replace(/(목사|장로|전도사|집사|권사)님?$/, '').trim(); })
      .filter(function (x, i, a) { return x.length >= 2 && a.indexOf(x) === i; }).slice(0, 20);
  }
  function showPhones(f) {
    var el = f.querySelector('.or-phone');
    var names = splitNames(f.querySelector('input[name="names"]').value);
    if (!names.length) { el.innerHTML = ''; return; }
    var need = names.filter(function (n) { return !(n in S.phones); });
    (need.length ? db().then(function (c) { return c.from('roster').select('name,church,position,phone').in('name', need); }) : Promise.resolve({ data: [] }))
      .then(function (r) {
        need.forEach(function (n) { S.phones[n] = null; });
        ((r && r.data) || []).forEach(function (x) { if (!S.phones[x.name]) S.phones[x.name] = x; });
        el.innerHTML = names.map(function (n) {
          var x = S.phones[n];
          if (!x) return '<span class="or-ph">' + esc(n) + ': 명단에서 찾지 못함</span>';
          var tel = String(x.phone || '').replace(/[^0-9+]/g, '');
          return '<span class="or-ph">' + esc(n) + ' ' + esc(x.position || '') + (x.church ? ' (' + esc(x.church) + ')' : '') +
            (tel ? ' · <a href="tel:' + esc(tel) + '">' + esc(x.phone) + '</a>' : ' · 전화 없음') + '</span>';
        }).join('');
      });
  }
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).catch(function () { return legacyCopy(t); });
    return legacyCopy(t);
  }
  function legacyCopy(t) {
    return new Promise(function (ok, no) {
      var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
      document.body.appendChild(ta); ta.select();
      var done = false; try { done = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); if (done) ok(); else no(new Error('copy'));
    });
  }
  function sendNotify(f) {
    if (f._busy) return;
    var out = f.querySelector('.or-acts .form-msg');
    var names = splitNames(f.querySelector('input[name="names"]').value);
    var title = f.querySelector('input[name="title"]').value.trim();
    var body = f.querySelector('textarea[name="body"]').value.trim();
    if (!names.length) { msg(out, false, '받는 분 이름을 적어 주세요.'); return; }
    if (title.length < 2) { msg(out, false, '제목을 적어 주세요.'); return; }
    var btn = f.querySelector('button[type="submit"]');
    f._busy = true; btn.disabled = true; btn.textContent = '보내는 중…';
    db().then(function (c) { return c.rpc('ai_task_notify', { p_names: names, p_title: title, p_body: body, p_task: f._task }); }).then(function (r) {
      f._busy = false; btn.disabled = false; btn.textContent = '홈페이지 알림 보내기';
      if (r.error) { msg(out, false, '보내지 못했습니다: ' + r.error.message); return; }
      var n = r.data || 0;
      if (!n) { msg(out, false, '그 이름의 홈페이지 계정이 없습니다. 「문자용 복사」로 보내 주세요.'); return; }
      f.dataset.dirty = '';
      msg(out, true, n + '분의 알림함에 보냈습니다.' + (f._task ? ' 할 일은 「연락함」으로 표시했습니다.' : ''));
      SHSCloud.log('create', '업무 알림 보냄', names.join(', ') + ' · ' + title.slice(0, 60));
      if (f._task) loadTasks().then(function () { if (S.tab === 'task') drawTasks(); refreshChips(); });
    });
  }
  /* 보고서의 할 일 상태 표시만 새로 (열려 있는 연락 칸은 그대로 둔다) */
  function refreshChips() {
    if (!S.rep) return;
    box.querySelectorAll('#or-view .or-todo').forEach(function (el) {
      var t = (S.rep.content.todos || [])[Number(el.dataset.i)];
      var task = t && taskOf(t), chip = el.querySelector('.or-st');
      if (task && chip) { chip.className = 'or-st or-st-' + stCls(task.status); chip.textContent = '할 일 목록: ' + task.status; }
    });
  }

  /* ---------- 할 일 탭 ---------- */
  function drawTasks() {
    var el = box.querySelector('#or-task');
    if (S.tasksErr) {
      el.innerHTML = /relation|does not exist|schema cache|PGRST20/.test(S.tasksErr)
        ? '<div class="notice-banner">할 일 표가 아직 없습니다. <code>supabase/128_officer_reports.sql</code> 을 실행해야 합니다.</div>'
        : '<div class="notice-banner">할 일을 불러오지 못했습니다: ' + esc(S.tasksErr) + '</div>';
      return;
    }
    var rows = S.tasks.filter(function (t) {
      if (S.tf === 'open' && OPEN.indexOf(t.status) === -1) return false;
      if (S.tf === 'done' && OPEN.indexOf(t.status) !== -1) return false;
      return !S.towner || t.owner === S.towner;
    });
    var h = '<p class="or-lead">회의록·결의·회칙에서 나온 「해야 할 일」입니다. 새 회의록이 등록되면 다음 날 아침 보고서를 만들 때 AI 가 결의를 읽어 이곳에 올립니다. ' +
      '끝날 때까지 보고서가 날마다 이어서 챙깁니다.</p>' +
      '<div class="or-bar"><div class="or-chips" id="or-tf">' +
      [['open', '진행 중'], ['done', '끝난 일'], ['all', '모두']].map(function (x) {
        return '<button type="button" data-tf="' + x[0] + '"' + (S.tf === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>';
      }).join('') + '</div>' +
      '<select id="or-towner" aria-label="담당"><option value="">모든 담당</option>' + Object.keys(OWNER_NAME).map(function (k) {
        return '<option value="' + k + '"' + (S.towner === k ? ' selected' : '') + '>' + OWNER_NAME[k] + '</option>';
      }).join('') + '</select>' +
      '<button type="button" class="btn sm" id="or-add-open">할 일 직접 등록</button></div>' +
      '<div class="or-add-host" id="or-add-host"></div>';
    if (!rows.length) h += '<p class="or-empty">' + (S.tf === 'open' ? '진행 중인 할 일이 없습니다.' : '해당하는 할 일이 없습니다.') + '</p>';
    var groups = {};
    rows.forEach(function (t) { var k = [t.dept_kind, t.dept_name].filter(Boolean).join(' · ') || '기타'; (groups[k] = groups[k] || []).push(t); });
    Object.keys(groups).forEach(function (g) {
      h += '<h3 class="or-g">' + esc(g) + ' <small>' + groups[g].length + '건</small></h3>';
      groups[g].forEach(function (t) {
        var dd = OPEN.indexOf(t.status) !== -1 ? dday(t.due_date) : '';
        var ed = canEdit(t.owner);
        h += '<div class="or-task" data-id="' + t.id + '">' +
          '<div class="or-todo-top"><span class="or-st or-st-' + stCls(t.status) + '">' + esc(t.status) + '</span>' +
          '<strong class="or-todo-t">' + esc(t.title) + '</strong>' +
          (dd ? '<span class="or-due' + (/지남/.test(dd) ? ' late' : '') + '">' + esc(dd) + '</span>' : '') + '</div>' +
          '<div class="or-todo-m">담당 ' + esc(OWNER_NAME[t.owner] || t.owner) + (t.contact_name ? ' · 연락: ' + esc(t.contact_name) : '') +
          (t.source ? ' · 출처: ' + esc(t.source) : '') + (t.updated_by ? ' · ' + esc(t.updated_by) + ' ' + esc(when(t.updated_at)) : '') + '</div>' +
          (t.detail ? '<p class="or-todo-d">' + esc(t.detail) + '</p>' : '') +
          (t.note ? '<p class="or-note">' + esc(String(t.note).split('\n').slice(-3).join(' / ')) + '</p>' : '') +
          '<div class="or-acts">' +
          (ed ? '<select class="or-stsel" data-id="' + t.id + '" aria-label="상태">' + STATUSES.map(function (s) {
              return '<option' + (s === t.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' : '') +
          (t.contact_name ? '<button type="button" class="btn ghost sm" data-tcontact="' + t.id + '">연락하기</button>' : '') +
          (reader ? '<span class="or-del"><button type="button" class="btn ghost sm" data-del="' + t.id + '">지우기</button></span>' : '') +
          '<span class="form-msg" role="status"></span></div>' +
          '<div class="or-contact-host"></div></div>';
      });
    });
    el.innerHTML = h;
  }
  function openAdd() {
    var host = box.querySelector('#or-add-host');
    if (!host || host.querySelector('form')) return;
    var mine = myOwner();
    host.innerHTML = '<form class="or-add" autocomplete="off">' +
      '<div class="or-row"><div class="field"><label>담당</label><select name="owner">' + Object.keys(OWNER_NAME).filter(canEdit).map(function (k) {
        return '<option value="' + k + '"' + (k === mine ? ' selected' : '') + '>' + OWNER_NAME[k] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>부서 갈래</label><select name="dept_kind">' + KINDS.map(function (k) { return '<option>' + k + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>부서 이름</label><input type="text" name="dept_name" maxlength="80" placeholder="예: 정치부"></div></div>' +
      '<div class="field"><label>할 일</label><input type="text" name="title" maxlength="300" placeholder="예: 정치부 — ○○교회 위임 청원 허락 통보"></div>' +
      '<div class="field"><label>자세히 <small>(선택)</small></label><textarea name="detail" rows="3" maxlength="3000"></textarea></div>' +
      '<div class="or-row"><div class="field"><label>기한 <small>(선택)</small></label><input type="date" name="due_date"></div>' +
      '<div class="field"><label>연락할 분 <small>(선택)</small></label><input type="text" name="contact_name" maxlength="100"></div></div>' +
      '<div class="or-acts"><button type="submit" class="btn sm">등록</button><button type="button" class="btn ghost sm" data-addclose="1">취소</button>' +
      '<span class="form-msg" role="status"></span></div></form>';
    host.querySelector('input[name="title"]').focus();
  }
  function insertTask(row, btn, out, after) {
    if (btn.disabled) return;
    btn.disabled = true;
    db().then(function (c) { return c.from('ai_tasks').insert(row).select('id'); }).then(function (r) {
      btn.disabled = false;
      if (r.error || !r.data || !r.data.length) { msg(out, false, r.error ? r.error.message : '등록하지 못했습니다 (담당 권한 확인).'); return; }
      SHSCloud.log('create', '할 일 등록', row.title.slice(0, 80));
      loadTasks().then(after);
    });
  }
  function setStatus(id, status, sel) {
    var item = sel.closest('.or-task');
    var out = item && item.querySelector('.or-acts .form-msg');
    sel.disabled = true;
    db().then(function (c) { return c.from('ai_tasks').update({ status: status }).eq('id', id).select('id'); }).then(function (r) {
      sel.disabled = false;
      if (r.error || !r.data || !r.data.length) { msg(out, false, r.error ? r.error.message : '바꾸지 못했습니다 (이 할 일의 담당이 아닙니다).'); return; }
      loadTasks().then(function () { drawTasks(); if (S.rep) drawReport(); });
    });
  }

  /* ---------- 지금 다시 만들기 (창구 SSE) ---------- */
  function runNow(only, btn) {
    if (S.busy) return;
    var prog = box.querySelector('#or-progress');
    S.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = '만드는 중…'; }
    if (prog) { prog.hidden = false; prog.className = 'or-progress'; prog.textContent = '창구에 요청하는 중… (임원 전체는 몇 분 걸립니다. 이 화면을 닫지 마세요)'; }
    function end(text, bad) {
      S.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = '지금 다시 만들기'; }
      if (prog) { prog.textContent = text; prog.className = 'or-progress' + (bad ? ' bad' : ' ok'); }
    }
    SHSCloud.init().then(function (c) { return c.auth.getSession(); }).then(function (s) {
      var tk = s && s.data && s.data.session && s.data.session.access_token;
      if (!tk) throw new Error('로그인이 확인되지 않습니다.');
      return fetch(WORKER + '/reports/run', { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify(only ? { only: only } : {}) });
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ('HTTP ' + r.status)); });
      var reader2 = r.body.getReader(), dec = new TextDecoder(), buf = '', result = null, failed = null;
      function pump() {
        return reader2.read().then(function (x) {
          if (x.done) return;
          buf += dec.decode(x.value, { stream: true });
          var k;
          while ((k = buf.indexOf('\n\n')) !== -1) {
            var chunk = buf.slice(0, k); buf = buf.slice(k + 2);
            var ev = '', data = '';
            chunk.split('\n').forEach(function (ln) { if (ln.indexOf('event:') === 0) ev = ln.slice(6).trim(); else if (ln.indexOf('data:') === 0) data += ln.slice(5).trim(); });
            var d = {}; try { d = JSON.parse(data || '{}'); } catch (e) {}
            if (ev === 'progress' && prog) prog.textContent = d.text + '…';
            else if (ev === 'done') result = d;
            else if (ev === 'error') failed = d.message || '오류';
          }
          return pump();
        });
      }
      return pump().then(function () {
        if (failed) throw new Error(failed);
        if (!result) throw new Error('창구 연결이 끊겼습니다. 잠시 뒤 다시 확인해 주세요 (창구는 계속 만들고 있을 수 있습니다).');
        end('다 만들었습니다: 보고서 ' + result.reports + '건' + (result.new_tasks ? ' · 새 할 일 ' + result.new_tasks + '건' : '') +
          (result.errors && result.errors.length ? ' · 오류 ' + result.errors.length + '건' : ''), result.errors && result.errors.length);
        SHSCloud.log('update', '임원 업무 보고서 다시 만들기', only ? '한 분' : '전체');
        S.date = null; S.pick = null;
        setTimeout(loadAll, 600);
      });
    }).catch(function (e) { end('만들지 못했습니다: ' + ((e && e.message) || e), true); });
  }

  /* ---------- 눌림 처리 ---------- */
  function onClick(ev) {
    var b = ev.target.closest('button');
    if (!b || !box.contains(b)) return;
    if (b.dataset.tab) { showTab(b.dataset.tab); return; }
    if (b.dataset.date) { S.date = b.dataset.date; S.pick = null; var mine = S.list.filter(function (r) { return r.report_date === S.date && r.user_id === user.id; })[0];
      var first = mine || S.list.filter(function (r) { return r.report_date === S.date; })[0]; S.pick = first ? first.id : null; drawRep(); openReport(S.pick); return; }
    if (b.dataset.pick) { S.pick = Number(b.dataset.pick); drawRep(); openReport(S.pick); return; }
    if (b.id === 'or-run-all') { runNow(null, b); return; }
    if (b.dataset.runOne) { runNow(b.dataset.runOne, box.querySelector('#or-run-all')); return; }
    if (b.dataset.contact) {
      var t = (S.rep.content.todos || [])[Number(b.dataset.contact)];
      var tk = taskOf(t);
      openContact(b.closest('.or-todo').querySelector('.or-contact-host'), { names: t.contact_name, title: '[시화산노회] ' + t.title, body: t.message || t.detail || '', task: tk ? tk.id : null });
      return;
    }
    if (b.dataset.tcontact) {
      var task = S.tasks.filter(function (x) { return String(x.id) === b.dataset.tcontact; })[0];
      if (!task) return;
      openContact(b.closest('.or-task').querySelector('.or-contact-host'), { names: task.contact_name, title: '[시화산노회] ' + task.title,
        body: (task.contact_name ? task.contact_name + ' 님께, ' : '') + '시화산노회 ' + (user.title || '') + ' ' + (user.name || '') + '입니다.\n' + (task.detail || task.title) + '\n확인 부탁드립니다.', task: task.id });
      return;
    }
    if (b.dataset.copy) {
      var f = b.closest('form');
      var text = f.querySelector('input[name="title"]').value.trim() + '\n\n' + f.querySelector('textarea[name="body"]').value.trim();
      var out = f.querySelector('.or-acts .form-msg');
      copyText(text).then(function () { msg(out, true, '복사했습니다. 문자·카카오톡에 붙여 넣으세요.'); }, function () { msg(out, false, '복사하지 못했습니다. 내용을 길게 눌러 복사해 주세요.'); });
      return;
    }
    if (b.dataset.close) { closeContact(b.closest('form')); return; }
    if (b.dataset.addtodo) {
      var td = (S.rep.content.todos || [])[Number(b.dataset.addtodo)];
      var out2 = b.parentNode.querySelector('.form-msg');
      insertTask({ owner: DUTY_OWNER[S.rep.duty] || 'officer', dept_kind: td.target_kind || null, dept_name: td.target_name || null, title: td.title,
        detail: td.detail || null, due_date: /^\d{4}-\d{2}-\d{2}$/.test(td.due || '') ? td.due : null, contact_name: td.contact_name || null,
        source: 'AI 보고서 ' + S.rep.report_date }, b, out2, function () { drawReport(); });
      return;
    }
    if (b.dataset.done) {
      var id = Number(b.dataset.done);
      b.disabled = true;
      db().then(function (c) { return c.from('ai_tasks').update({ status: '완료' }).eq('id', id).select('id'); }).then(function (r) {
        if (r.error || !r.data || !r.data.length) { b.disabled = false; msg(b.parentNode.querySelector('.form-msg'), false, r.error ? r.error.message : '바꾸지 못했습니다.'); return; }
        loadTasks().then(drawReport);
      });
      return;
    }
    if (b.dataset.tf) { S.tf = b.dataset.tf; drawTasks(); return; }
    if (b.id === 'or-add-open') { openAdd(); return; }
    if (b.dataset.addclose) {
      var fa = b.closest('form');
      if (fa.dataset.dirty === '1' && !confirm('쓰던 할 일을 버릴까요?')) return;
      fa.parentNode.innerHTML = ''; var o = box.querySelector('#or-add-open'); if (o) o.focus(); return;
    }
    if (b.dataset.del) {
      b.parentNode.innerHTML = '<span class="or-confirm">이 할 일을 지울까요? <button type="button" class="btn danger sm" data-delyes="' + b.dataset.del + '">지우기</button>' +
        '<button type="button" class="btn ghost sm" data-delno="' + b.dataset.del + '">취소</button></span>';
      var no = box.querySelector('[data-delno="' + b.dataset.del + '"]'); if (no) no.focus();
      return;
    }
    if (b.dataset.delno) { drawTasks(); return; }
    if (b.dataset.delyes) {
      if (b.disabled) return;
      b.disabled = true;
      var did = Number(b.dataset.delyes);
      var title = (S.tasks.filter(function (x) { return x.id === did; })[0] || {}).title || '';
      db().then(function (c) { return c.from('ai_tasks').delete().eq('id', did).select('id'); }).then(function (r) {
        if (r.error || !r.data || !r.data.length) { drawTasks(); return; }
        SHSCloud.log('delete', '할 일 지움', title.slice(0, 80));
        loadTasks().then(drawTasks);
      });
    }
  }
  function onSubmit(ev) {
    var f = ev.target;
    if (f.classList.contains('or-contact')) { ev.preventDefault(); sendNotify(f); return; }
    if (f.classList.contains('or-add')) {
      ev.preventDefault();
      var out = f.querySelector('.or-acts .form-msg');
      var title = f.querySelector('input[name="title"]').value.trim();
      if (title.length < 2) { msg(out, false, '할 일을 적어 주세요.'); return; }
      var row = { owner: f.querySelector('select[name="owner"]').value, dept_kind: f.querySelector('select[name="dept_kind"]').value,
        dept_name: f.querySelector('input[name="dept_name"]').value.trim() || null, title: title,
        detail: f.querySelector('textarea[name="detail"]').value.trim() || null, due_date: f.querySelector('input[name="due_date"]').value || null,
        contact_name: f.querySelector('input[name="contact_name"]').value.trim() || null, source: '직접 등록' };
      insertTask(row, f.querySelector('button[type="submit"]'), out, function () { S.tf = 'open'; drawTasks(); });
    }
  }
  function onChange(ev) {
    if (ev.target.id === 'or-towner') { S.towner = ev.target.value; drawTasks(); return; }
    if (ev.target.classList.contains('or-stsel')) setStatus(Number(ev.target.dataset.id), ev.target.value, ev.target);
  }

  return { mount: mount };
})();

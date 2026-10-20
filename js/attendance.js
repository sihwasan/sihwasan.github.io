/* 노회 출석부 (supabase/130_attendance_register.sql)
 *
 *   SHSAttend.mountSheet(el, { meeting, canEdit })   회의관리 「출석부」 탭 — 한 회기의 출석부
 *       meeting = 오늘의 노회 회의 { id, title, session_no, meet_date }
 *       회원 명단의 출석 대상(정회원 목사·총대 장로)을 출석·불참(이유서)·결석·면제로 보여 준다.
 *       이유서가 붙은 줄은 「이유서 보기」를 누르면 그 자리에서 펼쳐진다. 누적 결석 횟수도 함께.
 *       서기는 출석부 만들기·다시 맞추기, 줄마다 출결 바꾸기·메모를 한다.
 *   SHSAttend.mountSummary(el, { canEdit, onBack })  회의관리 「결석 관리」 — 모든 출석부를 모아 회원별 누적
 *   SHSAttend.profileRow(td, rosterId)               회원 신상 창(회원 관리)의 「노회 출결」 칸
 *
 * 출석부는 서버가 만들고 맞춘다 — 이유서를 내거나 거두거나 QR 입장이 늘면 저절로 다시 맞춰진다(130 sql).
 */
var SHSAttend = (function () {
  var STATUSES = ['출석', '불참', '결석', '면제'];
  var TONE = { '출석': 'on', '불참': 'warn', '결석': 'live', '면제': '' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function db() { return SHSCloud.init(); }
  function dots(d) { return String(d || '').slice(0, 10).replace(/-/g, '.'); }
  function when(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function badge(st) { return '<span class="ma-badge ' + (TONE[st] || '') + '">' + esc(st) + '</span>'; }
  function needSql(err) { return /relation|does not exist|schema cache|Could not find/i.test((err && err.message) || ''); }
  var NEED = '<div class="notice-banner">출석부를 쓰려면 <code>supabase/129_absence_reasons.sql</code> 과 ' +
    '<code>supabase/130_attendance_register.sql</code> 을 Supabase SQL Editor 에서 차례로 실행해 주세요.</div>';

  /* 회원별 누적 (대상 줄만): { roster_id: { 출석, 불참, 결석, 면제, n } } */
  function tally(rows) {
    var t = {};
    rows.forEach(function (r) {
      if (!r.obligated || r.roster_id == null) return;
      var x = t[r.roster_id] = t[r.roster_id] || { '출석': 0, '불참': 0, '결석': 0, '면제': 0, n: 0 };
      x[r.status] = (x[r.status] || 0) + 1; x.n++;
    });
    return t;
  }
  function csvDownload(name, rows) {
    var txt = '﻿' + rows.map(function (r) {
      return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
    }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  /* =====================================================================
   *  한 회기의 출석부
   * ===================================================================== */
  function mountSheet(el, ctx) {
    var S = { el: el, m: ctx.meeting, canEdit: !!ctx.canEdit, sheet: null, rows: [], all: [], filt: 'all', open: {}, edit: null, busy: false };
    el.innerHTML = '<p style="color:var(--gray-5)">출석부를 불러오는 중...</p>';
    el.onclick = function (ev) { onClick(ev); };
    load();

    function load(msg) {
      db().then(function (c) {
        return c.from('attendance_sheets').select('*').eq('meet_date', S.m.meet_date).limit(1).then(function (r) {
          if (r.error) throw r.error;
          S.sheet = (r.data || [])[0] || null;
          if (!S.sheet) return null;
          return Promise.all([
            c.from('attendance_records').select('*').eq('sheet_id', S.sheet.id).order('id'),
            c.from('attendance_records').select('roster_id,status,obligated').limit(20000)
          ]);
        });
      }).then(function (rs) {
        if (rs) {
          if (rs[0].error) throw rs[0].error;
          S.rows = rs[0].data || [];
          S.all = (rs[1] && rs[1].data) || [];
        }
        draw(msg);
      }).catch(function (e) {
        el.innerHTML = needSql(e) ? NEED : '<div class="notice-banner">출석부를 불러오지 못했습니다: ' + esc(e.message || e) + '</div>';
      });
    }
    function counts() {
      var c = { '출석': 0, '불참': 0, '결석': 0, '면제': 0, obl: 0, extra: 0, reasons: 0 };
      S.rows.forEach(function (r) {
        if (r.obligated) { c.obl++; c[r.status]++; } else if (r.status === '출석') c.extra++;
        if (r.reason) c.reasons++;
      });
      return c;
    }
    function sortKey(r) { return (r.obligated ? 0 : 1) * 1000 + STATUSES.indexOf(r.status) * 100; }
    function draw(msg, isErr) {
      if (!S.sheet) {
        el.innerHTML = '<p class="ma-sub">출석부는 회원 명단의 <strong>출석 대상(정회원 목사·총대 장로)</strong> 전체를 기준으로, ' +
          'QR 입장이면 <strong>출석</strong>, 불참 이유서를 냈으면 <strong>불참</strong>, 둘 다 없으면 <strong>결석</strong>으로 매깁니다. ' +
          '만든 뒤에는 이유서·입장이 바뀌면 저절로 맞춰집니다.</p>' +
          (S.canEdit ? '<div class="ma-btnrow"><button type="button" class="btn" data-att="build">출석부 만들기</button></div>'
                     : '<div class="notice-banner">아직 출석부를 만들지 않았습니다. 서기가 만들면 여기에 보입니다.</div>') +
          (msg ? '<div class="form-msg ' + (isErr ? 'err' : 'ok') + '" role="status">' + esc(msg) + '</div>' : '');
        return;
      }
      var c = counts(), tl = tally(S.all);
      var F = [['all', '전체 ' + S.rows.length], ['출석', '출석 ' + c['출석']], ['불참', '불참 ' + c['불참']], ['결석', '결석 ' + c['결석']],
               ['면제', '면제 ' + c['면제']], ['reason', '이유서 ' + c.reasons], ['extra', '대상 밖 출석 ' + c.extra]];
      var rows = S.rows.filter(function (r) {
        if (S.filt === 'all') return true;
        if (S.filt === 'extra') return !r.obligated;
        if (S.filt === 'reason') return !!r.reason;
        return r.obligated && r.status === S.filt;
      }).sort(function (a, b) { return sortKey(a) - sortKey(b) || String(a.name).localeCompare(String(b.name), 'ko'); });
      var h = '<div class="ma-cards">' +
        '<div class="ma-card"><span>출석 대상</span><strong>' + c.obl + '</strong></div>' +
        '<div class="ma-card"><span>출석</span><strong>' + c['출석'] + '</strong></div>' +
        '<div class="ma-card"><span>불참 (이유서)</span><strong>' + c['불참'] + '</strong></div>' +
        '<div class="ma-card"><span>결석</span><strong style="color:var(--red)">' + c['결석'] + '</strong></div>' +
        (c['면제'] ? '<div class="ma-card"><span>면제</span><strong>' + c['면제'] + '</strong></div>' : '') +
        '</div>' +
        '<div class="ma-sub">출석률 ' + (c.obl ? Math.round((c['출석'] / c.obl) * 1000) / 10 : 0) + '% · 대상 밖 출석 ' + c.extra + '명 (원로·은퇴목사 등)' +
        ' · 만든 분 ' + esc(S.sheet.built_by || '') + ' ' + esc(when(S.sheet.built_at)) + '</div>' +
        '<div class="ma-filter">' + F.map(function (f) {
          return '<button type="button" class="' + (S.filt === f[0] ? 'on' : '') + '" data-attf="' + f[0] + '">' + f[1] + '</button>';
        }).join('') + '</div>' +
        '<div class="ma-btnrow">' +
        (S.canEdit ? '<button type="button" class="btn ghost sm" data-att="build">다시 맞추기</button>' : '') +
        '<button type="button" class="btn ghost sm" data-att="print">인쇄</button>' +
        '<button type="button" class="btn ghost sm" data-att="csv">엑셀(CSV) 내려받기</button>' +
        '<span class="form-msg ' + (isErr ? 'err' : 'ok') + '" role="status">' + esc(msg || '') + '</span></div>';
      if (!rows.length) { el.innerHTML = h + '<div class="notice-banner">해당하는 분이 없습니다.</div>'; return; }
      h += '<div class="ma-tblwrap"><table class="ma-tbl"><thead><tr><th>번호</th><th>이름</th><th>직분</th><th>교회</th><th>출결</th>' +
        '<th>불참 이유서</th><th>누적 결석</th><th>메모</th>' + (S.canEdit ? '<th class="ma-noprint"></th>' : '') + '</tr></thead><tbody>' +
        rows.map(function (r, i) {
          var t = (r.roster_id != null && tl[r.roster_id]) || null;
          var abs = t ? t['결석'] : 0;
          var line = '<tr' + (r.status === '결석' && r.obligated ? ' class="late"' : '') + '><td>' + (i + 1) + '</td>' +
            '<td><strong>' + esc(r.name || '') + '</strong></td><td>' + esc(r.position || r.category || '') + '</td><td>' + esc(r.church || '') + '</td>' +
            '<td>' + (r.obligated ? badge(r.status) : '<span class="ma-badge">대상 밖 출석</span>') +
            (r.manual ? ' <span class="ma-badge" title="' + esc((r.updated_by || '') + ' ' + when(r.updated_at)) + '">서기 수정</span>' : '') +
            (r.entered_at && r.status === '출석' ? '<div class="ma-sub">입장 ' + esc(when(r.entered_at).slice(11)) + '</div>' : '') + '</td>' +
            '<td>' + (r.reason ? '<button type="button" class="btn ghost sm" data-attr="' + r.id + '" aria-expanded="' + !!S.open[r.id] + '">' +
              (S.open[r.id] ? '이유서 접기' : '이유서 보기') + '</button>' : '<span style="color:var(--gray-5)">없음</span>') + '</td>' +
            '<td>' + (r.obligated ? (abs ? '<strong style="color:' + (abs >= 2 ? 'var(--red)' : 'inherit') + '">' + abs + '회</strong>' : '0회') +
              (t ? ' <span class="ma-sub">/ ' + t.n + '회 중</span>' : '') : '-') + '</td>' +
            '<td style="white-space:normal;min-width:120px">' + esc(r.note || '') + '</td>' +
            (S.canEdit ? '<td class="ma-noprint"><button type="button" class="btn ghost sm" data-atte="' + r.id + '">바꾸기</button></td>' : '') + '</tr>';
          if (S.open[r.id] && r.reason) {
            line += '<tr><td></td><td colspan="' + (S.canEdit ? 8 : 7) + '" style="white-space:normal;background:#fffaf0">' +
              '<strong>[' + esc(r.reason_kind || '') + ']</strong> ' + esc(r.reason) +
              '<div class="ma-sub">제출 ' + esc(when(r.reason_at)) + (r.status === '출석' ? ' · 이유서를 냈지만 회의에 출석함' : '') + '</div></td></tr>';
          }
          if (S.edit === r.id) {
            line += '<tr class="ma-noprint"><td></td><td colspan="8" style="white-space:normal;background:var(--gray-1)">' +
              '<form class="att-ed" data-id="' + r.id + '" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
              '<label>출결 <select name="st">' + STATUSES.map(function (s) {
                return '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>';
              }).join('') + '</select></label>' +
              '<input type="text" name="note" maxlength="500" placeholder="메모 (예: 해외 선교 파송으로 면제)" value="' + esc(r.note || '') + '" style="flex:1 1 220px;min-height:36px">' +
              '<button type="submit" class="btn sm">저장</button><button type="button" class="btn ghost sm" data-att="cancel">취소</button>' +
              '</form><div class="ma-sub">바꾼 줄은 「서기 수정」으로 남고, 다시 맞추기를 해도 그대로 둡니다.</div></td></tr>';
          }
          return line;
        }).join('') + '</tbody></table></div>';
      el.innerHTML = h;
      var f = el.querySelector('form.att-ed');
      if (f) {
        f.onsubmit = function (ev) { ev.preventDefault(); save(f); };
        f.querySelector('select').focus();
      }
    }
    function build(btn) {
      if (S.busy) return;
      S.busy = true; if (btn) { btn.disabled = true; btn.textContent = '맞추는 중…'; }
      db().then(function (c) { return c.rpc('attendance_build', { p_assembly: S.m.id }); }).then(function (r) {
        S.busy = false;
        if (r.error) { if (needSql(r.error)) { el.innerHTML = NEED; return; } draw(r.error.message, true); return; }
        var v = r.data || {};
        if (window.SHSCloud && SHSCloud.log) SHSCloud.log('update', '노회 출석부 ' + (S.sheet ? '다시 맞추기' : '만들기'), (S.m.title || '') + ' 출석 ' + v['출석'] + ' · 불참 ' + v['불참'] + ' · 결석 ' + v['결석']);
        load();
      }, function (e) { S.busy = false; draw('맞추지 못했습니다: ' + ((e && e.message) || e), true); });
    }
    function save(f) {
      if (S.busy) return;
      var id = Number(f.dataset.id), st = f.st.value, note = f.note.value.trim();
      var btn = f.querySelector('button[type="submit"]');
      S.busy = true; btn.disabled = true; btn.textContent = '저장 중…';
      db().then(function (c) {
        return c.from('attendance_records').update({ status: st, note: note || null }).eq('id', id).select('*');
      }).then(function (r) {
        S.busy = false;
        if (r.error || !r.data || !r.data.length) { btn.disabled = false; btn.textContent = '저장'; draw('바꾸지 못했습니다' + (r.error ? ': ' + r.error.message : ' (서기 2단계 인증 확인)'), true); return; }
        var row = r.data[0];
        S.edit = null;
        if (window.SHSCloud && SHSCloud.log) SHSCloud.log('update', '노회 출석부 출결 수정', (row.name || '') + ' → ' + row.status + (row.note ? ' (' + row.note + ')' : ''));
        load('저장했습니다.');   /* 누적 결석도 새로 센다 */
      }, function (e) { S.busy = false; btn.disabled = false; btn.textContent = '저장'; draw('바꾸지 못했습니다: ' + ((e && e.message) || e), true); });
    }
    function onClick(ev) {
      var b = ev.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.attf) { S.filt = b.dataset.attf; draw(); return; }
      if (b.dataset.attr) { var id = Number(b.dataset.attr); S.open[id] = !S.open[id]; draw(); var nb = el.querySelector('[data-attr="' + id + '"]'); if (nb) nb.focus(); return; }
      if (b.dataset.atte) { if (S.busy) return; S.edit = Number(b.dataset.atte); draw(); return; }
      var act = b.dataset.att;
      if (act === 'cancel') { var back = S.edit; S.edit = null; draw(); var eb = el.querySelector('[data-atte="' + back + '"]'); if (eb) eb.focus(); return; }
      if (act === 'build') { build(b); return; }
      if (act === 'print') { window.print(); return; }
      if (act === 'csv') {
        var tl = tally(S.all);
        csvDownload('출석부_' + (S.m.session_no ? '제' + S.m.session_no + '회기_' : '') + S.m.meet_date + '.csv',
          [['번호', '이름', '직분', '교회', '출석 대상', '출결', '불참 사유 구분', '불참 사유', '이유서 제출', '누적 결석', '메모', '서기 수정']].concat(
            S.rows.map(function (r, i) {
              var t = (r.roster_id != null && tl[r.roster_id]) || null;
              return [i + 1, r.name, r.position || r.category, r.church, r.obligated ? '대상' : '대상 밖', r.status, r.reason_kind, r.reason,
                when(r.reason_at), t ? t['결석'] : '', r.note, r.manual ? (r.updated_by || '예') : ''];
            })));
      }
    }
  }

  /* =====================================================================
   *  결석 관리 — 모든 출석부를 회원별로
   * ===================================================================== */
  function mountSummary(el, ctx) {
    var S = { sheets: [], recs: [], filt: 'absent', open: {} };
    el.innerHTML = '<p style="color:var(--gray-5)">출결 기록을 모으는 중...</p>';
    db().then(function (c) {
      return Promise.all([
        c.from('attendance_sheets').select('id,meet_date,session_no,title').order('meet_date', { ascending: false }),
        c.from('attendance_records').select('id,sheet_id,roster_id,name,church,position,category,obligated,status,reason_kind,reason,reason_at,note,manual').limit(20000)
      ]);
    }).then(function (rs) {
      if (rs[0].error) throw rs[0].error;
      if (rs[1].error) throw rs[1].error;
      S.sheets = rs[0].data || []; S.recs = rs[1].data || [];
      draw();
    }).catch(function (e) { el.innerHTML = needSql(e) ? NEED : '<div class="notice-banner">불러오지 못했습니다: ' + esc(e.message || e) + '</div>'; });
    el.onclick = function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.sact === 'back' && ctx.onBack) { ctx.onBack(); return; }
      if (b.dataset.sf) { S.filt = b.dataset.sf; draw(); return; }
      if (b.dataset.who) { S.open[b.dataset.who] = !S.open[b.dataset.who]; draw(); return; }
      if (b.dataset.sact === 'csv') {
        csvDownload('노회_출결_누적.csv', [['이름', '직분', '교회', '대상 회수', '출석', '불참(이유서)', '결석', '면제', '결석한 회기']].concat(people().map(function (p) {
          return [p.name, p.position, p.church, p.n, p['출석'], p['불참'], p['결석'], p['면제'],
            p.list.filter(function (x) { return x.status === '결석'; }).map(function (x) { return x.sheet.title; }).join(' / ')];
        })));
      }
    };
    function sheetOf(id) { return S.sheets.filter(function (s) { return s.id === id; })[0] || { title: '?', meet_date: '' }; }
    function people() {
      var by = {};
      S.recs.forEach(function (r) {
        if (!r.obligated) return;
        var k = r.roster_id != null ? 'r' + r.roster_id : 'n' + r.name + '|' + r.church;
        var p = by[k] = by[k] || { key: k, name: r.name, church: r.church, position: r.position || r.category, '출석': 0, '불참': 0, '결석': 0, '면제': 0, n: 0, list: [] };
        p[r.status]++; p.n++;
        p.list.push(Object.assign({ sheet: sheetOf(r.sheet_id) }, r));
      });
      return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) {
        return b['결석'] - a['결석'] || b['불참'] - a['불참'] || String(a.name).localeCompare(String(b.name), 'ko');
      });
    }
    function draw() {
      var ps = people();
      var F = [['absent', '결석 있는 회원 ' + ps.filter(function (p) { return p['결석']; }).length], ['two', '결석 2회 이상 ' + ps.filter(function (p) { return p['결석'] >= 2; }).length],
               ['excused', '불참(이유서) 있는 회원 ' + ps.filter(function (p) { return p['불참']; }).length], ['all', '전체 ' + ps.length]];
      var rows = ps.filter(function (p) {
        return S.filt === 'all' || (S.filt === 'absent' && p['결석']) || (S.filt === 'two' && p['결석'] >= 2) || (S.filt === 'excused' && p['불참']);
      });
      var h = '<div class="ma-noprint" style="margin-bottom:12px"><button class="btn ghost sm" data-sact="back">&#8592; 회기 목록</button></div>' +
        '<h2 style="font-family:\'Noto Serif KR\',serif;margin:0 0 6px">결석 관리 — 누적 출결</h2>' +
        '<p class="ma-sub">출석부 ' + S.sheets.length + '회분을 모았습니다 (' + S.sheets.map(function (s) { return esc(s.title); }).join(' · ') + '). ' +
        '<strong>결석</strong>은 불참 이유서 없이 빠진 경우만 셉니다. 이름을 누르면 회기별 출결과 이유서를 봅니다.</p>' +
        '<div class="ma-filter">' + F.map(function (f) { return '<button type="button" class="' + (S.filt === f[0] ? 'on' : '') + '" data-sf="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>' +
        '<div class="ma-btnrow"><button type="button" class="btn ghost sm" data-sact="csv">엑셀(CSV) 내려받기</button></div>';
      if (!S.sheets.length) { el.innerHTML = h + '<div class="notice-banner">아직 만든 출석부가 없습니다. 회기를 골라 「출석부」 탭에서 만들어 주세요.</div>'; return; }
      if (!rows.length) { el.innerHTML = h + '<div class="notice-banner">해당하는 회원이 없습니다.</div>'; return; }
      h += '<div class="ma-tblwrap"><table class="ma-tbl"><thead><tr><th>이름</th><th>직분</th><th>교회</th><th>대상</th><th>출석</th><th>불참</th><th>결석</th><th>면제</th></tr></thead><tbody>' +
        rows.map(function (p) {
          var line = '<tr' + (p['결석'] >= 2 ? ' class="late"' : '') + '><td><button type="button" class="btn ghost sm" data-who="' + esc(p.key) + '" aria-expanded="' + !!S.open[p.key] + '">' + esc(p.name) + '</button></td>' +
            '<td>' + esc(p.position || '') + '</td><td>' + esc(p.church || '') + '</td><td>' + p.n + '회</td><td>' + p['출석'] + '</td><td>' + p['불참'] + '</td>' +
            '<td>' + (p['결석'] ? '<strong style="color:var(--red)">' + p['결석'] + '</strong>' : '0') + '</td><td>' + p['면제'] + '</td></tr>';
          if (S.open[p.key]) {
            line += '<tr><td colspan="8" style="white-space:normal;background:var(--gray-1)">' + p.list.sort(function (a, b) {
              return String(b.sheet.meet_date).localeCompare(String(a.sheet.meet_date));
            }).map(function (x) {
              return '<div style="margin:3px 0">' + esc(x.sheet.title) + ' <span class="ma-sub">' + esc(dots(x.sheet.meet_date)) + '</span> ' + badge(x.status) +
                (x.reason ? ' <span>[' + esc(x.reason_kind || '') + '] ' + esc(x.reason) + '</span>' : '') +
                (x.note ? ' <span class="ma-sub">· 메모: ' + esc(x.note) + '</span>' : '') + '</div>';
            }).join('') + '</td></tr>';
          }
          return line;
        }).join('') + '</tbody></table></div>';
      el.innerHTML = h;
    }
  }

  /* =====================================================================
   *  회원 신상 창의 「노회 출결」 칸
   * ===================================================================== */
  function profileRow(td, rosterId) {
    if (!td || rosterId == null || !(window.SHSCloud && SHSCloud.enabled && SHSCloud.enabled())) return;
    db().then(function (c) {
      return Promise.all([
        c.from('attendance_records').select('sheet_id,status,obligated,reason_kind,reason,note,manual').eq('roster_id', rosterId),
        c.from('attendance_sheets').select('id,title,meet_date,session_no').order('meet_date', { ascending: false })
      ]);
    }).then(function (rs) {
      var tr = td.parentNode;
      if (rs[0].error) { if (tr) tr.classList.add('hidden'); return; }
      var sheets = (rs[1] && rs[1].data) || [], recs = rs[0].data || [];
      if (tr) tr.classList.remove('hidden');
      if (!recs.length) {
        td.innerHTML = '<span style="color:var(--gray-5)">' + (sheets.length ? '출석부 ' + sheets.length + '회분에 이 분의 줄이 없습니다 (출석 대상이 아님)' : '아직 만든 출석부가 없습니다') + '</span>';
        return;
      }
      var c = { '출석': 0, '불참': 0, '결석': 0, '면제': 0 }, n = 0;
      recs.forEach(function (r) { if (r.obligated) { c[r.status]++; n++; } });
      var byId = {}; sheets.forEach(function (s) { byId[s.id] = s; });
      var list = recs.map(function (r) { return Object.assign({ sheet: byId[r.sheet_id] || { title: '?', meet_date: '' } }, r); })
        .sort(function (a, b) { return String(b.sheet.meet_date).localeCompare(String(a.sheet.meet_date)); });
      var tone = { '출석': '#1f7a3a', '불참': '#7a5a00', '결석': 'var(--red)', '면제': 'var(--gray-6)' };
      td.innerHTML = '<div><strong>' + (n ? Math.round(c['출석'] / n * 100) : 0) + '%</strong> 출석 · 대상 ' + n + '회 중 출석 ' + c['출석'] + ' · 불참 ' + c['불참'] +
        ' · <strong style="color:' + (c['결석'] ? 'var(--red)' : 'inherit') + '">결석 ' + c['결석'] + '</strong>' + (c['면제'] ? ' · 면제 ' + c['면제'] : '') + '</div>' +
        list.map(function (x, i) {
          return '<div style="font-size:0.86rem;margin-top:3px">' + esc(x.sheet.title) + ' <span style="color:var(--gray-5)">' + esc(dots(x.sheet.meet_date)) + '</span> ' +
            '<strong style="color:' + (tone[x.status] || 'inherit') + '">' + esc(x.obligated ? x.status : '출석(대상 밖)') + '</strong>' +
            (x.reason ? ' <button type="button" class="btn ghost sm" data-attp="' + i + '" style="padding:2px 8px;min-height:28px">이유서</button>' +
              '<div class="hidden" data-attpd="' + i + '" style="margin:4px 0 2px;padding:6px 8px;background:#fffaf0;border-radius:6px">[' + esc(x.reason_kind || '') + '] ' + esc(x.reason) + '</div>' : '') +
            (x.note ? ' <span style="color:var(--gray-5)">· ' + esc(x.note) + '</span>' : '') + '</div>';
        }).join('') +
        '<div style="margin-top:6px;font-size:0.82rem"><a href="meeting-admin.html" style="color:var(--navy);text-decoration:underline">노회 회의관리 → 출석부·결석 관리</a></div>';
      td.onclick = function (ev) {
        var b = ev.target.closest('[data-attp]');
        if (!b) return;
        var d = td.querySelector('[data-attpd="' + b.dataset.attp + '"]');
        if (d) d.classList.toggle('hidden');
      };
    }, function () {});
  }

  return { mountSheet: mountSheet, mountSummary: mountSummary, profileRow: profileRow, tally: tally };
})();

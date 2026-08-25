/* 감사필 (봄·가을 정기노회 전 감사)
 *
 * 감사부(감사헌의부)가 상비부·시찰의 회의록과 회계 장부를 감사합니다.
 * 감사 칸은 회의록과 회계 장부가 똑같이 쓰므로 여기 한 곳에 모아 두었습니다.
 *
 *   · 감사 기간은 3월(봄)과 9월(가을)입니다.
 *     그 달이 되면 감사부에게 '감사필 처리' 단추가 열립니다.
 *   · 감사필을 찍으면 감사부장·서기의 도장이 그때 모습 그대로 담깁니다.
 *     나중에 도장을 바꾸어도 이미 감사가 끝난 자료는 그대로 남습니다.
 *   · 감사가 끝난 자료는 고치거나 지울 수 없습니다.
 *     막는 일은 데이터베이스가 하므로 화면을 건너뛰어도 막힙니다.
 */
var SHSAuditMark = (function () {
  'use strict';

  var SEAL_KEYS = ['감사부장', '감사부서기'];
  var seals = null;      /* 한 번 불러오면 담아 둔다 */
  var loading = null;
  var override = null;   /* 노회 관리자가 손으로 열어 둔 감사 기간 */
  var overLoading = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- 지금이 감사 기간인가 ----------
   * 봄 정기노회 전 3월, 가을 정기노회 전 9월에 저절로 열린다.
   * 그 달 안에 감사를 마치지 못하는 일이 있으므로, 노회 관리자가
   * 시스템 운영 화면에서 손으로 열어 둘 수도 있다. 손으로 열어 둔
   * 것이 있으면 그것을 먼저 따른다. */
  function windowNow(now) {
    var d = now || new Date();
    var m = d.getMonth() + 1;
    if (override && override.open) {
      return {
        open: true,
        year: override.year || d.getFullYear(),
        period: override.period || (m >= 7 ? '가을' : '봄'),
        manual: true,
        note: override.note || ''
      };
    }
    if (m === 3) return { open: true, year: d.getFullYear(), period: '봄' };
    if (m === 9) return { open: true, year: d.getFullYear(), period: '가을' };
    return { open: false, year: d.getFullYear(), period: null };
  }

  /* 손으로 열어 둔 감사 기간을 서버에서 한 번 읽어 둔다.
   * 감사 칸을 그리기 전에 불러 주면 된다. 못 읽어도 달력대로 움직인다. */
  function ready() {
    if (override) return Promise.resolve(override);
    if (overLoading) return overLoading;
    if (!(window.SHSCloud && SHSCloud.enabled())) {
      override = { open: false };
      return Promise.resolve(override);
    }
    overLoading = SHSCloud.init().then(function (c) {
      return c.from('site_settings').select('value').eq('key', 'audit_window').single();
    }).then(function (r) {
      override = (r && r.data && r.data.value) || { open: false };
      return override;
    }).catch(function () {
      override = { open: false };
      return override;
    });
    return overLoading;
  }

  /* 설정을 고친 뒤 다시 읽게 한다 */
  function forget() { override = null; overLoading = null; }

  /* ---------- 감사부 도장 ----------
   * 비공개 보관함에서 꺼내 그림 자체로 바꾼다.
   * 감사필을 찍을 때 그 그림을 자료에 함께 담기 위함이다. */
  function toDataUrl(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var MAX = 200;
          var sc = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(img.naturalWidth * sc));
          cv.height = Math.max(1, Math.round(img.naturalHeight * sc));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/png'));
        } catch (x) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  function loadSeals() {
    if (seals) return Promise.resolve(seals);
    if (loading) return loading;
    loading = SHSCloud.init().then(function (c) {
      return c.from('seals').select('*').in('key', SEAL_KEYS);
    }).then(function (r) {
      var out = {};
      var rows = (r && r.data) || [];
      return Promise.all(rows.map(function (s) {
        out[s.key] = { label: s.label, holder: s.holder || '', data: null };
        if (!s.file_path) return null;
        return SHSCloud.init().then(function (c) {
          return c.storage.from('seals').createSignedUrl(s.file_path, 600);
        }).then(function (r2) {
          if (r2.error) return null;
          return toDataUrl(r2.data.signedUrl).then(function (d) { out[s.key].data = d; });
        }).catch(function () { return null; });
      })).then(function () { seals = out; return out; });
    }).catch(function () { loading = null; seals = {}; return seals; });
    return loading;
  }

  /* ---------- 감사 칸 그리기 ----------
   * rec  : 감사 칸(audited_yn 등)을 가진 자료 한 줄
   * opts : { isAuditor: 감사부인가 }
   */
  function panel(rec, opts) {
    opts = opts || {};
    var w = windowNow();
    var h = '<div class="audit-box' + (rec.audited_yn ? ' done' : '') + '">';

    if (rec.audited_yn) {
      h += '<div class="audit-head"><span class="audit-stamp">감사필</span> ' +
        esc(rec.audit_year || '') + '년 ' + esc(rec.audit_period || '') + ' 감사' +
        (rec.audited_at ? ' · ' + esc(String(rec.audited_at).slice(0, 10)) : '') +
        '</div>';
      h += '<div class="audit-signs">' +
        signSpan('감사부장', rec.audit_head, rec.audit_head_seal) +
        signSpan('감사부 서기', rec.audit_clerk, rec.audit_clerk_seal) +
        '</div>';
      if (rec.audit_opinion) {
        h += '<div class="audit-opinion">' + esc(rec.audit_opinion) + '</div>';
      }
      h += '<div class="audit-note">감사가 끝난 자료입니다. 고치거나 지울 수 없습니다.</div>';
      if (opts.isAuditor) {
        h += '<button class="btn danger sm" data-audit-undo="' + esc(rec.id) + '">감사 표시 풀기</button>';
      }
    } else if (opts.isAuditor && w.open) {
      h += '<div class="audit-head">' + w.year + '년 ' + w.period + ' 감사 기간입니다.' +
        (w.manual ? ' <span style="font-size:0.82rem;color:var(--gray-5)">' +
          '(노회 관리자가 열어 둔 기간' + (w.note ? ' · ' + esc(w.note) : '') + ')</span>' : '') +
        '</div>' +
        '<div class="field"><label>감사 의견 (선택)</label>' +
        '<input type="text" data-audit-opinion="' + esc(rec.id) + '" ' +
        'placeholder="예: 이상 없음"></div>' +
        '<button class="btn" data-audit-do="' + esc(rec.id) + '">감사필 처리</button>' +
        '<div class="form-msg" data-audit-msg="' + esc(rec.id) + '"></div>';
    } else if (opts.isAuditor) {
      h += '<div class="audit-head">아직 감사 전입니다.</div>' +
        '<div class="audit-note">감사는 <strong>3월(봄)</strong>과 <strong>9월(가을)</strong>에 시행합니다. ' +
        '지금은 감사 기간이 아니어서 감사필 처리를 할 수 없습니다.<br>' +
        '기간을 넘겨 감사해야 한다면 노회 관리자가 ' +
        '<strong>시스템 운영 → 감사 기간</strong>에서 열어 드릴 수 있습니다.</div>';
    } else {
      h += '<div class="audit-head">아직 감사 전입니다.</div>' +
        '<div class="audit-note">감사는 봄·가을 정기노회 전에 감사부가 시행합니다.</div>';
    }
    return h + '</div>';
  }

  function signSpan(role, name, sealData) {
    return '<span class="audit-sign">' + esc(role) +
      (name ? ' ' + esc(name) : '') +
      (sealData ? '<img src="' + esc(sealData) + '" alt="' + esc(role) + ' 도장">' : '') +
      '</span>';
  }

  /* ---------- 단추 이어 붙이기 ----------
   * box   : 감사 칸이 들어 있는 자리
   * opts  : { kind: 'sichal_minutes' | 'committee_minutes' | 'ledger_books',
   *           label: 감사 기록에 남길 이름, after: 끝난 뒤 부를 함수 }
   */
  function bind(box, opts) {
    if (!box) return;
    opts = opts || {};

    box.querySelectorAll('button[data-audit-do]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.auditDo;
        var msg = box.querySelector('[data-audit-msg="' + id + '"]');
        var op = box.querySelector('[data-audit-opinion="' + id + '"]');
        var w = windowNow();
        if (!w.open) {
          if (msg) { msg.className = 'form-msg err'; msg.textContent = '지금은 감사 기간이 아닙니다.'; }
          return;
        }
        if (!confirm(w.year + '년 ' + w.period + ' 감사로 감사필 처리합니다.\n\n' +
                     '감사필을 찍으면 이 자료는 고치거나 지울 수 없게 됩니다.\n계속하시겠습니까?')) return;

        b.disabled = true;
        if (msg) { msg.className = 'form-msg'; msg.textContent = '감사 도장을 찍는 중입니다...'; }

        loadSeals().then(function (s) {
          var head = s['감사부장'] || {};
          var clerk = s['감사부서기'] || {};
          return SHSCloud.init().then(function (c) {
            return c.rpc('set_audit_mark', {
              p_kind: opts.kind,
              p_id: parseInt(id, 10),
              p_done: true,
              p_year: w.year,
              p_period: w.period,
              p_opinion: (op && op.value.trim()) || null,
              p_head: head.holder || null,
              p_clerk: clerk.holder || null,
              p_head_seal: head.data || null,
              p_clerk_seal: clerk.data || null
            });
          });
        }).then(function (r) {
          b.disabled = false;
          if (r.error) {
            if (msg) { msg.className = 'form-msg err'; msg.textContent = r.error.message; }
            return;
          }
          SHSCloud.log('update', '감사필 처리', (opts.label || opts.kind) + ' #' + id);
          if (opts.after) opts.after();
        }).catch(function (x) {
          b.disabled = false;
          if (msg) { msg.className = 'form-msg err'; msg.textContent = (x && x.message) || '처리하지 못했습니다.'; }
        });
      });
    });

    box.querySelectorAll('button[data-audit-undo]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.auditUndo;
        if (!confirm('감사 표시를 풀겠습니까?\n\n잘못 찍은 경우에만 사용해 주세요. 푼 기록은 감사 기록에 남습니다.')) return;
        b.disabled = true;
        SHSCloud.init().then(function (c) {
          return c.rpc('set_audit_mark', { p_kind: opts.kind, p_id: parseInt(id, 10), p_done: false });
        }).then(function (r) {
          b.disabled = false;
          if (r.error) { alert(r.error.message); return; }
          SHSCloud.log('update', '감사 표시 해제', (opts.label || opts.kind) + ' #' + id);
          if (opts.after) opts.after();
        }).catch(function (x) {
          b.disabled = false;
          alert((x && x.message) || '처리하지 못했습니다.');
        });
      });
    });
  }

  /* 감사가 끝났으면 고치기·지우기 단추를 내린다 */
  function locked(rec) { return !!(rec && rec.audited_yn); }

  return {
    ready: ready,
    forget: forget,
    windowNow: windowNow,
    loadSeals: loadSeals,
    panel: panel,
    bind: bind,
    locked: locked
  };
})();

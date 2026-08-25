/* 회의록 (상비부·시찰 공용)
 *
 * 상비부와 시찰이 똑같은 모양으로 회의록을 남기도록 한 곳에 모아 두었다.
 * 회의 내용을 화면에 적어 두고, 정리된 문서를 함께 올릴 수 있다.
 * 봄·가을 감사 대상이므로 감사 칸(js/audit-mark.js)을 함께 붙인다.
 *
 *   SHSMinutesBox.mount(자리, {
 *     kind:   'sichal' | 'committee',
 *     owner:  '북부시찰' | '정치부',
 *     user:   지금 로그인한 사람,
 *     canEdit:  등록·수정·삭제를 할 수 있는가 (시찰장·서기 / 부장·서기)
 *     isAuditor: 감사부인가
 *   })
 */
var SHSMinutesBox = (function () {
  'use strict';

  var CFG = {
    sichal: {
      table: 'sichal_minutes', col: 'sichal', bucket: 'sichal-files', prefix: 'min',
      what: '시찰회', access: [
        { v: 'member',  t: '정회원 전체' },
        { v: 'sichal',  t: '이 시찰 소속' },
        { v: 'officer', t: '노회 임원' }
      ], def: 'sichal'
    },
    committee: {
      table: 'committee_minutes', col: 'committee', bucket: 'committee-files', prefix: 'min',
      what: '부회', access: [
        { v: 'member',  t: '정회원 전체' },
        { v: 'officer', t: '노회 임원' }
      ], def: 'member'
    }
  };

  /* 개회 예배 항목. 양식과 열람 화면이 이 하나를 함께 본다. */
  var WORSHIP = [
    { k: 'prayer',    t: '기도' },
    { k: 'scripture', t: '성경' },
    { k: 'hymn',      t: '찬송' },
    { k: 'preacher',  t: '설교자' },
    { k: 'sermon',    t: '제목' }
  ];

  function esc(s) { return SHS.esc(s); }
  function safeName(s) { return String(s || '').replace(/[^\w.\-가-힣]/g, '_'); }

  /* 적어 둔 것이 하나라도 있을 때에만 개회 예배 칸을 보여 준다 */
  function worshipBox(m) {
    var got = WORSHIP.filter(function (w) { return m[w.k]; });
    if (!got.length) return '';
    return '<h4 class="mn-sub">개회 예배</h4>' +
      '<div class="mn-worship">' + got.map(function (w) {
        return '<div><span>' + esc(w.t) + '</span>' + esc(m[w.k]) + '</div>';
      }).join('') + '</div>';
  }

  function mount(box, opts) {
    if (!box) return;
    var cfg = CFG[opts.kind];
    if (!cfg) { box.innerHTML = '<p style="color:var(--gray-5)">알 수 없는 회의록입니다.</p>'; return; }

    var rows = [];
    var file = null;

    function accessName(v) {
      var hit = cfg.access.filter(function (x) { return x.v === v; })[0];
      return hit ? hit.t : v;
    }

    function load() {
      box.innerHTML = '<p style="color:var(--gray-5)">회의록을 불러오는 중...</p>';
      SHSCloud.init().then(function (c) {
        return c.from(cfg.table).select('*').eq(cfg.col, opts.owner)
                .order('met_on', { ascending: false }).order('id', { ascending: false });
      }).then(function (r) {
        if (r.error) {
          box.innerHTML = '<p style="color:var(--gray-5)">회의록을 불러오지 못했습니다: ' +
            esc(r.error.message) +
            '<br>Supabase에서 <strong>36_audit_ledger.sql</strong>을 아직 실행하지 않으셨다면 먼저 실행해 주세요.</p>';
          return;
        }
        rows = r.data || [];
        draw();
      });
    }

    function draw() {
      var h = '<p style="color:var(--gray-5);font-size:0.88rem">' +
        cfg.what + ' 회의를 기록하고 보관하는 곳입니다. 회의 내용을 화면에 적어 두고, ' +
        '정리된 문서를 함께 올려 두실 수 있습니다. ' +
        '<strong>봄·가을 정기노회 전에 감사부의 감사를 받습니다.</strong></p>';

      if (!rows.length) {
        h += '<p style="color:var(--gray-5)">등록된 회의록이 없습니다.</p>';
      } else {
        h += '<div class="doc-list">' + rows.map(function (m, i) {
          var lock = SHSAuditMark.locked(m);
          return '<div class="doc-item">' +
            '<div class="d-name">' + esc(m.title) +
            (lock ? ' <span class="audit-stamp sm">감사필</span>' : '') + '</div>' +
            '<div class="d-desc">' +
            (m.met_on ? '<strong>' + esc(m.met_on) + '</strong>' : '') +
            (m.place ? ' · ' + esc(m.place) : '') +
            '<div style="margin-top:4px"><span class="role-badge">' + esc(accessName(m.access)) + '</span></div>' +
            (m.sermon || m.preacher
              ? '<div style="margin-top:6px">설교 : ' +
                esc([m.sermon, m.preacher].filter(Boolean).join(' · ')) + '</div>' : '') +
            (m.attendees ? '<div style="margin-top:6px">참석 : ' + esc(m.attendees) + '</div>' : '') +
            '</div>' +
            '<div>' +
            '<button class="btn sm" data-mnview="' + i + '">회의록 보기</button> ' +
            (m.file_path ? '<button class="btn ghost sm" data-mnfile="' + i + '">첨부 내려받기</button> ' : '') +
            (opts.canEdit && !lock
              ? '<button class="btn ghost sm" data-mnedit="' + i + '">수정</button> ' +
                '<button class="btn danger sm" data-mndel="' + i + '">삭제</button>'
              : '') +
            '</div></div>';
        }).join('') + '</div>';
        h += '<div id="mn-view" style="margin-top:16px"></div>';
      }

      if (opts.canEdit) h += form();
      box.innerHTML = h;
      if (opts.canEdit) bindForm();
      bindList();
    }

    function bindList() {
      box.querySelectorAll('button[data-mnview]').forEach(function (b) {
        b.addEventListener('click', function () {
          var m = rows[+b.dataset.mnview];
          var v = document.getElementById('mn-view');
          v.innerHTML =
            '<div class="admin-card"><h3 style="margin-top:0">' + esc(m.title) + '</h3>' +
            '<p style="color:var(--gray-5);font-size:0.85rem">' +
            esc(m.met_on || '') + (m.place ? ' · ' + esc(m.place) : '') + '</p>' +
            (m.attendees ? '<p><strong>참석</strong> ' + esc(m.attendees) + '</p>' : '') +
            worshipBox(m) +
            '<h4 class="mn-sub">결의 사항</h4>' +
            '<div style="white-space:pre-wrap;line-height:1.8">' +
            esc(m.body || '(적어 두신 결의 사항이 없습니다)') + '</div>' +
            SHSAuditMark.panel(m, { isAuditor: opts.isAuditor }) +
            '</div>';
          SHSAuditMark.bind(v, { kind: cfg.table, label: opts.owner + ' 회의록', after: load });
          SHS.logAction('view', cfg.what + ' 회의록 열람', opts.owner + ' / ' + m.title);
          v.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      });
      box.querySelectorAll('button[data-mnfile]').forEach(function (b) {
        b.addEventListener('click', function () {
          var m = rows[+b.dataset.mnfile];
          SHSCloud.init().then(function (c) {
            return c.storage.from(cfg.bucket).createSignedUrl(m.file_path, 60);
          }).then(function (r) {
            if (r.error) { alert('내려받지 못했습니다: ' + r.error.message); return; }
            SHSCloud.log('view', cfg.what + ' 회의록 첨부 내려받기', opts.owner + ' / ' + m.title);
            window.open(r.data.signedUrl, '_blank', 'noopener');
          });
        });
      });
      if (!opts.canEdit) return;
      box.querySelectorAll('button[data-mnedit]').forEach(function (b) {
        b.addEventListener('click', function () {
          var m = rows[+b.dataset.mnedit];
          document.getElementById('mn-id').value = m.id;
          document.getElementById('mn-title').value = m.title;
          document.getElementById('mn-date').value = m.met_on || '';
          document.getElementById('mn-place').value = m.place || '';
          document.getElementById('mn-att').value = m.attendees || '';
          WORSHIP.forEach(function (w) {
            document.getElementById('mn-' + w.k).value = m[w.k] || '';
          });
          document.getElementById('mn-body').value = m.body || '';
          document.getElementById('mn-access').value = m.access;
          document.getElementById('mn-ftitle').textContent = '회의록 수정';
          document.getElementById('mn-cancel').classList.remove('hidden');
          document.getElementById('mn-ftitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
      box.querySelectorAll('button[data-mndel]').forEach(function (b) {
        b.addEventListener('click', function () {
          var m = rows[+b.dataset.mndel];
          if (!confirm('"' + m.title + '" 회의록을 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
          SHSCloud.init().then(function (c) {
            var pre = m.file_path
              ? c.storage.from(cfg.bucket).remove([m.file_path]).catch(function () {})
              : Promise.resolve();
            return pre.then(function () { return c.from(cfg.table).delete().eq('id', m.id); });
          }).then(function (r) {
            if (r.error) { alert(r.error.message); return; }
            SHSCloud.log('delete', cfg.what + ' 회의록 삭제', opts.owner + ' / ' + m.title);
            load();
          });
        });
      });
    }

    function form() {
      return '<div class="admin-card" style="margin-top:18px">' +
        '<h3 style="margin-top:0" id="mn-ftitle">회의록 등록</h3>' +
        '<input type="hidden" id="mn-id" value="">' +
        '<div class="inline-form">' +
        '<div class="field"><label>회의 이름</label>' +
        '<input type="text" id="mn-title" placeholder="예: 제19회기 제2차 ' + cfg.what + '"></div>' +
        '<div class="field" style="flex:0 0 160px"><label>회의 날짜</label><input type="date" id="mn-date"></div>' +
        '<div class="field" style="flex:0 0 160px"><label>열람 범위</label><select id="mn-access">' +
        cfg.access.map(function (a) {
          return '<option value="' + a.v + '"' + (a.v === cfg.def ? ' selected' : '') + '>' + a.t + '</option>';
        }).join('') + '</select></div>' +
        '</div>' +
        '<div class="field"><label>장소</label><input type="text" id="mn-place"></div>' +
        '<div class="field"><label>참석자</label>' +
        '<input type="text" id="mn-att" placeholder="쉼표로 나누어 적어 주세요"></div>' +

        /* 개회 예배 — 회의는 예배로 시작하므로 함께 적어 둔다 */
        '<h4 class="mn-sub">개회 예배</h4>' +
        '<div class="inline-form">' +
        '<div class="field" style="flex:0 0 200px"><label>기도</label>' +
        '<input type="text" id="mn-prayer" placeholder="예: 김종수 목사"></div>' +
        '<div class="field" style="flex:0 0 220px"><label>성경</label>' +
        '<input type="text" id="mn-scripture" placeholder="예: 시편 133편 1-3절"></div>' +
        '<div class="field" style="flex:0 0 200px"><label>찬송</label>' +
        '<input type="text" id="mn-hymn" placeholder="예: 찬송가 391장"></div>' +
        '</div>' +
        '<div class="inline-form">' +
        '<div class="field" style="flex:0 0 200px"><label>설교자</label>' +
        '<input type="text" id="mn-preacher" placeholder="예: 박흥열 목사"></div>' +
        '<div class="field"><label>제목</label>' +
        '<input type="text" id="mn-sermon" placeholder="예: 하나 됨을 이루고"></div>' +
        '</div>' +

        '<h4 class="mn-sub">결의 사항</h4>' +
        '<div class="field"><textarea id="mn-body" rows="8" ' +
        'placeholder="안건과 결의 사항을 적어 주세요. 줄바꿈은 그대로 보입니다."></textarea></div>' +
        '<div class="field"><label>첨부파일 (선택 · 정리된 회의록 문서)</label>' +
        '<input type="file" id="mn-file"></div>' +
        '<button class="btn" id="mn-save">저장</button> ' +
        '<button class="btn ghost hidden" id="mn-cancel">취소</button>' +
        '<div class="form-msg" id="mn-msg"></div></div>';
    }

    function bindForm() {
      SHS.dropZone(document.getElementById('mn-file'), { what: '회의록 문서' });
      document.getElementById('mn-file').addEventListener('change', function () {
        file = this.files[0] || null;
      });
      document.getElementById('mn-cancel').addEventListener('click', function () {
        ['mn-id', 'mn-title', 'mn-date', 'mn-place', 'mn-att', 'mn-body']
          .concat(WORSHIP.map(function (w) { return 'mn-' + w.k; }))
          .forEach(function (id) { document.getElementById(id).value = ''; });
        document.getElementById('mn-ftitle').textContent = '회의록 등록';
        file = null;
        this.classList.add('hidden');
      });
      document.getElementById('mn-save').addEventListener('click', function () {
        var msg = document.getElementById('mn-msg');
        var id = document.getElementById('mn-id').value;
        var d = {
          title: document.getElementById('mn-title').value.trim(),
          met_on: document.getElementById('mn-date').value || null,
          place: document.getElementById('mn-place').value.trim() || null,
          attendees: document.getElementById('mn-att').value.trim() || null,
          prayer: document.getElementById('mn-prayer').value.trim() || null,
          scripture: document.getElementById('mn-scripture').value.trim() || null,
          hymn: document.getElementById('mn-hymn').value.trim() || null,
          preacher: document.getElementById('mn-preacher').value.trim() || null,
          sermon: document.getElementById('mn-sermon').value.trim() || null,
          body: document.getElementById('mn-body').value.trim() || null,
          access: document.getElementById('mn-access').value,
          updated_at: new Date().toISOString(),
          updated_by: opts.user.name
        };
        d[cfg.col] = opts.owner;
        if (!d.title) { msg.className = 'form-msg err'; msg.textContent = '회의 이름을 입력해 주세요.'; return; }
        if (!id) d.created_by = opts.user.name;
        msg.className = 'form-msg'; msg.textContent = '저장 중입니다...';

        SHSCloud.init().then(function (c) {
          var pre = Promise.resolve(null);
          if (file) {
            var path = safeName(opts.owner) + '/' + cfg.prefix + '-' + Date.now() + '-' + safeName(file.name);
            pre = c.storage.from(cfg.bucket).upload(path, file).then(function (r) {
              if (r.error) throw r.error;
              return { file_path: path, file_name: file.name };
            });
          }
          return pre.then(function (f) {
            if (f) { d.file_path = f.file_path; d.file_name = f.file_name; }
            return id ? c.from(cfg.table).update(d).eq('id', id)
                      : c.from(cfg.table).insert(d);
          });
        }).then(function (r) {
          if (r.error) { msg.className = 'form-msg err'; msg.textContent = r.error.message; return; }
          SHSCloud.log(id ? 'update' : 'create', cfg.what + ' 회의록 ' + (id ? '수정' : '등록'),
            opts.owner + ' / ' + d.title);
          file = null;
          load();
        }).catch(function (x) {
          msg.className = 'form-msg err';
          msg.textContent = '저장 실패: ' + ((x && x.message) || x);
        });
      });
    }

    /* 손으로 열어 둔 감사 기간이 있는지 먼저 읽고 그린다 */
    SHSAuditMark.ready().then(load, load);
  }

  return { mount: mount };
})();

/* 임원명단 관리 (노회 임원 명부·증경노회장단)
 *
 * 예전에는 사이트 관리(manage.html) 안에 있었으나, 회원 관리(admin.html)의
 * 회원 신상관리 옆 탭으로 옮기며 이 파일로 분리했다.
 *
 *   SHSOfficersPanel.mount(자리, 지금 로그인한 사람)
 */
var SHSOfficersPanel = (function () {
  'use strict';

  function mount(box, user) {
    if (!box) return;
    var e = SHS.esc;
    if (!user || !SHSAuth.canManageMembers(user) || !user.cloud) {
      box.innerHTML = '<div class="notice-banner">임원명단 관리는 관리자 등급이 ' +
        '서버 로그인(구글 또는 이메일) 후 이용할 수 있습니다.</div>';
      return;
    }
    var db = null;

  function mgModal(inner, maxWidth) {
    var old = document.getElementById('ofp-modal');
    if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'ofp-modal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,25,45,.55);z-index:300;' +
      'display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto';
    ov.innerHTML = '<div style="background:#fff;border-radius:8px;max-width:' + (maxWidth || 560) +
      'px;width:100%;padding:24px 26px;box-shadow:0 10px 40px rgba(0,0,0,.25);position:relative">' +
      '<button class="ofp-modal-x" aria-label="닫기" style="position:absolute;top:10px;right:14px;' +
      'border:none;background:none;font-size:1.4rem;color:var(--gray-5);cursor:pointer">&times;</button>' +
      inner + '</div>';
    document.body.appendChild(ov);
    function close() { ov.remove(); }
    ov.addEventListener('click', function (ev) { if (ev.target === ov) close(); });
    ov.querySelector('.ofp-modal-x').addEventListener('click', close);
    return { ov: ov, close: close };
  }

  function load() {
    db.from('site_settings').select('*').in('key', ['officers', 'delegates', 'veterans', 'sessions']).then(function (r) {
      if (r.error) { box.innerHTML = '<div class="notice-banner">불러오기 실패: ' + e(r.error.message) + '</div>'; return; }
      var officers = [], delegates = {}, veterans = [], curSession = null;
      (r.data || []).forEach(function (row) {
        if (row.key === 'officers') officers = row.value;
        if (row.key === 'delegates') delegates = row.value;
        if (row.key === 'veterans') veterans = (row.value && row.value.list) || [];
        if (row.key === 'sessions') curSession = (row.value && row.value.current) || null;
      });
      var canHand = user.role === 'president' || user.role === 'superadmin';

      /* 회원 명단을 받아 성명을 적으면 직분·교회가 저절로 채워지게 한다 */
      var rosterRows = [];
      db.from('roster').select('name,position,category,church')
        .then(function (rr) { rosterRows = (rr && rr.data) || []; }, function () {});

      var OF_TITLES = ['노회장', '부노회장', '서기', '부서기', '회록서기', '부회록서기', '회계', '부회계'];

      function saveOfficers(after) {
        return db.from('site_settings').upsert([
          { key: 'officers', value: officers, updated_at: new Date().toISOString() }
        ]).then(function (res) {
          if (res.error) { alert(res.error.message); return; }
          SHSCloud.log('update', '임원 명부 수정', '임원 ' + officers.length + '명');
          if (after) after();
        });
      }

      function drawOfficers() {
        var html = '<h2>노회 임원 명부</h2>';
        html += '<table class="tbl" style="max-width:820px"><thead><tr>' +
          '<th style="width:120px">직책</th><th style="width:110px">성명</th>' +
          '<th style="width:90px">직분</th><th>시무교회</th>' +
          '<th style="width:80px">관리</th></tr></thead><tbody>';
        if (!officers.length) {
          html += '<tr><td colspan="5" style="color:var(--gray-5)">등록된 임원이 없습니다.</td></tr>';
        }
        officers.forEach(function (o, i) {
          html += '<tr>' +
            '<td>' + e(o.role || '-') + '</td>' +
            '<td><strong>' + e(o.name || '-') + '</strong></td>' +
            '<td>' + e(o.position || '-') + '</td>' +
            '<td class="left">' + e(o.church || '-') + '</td>' +
            '<td><button class="btn sm" data-ofedit="' + i + '">수정</button></td></tr>';
        });
        html += '</tbody></table>';
        html += '<p><button class="btn ghost sm" id="of-addrow">임원 추가</button></p>';
        /* 총회 총대는 회원 관리 → 총회 총대 명단(delegates 테이블)에서 관리한다.
         * 예전의 site_settings 기반 카드는 중복이라 없앴다. */

        /* 증경노회장단: 권한 위임이 완료되면 자동 등재되고, 지난 기록은 손으로 넣는다 */
        html += '<h2>증경노회장단</h2>' +
          '<table class="tbl" style="max-width:820px"><thead><tr>' +
          '<th style="width:120px">구분</th><th style="width:110px">성명</th>' +
          '<th style="width:90px">직분</th><th>시무교회</th>' +
          '<th style="width:90px">회기</th><th style="width:80px">관리</th></tr></thead><tbody>';
        if (!veterans.length) {
          html += '<tr><td colspan="6" style="color:var(--gray-5)">등재된 증경단이 없습니다.</td></tr>';
        }
        veterans.forEach(function (o, i) {
          html += '<tr><td>' + e(o.role || '-') + '</td>' +
            '<td><strong>' + e(o.name || '-') + '</strong></td>' +
            '<td>' + e(o.position || '-') + '</td>' +
            '<td class="left">' + e(o.church || '-') + '</td>' +
            '<td>' + (o.session_no ? '제' + e(o.session_no) + '회기' : '-') + '</td>' +
            '<td><button class="btn sm" data-vtedit="' + i + '">수정</button></td></tr>';
        });
        html += '</tbody></table>' +
          '<p><button class="btn ghost sm" id="vt-add">증경단 추가</button></p>' +
          '<div class="form-msg" id="of-msg"></div>';
        box.innerHTML = html;

        function saveVeterans(after) {
          return db.from('site_settings').upsert([
            { key: 'veterans', value: { list: veterans }, updated_at: new Date().toISOString() }
          ]).then(function (res) {
            if (res.error) { alert(res.error.message); return; }
            SHSCloud.log('update', '증경노회장단 수정', '증경단 ' + veterans.length + '명');
            if (after) after();
          });
        }

        function openVeteranEdit(idx) {
          var isNew = idx < 0;
          var v0 = isNew ? { role: '증경노회장', name: '', position: '', church: '', session_no: '' } : veterans[idx];
          var mo = mgModal(
            '<h4 style="margin:0 0 14px">' + (isNew ? '증경단 추가' : '증경단 수정') + '</h4>' +
            '<div class="inline-form">' +
            '<div class="field" style="flex:0 0 150px"><label>구분</label>' +
            '<select id="vtm-role">' +
            ['증경노회장', '증경부노회장'].map(function (t) {
              return '<option' + (v0.role === t ? ' selected' : '') + '>' + t + '</option>';
            }).join('') + '</select></div>' +
            '<div class="field" style="flex:0 0 140px"><label>성명</label>' +
            '<input type="text" id="vtm-name" list="vtm-names" value="' + e(v0.name || '') + '">' +
            '<datalist id="vtm-names">' + rosterRows.map(function (m2) {
              return '<option value="' + e(m2.name) + '">';
            }).join('') + '</datalist></div>' +
            '<div class="field" style="flex:0 0 110px"><label>직분</label>' +
            '<input type="text" id="vtm-pos" value="' + e(v0.position || '') + '"></div>' +
            '<div class="field" style="flex:1 1 160px"><label>시무교회</label>' +
            '<input type="text" id="vtm-church" value="' + e(v0.church || '') + '"></div>' +
            '<div class="field" style="flex:0 0 100px"><label>회기 번호</label>' +
            '<input type="number" id="vtm-ses" min="1" max="99" value="' + e(v0.session_no || '') + '"></div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;margin-top:14px">' +
            '<button class="btn" id="vtm-save">저장</button>' +
            (isNew ? '' : '<button class="btn danger" id="vtm-del">삭제</button>') +
            '</div>', 640);

          /* 성명을 고르면 명단에서 직분·교회를 채워 준다 */
          mo.ov.querySelector('#vtm-name').addEventListener('change', function () {
            var hit = rosterRows.filter(function (m2) { return m2.name === this.value.trim(); }, this)[0];
            if (!hit) return;
            mo.ov.querySelector('#vtm-pos').value = hit.position || hit.category || '';
            mo.ov.querySelector('#vtm-church').value = hit.church || '';
          });
          mo.ov.querySelector('#vtm-save').addEventListener('click', function () {
            var name = mo.ov.querySelector('#vtm-name').value.trim();
            if (!name) { alert('성명을 적어 주세요.'); return; }
            var item = {
              role: mo.ov.querySelector('#vtm-role').value,
              name: name,
              position: mo.ov.querySelector('#vtm-pos').value.trim(),
              church: mo.ov.querySelector('#vtm-church').value.trim(),
              session_no: parseInt(mo.ov.querySelector('#vtm-ses').value, 10) || null
            };
            if (isNew) veterans.push(item); else veterans[idx] = item;
            mo.close();
            saveVeterans(drawOfficers);
          });
          var delB = mo.ov.querySelector('#vtm-del');
          if (delB) delB.addEventListener('click', function () {
            if (!confirm(v0.name + ' 님을 증경단 명단에서 빼시겠습니까?')) return;
            veterans.splice(idx, 1);
            mo.close();
            saveVeterans(drawOfficers);
          });
        }
        box.querySelectorAll('button[data-vtedit]').forEach(function (b) {
          b.addEventListener('click', function () { openVeteranEdit(parseInt(b.dataset.vtedit, 10)); });
        });
        document.getElementById('vt-add').addEventListener('click', function () { openVeteranEdit(-1); });

        box.querySelectorAll('button[data-ofedit]').forEach(function (b) {
          b.addEventListener('click', function () { openOfficerEdit(parseInt(b.dataset.ofedit, 10)); });
        });
        document.getElementById('of-addrow').addEventListener('click', function () {
          openOfficerEdit(-1);
        });
      }

      /* ----- 수정 팝업 ----- */
      /* 직책 사다리 (정·부 짝과 승계 규칙)
       * 목사: 부회록서기(부)→회록서기(정), 부서기(부)→서기(정),
       *       서기→부노회장(이때 현 목사 부노회장은 임원에서 빠져 정회원이 된다.
       *       노회장은 투표로 정하므로 권한 위임 절차로만 교체한다)
       * 장로: 부회계(부)→회계(정), 회계→부노회장은 장로 부노회장의 퇴임 처리로 이뤄진다 */
      var ROLE_UP = { '부회록서기': '회록서기', '부서기': '서기', '서기': '부노회장', '부회계': '회계' };
      var ROLE_DOWN = { '회록서기': '부회록서기', '서기': '부서기', '회계': '부회계' };

      /* 홈페이지 계정 등급도 함께 맞춘다 (노회장·최고관리자만 가능, 실패해도 명부는 저장) */
      function tuneGrade(name, role, title, note) {
        if (!canHand || !name) return Promise.resolve();
        return db.from('profiles').select('id').eq('name', name).then(function (r2) {
          var hit = r2 && r2.data && r2.data.length === 1 && r2.data[0];
          if (!hit) return;
          return db.rpc('set_member_role', { p_id: hit.id, p_role: role, p_title: title })
            .then(function () { SHSCloud.log('update', '등급 조정', name + ' → ' + (title || role) + (note ? ' (' + note + ')' : '')); },
                  function () {});
        }, function () {});
      }

      function openOfficerEdit(idx) {
        var o = idx >= 0 ? officers[idx] : { role: '', name: '', position: '목사', church: '' };
        var old = document.getElementById('of-modal');
        if (old) old.remove();
        var ov = document.createElement('div');
        ov.id = 'of-modal';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,25,45,.55);z-index:300;' +
          'display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto';
        ov.innerHTML =
          '<div style="background:#fff;border-radius:8px;max-width:520px;width:100%;padding:24px 26px;' +
          'box-shadow:0 10px 40px rgba(0,0,0,.25);position:relative">' +
          '<button id="of-modal-x" aria-label="닫기" style="position:absolute;top:10px;right:14px;' +
          'border:none;background:none;font-size:1.4rem;color:var(--gray-5);cursor:pointer">&times;</button>' +
          '<h3 style="margin:0 0 14px;color:var(--navy)">' +
          (idx >= 0 ? e(o.role || '') + ' ' + e(o.name || '') + ' — 임원 수정' : '임원 추가') + '</h3>' +
          '<div class="inline-form">' +
          '<div class="field" style="flex:0 0 150px"><label>직책</label>' +
          '<input type="text" id="ofm-role" list="ofm-titles" value="' + e(o.role || '') + '"></div>' +
          '<datalist id="ofm-titles">' + OF_TITLES.map(function (t) {
            return '<option value="' + t + '">';
          }).join('') + '</datalist>' +
          '<div class="field" style="flex:0 0 140px"><label>성명</label>' +
          '<input type="text" id="ofm-name" list="ofm-names" value="' + e(o.name || '') +
          '" autocomplete="off"></div>' +
          '<datalist id="ofm-names">' + rosterRows.map(function (m2) {
            return '<option value="' + e(m2.name) + '">';
          }).join('') + '</datalist>' +
          '</div>' +
          '<div class="inline-form">' +
          '<div class="field" style="flex:0 0 120px"><label>직분</label>' +
          '<input type="text" id="ofm-pos" value="' + e(o.position || '') + '"></div>' +
          '<div class="field"><label>시무교회</label>' +
          '<input type="text" id="ofm-church" value="' + e(o.church || '') + '"></div>' +
          '</div>' +
          '<p style="font-size:0.8rem;color:var(--gray-5)">성명을 회원 명단의 이름으로 적으면 ' +
          '직분과 시무교회가 저절로 채워집니다.</p>' +
          (function () {
            /* 직책 이동 버튼들 */
            if (idx < 0) return '';
            var role0 = (o.role || '').trim();
            if (role0 === '노회장') {
              return canHand
                ? '<div style="margin:4px 0 12px"><button class="btn" id="ofm-hand" ' +
                  'style="background:#b03a3a;border-color:#b03a3a">권한 위임</button>' +
                  '<span style="font-size:0.8rem;color:var(--gray-5);margin-left:8px">신임 노회장께서 수락하시면 자동으로 교체됩니다.</span></div>'
                : '<p style="font-size:0.8rem;color:var(--gray-5)">노회장 교체는 노회장 또는 최고관리자가 ' +
                  '<strong>노회 운영 &#8594; 노회장 권한 위임</strong>에서 합니다.</p>';
            }
            var acts = [];
            if (ROLE_UP[role0]) acts.push('<button class="btn ghost sm" id="ofm-up">직책 상향 &#8594; ' + ROLE_UP[role0] + '</button>');
            if (ROLE_DOWN[role0]) acts.push('<button class="btn ghost sm" id="ofm-down">정 &#8594; 부 이동 &#8594; ' + ROLE_DOWN[role0] + '</button>');
            if (role0.indexOf('부노회장') !== -1 && /장로/.test(o.position || '')) {
              acts.push('<button class="btn danger sm" id="ofm-retire">퇴임 (증경단 편입)</button>');
            }
            return acts.length
              ? '<div style="margin:4px 0 12px;display:flex;gap:8px;flex-wrap:wrap">' + acts.join('') + '</div>'
              : '';
          })() +
          '<div style="margin-top:6px"><button class="btn" id="ofm-save">저장</button> ' +
          '<button class="btn ghost" id="ofm-close">닫기</button>' +
          (idx >= 0 ? ' <button class="btn danger" id="ofm-del" style="float:right">삭제</button>' : '') +
          '</div><div class="form-msg" id="ofm-msg"></div></div>';
        document.body.appendChild(ov);
        function close() { ov.remove(); }
        ov.addEventListener('click', function (ev) { if (ev.target === ov) close(); });
        document.getElementById('of-modal-x').addEventListener('click', close);
        document.getElementById('ofm-close').addEventListener('click', close);

        /* 성명 → 명단에서 직분·교회 자동 채움 */
        var nameEl = document.getElementById('ofm-name');
        function autofill() {
          var hit = rosterRows.filter(function (m2) { return m2.name === nameEl.value.trim(); })[0];
          if (!hit) return;
          document.getElementById('ofm-pos').value = hit.position || hit.category || '';
          document.getElementById('ofm-church').value = hit.church || '';
        }
        nameEl.addEventListener('input', autofill);
        nameEl.addEventListener('change', autofill);

        document.getElementById('ofm-save').addEventListener('click', function () {
          var msg = document.getElementById('ofm-msg');
          var d = {
            role: document.getElementById('ofm-role').value.trim(),
            name: nameEl.value.trim(),
            position: document.getElementById('ofm-pos').value.trim(),
            church: document.getElementById('ofm-church').value.trim()
          };
          if (!d.role || !d.name) {
            msg.className = 'form-msg err';
            msg.textContent = '직책과 성명을 적어 주세요.';
            return;
          }
          if (idx >= 0) officers[idx] = d; else officers.push(d);
          saveOfficers(function () { close(); drawOfficers(); });
        });
        var delBtn = document.getElementById('ofm-del');
        if (delBtn) delBtn.addEventListener('click', function () {
          if (!confirm('"' + o.role + ' ' + o.name + '" 임원을 명부에서 지우시겠습니까?')) return;
          officers.splice(idx, 1);
          saveOfficers(function () { close(); drawOfficers(); });
        });

        /* 노회장 — 권한 위임 화면으로 */
        var handBtn = document.getElementById('ofm-hand');
        if (handBtn) handBtn.addEventListener('click', function () {
          close();
          /* 사이트 관리 → 노회 운영 → 노회장 권한 위임으로 */
          location.href = 'manage.html#ops-hand';
        });

        /* 직책 상향 / 정→부 이동 */
        function moveRole(to) {
          var role0 = (o.role || '').trim();
          /* 서기 → 부노회장: 현 목사 부노회장은 임원에서 빠지고 정회원이 된다 */
          var outVice = null;
          if (role0 === '서기' && to === '부노회장') {
            officers.forEach(function (x, j) {
              if (!outVice && j !== idx && (x.role || '').trim() === '부노회장' && !/장로/.test(x.position || '')) {
                outVice = { i: j, o: x };
              }
            });
          }
          var lines = '"' + o.role + ' ' + o.name + '" 님의 직책을 ' + to + '(으)로 바꾸시겠습니까?';
          if (outVice) {
            lines = '서기 ' + o.name + ' 님을 부노회장으로 올립니다.\n' +
              '· 현 부노회장 ' + outVice.o.name + ' 목사님은 임원에서 빠지고 정회원이 됩니다.\n' +
              '  (노회장은 투표로 정하므로 권한 위임 절차로만 교체됩니다)\n계속하시겠습니까?';
          }
          if (!confirm(lines)) return;
          officers[idx].role = to;
          if (outVice) officers.splice(outVice.i, 1);
          saveOfficers(function () {
            SHSCloud.log('update', '임원 직책 이동', o.name + ': ' + o.role + ' → ' + to +
              (outVice ? ' / ' + outVice.o.name + ' 임원 탈락(정회원)' : ''));
            var after = outVice ? tuneGrade(outVice.o.name, 'member', null, '부노회장 임기 종료') : Promise.resolve();
            after.then(function () {
              return tuneGrade(o.name, 'officer', to, '직책 이동');
            }).then(function () { close(); drawOfficers(); });
          });
        }
        var upBtn = document.getElementById('ofm-up');
        if (upBtn) upBtn.addEventListener('click', function () { moveRole(ROLE_UP[(o.role || '').trim()]); });
        var dnBtn = document.getElementById('ofm-down');
        if (dnBtn) dnBtn.addEventListener('click', function () { moveRole(ROLE_DOWN[(o.role || '').trim()]); });

        /* 장로 부노회장 퇴임 — 증경단 편입, 회계 장로가 부노회장으로 */
        var rtBtn = document.getElementById('ofm-retire');
        if (rtBtn) rtBtn.addEventListener('click', function () {
          var acct = null;
          officers.forEach(function (x, j) {
            if (!acct && j !== idx && (x.role || '').trim() === '회계') acct = x;
          });
          var lines = '장로 부노회장 ' + o.name + ' 님을 퇴임 처리합니다.\n' +
            '· ' + o.name + ' 님은 증경부노회장으로 증경단에 오릅니다.\n' +
            (acct ? '· 회계 ' + acct.name + ' 님이 부노회장이 됩니다.\n'
                  : '· 회계가 명부에 없어 부노회장 자리는 비워 둡니다.\n') +
            '계속하시겠습니까?';
          if (!confirm(lines)) return;
          veterans.push({ role: '증경부노회장', name: o.name, position: o.position || '장로',
                          church: o.church || '', session_no: curSession || null });
          if (acct) acct.role = '부노회장';
          officers.splice(idx, 1);
          db.from('site_settings').upsert([
            { key: 'officers', value: officers, updated_at: new Date().toISOString() },
            { key: 'veterans', value: { list: veterans }, updated_at: new Date().toISOString() }
          ]).then(function (res) {
            if (res.error) { alert(res.error.message); return; }
            SHSCloud.log('update', '장로 부노회장 퇴임',
              o.name + ' → 증경부노회장' + (acct ? ' / ' + acct.name + ' → 부노회장' : ''));
            var after = tuneGrade(o.name, 'member', null, '부노회장 퇴임');
            after.then(function () {
              return acct ? tuneGrade(acct.name, 'officer', '(장로)부노회장', '퇴임 승계') : null;
            }).then(function () { close(); drawOfficers(); });
          });
        });
      }

      drawOfficers();
    });
  }

    SHSCloud.init().then(function (c) { db = c; load(); });
  }

  return { mount: mount };
})();

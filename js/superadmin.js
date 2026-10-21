/* 최고관리자 메뉴 (2026-10-22 사용자 지시) — 최고관리자만, 2단계 인증 로그인에서만 쓴다
 *
 *   AI 허용 범위   임원마다 AI 검색 모델을 정한다 (창구 KV settings.user_models).
 *                  최고관리자 자신은 늘 Opus. 정하지 않은 분은 「AI 검색·API 설정」의 기본 모델.
 *   활동 내역      감사 기록 전체 (js/audit-view.js) — 오해를 부를 만한 기록은 사유를 적어 감출 수 있다.
 *                  감춘 기록도 지워지지 않으며, 관리자는 「감춘 기록도 보기」로 사유와 함께 본다 (138 sql).
 *   검색 내역      회원 AI 검색 질문 전체 — 물은 사람은 가리고, 점검 낱말(비속어·욕설·비방)에 걸린
 *                  질문만 누가 물었는지 보인다 (138 sql super_ai_logs, 처리방침의 부정 이용 방지 목적 안).
 *
 * 주소 끝 #ai · #act · #srch 로 그 탭을 바로 연다.
 */
var SHSSuper = (function () {
  'use strict';

  function mount(area, user) {
    var e = SHS.esc;
    if (!user || !user.cloud || user.role !== 'superadmin') {
      area.innerHTML = '<div class="notice-banner">이 메뉴는 <strong>최고관리자</strong>만 이용할 수 있습니다.' +
        (user ? '' : ' <a class="btn sm" style="margin-left:10px" href="login.html">로그인</a>') + '</div>';
      return;
    }
    var WORKER = window.SHSAI && SHSAI.url;

    var TABS = [['ai', 'AI 허용 범위'], ['act', '활동 내역'], ['srch', '검색 내역']];
    area.innerHTML = '<div class="tabs" id="su-tabs">' + TABS.map(function (t) {
        return '<button type="button" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>' +
      TABS.map(function (t) { return '<div class="tab-panel" id="su-' + t[0] + '"></div>'; }).join('');

    var ready = {};
    function show(id) {
      if (!document.getElementById('su-' + id)) id = 'ai';
      area.querySelectorAll('#su-tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === id); });
      area.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'su-' + id); });
      if (!ready[id]) {
        ready[id] = true;
        if (id === 'ai') mountAi(document.getElementById('su-ai'));
        if (id === 'act') SHSAuditView.mount(document.getElementById('su-act'), user);
        if (id === 'srch') mountSearch(document.getElementById('su-srch'));
      }
    }
    area.querySelectorAll('#su-tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        show(b.dataset.tab);
        try { history.replaceState(null, '', '#' + b.dataset.tab); } catch (x) {}
      });
    });
    show((location.hash || '').replace('#', '') || 'ai');

    /* ---------- 창구(AI 워커) 부르기 ---------- */
    function token() {
      return SHSCloud.init().then(function (c) {
        return c.auth.getSession().then(function (r) { return r && r.data && r.data.session ? r.data.session.access_token : null; });
      });
    }
    function call(path, method, body) {
      if (!WORKER) return Promise.resolve({ error: 'AI 창구 주소를 찾지 못했습니다.' });
      return token().then(function (tk) {
        return fetch(WORKER + path, {
          method: method || 'GET',
          headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined
        });
      }).then(function (r) {
        return r.json().catch(function () { return { error: '창구 응답을 읽지 못했습니다 (HTTP ' + r.status + ')' }; })
          .then(function (j) { if (!r.ok && !j.error) j.error = 'HTTP ' + r.status; return j; });
      }).catch(function (x) {
        return { error: '창구에 연결하지 못했습니다. (' + (x && x.message) + ')' };
      });
    }

    /* ---------- 1. AI 허용 범위 ---------- */
    function mountAi(box) {
      box.innerHTML = '<p style="color:var(--gray-5)">설정을 불러오는 중...</p>';
      var OFFICER_ROLES = ['president', 'clerk', 'staff', 'officer'];
      Promise.all([
        call('/settings'),
        SHSCloud.init().then(function (c) {
          return c.from('profiles').select('id,name,role,title,church,email').in('role', OFFICER_ROLES).order('name');
        })
      ]).then(function (rs) {
        var S = rs[0], pr = rs[1];
        if (S.error) { box.innerHTML = '<div class="notice-banner">' + e(S.error) + '</div>'; return; }
        var people = (pr && pr.data) || [];
        var models = S.models || [];
        var um = S.user_models || {};
        function mName(id) {
          var m = models.filter(function (x) { return x.id === id; })[0];
          return m ? m.name : id;
        }
        function price(m) { return '1백만 토큰당 입력 $' + m.input + ' · 출력 $' + m.output; }
        /* 직책 — 화면 표기(displayRole)는 노회장·서기·간사를 '관리자'로 묶지만 여기서는 직책 그대로 */
        function dutyName(p) {
          return ({ president: '노회장', clerk: '서기', staff: '간사' })[p.role] || String(p.title || '').trim() || '임원';
        }
        var RANK = { president: 1, clerk: 2, staff: 3, officer: 4 };
        people.sort(function (a, b) {
          return (RANK[a.role] || 9) - (RANK[b.role] || 9) || String(a.name).localeCompare(String(b.name));
        });

        var h = (S.user_models ? '' : '<div class="notice-banner">AI 창구(sihwasan-ai)가 아직 새 버전으로 배포되지 않았습니다. ' +
            '배포하기 전에는 임원별 모델을 저장할 수 없고, 모든 분이 기본 모델로 검색합니다.</div>') +
          '<p style="font-size:0.9rem;color:var(--gray-6);margin:0 0 12px">' +
          '임원마다 AI 검색에 쓸 모델을 정합니다. 정하지 않은 분과 정회원은 「AI 검색·API 설정」의 ' +
          '<strong>기본 모델(' + e(mName(S.model)) + ')</strong>을 씁니다. 최고관리자의 검색은 늘 <strong>' +
          e(mName(S.super_model || 'claude-opus-5-5')) + '</strong>입니다. 저장은 최고관리자(2단계 인증)만 할 수 있습니다.</p>';
        h += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px">' + models.map(function (m) {
          return '<span style="font-size:0.82rem;border:1px solid var(--gray-2);border-radius:6px;padding:4px 8px">' +
            '<strong>' + e(m.name) + '</strong> — ' + e(m.note || '') + ' · ' + e(price(m)) + '</span>';
        }).join('') + '</div>';
        h += '<div style="overflow-x:auto"><table class="tbl" id="su-ai-tbl"><thead><tr>' +
          '<th style="width:110px">성명</th><th style="width:130px">직책</th><th>교회</th>' +
          '<th style="width:260px">AI 검색 모델</th></tr></thead><tbody>';
        h += '<tr style="background:var(--gray-1,#f5f4f0)"><td><strong>' + e(user.name || '최고관리자') + '</strong></td>' +
          '<td>최고관리자</td><td class="left">-</td><td>' + e(mName(S.super_model || 'claude-opus-5-5')) + ' (고정)</td></tr>';
        if (!people.length) {
          h += '<tr><td colspan="4" style="color:var(--gray-5)">임원 등급 계정이 없습니다.</td></tr>';
        }
        people.forEach(function (p) {
          var cur = um[p.id] || '';
          /* 한 분이 계정을 둘 가진 경우가 있어(예: 서기) 계정 이메일을 함께 적는다 */
          h += '<tr><td>' + e(p.name || '-') +
            (p.email ? '<div style="font-size:0.76rem;color:var(--gray-5);word-break:break-all">' + e(p.email) + '</div>' : '') + '</td>' +
            '<td>' + e(dutyName(p)) + '</td>' +
            '<td class="left">' + e(p.church || '-') + '</td>' +
            '<td><select data-uid="' + e(p.id) + '" style="width:100%">' +
            '<option value="">기본 모델 따름 (' + e(mName(S.model)) + ')</option>' +
            models.map(function (m) {
              return '<option value="' + e(m.id) + '"' + (m.id === cur ? ' selected' : '') + '>' + e(m.name) + '</option>';
            }).join('') + '</select></td></tr>';
        });
        h += '</tbody></table></div>' +
          '<div style="margin-top:12px"><button class="btn" id="su-ai-save">저장</button>' +
          '<span class="form-msg" id="su-ai-msg" style="margin-left:10px"></span></div>' +
          (S.updated_at ? '<p style="font-size:0.8rem;color:var(--gray-5);margin-top:8px">마지막 설정 저장: ' +
            e(String(S.updated_at).replace('T', ' ').slice(0, 16)) + (S.updated_by ? ' · ' + e(S.updated_by) : '') + '</p>' : '');
        box.innerHTML = h;

        box.querySelector('#su-ai-save').addEventListener('click', function () {
          var btn = this, msg = box.querySelector('#su-ai-msg');
          var map = {};
          box.querySelectorAll('select[data-uid]').forEach(function (s) { if (s.value) map[s.dataset.uid] = s.value; });
          btn.disabled = true;
          msg.className = 'form-msg'; msg.textContent = '저장하는 중...';
          call('/settings', 'POST', { user_models: map }).then(function (j) {
            btn.disabled = false;
            if (j.error) { msg.className = 'form-msg err'; msg.textContent = j.error; return; }
            /* 옛 창구는 user_models 를 모르고 그냥 넘긴다 — 저장된 값이 돌아오지 않으면 저장되지 않은 것 */
            if (!j.user_models) {
              msg.className = 'form-msg err';
              msg.textContent = 'AI 창구(sihwasan-ai)가 아직 새 버전으로 배포되지 않아 저장되지 않았습니다. 배포한 뒤 다시 저장해 주세요.';
              return;
            }
            msg.className = 'form-msg ok';
            msg.textContent = '저장했습니다. 다음 질문부터 정한 모델로 답합니다.';
          });
        });
      });
    }

    /* ---------- 3. 검색 내역 ---------- */
    function mountSearch(box) {
      var flaggedOnly = false, lastId = null, words = [];
      box.innerHTML =
        '<p style="font-size:0.9rem;color:var(--gray-6);margin:0 0 12px">' +
        '회원들의 AI 검색 질문입니다. <strong>물은 분은 가려 두고</strong>, 아래 점검 낱말(비속어·욕설·비방)에 ' +
        '걸린 질문만 누가 물었는지 보입니다. (개인정보처리방침의 부정 이용 방지 목적)</p>' +
        '<div class="board-controls" style="flex-wrap:wrap;gap:10px;align-items:center">' +
        '<label style="display:inline-flex;align-items:center;gap:6px;font-weight:400">' +
        '<input type="checkbox" id="su-s-flag" style="width:auto"> 걸린 질문만</label>' +
        '<button class="btn ghost sm" id="su-s-reload">새로 고침</button>' +
        '<span id="su-s-sum" style="font-size:0.86rem;color:var(--gray-6)"></span></div>' +
        '<div id="su-s-list"></div>' +
        '<div style="margin:10px 0 18px"><button class="btn ghost sm" id="su-s-more" style="display:none">더 보기</button></div>' +
        '<details id="su-w" style="border:1px solid var(--gray-2);border-radius:8px;padding:10px 14px">' +
        '<summary style="cursor:pointer;font-weight:700">점검 낱말 고치기</summary>' +
        '<div id="su-w-body" style="margin-top:10px"></div></details>';
      var list = box.querySelector('#su-s-list'), more = box.querySelector('#su-s-more'), sum = box.querySelector('#su-s-sum');
      var shown = 0, hit = 0;

      function mark(text, hits) {
        var out = e(text || '');
        (hits || []).forEach(function (w) {
          var ew = e(w);
          if (!ew) return;
          out = out.split(ew).join('<mark>' + ew + '</mark>');
        });
        return out;
      }
      function roleName(r) { return SHSCloud.roleName ? SHSCloud.roleName(r) : r; }

      function load(reset) {
        if (reset) { lastId = null; shown = 0; hit = 0; list.innerHTML = '<p style="color:var(--gray-5)">불러오는 중...</p>'; }
        more.style.display = 'none';
        SHSCloud.init().then(function (c) {
          return c.rpc('super_ai_logs', { p_limit: 100, p_before: lastId, p_flagged: flaggedOnly });
        }).then(function (r) {
          if (reset) list.innerHTML = '';
          if (r.error) {
            list.innerHTML = '<div class="notice-banner">' +
              (/super_ai_logs|function/.test(r.error.message || '') && r.error.code !== '42501'
                ? '검색 내역 보기는 <strong>138 sql</strong>(Supabase SQL Editor)을 실행한 뒤에 열립니다.'
                : e(r.error.message)) + '</div>';
            return;
          }
          var rows = r.data || [];
          rows.forEach(function (x) {
            var flagged = !!(x.out_hits && x.out_hits.length);
            if (flagged) hit++;
            shown++;
            lastId = x.out_id;
            var div = document.createElement('div');
            div.style.cssText = 'border:1px solid ' + (flagged ? '#d9a3a3' : 'var(--gray-2)') + ';border-radius:8px;' +
              'padding:10px 14px;margin:0 0 10px;' + (flagged ? 'background:#fdf3f3' : '');
            div.innerHTML =
              '<div style="font-size:0.8rem;color:var(--gray-5);display:flex;flex-wrap:wrap;gap:10px">' +
              '<span>' + e(String(x.out_created_at).replace('T', ' ').slice(0, 16)) + '</span>' +
              '<span>' + e(roleName(x.out_role)) + '</span>' +
              (x.out_no_answer ? '<span>못 찾은 답</span>' : '') +
              (x.out_fb_helpful === false ? '<span>「도움 안 됨」 평가</span>' : '') +
              '<span>' + (flagged ? '<strong class="fail">물은 분: ' + e(x.out_asker || '-') + '</strong>' : '물은 분: 가림') + '</span>' +
              '</div>' +
              '<div style="margin-top:4px;font-weight:600">' + mark(x.out_question, x.out_hits) + '</div>' +
              (x.out_fb_reason ? '<div style="font-size:0.84rem;color:var(--gray-6);margin-top:2px">평가 이유: ' +
                mark(x.out_fb_reason, x.out_hits) + '</div>' : '') +
              (flagged ? '<div class="fail" style="font-size:0.82rem;margin-top:4px">걸린 낱말: ' + e(x.out_hits.join(', ')) + '</div>' : '') +
              (x.out_answer ? '<details style="margin-top:4px"><summary style="cursor:pointer;font-size:0.84rem;color:var(--gray-6)">답 보기</summary>' +
                '<div style="font-size:0.86rem;white-space:pre-wrap;margin-top:4px">' +
                e(String(x.out_answer).replace(/\[R\d+\]|\{\{[\s\S]*?\}\}/g, '')) + '</div></details>' : '');
            list.appendChild(div);
          });
          if (!shown) list.innerHTML = '<p style="color:var(--gray-5)">' + (flaggedOnly ? '걸린 질문이 없습니다.' : '검색 기록이 없습니다.') + '</p>';
          sum.textContent = shown + '건' + (flaggedOnly ? '' : ' · 걸린 질문 ' + hit + '건');
          more.style.display = rows.length >= 100 ? '' : 'none';
        });
      }
      box.querySelector('#su-s-flag').addEventListener('change', function () { flaggedOnly = this.checked; load(true); });
      box.querySelector('#su-s-reload').addEventListener('click', function () { load(true); });
      more.addEventListener('click', function () { load(false); });
      load(true);

      /* 점검 낱말 */
      var wb = box.querySelector('#su-w-body');
      function drawWords() {
        wb.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' +
          (words.length ? words.map(function (w) {
            return '<span style="border:1px solid var(--gray-3);border-radius:14px;padding:3px 6px 3px 10px;font-size:0.86rem">' +
              e(w) + ' <button type="button" class="btn ghost sm" data-wdel="' + e(w) + '" ' +
              'style="padding:0 6px;min-height:0;line-height:1.4" title="빼기">×</button></span>';
          }).join('') : '<span style="color:var(--gray-5)">낱말이 없습니다.</span>') + '</div>' +
          '<div class="inline-form"><div class="field" style="flex:0 0 220px;margin:0"><input type="text" id="su-w-new" maxlength="30" placeholder="더할 낱말"></div>' +
          '<button class="btn sm" id="su-w-add" style="align-self:center">더하기</button>' +
          '<span class="form-msg" id="su-w-msg" style="align-self:center"></span></div>' +
          '<p style="font-size:0.8rem;color:var(--gray-5);margin:6px 0 0">질문이나 평가 이유에 이 낱말이 들어 있으면 「걸린 질문」이 됩니다. ' +
          '성경·회의 말에도 나오는 낱말(예: 새끼, 죽여)은 엉뚱하게 걸리니 넣지 않는 편이 좋습니다.</p>';
        wb.querySelectorAll('[data-wdel]').forEach(function (b) {
          b.addEventListener('click', function () {
            var w = b.dataset.wdel;
            SHSCloud.init().then(function (c) { return c.from('watch_words').delete().eq('word', w); })
              .then(function (r) { if (!r.error) { words = words.filter(function (x) { return x !== w; }); drawWords(); } });
          });
        });
        wb.querySelector('#su-w-add').addEventListener('click', function () {
          var inp = wb.querySelector('#su-w-new'), msg = wb.querySelector('#su-w-msg');
          var w = inp.value.trim();
          if (!w) return;
          SHSCloud.init().then(function (c) { return c.from('watch_words').insert({ word: w }); }).then(function (r) {
            if (r.error) { msg.className = 'form-msg err'; msg.textContent = r.error.code === '23505' ? '이미 있는 낱말입니다.' : r.error.message; return; }
            words.push(w); words.sort(); drawWords();
          });
        });
      }
      box.querySelector('#su-w').addEventListener('toggle', function () {
        if (!this.open || words.length) return;
        wb.innerHTML = '<p style="color:var(--gray-5)">불러오는 중...</p>';
        SHSCloud.init().then(function (c) { return c.from('watch_words').select('word').order('word'); }).then(function (r) {
          if (r.error) { wb.innerHTML = '<div class="notice-banner">점검 낱말은 138 sql 을 실행한 뒤에 쓸 수 있습니다.</div>'; return; }
          words = (r.data || []).map(function (x) { return x.word; });
          drawWords();
        });
      });
    }
  }

  return { mount: mount };
})();

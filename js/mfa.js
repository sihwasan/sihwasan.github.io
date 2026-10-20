/* 시화산노회 — 임원 등급 2단계 인증 (구글 OTP)
 *
 * 임원 등급(최고관리자·노회장·서기·간사·임원)은 모두 로그인할 때 비밀번호(또는 구글·네이버)에 더해
 * 휴대전화의 Google OTP(Google Authenticator) 앱에 나오는 6자리 숫자를 한 번 더 확인한다 (2026-10-20 노회 결정).
 * Supabase 인증의 TOTP 2단계 인증(auth.mfa)을 그대로 쓴다.
 *
 *   SHSMfa.mountVerify(el)             mfa.html — 로그인 뒤 6자리 숫자 확인, 아직 없으면 먼저 등록
 *   SHSMfa.mountSettings(el, profile)  내 정보 — 휴대전화 바꾸기(다시 등록), 임원 등급이 아니게 된 분은 끄기,
 *                                      최고관리자에게는 임원별 등록 현황과 초기화(124 sql)
 *
 * 화면마다 js/supabase-auth.js 가 확인해 mfa.html 로 보낸다. 서버 쪽에서도 막으려면
 * supabase/124_admin_mfa.sql 을 실행한다 (관리·임원 권한에 OTP 확인 조건).
 */
var SHSMfa = (function () {
  var ROLE = { superadmin: '최고관리자', president: '노회장', clerk: '서기', staff: '간사', officer: '임원' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ymd(iso) { return String(iso || '').slice(0, 10); }
  function mustOtp(p) { return !!(window.SHSCloud && SHSCloud.needsOtp && SHSCloud.needsOtp(p)); }
  function client() {
    return SHSCloud.init().then(function (c) {
      if (!c || !c.auth || !c.auth.mfa) throw new Error('로그인 서버에 연결할 수 없습니다.');
      return c;
    });
  }
  function must(r) {
    if (r && r.error) throw r.error;
    return r ? r.data : null;
  }
  /* 서버 오류를 알아듣기 쉬운 말로 */
  function why(e) {
    var m = String((e && e.message) || e || '');
    if (/invalid.*(totp|code)|code.*invalid|Invalid TOTP/i.test(m)) return '숫자가 맞지 않습니다. 앱에 지금 나온 6자리 숫자를 다시 넣어 주세요. (휴대전화 시간이 자동으로 맞춰져 있어야 합니다)';
    if (/expired/i.test(m)) return '확인 시간이 지났습니다. 다시 시도해 주세요.';
    if (/disabled/i.test(m)) return '로그인 서버에서 OTP 2단계 인증이 꺼져 있습니다. Supabase → Authentication → Multi-Factor 에서 TOTP 를 켜 주세요.';
    if (/aal2|AAL2/.test(m)) return '먼저 OTP 확인을 마쳐야 합니다. 다시 로그인해 주세요.';
    if (/rate|too many/i.test(m)) return '너무 여러 번 시도했습니다. 잠시 뒤 다시 해 주세요.';
    return m || '처리하지 못했습니다.';
  }
  /* 6자리 숫자 칸 — 숫자만 받고, 여섯 자리가 차면 바로 확인한다 */
  function codeInput(id) {
    return '<input type="text" id="' + id + '" class="mfa-code" inputmode="numeric" pattern="[0-9]*" ' +
      'autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="OTP 6자리 숫자">';
  }
  function bindCode(input, go) {
    input.addEventListener('input', function () {
      var v = input.value.replace(/\D/g, '').slice(0, 6);
      if (v !== input.value) input.value = v;
      if (v.length === 6) go();
    });
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
  }
  /* QR 은 SVG 글이나 data 주소로 온다 — 어느 쪽이든 그림으로 */
  function qrSrc(q) {
    q = String(q || '');
    if (q.indexOf('data:') === 0) return q;
    if (q.indexOf('<svg') !== -1) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(q);
    return '';
  }
  function verifiedTotp(data) {
    return ((data && data.all) || []).filter(function (f) { return f.factor_type === 'totp' && f.status === 'verified'; })[0] || null;
  }
  function msgSetter(el) {
    return function (t, ok) { if (!el) return; el.className = 'form-msg' + (t ? (ok ? ' ok' : ' err') : ''); el.textContent = t || ''; };
  }

  /* ================= 등록 (QR → 6자리 확인) =================
   * 남은 미완료 등록을 치우고 새로 등록해 QR 을 보인다. 마치면 onDone(), 취소하면 onCancel(). */
  function enrollFlow(body, say, onDone, onCancel) {
    var busy = true, c0;
    say('');
    body.innerHTML = '<p style="color:var(--gray-5)">QR 코드를 만드는 중입니다…</p>';
    client().then(function (c) {
      c0 = c;
      return c.auth.mfa.listFactors();
    }).then(must).then(function (data) {
      var left = ((data && data.all) || []).filter(function (f) { return f.factor_type === 'totp' && f.status !== 'verified'; });
      return Promise.all(left.map(function (f) { return c0.auth.mfa.unenroll({ factorId: f.id }); }));
    }).then(function () {
      var d = new Date();
      return c0.auth.mfa.enroll({
        factorType: 'totp', issuer: '시화산노회',
        friendlyName: 'Google OTP ' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' +
          d.getHours() + ':' + d.getMinutes() + ':' + d.getSeconds()
      });
    }).then(must).then(function (en) {
      busy = false;
      var t = en.totp || {};
      var secret = String(t.secret || '').replace(/(.{4})/g, '$1 ').trim();
      var src = qrSrc(t.qr_code);
      body.innerHTML =
        '<ol class="mfa-steps">' +
        '<li>휴대전화에 <strong>Google OTP</strong>(Google Authenticator) 앱을 설치합니다. (Play 스토어·앱 스토어에서 「Google OTP」)</li>' +
        '<li>앱에서 <strong>+</strong> → <strong>QR 코드 스캔</strong>으로 아래 그림을 찍습니다.</li>' +
        '<li>앱에 나온 <strong>시화산노회</strong> 6자리 숫자를 아래 칸에 넣습니다.</li></ol>' +
        (src ? '<div class="mfa-qr"><img src="' + esc(src) + '" alt="2단계 인증 등록 QR 코드" width="200" height="200"></div>' : '') +
        '<details class="mfa-manual"><summary>QR 코드를 찍을 수 없을 때 (지금 이 휴대전화로 보고 있을 때)</summary>' +
        (t.uri ? '<p><a class="btn ghost sm" href="' + esc(t.uri) + '">이 휴대전화의 OTP 앱으로 열기</a></p>' : '') +
        '<p>또는 앱에서 <strong>설정 키 입력</strong>을 고르고, 계정 이름은 「시화산노회」, 키는 아래 글자를 넣습니다 (시간 기준).</p>' +
        '<p class="mfa-secret">' + esc(secret) + '</p></details>' +
        '<div class="mfa-row">' + codeInput('mfa-new') +
        '<button type="button" class="btn" id="mfa-ok">확인</button>' +
        (onCancel ? '<button type="button" class="btn ghost" id="mfa-cancel">취소</button>' : '') + '</div>';
      var input = body.querySelector('#mfa-new');
      var ok = body.querySelector('#mfa-ok');
      function go() {
        var code = input.value.replace(/\D/g, '');
        if (code.length !== 6) { say('6자리 숫자를 넣어 주세요.', false); return; }
        if (busy) return;
        busy = true; ok.disabled = true; say('확인하는 중입니다…', true);
        c0.auth.mfa.challengeAndVerify({ factorId: en.id, code: code }).then(must).then(function () {
          SHSCloud.log('update', '2단계 인증 등록', '');
          onDone();
        }).catch(function (e) {
          busy = false; ok.disabled = false;
          input.value = ''; input.focus();
          say(why(e), false);
        });
      }
      bindCode(input, go);
      ok.addEventListener('click', go);
      var cancel = body.querySelector('#mfa-cancel');
      if (cancel) cancel.addEventListener('click', function () {
        if (busy) return;
        busy = true;
        c0.auth.mfa.unenroll({ factorId: en.id }).then(onCancel, onCancel);
      });
      input.focus();
    }).catch(function (e) {
      busy = false;
      body.innerHTML = '<p class="form-msg err">' + esc(why(e)) + '</p>' +
        '<button type="button" class="btn ghost sm" id="mfa-retry">다시 시도</button>';
      body.querySelector('#mfa-retry').addEventListener('click', function () { enrollFlow(body, say, onDone, onCancel); });
    });
  }

  /* ================= 내 정보 ================= */
  function mountSettings(el, p) {
    if (!el || !p || !(window.SHSCloud && SHSCloud.enabled())) return;
    var required = mustOtp(p);
    client().then(function (c) { return c.auth.mfa.listFactors(); }).then(must).then(function (data) {
      /* 임원 등급이거나, 예전에 등록해 둔 분에게만 보인다 */
      if (!required && !verifiedTotp(data)) return;
      el.innerHTML = '<h2 id="mfa">2단계 인증 (Google OTP)</h2>' +
        '<div class="form-card mfa-card" style="max-width:520px;margin:0"><div id="mfa-body"></div>' +
        '<div class="form-msg" id="mfa-msg"></div></div>' +
        (p.role === 'superadmin' ? '<div id="mfa-admins"></div>' : '');
      var body = el.querySelector('#mfa-body');
      var say = msgSetter(el.querySelector('#mfa-msg'));
      var busy = false;

      function draw(on, note) {
        if (on) {
          body.innerHTML =
            '<p class="mfa-state on"><strong>사용 중</strong> <span>등록 ' + esc(ymd(on.created_at)) + '</span></p>' +
            '<p class="mfa-help">로그인할 때마다 휴대전화의 Google OTP 앱에 나오는 6자리 숫자를 한 번 더 확인합니다.' +
            (required ? ' 임원 등급은 2단계 인증을 끌 수 없습니다.' : '') + '</p>' +
            '<div class="mfa-btns"><button type="button" class="btn ghost" id="mfa-phone">휴대전화를 바꿨습니다</button>' +
            (required ? '' : '<button type="button" class="btn ghost" id="mfa-off">2단계 인증 끄기</button>') + '</div>' +
            '<div id="mfa-confirm"></div>';
          body.querySelector('#mfa-phone').addEventListener('click', function () { confirmOff(on, true); });
          var off = body.querySelector('#mfa-off');
          if (off) off.addEventListener('click', function () { confirmOff(on, false); });
        } else {
          body.innerHTML = '<p class="mfa-state"><strong>등록되어 있지 않습니다</strong></p>' +
            '<button type="button" class="btn" id="mfa-on" style="width:100%">Google OTP 등록하기</button>';
          body.querySelector('#mfa-on').addEventListener('click', function () { enrollFlow(body, say, done, required ? null : refresh); });
        }
        say(note || '', true);
      }
      function refresh(note) {
        client().then(function (c) { return c.auth.mfa.listFactors(); }).then(must)
          .then(function (d) { draw(verifiedTotp(d), typeof note === 'string' ? note : ''); })
          .catch(function (e) { say(why(e), false); });
      }
      function done() { refresh('등록했습니다. 다음 로그인부터 6자리 숫자를 묻습니다.'); }

      /* 휴대전화 바꾸기·끄기 — 화면 안에서 한 번 더 묻는다 */
      function confirmOff(on, again) {
        var box = body.querySelector('#mfa-confirm');
        box.innerHTML = '<div class="mfa-ask"><p>' + (again
          ? '지금 등록된 휴대전화를 지우고 새 휴대전화로 다시 등록합니다. 새 휴대전화를 손에 들고 계속해 주세요.'
          : '2단계 인증을 끄면 로그인할 때 6자리 숫자를 묻지 않습니다. 끌까요?') + '</p>' +
          '<button type="button" class="btn danger sm" id="mfa-yes">' + (again ? '새로 등록하기' : '끄기') + '</button> ' +
          '<button type="button" class="btn ghost sm" id="mfa-no">취소</button></div>';
        box.querySelector('#mfa-no').addEventListener('click', function () { box.innerHTML = ''; });
        var yes = box.querySelector('#mfa-yes');
        yes.focus();
        yes.addEventListener('click', function () {
          if (busy) return;
          busy = true; yes.disabled = true;
          client().then(function (c) { return c.auth.mfa.unenroll({ factorId: on.id }); }).then(must).then(function () {
            busy = false;
            SHSCloud.log('update', again ? '2단계 인증 휴대전화 바꾸기' : '2단계 인증 끄기', '');
            if (again) enrollFlow(body, say, done, null); else refresh('2단계 인증을 껐습니다.');
          }).catch(function (e) { busy = false; yes.disabled = false; say(why(e), false); });
        });
      }

      draw(verifiedTotp(data), '');
      if (p.role === 'superadmin') adminList(el.querySelector('#mfa-admins'));
    }).catch(function () { /* 상태를 못 읽으면 칸을 그리지 않는다 */ });
  }

  /* ================= 최고관리자 — 임원별 등록 현황·초기화 (124 sql) ================= */
  function adminList(box) {
    if (!box) return;
    client().then(function (c) { return c.rpc('admin_mfa_list'); }).then(function (r) {
      if (r.error) {   /* 124 sql 을 아직 실행하지 않았으면 안내만 */
        box.innerHTML = '<p class="mfa-note">임원별 2단계 인증 현황과 초기화는 <code>supabase/124_admin_mfa.sql</code> 을 실행하면 여기에 보입니다.</p>';
        return;
      }
      var rows = r.data || [];
      var on = rows.filter(function (a) { return a.enrolled; }).length;
      box.innerHTML = '<h3 class="mfa-sub">임원 2단계 인증 현황 <small>' + on + ' / ' + rows.length + '명 등록</small></h3>' +
        '<p class="mfa-note">휴대전화를 잃어버린 분은 「초기화」하면 다음 로그인 때 새 휴대전화로 다시 등록합니다.</p>' +
        '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th class="left">이름</th><th>등급</th><th>2단계 인증</th><th></th></tr></thead><tbody>' +
        rows.map(function (a) {
          return '<tr><td class="left">' + esc(a.name || '-') + (a.title ? ' <small style="color:var(--gray-5)">' + esc(a.title) + '</small>' : '') + '</td>' +
            '<td>' + esc(ROLE[a.role] || a.role) + '</td>' +
            '<td>' + (a.enrolled ? '<span class="pass">등록</span> <small>' + esc(ymd(a.enrolled_at)) + '</small>' : '<span class="fail">미등록</span>') + '</td>' +
            '<td>' + (a.enrolled ? '<button type="button" class="btn ghost sm" data-mfareset="' + esc(a.id) + '" data-name="' + esc(a.name || '') + '">초기화</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div><div class="form-msg" id="mfa-admsg"></div>';
      box.querySelectorAll('button[data-mfareset]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.dataset.armed !== '1') {   /* 한 번 더 눌러야 초기화 */
            b.dataset.armed = '1';
            b.textContent = '정말 초기화';
            b.classList.add('danger');
            setTimeout(function () { if (b.isConnected && !b.disabled) { b.dataset.armed = ''; b.textContent = '초기화'; b.classList.remove('danger'); } }, 4000);
            return;
          }
          b.disabled = true;
          client().then(function (c) { return c.rpc('admin_reset_mfa', { p_user: b.dataset.mfareset }); }).then(function (r) {
            var m = box.querySelector('#mfa-admsg');
            if (r.error) { b.disabled = false; m.className = 'form-msg err'; m.textContent = why(r.error); return; }
            SHSCloud.log('update', '2단계 인증 초기화', b.dataset.name);
            adminList(box);
          });
        });
      });
    }).catch(function () { box.innerHTML = ''; });
  }

  /* ================= mfa.html — 로그인 뒤 확인, 아직 없으면 등록 ================= */
  function backTo() {
    var t = '';
    try { t = sessionStorage.getItem('shs_mfa_back') || ''; sessionStorage.removeItem('shs_mfa_back'); } catch (e) {}
    return /^[a-z][a-z0-9-]*\.html([?#][^\s]*)?$/.test(t) && !/^(mfa|login)\.html/.test(t) ? t : 'index.html';
  }
  function mountVerify(el) {
    if (!el) return;
    var c0 = null, lv = null, prof = null;
    function outLink() {
      return '<p class="mfa-note" style="margin-top:18px">휴대전화를 잃어버리셨으면 노회 사무실(031-486-9993)이나 최고관리자에게 ' +
        '2단계 인증 초기화를 부탁해 주세요. <button type="button" class="linklike" id="mfa-out">로그아웃</button></p>';
    }
    function bindOut() {
      var o = el.querySelector('#mfa-out');
      if (o) o.addEventListener('click', function () { SHSCloud.signOut().then(function () { location.replace('login.html'); }); });
    }
    client().then(function (c) {
      c0 = c;
      return c.auth.getSession();
    }).then(function (r) {
      if (!(r && r.data && r.data.session)) { location.replace('login.html'); return null; }
      return Promise.all([c0.auth.mfa.getAuthenticatorAssuranceLevel().then(must), SHSCloud.loadProfile(), c0.auth.mfa.listFactors().then(must)]);
    }).then(function (xs) {
      if (!xs) return;
      lv = xs[0]; prof = xs[1];
      var factor = verifiedTotp(xs[2]);
      var title = document.getElementById('mfa-title');

      /* 1) 등록되어 있고 아직 확인 전 → 6자리 숫자 확인 */
      if (factor && lv && lv.currentLevel !== 'aal2') {
        el.innerHTML =
          '<p class="mfa-help">임원 등급 계정은 2단계 인증을 씁니다.<br>휴대전화의 <strong>Google OTP</strong> 앱에 나온 ' +
          '<strong>시화산노회</strong> 6자리 숫자를 넣어 주세요.</p>' +
          '<div class="mfa-row">' + codeInput('mfa-code') + '<button type="button" class="btn" id="mfa-go">확인</button></div>' +
          '<div class="form-msg" id="mfa-vmsg"></div>' + outLink();
        bindOut();
        var input = el.querySelector('#mfa-code');
        var btn = el.querySelector('#mfa-go');
        var say = msgSetter(el.querySelector('#mfa-vmsg'));
        var busy = false;
        var go = function () {
          var code = input.value.replace(/\D/g, '');
          if (code.length !== 6) { say('6자리 숫자를 넣어 주세요.', false); return; }
          if (busy) return;
          busy = true; btn.disabled = true; say('확인하는 중입니다…', true);
          c0.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code }).then(must).then(function () {
            say('확인되었습니다.', true);
            location.replace(backTo());
          }).catch(function (e) {
            busy = false; btn.disabled = false;
            input.value = ''; input.focus();
            say(why(e), false);
          });
        };
        bindCode(input, go);
        btn.addEventListener('click', go);
        input.focus();
        return;
      }
      /* 2) 임원 등급인데 아직 등록하지 않음 → 먼저 등록 */
      if (!factor && mustOtp(prof)) {
        if (title) title.textContent = '2단계 인증 등록';
        el.innerHTML =
          '<p class="mfa-help"><strong>' + esc(prof.name || '') + ' ' + esc(ROLE[prof.role] || '') + '</strong>님, ' +
          '임원 등급 계정은 2단계 인증(Google OTP)을 꼭 쓰셔야 합니다. 처음 한 번만 등록하시면 됩니다.</p>' +
          '<div id="mfa-enroll"></div><div class="form-msg" id="mfa-vmsg"></div>' + outLink();
        bindOut();
        enrollFlow(el.querySelector('#mfa-enroll'), msgSetter(el.querySelector('#mfa-vmsg')), function () {
          location.replace(backTo());
        }, null);
        return;
      }
      /* 3) 할 일 없음 */
      location.replace(backTo());
    }).catch(function (e) {
      el.innerHTML = '<p class="form-msg err">' + esc(why(e)) + '</p>' +
        '<p><a class="btn ghost sm" href="login.html">로그인 화면으로</a></p>';
    });
  }

  return { mountSettings: mountSettings, mountVerify: mountVerify };
})();

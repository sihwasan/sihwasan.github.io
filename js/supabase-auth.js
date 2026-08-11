/* 시화산노회 홈페이지 - Supabase 인증 (구글 로그인)
 *
 * 이 파일은 서버(Supabase)를 통해 로그인과 권한을 처리한다.
 * 브라우저 저장소 방식(auth.js)과 달리 사용자가 임의로 등급을 바꿀 수 없다.
 *
 * 사용 전 js/supabase-config.js 에 anon 키를 입력해야 한다.
 */

var SHSCloud = (function () {
  var client = null;
  var profile = null;
  var ready = false;

  var ROLE_NAMES = {
    superadmin: '최고관리자',
    president: '노회장',
    clerk: '서기',
    staff: '간사',
    officer: '임원',
    member: '정회원',
    pending: '승인대기'
  };

  function roleName(r) { return ROLE_NAMES[r] || r; }

  /* Supabase 라이브러리를 내려받아 클라이언트를 준비한다. */
  function init() {
    return new Promise(function (resolve) {
      if (ready) { resolve(client); return; }
      if (!window.SHS_SUPABASE || !SHS_SUPABASE.ready()) { resolve(null); return; }

      function build() {
        try {
          client = window.supabase.createClient(SHS_SUPABASE.url, SHS_SUPABASE.anonKey);
          ready = true;
        } catch (e) { client = null; }
        resolve(client);
      }

      if (window.supabase && window.supabase.createClient) { build(); return; }

      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
      s.onload = build;
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
  }

  /* 현재 로그인한 회원의 프로필(등급 포함)을 가져온다. */
  function loadProfile() {
    return init().then(function (c) {
      if (!c) return null;
      return c.auth.getUser().then(function (res) {
        var user = res && res.data && res.data.user;
        if (!user) { profile = null; return null; }
        return c.from('profiles').select('*').eq('id', user.id).single()
          .then(function (r) {
            profile = r.data || { id: user.id, email: user.email, name: '', role: 'pending' };
            return profile;
          })
          .catch(function () {
            profile = { id: user.id, email: user.email, name: '', role: 'pending' };
            return profile;
          });
      });
    });
  }

  function currentProfile() { return profile; }

  /* 구글 로그인 시작 */
  function signInWithGoogle() {
    return init().then(function (c) {
      if (!c) {
        alert('로그인 서버 설정이 아직 완료되지 않았습니다. 노회 사무실로 문의해 주세요.');
        return null;
      }
      return c.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: SHS_SUPABASE.redirectTo }
      });
    });
  }

  function signOut() {
    return init().then(function (c) {
      if (!c) return null;
      return c.auth.signOut().then(function () { profile = null; });
    });
  }

  /* 성명·소속 교회를 등록하고 노회 명단과 대조하여 등급을 부여받는다. */
  /* 생년월일은 정년(만 70세) 판정에 쓰이므로 등급을 정하기 전에 먼저 저장한다 */
  function claimMembership(name, church, position, phone, birth) {
    return init().then(function (c) {
      if (!c) return { ok: false, msg: '서버에 연결할 수 없습니다.' };
      var pre = Promise.resolve();
      if (birth) {
        pre = c.auth.getUser().then(function (u) {
          var id = u && u.data && u.data.user && u.data.user.id;
          if (!id) return;
          return c.from('profiles').update({ birth_date: birth }).eq('id', id);
        }).catch(function () {});
      }
      return pre.then(function () {
      return c.rpc('claim_membership', {
        p_name: name, p_church: church, p_position: position, p_phone: phone || ''
      }).then(function (r) {
        if (r.error) return { ok: false, msg: r.error.message };
        var row = (r.data && r.data[0]) || {};
        return { ok: true, role: row.out_role, title: row.out_title, roleName: roleName(row.out_role) };
      });
      });
    });
  }

  /* 감사 로그 기록 */
  /* 최고관리자는 홈페이지를 기술적으로 유지·보수하는 운영자 계정이므로
   * 그 행위는 감사 기록 대상에서 제외한다. (개인정보처리방침에 고지)
   * 서버에도 같은 규칙이 걸려 있어 다른 경로로도 기록되지 않는다. */
  function log(type, action, detail) {
    return init().then(function (c) {
      if (!c || !profile) return null;
      if (profile.role === 'superadmin') return null;
      return c.from('audit_logs').insert({
        user_id: profile.id, user_email: profile.email, user_name: profile.name,
        role: profile.role, type: type, action: action, detail: detail || ''
      });
    }).catch(function () { return null; });
  }

  /* 권한 판정 (서버 RLS와 동일한 기준을 화면 표시에 사용) */
  function isMember(p) { p = p || profile; return !!p && p.role !== 'pending'; }
  function isOfficer(p) {
    p = p || profile;
    return !!p && ['superadmin', 'president', 'clerk', 'staff', 'officer'].indexOf(p.role) !== -1;
  }
  function canManage(p) {
    p = p || profile;
    return !!p && ['superadmin', 'president', 'clerk', 'staff'].indexOf(p.role) !== -1;
  }
  function isSuperadmin(p) { p = p || profile; return !!p && p.role === 'superadmin'; }

  /* 설정이 되어 있는지 (미설정이면 기존 방식으로 동작) */
  function enabled() { return !!(window.SHS_SUPABASE && SHS_SUPABASE.ready()); }

  return {
    init: init,
    enabled: enabled,
    loadProfile: loadProfile,
    currentProfile: currentProfile,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    claimMembership: claimMembership,
    log: log,
    roleName: roleName,
    isMember: isMember,
    isOfficer: isOfficer,
    canManage: canManage,
    isSuperadmin: isSuperadmin
  };
})();

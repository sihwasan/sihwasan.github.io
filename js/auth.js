/* 시화산노회 홈페이지 - 회원/권한 관리 및 감사 로그
 * 데모 구현: 브라우저 localStorage 기반.
 * 실제 운영 시 서버(예: Supabase, 그누보드 등) 인증으로 교체해야 합니다.
 */

/* ---------- 감사 로그 (감독 기능) ----------
 * 개인정보 열람, 자료 추가·수정·삭제, 로그인 등 주요 행위를 기록한다.
 * 로그 열람은 관리자(노회장·서기·간사)만 가능하며, 로그는 삭제 기능을 두지 않는다.
 */
var SHSAudit = (function () {
  var KEY = 'shs_audit_v1';
  var MAX = 500;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }

  function stamp() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* type: view(개인정보·자료 열람) / create(추가) / update(수정) / delete(삭제) / auth(로그인·아웃) / issue(서류발급) */
  function log(type, action, detail) {
    var u = null;
    try { u = SHSAuth.currentUser(); } catch (e) {}
    var rows = load();
    rows.push({
      time: stamp(),
      userId: u ? u.id : '(비로그인)',
      userName: u ? u.name : '방문자',
      role: u ? u.role : '-',
      type: type,
      action: action,
      detail: detail || ''
    });
    if (rows.length > MAX) rows = rows.slice(rows.length - MAX);
    localStorage.setItem(KEY, JSON.stringify(rows));
  }

  function list() { return load(); }

  var TYPE_NAMES = {
    view: '열람', create: '추가', update: '수정', 'delete': '삭제', auth: '접속', issue: '서류발급'
  };

  return { log: log, list: list, typeName: function (t) { return TYPE_NAMES[t] || t; } };
})();

var SHSAuth = (function () {
  var USERS_KEY = 'shs_users_v4';
  var SESSION_KEY = 'shs_session_v1';

  /* 등급 정의
   * superadmin : 최고관리자
   * president  : 노회장
   * clerk      : 서기
   * staff      : 간사
   * officer    : 임원 (부노회장·부서기·회록서기·부회록서기·회계·부회계)
   * member     : 정회원 (노회 소속 목사, 총대 장로)
   * pending    : 승인대기
   */
  var ROLE_NAMES = {
    superadmin: '최고관리자',
    president: '노회장',
    clerk: '서기',
    staff: '간사',
    officer: '임원',
    member: '정회원',
    pending: '승인대기'
  };

  function hash(str) {
    /* 데모용 해시 (운영 시 서버측 bcrypt 등으로 교체) */
    var h = 5381, i;
    str = 'shs$' + str + '$presbytery';
    for (i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return 'h' + (h >>> 0).toString(36);
  }

  /* 초기 계정 (이메일이 곧 아이디). 홈페이지 관리자: 노회장, 서기, 간사 */
  function seedUsers() {
    return [
      { id: 'parkhy@sihwasan.kr', email: 'parkhy@sihwasan.kr', pw: hash('1234'), name: '박흥열',
        role: 'president', title: '노회장', position: '목사', church: '시흥생수교회', phone: '' },
      { id: 'kwonbr@sihwasan.kr', email: 'kwonbr@sihwasan.kr', pw: hash('1234'), name: '권병렬',
        role: 'clerk', title: '서기', position: '목사', church: '섬김의교회', phone: '' },
      { id: 'gansa@sihwasan.kr', email: 'gansa@sihwasan.kr', pw: hash('1234'), name: '노회 간사',
        role: 'staff', title: '간사', position: '간사', church: '노회 사무실', phone: '' }
    ];
  }

  /* 별도 파일에서 계정을 보장 생성 (이미 있으면 유지) */
  function ensureAccount(seed) {
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === seed.id) return;
    }
    users.push({
      id: seed.id, pw: hash(seed.pw), name: seed.name,
      role: seed.role || 'member', position: seed.position || '', church: seed.church || ''
    });
    saveUsers(users);
  }

  function loadUsers() {
    try {
      var raw = localStorage.getItem(USERS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    var seeded = seedUsers();
    saveUsers(seeded);
    return seeded;
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function currentUser() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      var users = loadUsers();
      for (var i = 0; i < users.length; i++) {
        if (users[i].id === s.id) return users[i];
      }
    } catch (e) {}
    return null;
  }

  function startSession(id, keep) {
    var store = keep ? localStorage : sessionStorage;
    store.setItem(SESSION_KEY, JSON.stringify({ id: id, at: new Date().toISOString() }));
  }

  function login(id, pw, keep) {
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === id && users[i].pw === hash(pw)) {
        startSession(id, keep);
        SHSAudit.log('auth', '로그인', '아이디 ' + id);
        return { ok: true, user: users[i] };
      }
    }
    SHSAudit.log('auth', '로그인 실패', '아이디 ' + id);
    return { ok: false, msg: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  }

  function logout() {
    SHSAudit.log('auth', '로그아웃', '');
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  }

  /* ---------- 권한 ---------- */

  function roleName(role) { return ROLE_NAMES[role] || role; }

  /* 회원명단 추가·삭제: 노회장, 서기, 간사, 최고관리자 */
  function canManageMembers(u) {
    return !!u && (u.role === 'president' || u.role === 'clerk' || u.role === 'staff' || u.role === 'superadmin');
  }

  /* 서류 발급 권한은 서기에게 있다.
   * 노회장은 허락 주체로서, 간사는 서기를 대행하여 발급 실무를 처리하므로
   * 화면 접근은 허용하되 발급 기록에는 대행·승인으로 구분해 남긴다. */
  function canIssueDocuments(u) {
    return !!u && (u.role === 'clerk' || u.role === 'president' || u.role === 'staff' ||
                   u.role === 'superadmin');
  }

  /* 직책(서기·노회장·간사) 지정: 최고관리자 */
  function canAssignRoles(u) {
    return !!u && u.role === 'superadmin';
  }

  /* 감사 기록 열람: 관리자(노회장·서기·간사)와 최고관리자 */
  function canViewAudit(u) {
    return canManageMembers(u);
  }

  /* 정회원 이상 열람 자료 (승인대기 회원 제외) */
  function isMember(u) { return !!u && u.role !== 'pending'; }

  /* 승인대기 회원을 정회원으로 설정: 관리자 등급 전원 (노회장·서기·간사) */
  function canApproveMembers(u) {
    return canManageMembers(u);
  }

  /* ---------- 임원 자료실 보안 등급 ----------
   * 일반자료·대외비자료 : 노회 임원과 간사
   * 기밀자료           : 노회장·부노회장·서기·간사 (최고관리자 포함)
   *                     간사는 기밀자료의 등록·수정 실무를 담당한다. */
  function canViewSecret(u) {
    if (!u) return false;
    if (u.role === 'superadmin' || u.role === 'president' ||
        u.role === 'clerk' || u.role === 'staff') return true;
    return u.role === 'officer' && !!u.title && u.title.indexOf('부노회장') !== -1;
  }

  function canViewLevel(u, level) {
    if (level === '기밀') return canViewSecret(u);
    return isOfficer(u);
  }

  /* 자료 등록·수정·삭제: 관리자이면서 해당 등급을 볼 수 있는 사람 */
  function canEditLevel(u, level) {
    return canManageMembers(u) && canViewLevel(u, level);
  }

  /* 임원 전용 자료(회의록 등): 노회 임원 전원(노회장·부노회장·서기·부서기·회록서기·
   * 부회록서기·회계·부회계)과 간사, 최고관리자 */
  function isOfficer(u) {
    return !!u && (u.role === 'president' || u.role === 'clerk' || u.role === 'staff' ||
                   u.role === 'officer' || u.role === 'superadmin');
  }

  /* ---------- 회원가입 ---------- */

  /* 교회명 정규화: 공백 제거, 끝의 "교회" 생략 허용 */
  function normChurch(s) {
    return String(s || '').replace(/\s+/g, '').replace(/교회$/, '');
  }

  /* 노회 임원 직책 → 홈페이지 등급 */
  var OFFICER_ROLE = {
    '노회장': 'president',
    '서기': 'clerk',
    '간사': 'staff'
  };

  /* 회원명단·임원명단과 이름·교회를 대조하여 부여할 등급을 반환한다.
   * 임원이면 해당 임원 등급, 일반 회원이면 정회원, 일치하지 않으면 null(승인대기). */
  function rosterRole(name, church) {
    var D = window.SHSData;
    if (!D) return null;
    var n = String(name || '').replace(/\s+/g, '');
    var c = normChurch(church);
    if (!n || !c) return null;

    /* 1) 노회 임원 명단 우선 대조 */
    var offs = D.officers || [];
    for (var i = 0; i < offs.length; i++) {
      if (offs[i].name.replace(/\s+/g, '') === n && normChurch(offs[i].church) === c) {
        return { role: OFFICER_ROLE[offs[i].role] || 'officer', title: offs[i].role };
      }
    }

    /* 2) 일반 회원명단 대조 */
    var lists = [].concat(D.pastors || [], D.assocPastors || [], D.seniorPastors || [], D.retiredPastors || []);
    Object.keys(D.elders || {}).forEach(function (k) { lists = lists.concat(D.elders[k]); });
    for (var j = 0; j < lists.length; j++) {
      if (lists[j].name.replace(/\s+/g, '') === n && normChurch(lists[j].church) === c) {
        return { role: 'member', title: null };
      }
    }
    return null;
  }

  function isEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || ''));
  }

  /* 자가 회원가입: 이메일을 아이디로 사용한다.
   * 임원명단과 일치하면 해당 임원 등급, 회원명단과 일치하면 정회원,
   * 일치하지 않으면 승인대기 상태로 가입된다. */
  function register(data) {
    var email = String(data.email || data.id || '').trim().toLowerCase();
    if (!email || !data.pw || !data.name || !data.church) {
      return { ok: false, msg: '이메일, 비밀번호, 성명, 소속 교회는 필수 항목입니다.' };
    }
    if (!isEmail(email)) {
      return { ok: false, msg: '올바른 이메일 주소를 입력해 주세요. (예: hong@naver.com)' };
    }
    if (String(data.pw).length < 4) {
      return { ok: false, msg: '비밀번호는 4자 이상으로 입력해 주세요.' };
    }
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === email) return { ok: false, msg: '이미 가입된 이메일입니다.' };
    }
    var matched = rosterRole(data.name, data.church);
    users.push({
      id: email, email: email, pw: hash(data.pw), name: data.name,
      role: matched ? matched.role : 'pending',
      title: matched ? matched.title : null,
      position: data.position || '목사', church: data.church,
      phone: data.phone || '',
      joinedAt: new Date().toISOString().slice(0, 10)
    });
    saveUsers(users);
    var result = matched ? ROLE_NAMES[matched.role] + ' 자동승인' : '승인대기';
    SHSAudit.log('create', '회원가입', email + ' (' + data.name + ', ' + data.church + ') → ' + result);
    return {
      ok: true,
      autoApproved: !!matched,
      role: matched ? matched.role : 'pending',
      roleName: matched ? ROLE_NAMES[matched.role] : '승인대기',
      title: matched ? matched.title : null
    };
  }

  /* ---------- 내 정보 수정 / 탈퇴 ---------- */

  function updateProfile(actorId, data) {
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id !== actorId) continue;
      var u = users[i];
      var changes = [];

      if (data.email && data.email.trim().toLowerCase() !== u.id) {
        var newEmail = data.email.trim().toLowerCase();
        if (!isEmail(newEmail)) return { ok: false, msg: '올바른 이메일 주소를 입력해 주세요.' };
        for (var j = 0; j < users.length; j++) {
          if (users[j].id === newEmail) return { ok: false, msg: '이미 가입된 이메일입니다.' };
        }
        changes.push('이메일');
        u.id = newEmail; u.email = newEmail;
      }
      if (data.name && data.name !== u.name) { changes.push('성명'); u.name = data.name; }
      if (data.position && data.position !== u.position) { changes.push('직분'); u.position = data.position; }
      if (typeof data.phone === 'string' && data.phone !== (u.phone || '')) { changes.push('연락처'); u.phone = data.phone; }
      if (data.church && data.church !== u.church) { changes.push('소속 교회'); u.church = data.church; }

      /* 성명·교회가 바뀌면 임원/회원 명단과 다시 대조하여 등급을 갱신한다.
       * (관리자가 직접 지정한 등급과 최고관리자 등급은 유지) */
      var reassigned = null;
      if (u.role !== 'superadmin' && (changes.indexOf('성명') !== -1 || changes.indexOf('소속 교회') !== -1)) {
        var m = rosterRole(u.name, u.church);
        if (m && m.role !== u.role) {
          u.role = m.role; u.title = m.title;
          reassigned = ROLE_NAMES[m.role];
        }
      }

      saveUsers(users);
      if (changes.length) {
        SHSAudit.log('update', '내 정보 수정', u.id + ' — ' + changes.join(', ') + ' 변경' +
          (reassigned ? ' (등급 ' + reassigned + '으로 갱신)' : ''));
      }
      return { ok: true, changed: changes, newId: u.id, reassigned: reassigned };
    }
    return { ok: false, msg: '계정을 찾을 수 없습니다.' };
  }

  function changePassword(actorId, currentPw, newPw) {
    if (String(newPw || '').length < 4) {
      return { ok: false, msg: '새 비밀번호는 4자 이상으로 입력해 주세요.' };
    }
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === actorId) {
        if (users[i].pw !== hash(currentPw)) {
          return { ok: false, msg: '현재 비밀번호가 올바르지 않습니다.' };
        }
        users[i].pw = hash(newPw);
        saveUsers(users);
        SHSAudit.log('update', '비밀번호 변경', actorId + ' 본인 변경');
        return { ok: true };
      }
    }
    return { ok: false, msg: '계정을 찾을 수 없습니다.' };
  }

  /* 회원 탈퇴 (본인) */
  function withdraw(actorId, pw) {
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === actorId) {
        if (users[i].pw !== hash(pw)) {
          return { ok: false, msg: '비밀번호가 올바르지 않습니다.' };
        }
        var name = users[i].name;
        users.splice(i, 1);
        saveUsers(users);
        SHSAudit.log('delete', '회원 탈퇴', actorId + ' (' + name + ') 본인 탈퇴');
        sessionStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(SESSION_KEY);
        return { ok: true };
      }
    }
    return { ok: false, msg: '계정을 찾을 수 없습니다.' };
  }

  /* 승인대기 회원을 정회원으로 설정 */
  function approveMember(actor, id) {
    if (!canApproveMembers(actor)) return { ok: false, msg: '정회원 승인은 노회장, 서기, 간사만 할 수 있습니다.' };
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === id) {
        if (users[i].role !== 'pending') return { ok: false, msg: '승인대기 상태의 회원이 아닙니다.' };
        users[i].role = 'member';
        saveUsers(users);
        SHSAudit.log('update', '정회원 승인', '아이디 ' + id + ' (' + users[i].name + ') 승인대기 → 정회원');
        return { ok: true };
      }
    }
    return { ok: false, msg: '해당 아이디를 찾을 수 없습니다.' };
  }

  /* ---------- 아이디 찾기 / 비밀번호 재설정 ---------- */

  /* 이메일 일부 마스킹: hong@naver.com → ho***g@naver.com */
  function maskId(id) {
    var s = String(id);
    var at = s.indexOf('@');
    if (at < 0) {
      if (s.length <= 3) return s.charAt(0) + '**';
      return s.slice(0, 2) + '***' + s.charAt(s.length - 1);
    }
    var local = s.slice(0, at), domain = s.slice(at);
    if (local.length <= 2) return local.charAt(0) + '**' + domain;
    return local.slice(0, 2) + '***' + local.charAt(local.length - 1) + domain;
  }

  /* 아이디 찾기: 성명 + 소속 교회가 일치하는 계정의 마스킹된 아이디 반환 */
  function findIds(name, church) {
    var n = String(name || '').replace(/\s+/g, '');
    var c = normChurch(church);
    if (!n || !c) return { ok: false, msg: '성명과 소속 교회를 모두 입력해 주세요.' };
    var found = [];
    loadUsers().forEach(function (u) {
      if (u.role === 'superadmin') return;
      if (u.name.replace(/\s+/g, '') === n && normChurch(u.church) === c) found.push(maskId(u.id));
    });
    if (!found.length) {
      return { ok: false, msg: '일치하는 계정을 찾을 수 없습니다. 노회 사무실(031-486-9993)로 문의해 주세요.' };
    }
    SHSAudit.log('view', '아이디 찾기', '성명 ' + name + ', 교회 ' + church + ' → ' + found.length + '건 조회');
    return { ok: true, ids: found };
  }

  /* 비밀번호 재설정: 아이디 + 성명 + 소속 교회가 모두 일치할 때 새 비밀번호로 변경 */
  function resetPassword(id, name, church, newPw) {
    if (!id || !name || !church || !newPw) {
      return { ok: false, msg: '모든 항목을 입력해 주세요.' };
    }
    if (String(newPw).length < 4) {
      return { ok: false, msg: '새 비밀번호는 4자 이상으로 입력해 주세요.' };
    }
    var users = loadUsers();
    var n = String(name).replace(/\s+/g, '');
    var c = normChurch(church);
    for (var i = 0; i < users.length; i++) {
      if (users[i].role === 'superadmin') continue;
      if (users[i].id === id &&
          users[i].name.replace(/\s+/g, '') === n &&
          normChurch(users[i].church) === c) {
        users[i].pw = hash(newPw);
        saveUsers(users);
        SHSAudit.log('update', '비밀번호 재설정', '아이디 ' + id + ' 본인확인(성명·교회 일치) 후 재설정');
        return { ok: true };
      }
    }
    SHSAudit.log('view', '비밀번호 재설정 실패', '아이디 ' + id + ' 본인확인 불일치');
    return { ok: false, msg: '입력하신 정보와 일치하는 계정이 없습니다. 노회 사무실(031-486-9993)로 문의해 주세요.' };
  }

  /* ---------- 계정 관리 ---------- */

  function addAccount(actor, data) {
    if (!canManageMembers(actor)) return { ok: false, msg: '회원 등록 권한이 없습니다.' };
    var email = String(data.id || data.email || '').trim().toLowerCase();
    if (!isEmail(email)) return { ok: false, msg: '올바른 이메일 주소를 입력해 주세요.' };
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === email) return { ok: false, msg: '이미 가입된 이메일입니다.' };
    }
    var matched = rosterRole(data.name, data.church);
    users.push({
      id: email, email: email, pw: hash(data.pw), name: data.name,
      role: matched ? matched.role : 'pending',
      title: matched ? matched.title : null,
      position: data.position || '목사', church: data.church || '', phone: data.phone || '',
      joinedAt: new Date().toISOString().slice(0, 10)
    });
    saveUsers(users);
    SHSAudit.log('create', '회원 추가', email + ' (' + data.name + ', ' + (data.church || '-') + ') → ' +
      (matched ? ROLE_NAMES[matched.role] : '승인대기'));
    return { ok: true, roleName: matched ? ROLE_NAMES[matched.role] : '승인대기' };
  }

  function removeAccount(actor, id) {
    if (!canManageMembers(actor)) return { ok: false, msg: '회원 삭제 권한이 없습니다.' };
    var users = loadUsers();
    for (var k = 0; k < users.length; k++) {
      if (users[k].id === id && users[k].role === 'superadmin' && (!actor || actor.role !== 'superadmin')) {
        return { ok: false, msg: '해당 아이디를 찾을 수 없습니다.' };
      }
    }
    var next = [];
    for (var i = 0; i < users.length; i++) {
      if (users[i].id !== id) next.push(users[i]);
    }
    if (next.length === users.length) return { ok: false, msg: '해당 아이디를 찾을 수 없습니다.' };
    saveUsers(next);
    SHSAudit.log('delete', '회원 삭제', '아이디 ' + id);
    return { ok: true };
  }

  function assignRole(actor, id, role) {
    if (!canAssignRoles(actor)) return { ok: false, msg: '직책을 지정할 권한이 없습니다.' };
    if (!ROLE_NAMES[role]) return { ok: false, msg: '알 수 없는 등급입니다.' };
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === id) {
        if (users[i].role === 'superadmin' && role !== 'superadmin') {
          /* 최고관리자가 1명뿐이면 강등 금지 */
          var admins = 0;
          for (var j = 0; j < users.length; j++) if (users[j].role === 'superadmin') admins++;
          if (admins <= 1) return { ok: false, msg: '이 계정의 등급은 변경할 수 없습니다.' };
        }
        var before = users[i].role;
        users[i].role = role;
        saveUsers(users);
        SHSAudit.log('update', '등급 변경', '아이디 ' + id + ' (' + users[i].name + ') ' +
          ROLE_NAMES[before] + ' → ' + ROLE_NAMES[role]);
        return { ok: true };
      }
    }
    return { ok: false, msg: '해당 아이디를 찾을 수 없습니다.' };
  }

  function listAccounts() { return loadUsers(); }

  return {
    login: login,
    logout: logout,
    ensureAccount: ensureAccount,
    currentUser: currentUser,
    roleName: roleName,
    canManageMembers: canManageMembers,
    canIssueDocuments: canIssueDocuments,
    canAssignRoles: canAssignRoles,
    canViewAudit: canViewAudit,
    isMember: isMember,
    isOfficer: isOfficer,
    canApproveMembers: canApproveMembers,
    canViewSecret: canViewSecret,
    canViewLevel: canViewLevel,
    canEditLevel: canEditLevel,
    register: register,
    approveMember: approveMember,
    findIds: findIds,
    resetPassword: resetPassword,
    updateProfile: updateProfile,
    changePassword: changePassword,
    withdraw: withdraw,
    rosterRole: rosterRole,
    addAccount: addAccount,
    removeAccount: removeAccount,
    assignRole: assignRole,
    listAccounts: listAccounts
  };
})();

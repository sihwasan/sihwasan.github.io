/* 감독 (감사 기록) 보기
 *
 * 감사 기록은 두 곳에서 본다.
 *   · 시스템 운영 화면의 '감독 (감사 기록)' 탭
 *   · 예전 주소(audit.html)로 들어온 경우
 * 두 곳이 늘 같은 모습이도록, 그리는 일을 이 파일 한 곳에 두었다.
 *
 * 이름이 SHSAudit(이 컴퓨터에 남기는 기록 창고)과 겹치지 않도록
 * SHSAuditView 로 둔다.
 *
 * mount(자리, 이용자) 로 부르면 그 자리에 감사 기록을 그린다.
 * 열람 권한 확인도 이 안에서 한다.
 */
var SHSAuditView = (function () {
  'use strict';

  function mount(area, user) {
    if (!area) return;
    var e = SHS.esc;


    if (!user || !SHSAuth.canViewAudit(user)) {
      area.innerHTML =
        '<div class="notice-banner">감사 기록을 열람할 권한이 없습니다.' +
        (user ? '' : ' <a class="btn sm" style="margin-left:10px" href="login.html">로그인</a>') +
        '</div>';
      return;
    }

    SHS.logAction('view', '감사 로그 열람', '감독 페이지 접속');

    /* 서버 로그인(구글) 시에는 서버에 보존된 기록을, 아니면 이 컴퓨터의 기록을 본다 */
    var cloudRows = null;
    var PAGE_MAX = 2000;   /* 한 화면에 불러오는 최대 건수 */
    var capped = false;

    function loadRows() {
      if (!user.cloud) {
        return Promise.resolve(SHSAudit.list().slice().reverse().map(function (r) {
          return { time: r.time, who: r.userName, whoSub: r.userId + (r.role !== '-' ? ' / ' + SHSAuth.roleName(r.role) : ''),
                   type: r.type, action: r.action, detail: r.detail };
        }));
      }
      if (cloudRows) return Promise.resolve(cloudRows);
      return SHSCloud.init().then(function (c) {
        /* 보관 기간(3년)이 지난 기록을 먼저 정리한다. 없으면 아무 일도 하지 않는다. */
        return c.rpc('purge_audit_logs').then(function () { return c; }, function () { return c; });
      }).then(function (c) {
        return c.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(PAGE_MAX);
      }).then(function (r) {
        capped = (r.data || []).length >= PAGE_MAX;
        cloudRows = (r.data || []).map(function (row) {
          return {
            time: String(row.created_at).replace('T', ' ').slice(0, 19),
            who: row.user_name || '-',
            whoSub: (row.user_email || '') + (row.role ? ' / ' + SHSCloud.roleName(row.role) : ''),
            type: row.type, action: row.action, detail: row.detail
          };
        });
        return cloudRows;
      });
    }

    var html = '';
    html += '<div class="notice-banner">개인정보 열람, 자료의 추가·수정·삭제, 서류 발급, 로그인 등 주요 행위가 자동으로 기록됩니다. ' +
      '기록은 고치거나 지울 수 없으며, <strong>3년</strong> 동안 보관된 뒤 자동으로 폐기됩니다. ' +
      '열람 권한은 <strong>관리자(노회장·서기·간사)</strong>에게 있습니다.</div>';
    html += '<div class="board-controls">' +
      '<select id="filter-type" style="border:1px solid var(--gray-3);padding:8px 12px">' +
      '<option value="">전체 구분</option>' +
      '<option value="view">열람</option>' +
      '<option value="create">추가</option>' +
      '<option value="update">수정</option>' +
      '<option value="delete">삭제</option>' +
      '<option value="issue">서류발급</option>' +
      '<option value="auth">접속</option>' +
      '</select>' +
      '<input type="text" id="filter-text" placeholder="이용자·내용 검색">' +
      '</div>';
    html += '<div id="log-list"></div>';
    area.innerHTML = html;

    function render() {
      var type = document.getElementById('filter-type').value;
      var q = document.getElementById('filter-text').value.trim();
      loadRows().then(function (all) {
        var rows = all.filter(function (r) {
          if (type && r.type !== type) return false;
          if (q && ((r.who || '') + (r.whoSub || '') + r.action + (r.detail || '')).indexOf(q) === -1) return false;
          return true;
        });
        var t = document.getElementById('log-list');
        if (!rows.length) {
          t.innerHTML = '<p style="color:var(--gray-5)">기록이 없습니다.</p>';
          return;
        }
        var body = '';
        rows.forEach(function (r) {
          body += '<tr><td style="white-space:nowrap">' + e(r.time) + '</td>' +
            '<td>' + e(r.who) + '<div style="font-size:0.78rem;color:var(--gray-5)">' + e(r.whoSub) + '</div></td>' +
            '<td><span class="role-badge">' + SHSAudit.typeName(r.type) + '</span></td>' +
            '<td class="left">' + e(r.action) +
            (r.detail ? '<div style="font-size:0.82rem;color:var(--gray-5)">' + e(r.detail) + '</div>' : '') + '</td></tr>';
        });
        t.innerHTML = '<table class="tbl"><thead><tr><th style="width:170px">일시</th><th style="width:160px">이용자</th>' +
          '<th style="width:100px">구분</th><th>내용</th></tr></thead><tbody>' + body + '</tbody></table>' +
          '<p style="font-size:0.82rem;color:var(--gray-5)">총 ' + rows.length + '건' +
          (capped ? ' (화면에는 최근 ' + PAGE_MAX + '건까지 표시됩니다. 그 이전 기록도 서버에 그대로 남아 있습니다.)' : '') +
          '</p>';
      });
    }
    document.getElementById('filter-type').addEventListener('change', render);
    document.getElementById('filter-text').addEventListener('input', render);
    render();
  }

  return { mount: mount };
})();

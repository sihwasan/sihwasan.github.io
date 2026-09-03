/* =====================================================================
 *  교회상황 보고서 — 결재 흐름과 교세 집계 (한 곳에 모아 둔다)
 *
 *  결재 흐름 (supabase/71_church_report_flow.sql)
 *    작성 → 시찰접수 → 노회제출 → 반영완료
 *    (보완요청은 노회 서기가 고쳐 달라고 돌려보낸 것)
 *    ※ 노회 서기의 승인이 곧 노회장의 승인입니다.
 *
 *  쓰는 곳 : sichal.html · report.html · report-intake.html · officer.html
 *  여기 한 곳만 고치면 네 화면이 같은 말을 하게 됩니다.
 * ===================================================================== */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var STAGES = ['작성', '시찰접수', '노회제출', '반영완료', '보완요청'];

  /* 단계를 눈에 띄게 그린다 */
  function stage(st) {
    if (st === '반영완료') return '<span class="pass">반영완료</span>';
    if (st === '보완요청') return '<span class="fail">보완요청</span>';
    if (st === '노회제출') return '<span style="color:#2f6f8f;font-weight:700">노회제출</span>';
    if (st === '시찰접수') return '<span class="role-badge">시찰접수</span>';
    return '<span style="color:var(--gray-6)">' + esc(st || '작성') + '</span>';
  }

  /* 언제 어디까지 갔는지 (시찰 제출 · 노회 제출 · 반영) */
  function trail(r) {
    var out = [];
    if (!r) return '';
    if (r.sichal_sent_at)     out.push('시찰 제출 ' + String(r.sichal_sent_at).slice(0, 10));
    if (r.presbytery_sent_at) out.push('노회 제출 ' + String(r.presbytery_sent_at).slice(0, 10));
    if (r.approved_at)        out.push('반영 ' + String(r.approved_at).slice(0, 10));
    return out.length
      ? ' <span style="color:var(--gray-5)">(' + esc(out.join(' · ')) + ')</span>' : '';
  }

  /* 노회 서기가 반영을 마친 보고서는 교회·시찰 화면에서 고칠 수 없다.
   * 되돌리는 일은 노회 관리자(can_manage)만 한다. */
  function locked(r, user) {
    if (!r || r.status !== '반영완료') return false;
    return !(window.SHSAuth && SHSAuth.canManageMembers(user));
  }

  /* 교세 집계 — 시찰보고서의 교세보고 칸과 같은 기준으로 센다 */
  function stat(r) {
    function n(v) { return Number(v || 0) || 0; }
    function pick(o, ks) { var s = 0; ks.forEach(function (k) { s += n(o && o[k]); }); return s; }
    var d = (r && r.data) || {};
    var cg = d.clergy || {}, jj = d.jejik || {};
    return {
      church: r && r.church,
      pastors:  pick(cg, ['damim', 'wonro', 'bumok', 'hyup', 'gita']),
      gangdosa: n(cg.gangdosa),
      jeondosa: pick(cg, ['jd_m', 'jd_f']),
      elders:   n(jj.jr_simu),
      muim:     pick(jj, ['jr_wonro', 'jr_euntoe', 'jr_hyup', 'jr_gita']),
      kwonsa:   pick(jj, ['ks_simu', 'ks_gita']),
      deacons:  pick(jj, ['as_simu', 'as_gita', 'ss_m', 'ss_f']),
      total:    n(r && r.members_total),
      baptized: n(r && r.members_baptized),
      wavg:     n(r && r.worship_avg),
      school:   n(r && r.school_total),
      offer:    n(r && r.offering_year)
    };
  }

  var SUM_KEYS = ['pastors', 'gangdosa', 'jeondosa', 'elders', 'muim', 'kwonsa',
                  'deacons', 'total', 'baptized', 'wavg', 'school', 'offer'];

  /* 여러 보고서의 교세를 더한다 */
  function sum(rows) {
    var out = {};
    SUM_KEYS.forEach(function (k) { out[k] = 0; });
    (rows || []).forEach(function (r) {
      var s = stat(r);
      SUM_KEYS.forEach(function (k) { out[k] += s[k]; });
    });
    return out;
  }

  window.SHSReport = {
    STAGES: STAGES, SUM_KEYS: SUM_KEYS,
    stage: stage, trail: trail, locked: locked, stat: stat, sum: sum
  };
})();

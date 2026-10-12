/* 노회 진행 매니저 — 순서지 진행 판 (여러 화면이 함께 쓴다)
 *
 *   SHSProceed.mount(area, user, opts) → { reload(), setStatus(status) }
 *
 *   쓰는 곳
 *     · proceed.html      — 노회 진행 매니저 (서기)
 *     · today.html        — 오늘의 노회 서기 화면 (회의 진행 + 전자투표)
 *     · meeting-admin.html — 노회 회의관리 (서기 입력 · 부서기 열람)
 *
 *   opts
 *     readOnly  : 참이면 보기만 한다 (부서기)
 *     sessionNo : 이 회기의 회의를 바로 연다
 *     embed     : 다른 화면 안에 들어갈 때 — 회의 목록 단추 대신 회의 목록 접기
 *     onVote(title)      : 순서마다 「투표 올리기」 단추를 보이고, 누르면 부른다 (오늘의 노회)
 *     onPause(), onResume() : 정회 · 속회를 누르면 먼저 부른다 (오늘의 노회 — 새 QR).
 *                              Promise 를 돌려주면 성공한 뒤에 순서지 상태를 바꾼다.
 *
 *   세부 체크 (meeting_items.checks, 63_meeting_item_checks.sql)
 *     · 보통      : [{t, ok, at}]                   — 시찰 보고처럼 보고한 곳을 하나씩 체크
 *     · 각 부 보고 : [{t, ok, at, tmp, full}]        — 임시보고 · 완전보고를 따로 체크 (완전보고 = 완료)
 *     · 헌의부 보고: [{t, ok, at, to, res, rat}]     — 헌의안마다 확인(ok) → 보낼 부서(to) → 처리 결과(res)
 *       정치부 보고 · 고시규칙부 보고 순서에는 그 부서로 보낸 헌의안이 나타나 그 자리에서 처리한다.
 */
(function () {
  var e = function (s) { return SHS.esc(s); };

  function nowIso() { return new Date().toISOString(); }
  function hhmm(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  var SICHALS = ((window.SHSData && SHSData.sichals) || []).map(function (s) { return s.name; });
  if (!SICHALS.length) SICHALS = ['북부시찰', '상록시찰', '남부시찰'];
  var BUSEO = ((window.SHSData && SHSData.committees) || []).map(function (c2) { return c2.name; });
  if (!BUSEO.length) BUSEO = ['감사헌의부', '정치부', '고시규칙부', '재정부', '교육친교부', '전도선교부', '사회복지부'];
  /* 헌의안을 보내는 부서 — 정치부 · 고시규칙부가 먼저, 나머지 상비부는 뒤에 */
  var ROUTE_TO = ['정치부', '고시규칙부'].concat(BUSEO.filter(function (b) {
    return b !== '정치부' && b !== '고시규칙부' && !/헌의/.test(b);
  }));
  var RESULTS = ['가결', '부결', '보류', '기각', '임원회 위임'];

  /* ---------------- 순서지 틀 ----------------
   * 제19회 봄 정기노회 회의록(본 노회 실제 진행)과
   * 제20회 가을 정기노회를 치르고 서기가 고친 순서(2026-10)를 바탕으로 한 기본 틀.
   * [구분, 순서 이름, 담당, 준비 메모] */
  var TPL = {
    spring: [
      ['Ⅰ. 개회예배', '개회예배', '노회장', '찬송 · 기도 · 성경봉독 · 설교 · 축도'],
      ['Ⅰ. 개회예배', '성찬식', '시찰장 집례', '설교 · 분병 · 분잔'],
      ['Ⅱ. 회무처리 (오전)', '회원점명 · 성수 보고', '서기', '목사회원 · 장로총대 출석 확인'],
      ['Ⅱ. 회무처리 (오전)', '개회선언', '노회장', ''],
      ['Ⅱ. 회무처리 (오전)', '회의순서(회순) 채택', '노회장', '유인물대로 받기로 가결'],
      ['Ⅱ. 회무처리 (오전)', '명패 · 휘장 분배', '서기', ''],
      ['Ⅱ. 회무처리 (오전)', '광고 · 지시위원 선정', '노회장', ''],
      ['Ⅱ. 회무처리 (오전)', '간식 허락', '노회장', ''],
      ['Ⅱ. 회무처리 (오전)', '임원선거', '선거관리위원장', '노회장 · 부노회장 · 서기 · 회계 등'],
      ['Ⅱ. 회무처리 (오전)', '총회총대 선거', '선거관리위원장', '목사 · 장로 정총대와 부총대'],
      ['Ⅱ. 회무처리 (오전)', '임원회 보고', '서기', ''],
      ['Ⅱ. 회무처리 (오전)', '감사헌의부 보고', '감사헌의부 서기', '헌의안건 접수 · 각 부 이관'],
      ['Ⅱ. 회무처리 (오전)', '정치부 · 고시규칙부 모임 허락', '노회장', '헌의안건 심의를 위한 부서 모임'],
      ['Ⅱ. 회무처리 (오전)', '공천부 보고', '공천부 서기', '상비부 공천'],
      ['Ⅱ. 회무처리 (오전)', '정회 (오찬)', '', ''],
      ['Ⅲ. 계속 회무처리 (오후)', '속회', '노회장', '새 출석 QR 코드로 다시 입장'],
      ['Ⅲ. 계속 회무처리 (오후)', '각 상비부 조직보고', '각 부 서기', '부장 · 서기 · 회계 조직'],
      ['Ⅲ. 계속 회무처리 (오후)', '각 시찰 보고', '각 시찰 서기', ''],
      ['Ⅲ. 계속 회무처리 (오후)', '서기 사무 보고', '서기', ''],
      ['Ⅲ. 계속 회무처리 (오후)', '각 부 보고', '각 부 서기', '임시보고 · 완전보고'],
      ['Ⅲ. 계속 회무처리 (오후)', '정치부 보고 (헌의안건 처리)', '정치부 서기', '청빙 · 사면 · 청원 안건'],
      ['Ⅲ. 계속 회무처리 (오후)', '고시규칙부 보고 (헌의안건 처리)', '고시규칙부 서기', ''],
      ['Ⅲ. 계속 회무처리 (오후)', '재정부 회계 보고', '재정부', '결산 · 예산'],
      ['Ⅲ. 계속 회무처리 (오후)', '이사 선정', '노회장', ''],
      ['Ⅲ. 계속 회무처리 (오후)', '신입 · 이명 회원 소개', '서기', ''],
      ['Ⅲ. 계속 회무처리 (오후)', '기타 보고', '', '수원신학교 보고'],
      ['Ⅲ. 계속 회무처리 (오후)', '기타 안건 · 긴급동의안', '노회장', ''],
      ['Ⅲ. 계속 회무처리 (오후)', '회의록 채택', '회록서기', '미진 안건은 임원회에 위임'],
      ['Ⅲ. 계속 회무처리 (오후)', '감사패 · 임명장 전달', '노회장', ''],
      ['Ⅳ. 폐회', '폐회예배', '노회장', '기도 · 말씀'],
      ['Ⅳ. 폐회', '폐회선언 · 축도', '노회장', '']
    ],
    fall: [
      ['Ⅰ. 개회예배', '개회예배', '노회장', '찬송 · 기도 · 성경봉독 · 설교 · 축도'],
      ['Ⅱ. 회무처리', '회원점명 · 성수 보고', '서기', '목사회원 · 장로총대 출석 확인'],
      ['Ⅱ. 회무처리', '개회선언', '노회장', ''],
      ['Ⅱ. 회무처리', '회의순서(회순) 채택', '노회장', ''],
      ['Ⅱ. 회무처리', '명패 · 휘장 분배', '서기', ''],
      ['Ⅱ. 회무처리', '광고 · 지시위원 선정', '노회장', ''],
      ['Ⅱ. 회무처리', '간식 허락', '노회장', ''],
      ['Ⅱ. 회무처리', '임원회 보고', '서기', ''],
      ['Ⅱ. 회무처리', '감사헌의부 보고', '감사헌의부 서기', '헌의안건 접수 · 각 부 이관'],
      ['Ⅱ. 회무처리', '정치부 · 고시규칙부 모임 허락', '노회장', '헌의안건 심의를 위한 부서 모임'],
      ['Ⅱ. 회무처리', '각 시찰 보고', '각 시찰 서기', ''],
      ['Ⅱ. 회무처리', '서기 사무 보고', '서기', ''],
      ['Ⅱ. 회무처리', '각 부 보고', '각 부 서기', '임시보고 · 완전보고'],
      ['Ⅱ. 회무처리', '총회총대 총회 참석 보고', '총대', ''],
      ['Ⅱ. 회무처리', '정치부 보고 (헌의안건 처리)', '정치부 서기', ''],
      ['Ⅱ. 회무처리', '고시규칙부 보고 (헌의안건 처리)', '고시규칙부 서기', '강도사고시 추천 등'],
      ['Ⅱ. 회무처리', '치리회 전환 — 윤중식 씨 해벌의 건', '노회장', '치리회로 전환하여 해벌을 다룬 뒤 다시 노회로'],
      ['Ⅱ. 회무처리', '재정부 보고', '재정부', ''],
      ['Ⅱ. 회무처리', '신입 · 이명 회원 소개', '서기', ''],
      ['Ⅱ. 회무처리', '기타 보고', '', '수원신학교 보고'],
      ['Ⅱ. 회무처리', '기타 안건', '노회장', ''],
      ['Ⅱ. 회무처리', '회의록 채택', '회록서기', ''],
      ['Ⅱ. 회무처리', '감사패 전달', '노회장', ''],
      ['Ⅲ. 폐회', '폐회예배 · 폐회선언', '노회장', '']
    ],
    empty: [
      ['', '개회선언', '노회장', ''],
      ['', '폐회선언', '노회장', '']
    ]
  };
  /* 가을 노회에서는 하지 않는 순서 — 틀 맞추기 때 아직 다루지 않았으면 뺀다 */
  var FALL_DROP = /공천부/;
  /* 예전 틀의 이름 → 새 틀의 이름 (틀 맞추기 때 같은 순서로 본다) */
  var ALIAS = {
    '고시부 보고': '고시규칙부 보고 (헌의안건 처리)',
    '정치부 보고 (청원안건 처리)': '정치부 보고 (헌의안건 처리)',
    '위원 선정': '광고 · 지시위원 선정',
    '감사패 · 임명장 증정': '감사패 · 임명장 전달'
  };

  /* ---------------- 세부 체크 ---------------- */
  function modeOf(title) {
    var t = title || '';
    if (/헌의부/.test(t)) return 'heoni';
    if (/^\s*(정치부|고시규칙부)\s*보고/.test(t)) return 'route';
    if (/각\s*부\s*보고/.test(t)) return 'buseo';
    return 'plain';
  }
  function routeDept(title) {
    var m = String(title || '').match(/^\s*(정치부|고시규칙부)/);
    return m ? m[1] : '';
  }
  function mkChecks(names, mode) {
    return names.map(function (n) {
      return mode === 'buseo' ? { t: n, ok: false, at: null, tmp: false, full: false } : { t: n, ok: false, at: null };
    });
  }
  /* 순서 이름을 보고 세부 항목을 미리 채워 준다 */
  function autoChecks(title, detail) {
    var t = title || '';
    if (/시찰/.test(t)) return mkChecks(SICHALS);
    if (/각\s*부\s*보고/.test(t)) return mkChecks(BUSEO, 'buseo');
    if (/상비부|조직\s*보고/.test(t)) return mkChecks(BUSEO);
    if (/모임\s*허락/.test(t)) return mkChecks(['정치부 모임', '고시규칙부 모임']);
    if (/기타\s*보고/.test(t)) return mkChecks((detail || '수원신학교 보고').split(/\s*[·,]\s*/).filter(Boolean));
    return [];
  }
  function checksOf(x) { return (x && Array.isArray(x.checks)) ? x.checks : []; }

  function mount(area, user, opts) {
    opts = opts || {};
    var RO = !!opts.readOnly;
    var sessions = [], cur = null, items = [];
    var meetings = [];
    var SESSION_NO = null;
    var HAS_CHECKS = true;
    var loaded = false;

    function db() { return SHSCloud.init(); }

    /* 헌의부 보고 순서 (헌의안 목록이 있는 곳) */
    function heoniItem() { return items.filter(function (x) { return modeOf(x.title) === 'heoni'; })[0] || null; }
    function routedTo(dept) {
      var h = heoniItem();
      if (!h) return [];
      return checksOf(h).map(function (c2, i) { return { c: c2, i: i, hid: h.id }; })
        .filter(function (r) { return r.c.to === dept; });
    }
    /* 완료 수 / 전체 수 — 순서 모양마다 다르게 센다 */
    function progressOf(x) {
      var md = modeOf(x.title), cs = checksOf(x);
      if (md === 'route') {
        var rs = routedTo(routeDept(x.title));
        return { done: rs.filter(function (r) { return !!r.c.res; }).length, all: rs.length, label: '처리' };
      }
      if (md === 'heoni') return { done: cs.filter(function (c2) { return !!c2.to; }).length, all: cs.length, label: '이관' };
      if (md === 'buseo') return { done: cs.filter(function (c2) { return c2.full; }).length, all: cs.length, label: '완전보고' };
      return { done: cs.filter(function (c2) { return c2.ok; }).length, all: cs.length, label: '보고' };
    }

    function voteBtn(title) {
      if (!opts.onVote || RO) return '';
      return '<button type="button" class="btn ghost sm pp-vote" data-vote="' + e(title) + '" title="이 안건으로 전자투표를 올립니다">투표 올리기</button>';
    }

    function checksHtml(x, big) {
      var md = modeOf(x.title), cs = checksOf(x), h = '';
      if (md === 'route') {
        var rs = routedTo(routeDept(x.title));
        if (!rs.length) {
          return heoniItem() ? '<div class="pc-note">감사헌의부 보고에서 ' + e(routeDept(x.title)) + '로 보낸 헌의안이 아직 없습니다.</div>' : '';
        }
        return '<ul class="pc-hn">' + rs.map(function (r) {
          return '<li class="' + (r.c.res ? 'on' : '') + '"><div class="pc-hn-t"><b>' + e(r.c.t) + '</b>' +
            (r.c.res ? ' <span class="pc-res r' + e(r.c.res) + '">' + e(r.c.res) + '</span>' : ' <span class="pc-res">심의 중</span>') + '</div>' +
            '<div class="pc-hn-act">' + RESULTS.map(function (rv) {
              return '<button type="button" class="btn ' + (r.c.res === rv ? '' : 'ghost ') + 'sm" data-res="' + r.hid + ':' + r.i + ':' + e(rv) + '">' + e(rv) + '</button>';
            }).join('') + voteBtn(r.c.t) + '</div></li>';
        }).join('') + '</ul>';
      }
      if (!cs.length) return '';
      if (md === 'buseo') {
        return '<ul class="pc-bs' + (big ? ' big' : '') + '">' + cs.map(function (c2, i2) {
          return '<li class="' + (c2.full ? 'on' : c2.tmp ? 'half' : '') + '"><span class="pc-bs-n">' + e(c2.t) + '</span>' +
            '<button type="button" class="' + (c2.tmp ? 'on' : '') + '" data-bs="' + x.id + ':' + i2 + ':tmp">' +
            '<span class="mk">' + (c2.tmp ? '&#10003;' : '&#9675;') + '</span>임시보고</button>' +
            '<button type="button" class="' + (c2.full ? 'on' : '') + '" data-bs="' + x.id + ':' + i2 + ':full">' +
            '<span class="mk">' + (c2.full ? '&#10003;' : '&#9675;') + '</span>완전보고</button></li>';
        }).join('') + '</ul>';
      }
      if (md === 'heoni') {
        return '<ul class="pc-hn">' + cs.map(function (c2, i2) {
          return '<li class="' + (c2.to ? 'on' : '') + '"><div class="pc-hn-t">' +
            '<button type="button" class="pc-hn-ok' + (c2.ok ? ' on' : '') + '" data-chk="' + x.id + ':' + i2 + '" title="보고 확인">' +
            (c2.ok ? '&#10003;' : '&#9675;') + '</button> <b>' + (i2 + 1) + '. ' + e(c2.t) + '</b>' +
            (c2.res ? ' <span class="pc-res r' + e(c2.res) + '">' + e(c2.to || '') + ' · ' + e(c2.res) + '</span>'
                    : c2.to ? ' <span class="pc-res">' + e(c2.to) + '로 보냄 · 심의 중</span>' : '') + '</div>' +
            '<div class="pc-hn-act"><label>보낼 부서 <select data-to="' + x.id + ':' + i2 + '">' +
            '<option value="">— 고르기 —</option>' +
            ROUTE_TO.map(function (b) { return '<option' + (c2.to === b ? ' selected' : '') + '>' + e(b) + '</option>'; }).join('') +
            '<option value="본회 직접"' + (c2.to === '본회 직접' ? ' selected' : '') + '>본회 직접 처리</option>' +
            '</select></label>' +
            (c2.to === '본회 직접'
              ? RESULTS.map(function (rv) {
                  return '<button type="button" class="btn ' + (c2.res === rv ? '' : 'ghost ') + 'sm" data-res="' + x.id + ':' + i2 + ':' + e(rv) + '">' + e(rv) + '</button>';
                }).join('') + voteBtn(c2.t)
              : '') + '</div></li>';
        }).join('') + '</ul>';
      }
      return '<ul class="pc-chk">' + cs.map(function (c2, i2) {
        return '<li><button type="button" class="' + (c2.ok ? 'on' : '') + '" ' +
          'data-chk="' + x.id + ':' + i2 + '" title="눌러서 보고 완료 · 취소">' +
          '<span class="mk">' + (c2.ok ? '&#10003;' : '&#9675;') + '</span>' + e(c2.t) + '</button></li>';
      }).join('') + '</ul>';
    }
    function copyChecks(x) {
      return checksOf(x).map(function (c2) {
        var o = {}; Object.keys(c2).forEach(function (k) { o[k] = c2[k]; }); return o;
      });
    }
    function itemById(id) { return items.filter(function (i2) { return String(i2.id) === String(id); })[0]; }
    function saveChecks(x, arr) {
      x.checks = arr;
      drawSession();
      upItem(x.id, { checks: arr }, function () {});
    }
    function toggleCheck(id, idx) {
      var x = itemById(id); if (!x) return;
      var arr = copyChecks(x); if (!arr[idx]) return;
      arr[idx].ok = !arr[idx].ok;
      arr[idx].at = arr[idx].ok ? nowIso() : null;
      saveChecks(x, arr);
    }
    /* 각 부 보고 — 임시보고 · 완전보고. 완전보고가 되면 그 부서 보고는 끝난 것으로 본다 */
    function toggleBuseo(id, idx, key) {
      var x = itemById(id); if (!x) return;
      var arr = copyChecks(x); if (!arr[idx]) return;
      arr[idx][key] = !arr[idx][key];
      arr[idx][key + '_at'] = arr[idx][key] ? nowIso() : null;
      arr[idx].ok = !!arr[idx].full;
      arr[idx].at = arr[idx].ok ? (arr[idx].full_at || nowIso()) : null;
      saveChecks(x, arr);
    }
    function setRoute(id, idx, to) {
      var x = itemById(id); if (!x) return;
      var arr = copyChecks(x); if (!arr[idx]) return;
      if (arr[idx].res && arr[idx].to !== to &&
          !confirm('「' + arr[idx].t + '」은 이미 ' + arr[idx].to + '에서 「' + arr[idx].res + '」로 처리되었습니다.\n보낼 부서를 바꾸면 처리 결과가 지워집니다.')) {
        drawSession(); return;
      }
      if (arr[idx].to !== to) { arr[idx].res = null; arr[idx].rat = null; }
      arr[idx].to = to || null;
      arr[idx].ok = arr[idx].ok || !!to;
      if (arr[idx].ok && !arr[idx].at) arr[idx].at = nowIso();
      saveChecks(x, arr);
    }
    function setResult(id, idx, res) {
      var x = itemById(id); if (!x) return;
      var arr = copyChecks(x); if (!arr[idx]) return;
      arr[idx].res = arr[idx].res === res ? null : res;   /* 같은 것을 다시 누르면 취소 */
      arr[idx].rat = arr[idx].res ? nowIso() : null;
      saveChecks(x, arr);
    }

    /* 정기노회 일정에서 회기 번호를 헤아린다. 회기는 봄 정기노회에서 새로 시작한다. */
    function meetingNo(m) {
      if (!SESSION_NO) return null;
      var no = Number(SESSION_NO);
      if (/^봄/.test(m.kind || '') && m.meet_date && m.meet_date > new Date().toISOString().slice(0, 10)) no += 1;
      return no;
    }
    function meetingTitle(m) {
      var no = meetingNo(m);
      return (no ? '제' + no + '회 ' : '') + (m.kind || '정기노회');
    }
    function meetingLabel(m) {
      return meetingTitle(m) + (m.meet_date ? ' — ' + m.meet_date : '') +
        (m.place ? ' · ' + m.place : '') + (m.confirmed ? '' : ' (미확정)');
    }
    function isFall(s) { return /가을/.test((s && s.title) || '') || (s && s.meet_on && Number(String(s.meet_on).slice(5, 7)) >= 7); }

    /* ---------------- 불러오기 ---------------- */
    function load(openId) {
      db().then(function (c) {
        return Promise.all([
          c.from('meeting_sessions').select('*')
            .order('meet_on', { ascending: false }).order('id', { ascending: false }),
          c.from('site_settings').select('value').eq('key', 'sessions')
            .then(function (x) { return x; }, function () { return { data: [] }; }),
          c.from('meetings').select('*').order('meet_date', { ascending: false })
            .then(function (x) { return x; }, function () { return { data: [] }; }),
          c.from('meeting_items').select('id, checks').limit(1)
            .then(function (x) { return x; }, function () { return { error: 1 }; })
        ]);
      }).then(function (rs) {
        if (rs[0].error) {
          area.innerHTML = '<div class="notice-banner">회의 목록을 불러오지 못했습니다: ' +
            e(rs[0].error.message) +
            '<br><span style="font-size:0.85rem;color:var(--gray-5)">Supabase에서 <strong>61_proceedings.sql</strong>을 ' +
            '아직 실행하지 않으셨다면 먼저 실행해 주세요.</span></div>';
          return;
        }
        sessions = rs[0].data || [];
        var ses = rs[1].data && rs[1].data[0] && rs[1].data[0].value;
        if (ses && ses.current) SESSION_NO = ses.current;
        meetings = (rs[2] && rs[2].data) || [];
        HAS_CHECKS = !!(rs[3] && !rs[3].error);

        if (openId) {
          cur = sessions.filter(function (s) { return s.id === openId; })[0] || null;
        } else if (cur) {
          cur = sessions.filter(function (s) { return s.id === cur.id; })[0] || null;
        }
        if (!cur && !loaded && opts.sessionNo) {
          cur = sessions.filter(function (s) { return Number(s.session_no) === Number(opts.sessionNo); })[0] || null;
        }
        if (!cur && !loaded) {
          cur = sessions.filter(function (s) { return s.status === '진행' || s.status === '정회'; })[0] || null;
        }
        loaded = true;
        if (!cur) { drawList(); return; }
        loadItems();
      });
    }

    function loadItems() {
      if (!cur) return;
      db().then(function (c) {
        return c.from('meeting_items').select('*').eq('session_id', cur.id).order('sort').order('id');
      }).then(function (r) {
        items = (r && r.data) || [];
        drawSession();
      });
    }

    /* ---------------- 회의 목록 ---------------- */
    function drawList() {
      var h = '<p class="pc-intro">회의 순서지를 미리 만들어 두고, ' +
        '회의 당일 순서를 하나씩 진행 · 완료 처리하면서 회의를 이끄는 도구입니다. ' +
        '한 순서가 끝나면 <strong>완료</strong>를 누르세요. 다음 순서가 저절로 안내됩니다.</p>';
      var list = opts.sessionNo
        ? sessions.filter(function (s) { return Number(s.session_no) === Number(opts.sessionNo); })
        : sessions;
      if (opts.sessionNo && !list.length) {
        h += '<div class="notice-banner">제' + Number(opts.sessionNo) + '회기 회의 순서지가 아직 없습니다.' +
          (RO ? '' : ' 아래에서 만들어 주세요.') + '</div>';
      }
      if (!list.length && !opts.sessionNo) {
        h += '<p style="color:var(--gray-5)">만들어 둔 회의가 없습니다.' + (RO ? '' : ' 아래에서 첫 회의를 만들어 주세요.') + '</p>';
      } else if (list.length) {
        h += '<div class="pc-tblwrap"><table class="tbl"><thead><tr><th style="width:120px">날짜</th><th>회의</th>' +
          '<th style="width:160px">장소</th><th style="width:90px">상태</th>' +
          '<th style="width:150px">관리</th></tr></thead><tbody>';
        list.forEach(function (s) {
          h += '<tr><td>' + e(s.meet_on || '-') + '</td>' +
            '<td class="left"><strong>' + e(s.title) + '</strong></td>' +
            '<td>' + e(s.place || '-') + '</td>' +
            '<td><span class="pc-st s' + (s.status === '폐회' ? '완료' : s.status === '준비' ? '대기' : '진행중') + '">' +
            e(s.status) + '</span></td>' +
            '<td><button class="btn sm" data-open="' + s.id + '">열기</button> ' +
            (RO ? '' : '<button class="btn danger sm" data-del="' + s.id + '">삭제</button>') + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }

      if (!RO) {
        h += '<div class="admin-card" style="margin-top:18px"><h3 style="margin-top:0">새 회의 만들기</h3>' +
          (meetings.length
            ? '<div class="field" style="max-width:520px"><label>정기노회 일정에서 가져오기</label>' +
              '<select id="ns-meet"><option value="">직접 적기</option>' +
              meetings.map(function (m, i) {
                return '<option value="' + i + '">' + e(meetingLabel(m)) + '</option>';
              }).join('') + '</select>' +
              '<div class="field-hint" style="font-size:0.8rem;color:var(--gray-5);margin-top:4px">' +
              '고르면 회의 이름 · 날짜 · 장소 · 순서지 틀이 그 일정에 맞추어 채워집니다.</div></div>'
            : '') +
          '<div class="inline-form">' +
          '<div class="field" style="flex:0 0 110px"><label>회기</label>' +
          '<input type="number" id="ns-no" value="' + (opts.sessionNo || (SESSION_NO ? Number(SESSION_NO) : '')) + '"></div>' +
          '<div class="field"><label>회의 이름</label>' +
          '<input type="text" id="ns-title" placeholder="예: 제20회 가을 정기노회"></div>' +
          '<div class="field" style="flex:0 0 160px"><label>날짜</label><input type="date" id="ns-date"></div>' +
          '<div class="field" style="flex:0 0 200px"><label>장소</label><input type="text" id="ns-place" placeholder="예: 섬기는교회"></div>' +
          '</div>' +
          '<div class="inline-form">' +
          '<div class="field" style="flex:0 0 260px"><label>순서지 틀</label><select id="ns-tpl">' +
          '<option value="fall">가을 정기노회 틀 (' + TPL.fall.length + '개 순서)</option>' +
          '<option value="spring">봄 정기노회 틀 (' + TPL.spring.length + '개 순서 · 임원선거 포함)</option>' +
          '<option value="empty">빈 순서지 (직접 작성)</option>' +
          '</select></div>' +
          '<button class="btn" id="ns-make" style="align-self:flex-end">회의 만들기</button>' +
          '</div>' +
          '<p style="font-size:0.8rem;color:var(--gray-5);margin:6px 0 0">만든 뒤 순서를 자유롭게 더하고 빼고 바꿀 수 있습니다.</p>' +
          '<div class="form-msg" id="ns-msg"></div></div>';
      }
      area.innerHTML = h;

      area.querySelectorAll('button[data-open]').forEach(function (b) {
        b.addEventListener('click', function () {
          cur = sessions.filter(function (s) { return String(s.id) === b.dataset.open; })[0];
          loadItems();
        });
      });
      if (RO) return;
      area.querySelectorAll('button[data-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          var s = sessions.filter(function (x) { return String(x.id) === b.dataset.del; })[0];
          if (!s) return;
          if (!confirm('"' + s.title + '" 회의와 그 순서지를 모두 지우시겠습니까? 되돌릴 수 없습니다.')) return;
          db().then(function (c) {
            return c.from('meeting_sessions').delete().eq('id', s.id);
          }).then(function (r) {
            if (r.error) { alert(r.error.message); return; }
            SHSCloud.log('delete', '노회 진행 회의 삭제', s.title);
            cur = null;
            load();
          });
        });
      });
      var msel = document.getElementById('ns-meet');
      if (msel) msel.addEventListener('change', function () {
        if (this.value === '') return;
        var m = meetings[Number(this.value)];
        if (!m) return;
        var no = meetingNo(m);
        if (no) document.getElementById('ns-no').value = no;
        document.getElementById('ns-title').value = meetingTitle(m);
        document.getElementById('ns-date').value = m.meet_date || '';
        document.getElementById('ns-place').value = m.place || '';
        document.getElementById('ns-tpl').value = /^봄/.test(m.kind || '') ? 'spring' : 'fall';
      });
      var mk = document.getElementById('ns-make');
      if (mk) mk.addEventListener('click', function () {
        var msg = document.getElementById('ns-msg');
        var title = document.getElementById('ns-title').value.trim();
        var no = parseInt(document.getElementById('ns-no').value, 10) || null;
        if (!title && no) title = '제' + no + '회 정기노회';
        if (!title) { msg.className = 'form-msg err'; msg.textContent = '회의 이름을 적어 주세요.'; return; }
        var tpl = TPL[document.getElementById('ns-tpl').value] || TPL.empty;
        mk.disabled = true;
        msg.className = 'form-msg'; msg.textContent = '만드는 중입니다...';
        db().then(function (c) {
          return c.from('meeting_sessions').insert({
            title: title, session_no: no,
            meet_on: document.getElementById('ns-date').value || null,
            place: document.getElementById('ns-place').value.trim() || null,
            created_by: user.name, updated_by: user.name
          }).select().single();
        }).then(function (r) {
          if (r.error) { mk.disabled = false; msg.className = 'form-msg err'; msg.textContent = r.error.message; return; }
          var sid = r.data.id;
          var rows = tpl.map(function (t, i) { return tplRow(sid, t, (i + 1) * 10); });
          return db().then(function (c) {
            return c.from('meeting_items').insert(rows);
          }).then(function (r2) {
            mk.disabled = false;
            if (r2.error) { msg.className = 'form-msg err'; msg.textContent = r2.error.message; return; }
            SHSCloud.log('create', '노회 진행 회의 개설', title + ' (순서 ' + rows.length + '개)');
            load(sid);
          });
        });
      });
    }
    function tplRow(sid, t, sort) {
      var row = { session_id: sid, sort: sort, section: t[0] || null, title: t[1], leader: t[2] || null,
                  detail: t[3] || null, updated_by: user.name };
      if (HAS_CHECKS) row.checks = autoChecks(t[1], t[3]);
      return row;
    }

    /* ---------------- 틀 맞추기 ----------------
     * 이미 만든 순서지에 새 틀(가을 · 봄)의 순서를 맞춘다.
     *   · 틀에 있는데 순서지에 없는 순서는 제자리에 넣는다.
     *   · 순서는 틀의 차례대로 다시 놓는다. 서기가 따로 넣은 순서는 바로 앞 순서 뒤에 그대로 둔다.
     *   · 가을 노회면 아직 다루지 않은 공천부 보고를 뺀다.
     *   · 이미 진행한 기록(완료 · 결과 · 체크)은 그대로 둔다. */
    function norm(t) { return String(t || '').replace(/\s/g, ''); }
    function alignTemplate(kind) {
      var tpl = TPL[kind];
      if (!tpl || !cur) return;
      var key = {};
      tpl.forEach(function (t, i) { key[norm(t[1])] = i; });
      Object.keys(ALIAS).forEach(function (k) { if (key[norm(ALIAS[k])] != null) key[norm(k)] = key[norm(ALIAS[k])]; });
      var drop = kind === 'fall' ? items.filter(function (x) { return FALL_DROP.test(x.title) && x.status === '대기'; }) : [];
      var keep = items.filter(function (x) { return drop.indexOf(x) === -1; });
      var have = {};
      keep.forEach(function (x) { if (key[norm(x.title)] != null) have[key[norm(x.title)]] = x; });
      var missing = [];
      tpl.forEach(function (t, i) { if (!have[i]) missing.push(i); });
      if (!missing.length && !drop.length) {
        if (!confirm('빠진 순서가 없습니다. 순서만 틀의 차례대로 다시 놓을까요?')) return;
      } else if (!confirm((kind === 'fall' ? '가을' : '봄') + ' 정기노회 틀에 맞춥니다.\n\n' +
          (missing.length ? '넣을 순서 ' + missing.length + '개: ' + missing.map(function (i) { return tpl[i][1]; }).join(', ') + '\n' : '') +
          (drop.length ? '뺄 순서: ' + drop.map(function (x) { return x.title; }).join(', ') + ' (가을에는 하지 않음)\n' : '') +
          '\n이미 진행한 기록은 그대로 남습니다.')) return;

      /* 새 차례: 틀 순서대로 놓되, 틀에 없는 순서는 원래 바로 앞에 있던 순서 뒤에 붙인다 */
      var after = {}, lead = [];
      var prevTpl = null;
      keep.forEach(function (x) {
        var k = key[norm(x.title)];
        if (k != null) { prevTpl = k; return; }
        if (prevTpl == null) lead.push(x); else (after[prevTpl] = after[prevTpl] || []).push(x);
      });
      var order = lead.slice();
      tpl.forEach(function (t, i) {
        order.push(have[i] || { _new: i });
        (after[i] || []).forEach(function (x) { order.push(x); });
      });
      var ups = [], ins = [];
      order.forEach(function (x, n) {
        var s = (n + 1) * 10, patch = {};
        if (x._new != null) { ins.push(tplRow(cur.id, tpl[x._new], s)); return; }
        if (x.sort !== s) patch.sort = s;
        /* 예전 이름(고시부 보고 등)은 새 틀의 이름으로 — 그래야 헌의안 처리 칸이 붙는다 */
        var k = key[norm(x.title)];
        if (k != null && norm(x.title) !== norm(tpl[k][1])) patch.title = tpl[k][1];
        if (Object.keys(patch).length) ups.push({ id: x.id, patch: patch });
      });
      db().then(function (c) {
        var jobs = ups.map(function (u) { return c.from('meeting_items').update(u.patch).eq('id', u.id); });
        if (ins.length) jobs.push(c.from('meeting_items').insert(ins));
        drop.forEach(function (x) { jobs.push(c.from('meeting_items').delete().eq('id', x.id)); });
        return Promise.all(jobs);
      }).then(function (rs) {
        var bad = rs.filter(function (r) { return r && r.error; })[0];
        if (bad) alert(bad.error.message);
        SHSCloud.log('update', '노회 순서지 틀 맞추기', cur.title + ' (+' + ins.length + ', -' + drop.length + ')');
        loadItems();
      });
    }

    /* ---------------- 회의 진행 화면 ---------------- */
    function upSession(patch, then) {
      patch.updated_at = nowIso();
      patch.updated_by = user.name;
      db().then(function (c) {
        return c.from('meeting_sessions').update(patch).eq('id', cur.id).select();
      }).then(function (r) {
        var w = SHS.wrote(r);
        if (!w.ok) { alert(w.why); return; }
        cur = r.data[0];
        if (then) then(); else drawSession();
      });
    }
    function upItem(id, patch, then) {
      patch.updated_at = nowIso();
      patch.updated_by = user.name;
      db().then(function (c) {
        return c.from('meeting_items').update(patch).eq('id', id).select();
      }).then(function (r) {
        var w = SHS.wrote(r);
        if (!w.ok) { alert(w.why); loadItems(); return; }
        if (then) then(); else loadItems();
      });
    }
    function currentItem() { return items.filter(function (x) { return x.status === '진행중'; })[0] || null; }
    function nextWaiting(afterSort) {
      return items.filter(function (x) {
        return x.status === '대기' && (afterSort == null || x.sort > afterSort);
      })[0] || items.filter(function (x) { return x.status === '대기'; })[0] || null;
    }
    function markItem(id, status) {
      var x = itemById(id); if (!x) return;
      var patch = status === '대기'
        ? { status: '대기', started_at: null, done_at: null }
        : { status: status, done_at: nowIso() };
      upItem(x.id, patch, function () {
        SHSCloud.log('update', '노회 순서 ' + status, cur.title + ' / ' + x.title);
        loadItems();
      });
    }
    function finishCurrent(skip) {
      var it = currentItem();
      if (!it) return;
      var result = (document.getElementById('pc-result') || { value: '' }).value.trim() || null;
      var nxt = nextWaiting(it.sort);
      upItem(it.id, {
        status: skip ? '건너뜀' : '완료',
        result: skip ? (result || '다음에 다루기로 함') : result,
        done_at: nowIso()
      }, function () {
        SHSCloud.log('update', '노회 순서 ' + (skip ? '건너뜀' : '완료'), cur.title + ' / ' + it.title);
        if (nxt) upItem(nxt.id, { status: '진행중', started_at: nowIso() }, loadItems);
        else loadItems();
      });
    }
    function stCls(s) { return s === '폐회' ? '완료' : s === '준비' ? '대기' : '진행중'; }

    function drawSession() {
      var done = items.filter(function (x) { return x.status === '완료' || x.status === '건너뜀'; }).length;
      var left = items.filter(function (x) { return x.status === '대기' || x.status === '진행중'; }).length;
      var total = items.length;
      var pct = total ? Math.round(done / total * 100) : 0;
      var it = currentItem();
      var running = cur.status === '진행' || cur.status === '정회';

      var h = (opts.sessionNo ? '' : '<div style="margin-bottom:12px"><button class="btn ghost sm" id="pc-back" data-ro-ok>&#8592; 회의 목록</button></div>');
      if (!HAS_CHECKS) {
        h += '<div class="notice-banner" style="border-color:#d9a33b">시찰 · 상비부 보고를 하나씩 체크하려면 ' +
          'Supabase에서 <strong>63_meeting_item_checks.sql</strong>을 한 번 실행해 주세요.</div>';
      }
      if (RO) h += '<div class="pc-ro">열람 전용 — 회의 진행은 서기가 입력합니다.</div>';

      h += '<div class="cm-head"><div class="cm-officers" style="align-items:center">' +
        '<span><strong>' + e(cur.title) + '</strong></span>' +
        (cur.meet_on ? '<span>' + e(cur.meet_on) + '</span>' : '') +
        (cur.place ? '<span>' + e(cur.place) + '</span>' : '') +
        '<span class="pc-st s' + stCls(cur.status) + '">' + e(cur.status) + '</span>' +
        (cur.started_at ? '<span style="color:var(--gray-5)">개회 ' + hhmm(cur.started_at) + '</span>' : '') +
        (cur.ended_at ? '<span style="color:var(--gray-5)">폐회 ' + hhmm(cur.ended_at) + '</span>' : '') +
        '</div>' +
        '<div class="pc-headbtns">' +
        (cur.status === '준비' ? '<button class="btn" id="pc-start">개회 — 진행 시작</button>' : '') +
        (cur.status === '진행' ? '<button class="btn ghost" id="pc-pause">정회</button> <button class="btn" id="pc-end">폐회</button>' : '') +
        (cur.status === '정회' ? '<button class="btn" id="pc-resume">속회</button> <button class="btn ghost" id="pc-end">폐회</button>' : '') +
        (cur.status === '폐회' ? '<button class="btn ghost sm" id="pc-reopen">다시 열기</button> ' : '') +
        '<button class="btn ghost sm" id="pc-draft" data-ro-ok>회의 기록 정리</button>' +
        '</div></div>';

      h += '<div class="inline-form" style="margin:12px 0 4px">' +
        '<div class="field" style="flex:1 1 380px"><label>성수 보고 (예: 목사 29/37 · 장로 16/26 — 성수)</label>' +
        '<input type="text" id="pc-quorum" value="' + e(cur.quorum_note || '') + '"></div>' +
        '<button class="btn ghost sm" id="pc-quorum-save" style="align-self:flex-end">저장</button>' +
        '</div>';

      h += '<div style="max-width:760px;margin:10px 0 4px">' +
        '<div style="display:flex;justify-content:space-between;font-size:0.82rem;color:var(--gray-6)">' +
        '<span>진행 현황</span><span><strong>' + done + '</strong> / ' + total + ' 순서 (' + pct + '%)' +
        ' · 남은 순서 <strong>' + left + '</strong>개</span></div>' +
        '<div class="pc-bar"><div style="width:' + pct + '%"></div></div></div>';

      if (running && it) {
        var nxts = items.filter(function (x) { return x.status === '대기' && x.sort > it.sort; }).slice(0, 2);
        var pg = progressOf(it);
        h += '<div class="pc-now">' +
          (it.section ? '<div class="pc-sec">' + e(it.section) + '</div>' : '') +
          '<h2>지금 순서 — ' + e(it.title) + '</h2>' +
          (it.leader ? '<p class="pc-lead"><span>진행 담당</span><strong>' + e(it.leader) + '</strong></p>' : '') +
          (it.detail ? '<p class="pc-detail">' + e(it.detail) + '</p>' : '') +
          (pg.all ? '<div class="pc-chkhead">' + e(pg.label) + ' <strong>' + pg.done + ' / ' + pg.all + '</strong></div>' : '') +
          checksHtml(it, true) +
          '<div class="field"><label>처리 결과 (선택 — 예: 가결, 유인물대로 받기로 함)</label>' +
          '<input type="text" id="pc-result" value="' + e(it.result || '') + '"></div>' +
          '<div style="margin-top:8px">' +
          '<button class="btn" id="pc-done">이 순서 완료 — 다음으로</button> ' +
          '<button class="btn ghost" id="pc-skip">건너뛰고 다음으로</button> ' + voteBtn(it.title) + '</div>' +
          (nxts.length
            ? '<div class="pc-next">다음 순서: ' + nxts.map(function (n2) {
                return '<strong>' + e(n2.title) + '</strong>' + (n2.leader ? ' (' + e(n2.leader) + ')' : '');
              }).join(' &#8594; ') + '</div>'
            : '<div class="pc-next">이 순서가 <strong>마지막</strong>입니다. 완료 후 폐회 처리를 해주세요.</div>') +
          '</div>';
      } else if (cur.status === '정회') {
        h += '<div class="notice-banner">정회 중입니다. 속회하면 ' + (opts.onResume ? '새 출석 QR 코드가 나오고, 회원들은 그 QR을 찍어 다시 입장합니다.' : '진행이 이어집니다.') + '</div>';
      } else if (running && !it && left) {
        h += '<div class="notice-banner">지금 진행 중인 순서가 없습니다. 아래 순서지에서 ' +
          '<strong>이 순서로</strong>를 눌러 지금 다루는 순서를 고르세요. 남은 순서는 ' + left + '개입니다.</div>';
      } else if (running && !it) {
        h += '<div class="notice-banner">모든 순서가 끝났습니다. <strong>폐회</strong>를 눌러 마무리해 주세요.</div>';
      } else if (cur.status === '준비' && !RO) {
        h += '<div class="notice-banner">아래 순서지를 확인하고 <strong>개회 — 진행 시작</strong>을 누르면 첫 순서부터 안내가 시작됩니다.</div>';
      }

      h += '<h3 class="mn-sub" style="margin-top:20px">순서지 (' + total + '개)</h3>';
      h += '<div class="pc-tblwrap"><table class="tbl pc-tbl"><thead><tr><th style="width:40px">#</th><th>순서</th>' +
        '<th style="width:120px">담당</th><th style="width:80px">상태</th>' +
        '<th class="left">처리 결과</th>' + (RO ? '' : '<th style="width:220px">관리</th>') + '</tr></thead><tbody>';
      var lastSec = null, num = 0;
      items.forEach(function (x, i) {
        if (x.section && x.section !== lastSec) {
          lastSec = x.section;
          h += '<tr class="pc-sechead"><td colspan="' + (RO ? 5 : 6) + '" class="left">' + e(x.section) + '</td></tr>';
        }
        num++;
        var cls = x.status === '진행중' ? ' class="pc-cur"' : (x.status === '완료' || x.status === '건너뜀') ? ' class="pc-done"' : '';
        var pg2 = progressOf(x);
        var showChk = !(running && it && it.id === x.id);   /* 지금 순서는 위 큰 카드에서 다룬다 */
        h += '<tr' + cls + '><td>' + num + '</td>' +
          '<td class="left"><strong>' + e(x.title) + '</strong>' +
          (pg2.all ? ' <span class="pc-chkcnt">(' + e(pg2.label) + ' ' + pg2.done + '/' + pg2.all + ')</span>' : '') +
          (x.detail ? '<div style="font-size:0.78rem;color:var(--gray-5)">' + e(x.detail) + '</div>' : '') +
          (showChk ? checksHtml(x) : '<div class="pc-note">지금 순서 — 위에서 진행합니다</div>') + '</td>' +
          '<td>' + e(x.leader || '-') + '</td>' +
          '<td><span class="pc-st s' + e(x.status) + '">' + e(x.status) + '</span>' +
          (x.done_at ? '<div style="font-size:0.72rem;color:var(--gray-5)">' + hhmm(x.done_at) + '</div>' : '') + '</td>' +
          '<td class="left">' + (x.result ? e(x.result) : '<span style="color:var(--gray-5)">-</span>') + '</td>' +
          (RO ? '' : '<td>' +
            (x.status === '완료' || x.status === '건너뜀'
              ? '<button class="btn ghost sm" data-undo="' + x.id + '">되돌리기</button> '
              : '<button class="btn sm" data-fin="' + x.id + '">완료</button> ') +
            (running && x.status === '대기' ? '<button class="btn ghost sm" data-go="' + x.id + '">이 순서로</button> ' : '') +
            '<button class="btn ghost sm" data-edit="' + x.id + '">수정</button> ' +
            '<button class="btn ghost sm" data-up="' + x.id + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="위로">&#8593;</button>' +
            '<button class="btn ghost sm" data-down="' + x.id + '"' + (i === items.length - 1 ? ' disabled' : '') + ' aria-label="아래로">&#8595;</button> ' +
            '<button class="btn danger sm" data-rm="' + x.id + '">삭제</button>' +
            '</td>') + '</tr>';
      });
      h += '</tbody></table></div>';

      if (!RO) {
        h += '<div class="pc-align"><span>순서지 틀 맞추기 — 빠진 순서(명패 · 휘장 분배, 광고 · 지시위원 선정, 간식 허락, 임원회 보고, 서기 사무 보고, 수원신학교 보고, 감사패 전달 등)를 제자리에 넣습니다.</span>' +
          '<button class="btn ghost sm" id="pc-align-fall">가을 틀에 맞추기</button>' +
          '<button class="btn ghost sm" id="pc-align-spring">봄 틀에 맞추기</button></div>';

        h += '<div class="admin-card" style="margin-top:18px"><h3 style="margin-top:0" id="it-ftitle">순서 추가</h3>' +
          '<input type="hidden" id="it-id" value="">' +
          '<div class="inline-form">' +
          '<div class="field" style="flex:0 0 220px"><label>구분 (선택 — 예: Ⅱ. 회무처리)</label>' +
          '<input type="text" id="it-sec" list="it-secs"><datalist id="it-secs">' +
          (function () {
            var seen = {};
            return items.map(function (x) { return x.section; }).filter(function (s) {
              if (!s || seen[s]) return false; seen[s] = 1; return true;
            }).map(function (s) { return '<option value="' + e(s) + '"></option>'; }).join('');
          })() + '</datalist></div>' +
          '<div class="field"><label>순서 이름</label><input type="text" id="it-title" placeholder="예: 정치부 보고"></div>' +
          '<div class="field" style="flex:0 0 160px"><label>담당 (선택)</label><input type="text" id="it-leader"></div>' +
          '</div>' +
          '<div class="field"><label>준비 메모 (선택)</label><input type="text" id="it-detail"></div>' +
          (HAS_CHECKS
            ? '<div class="field"><label id="it-chklabel">세부 항목 (선택 — 한 줄에 하나. 감사헌의부 보고는 헌의안을 한 줄에 하나씩)</label>' +
              '<textarea id="it-checks" rows="4" placeholder="북부시찰&#10;상록시찰&#10;남부시찰"></textarea></div>' +
              '<div style="margin:-4px 0 12px">' +
              '<button class="btn ghost sm" id="it-chk-sichal">시찰 ' + SICHALS.length + '곳 넣기</button> ' +
              '<button class="btn ghost sm" id="it-chk-buseo">상비부 ' + BUSEO.length + '곳 넣기</button> ' +
              '<button class="btn ghost sm" id="it-chk-clear">비우기</button></div>'
            : '') +
          '<button class="btn" id="it-save">저장</button> ' +
          '<button class="btn ghost hidden" id="it-cancel">취소</button>' +
          '<div class="form-msg" id="it-msg"></div></div>';
      }

      h += '<div id="pc-draft-box" class="hidden" style="margin-top:18px">' +
        '<h3 class="mn-sub">회의 기록 정리 — 회의록 초안</h3>' +
        '<p style="font-size:0.82rem;color:var(--gray-5)">진행하며 적은 결과를 그대로 모았습니다. 복사해서 회의록 작성에 쓰시면 됩니다.</p>' +
        '<textarea id="pc-draft-text" rows="16" style="width:100%;font-size:0.86rem" readonly></textarea>' +
        '<div style="margin-top:8px"><button class="btn sm" id="pc-copy" data-ro-ok>복사</button></div></div>';

      /* 다시 그릴 때 화면 위치를 지킨다 (체크를 누를 때마다 맨 위로 튀지 않게) */
      var y = window.scrollY;
      var focusId = document.activeElement && area.contains(document.activeElement) ? document.activeElement.id : null;
      area.innerHTML = h;
      if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus({ preventScroll: true });
      window.scrollTo(0, y);
      bindSession();
      if (RO) {
        [].forEach.call(area.querySelectorAll('button, input, select, textarea'), function (b) {
          if (b.hasAttribute('data-ro-ok') || b.id === 'pc-draft-text') return;
          b.disabled = true;
        });
      }
    }

    function bindSession() {
      var el;
      if ((el = document.getElementById('pc-back'))) el.addEventListener('click', function () {
        cur = null;
        db().then(function (c) {
          return c.from('meeting_sessions').select('*')
                  .order('meet_on', { ascending: false }).order('id', { ascending: false });
        }).then(function (r) {
          sessions = (r && r.data) || sessions;
          drawList();
        });
      });
      if ((el = document.getElementById('pc-draft'))) el.addEventListener('click', function () {
        var box = document.getElementById('pc-draft-box');
        var t = [];
        t.push(cur.title);
        t.push('일시: ' + (cur.meet_on || '') + (cur.started_at ? ' ' + hhmm(cur.started_at) : '') +
          (cur.ended_at ? ' ~ ' + hhmm(cur.ended_at) : ''));
        if (cur.place) t.push('장소: ' + cur.place);
        if (cur.quorum_note) t.push('성수: ' + cur.quorum_note);
        t.push('');
        var lastSec = null, n = 0;
        items.forEach(function (x) {
          if (x.section && x.section !== lastSec) { lastSec = x.section; t.push('[' + x.section + ']'); }
          n++;
          var line = n + '. ' + x.title;
          if (x.leader) line += ' (' + x.leader + ')';
          if (x.status === '건너뜀') line += ' — 건너뜀';
          if (x.result) line += ' — ' + x.result;
          if (x.done_at) line += ' [' + hhmm(x.done_at) + ']';
          t.push(line);
          var md = modeOf(x.title);
          if (md === 'route') {
            routedTo(routeDept(x.title)).forEach(function (r) {
              t.push('   · ' + r.c.t + ' — ' + (r.c.res || '미처리'));
            });
            return;
          }
          checksOf(x).forEach(function (c2, i2) {
            if (md === 'buseo') t.push('   · ' + c2.t + ' — ' + (c2.full ? '완전보고' : c2.tmp ? '임시보고' : '미보고'));
            else if (md === 'heoni') t.push('   ' + (i2 + 1) + ') ' + c2.t + ' — ' + (c2.to ? c2.to + (c2.to === '본회 직접' ? '' : '로 보냄') : '미이관') + (c2.res ? ' · ' + c2.res : ''));
            else t.push('   · ' + c2.t + ' — ' + (c2.ok ? '보고 완료' : '미보고'));
          });
        });
        document.getElementById('pc-draft-text').value = t.join('\n');
        box.classList.remove('hidden');
        box.scrollIntoView({ behavior: 'smooth' });
      });
      if ((el = document.getElementById('pc-copy'))) el.addEventListener('click', function () {
        var ta = document.getElementById('pc-draft-text');
        ta.select();
        try { document.execCommand('copy'); } catch (x2) {}
        if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(function () {});
        this.textContent = '복사됨';
      });
      if (RO) return;

      if ((el = document.getElementById('pc-start'))) el.addEventListener('click', function () {
        var first = nextWaiting(null);
        upSession({ status: '진행', started_at: cur.started_at || nowIso() }, function () {
          SHSCloud.log('update', '노회 개회', cur.title);
          if (first) upItem(first.id, { status: '진행중', started_at: nowIso() }, loadItems);
          else loadItems();
        });
      });
      function hook(fn, then) {
        var p = fn ? fn() : null;
        if (p && p.then) p.then(function (ok) { if (ok !== false) then(); }); else if (p !== false) then();
      }
      if ((el = document.getElementById('pc-pause'))) el.addEventListener('click', function () {
        hook(opts.onPause, function () {
          upSession({ status: '정회' }, function () { SHSCloud.log('update', '노회 정회', cur.title); loadItems(); });
        });
      });
      if ((el = document.getElementById('pc-resume'))) el.addEventListener('click', function () {
        hook(opts.onResume, function () {
          upSession({ status: '진행' }, function () { SHSCloud.log('update', '노회 속회', cur.title); loadItems(); });
        });
      });
      if ((el = document.getElementById('pc-end'))) el.addEventListener('click', function () {
        var remain = items.filter(function (x) { return x.status === '대기' || x.status === '진행중'; }).length;
        if (!confirm('순서지를 폐회 처리하시겠습니까?' + (remain ? '\n아직 마치지 않은 순서가 ' + remain + '개 있습니다.' : '') +
              (opts.onResume ? '\n(출석 명단 확정과 「노회 마치기」는 위 서기 칸에서 따로 합니다)' : ''))) return;
        upSession({ status: '폐회', ended_at: nowIso() }, function () {
          SHSCloud.log('update', '노회 폐회', cur.title);
          loadItems();
        });
      });
      if ((el = document.getElementById('pc-reopen'))) el.addEventListener('click', function () {
        upSession({ status: '진행', ended_at: null }, function () { loadItems(); });
      });
      if ((el = document.getElementById('pc-quorum-save'))) el.addEventListener('click', function () {
        upSession({ quorum_note: document.getElementById('pc-quorum').value.trim() || null }, function () { loadItems(); });
      });
      if ((el = document.getElementById('pc-done'))) el.addEventListener('click', function () { this.disabled = true; finishCurrent(false); });
      if ((el = document.getElementById('pc-skip'))) el.addEventListener('click', function () { this.disabled = true; finishCurrent(true); });
      if ((el = document.getElementById('pc-align-fall'))) el.addEventListener('click', function () { alignTemplate('fall'); });
      if ((el = document.getElementById('pc-align-spring'))) el.addEventListener('click', function () { alignTemplate('spring'); });

      area.querySelectorAll('button[data-vote]').forEach(function (b) {
        b.addEventListener('click', function () { opts.onVote(b.getAttribute('data-vote')); });
      });
      area.querySelectorAll('button[data-go]').forEach(function (b) {
        b.addEventListener('click', function () {
          var it = currentItem();
          var go = function () { upItem(parseInt(b.dataset.go, 10), { status: '진행중', started_at: nowIso() }, loadItems); };
          if (it) upItem(it.id, { status: '대기', started_at: null }, go); else go();
        });
      });
      area.querySelectorAll('button[data-chk]').forEach(function (b) {
        b.addEventListener('click', function () {
          var v = b.dataset.chk.split(':');
          toggleCheck(v[0], parseInt(v[1], 10));
        });
      });
      area.querySelectorAll('button[data-bs]').forEach(function (b) {
        b.addEventListener('click', function () {
          var v = b.dataset.bs.split(':');
          toggleBuseo(v[0], parseInt(v[1], 10), v[2]);
        });
      });
      area.querySelectorAll('select[data-to]').forEach(function (s) {
        s.addEventListener('change', function () {
          var v = s.dataset.to.split(':');
          setRoute(v[0], parseInt(v[1], 10), s.value);
        });
      });
      area.querySelectorAll('button[data-res]').forEach(function (b) {
        b.addEventListener('click', function () {
          var v = b.dataset.res.split(':');
          setResult(v[0], parseInt(v[1], 10), v.slice(2).join(':'));
        });
      });
      area.querySelectorAll('button[data-fin]').forEach(function (b) {
        b.addEventListener('click', function () { markItem(b.dataset.fin, '완료'); });
      });
      area.querySelectorAll('button[data-undo]').forEach(function (b) {
        b.addEventListener('click', function () { markItem(b.dataset.undo, '대기'); });
      });
      area.querySelectorAll('button[data-edit]').forEach(function (b) {
        b.addEventListener('click', function () {
          var x = itemById(b.dataset.edit);
          if (!x) return;
          document.getElementById('it-id').value = x.id;
          document.getElementById('it-sec').value = x.section || '';
          document.getElementById('it-title').value = x.title;
          document.getElementById('it-leader').value = x.leader || '';
          document.getElementById('it-detail').value = x.detail || '';
          if (document.getElementById('it-checks')) {
            document.getElementById('it-checks').value = checksOf(x).map(function (c2) { return c2.t; }).join('\n');
          }
          document.getElementById('it-ftitle').textContent = '순서 수정';
          document.getElementById('it-cancel').classList.remove('hidden');
          document.getElementById('it-ftitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
      area.querySelectorAll('button[data-rm]').forEach(function (b) {
        b.addEventListener('click', function () {
          var x = itemById(b.dataset.rm);
          if (!x) return;
          if (!confirm('"' + x.title + '" 순서를 지우시겠습니까?')) return;
          db().then(function (c) { return c.from('meeting_items').delete().eq('id', x.id); }).then(function (r) {
            if (r.error) { alert(r.error.message); return; }
            loadItems();
          });
        });
      });
      function swap(idA, dir) {
        var idx = -1;
        items.forEach(function (x, i) { if (String(x.id) === idA) idx = i; });
        var j = idx + dir;
        if (idx < 0 || j < 0 || j >= items.length) return;
        var a = items[idx], b2 = items[j];
        var sa = a.sort, sb = b2.sort;
        if (sa === sb) sb = sa + dir;    /* 같은 차례 번호면 엇갈리게 */
        upItem(a.id, { sort: sb }, function () { upItem(b2.id, { sort: sa }, loadItems); });
      }
      area.querySelectorAll('button[data-up]').forEach(function (b) {
        b.addEventListener('click', function () { swap(b.dataset.up, -1); });
      });
      area.querySelectorAll('button[data-down]').forEach(function (b) {
        b.addEventListener('click', function () { swap(b.dataset.down, 1); });
      });

      var chkBox = document.getElementById('it-checks');
      if (chkBox) {
        document.getElementById('it-chk-sichal').addEventListener('click', function () { chkBox.value = SICHALS.join('\n'); });
        document.getElementById('it-chk-buseo').addEventListener('click', function () { chkBox.value = BUSEO.join('\n'); });
        document.getElementById('it-chk-clear').addEventListener('click', function () { chkBox.value = ''; });
        document.getElementById('it-title').addEventListener('change', function () {
          if (chkBox.value.trim()) return;
          var auto = autoChecks(this.value.trim(), document.getElementById('it-detail').value);
          if (auto.length) chkBox.value = auto.map(function (c2) { return c2.t; }).join('\n');
        });
      }
      document.getElementById('it-cancel').addEventListener('click', function () {
        ['it-id', 'it-sec', 'it-title', 'it-leader', 'it-detail', 'it-checks'].forEach(function (id) {
          var f = document.getElementById(id);
          if (f) f.value = '';
        });
        document.getElementById('it-ftitle').textContent = '순서 추가';
        this.classList.add('hidden');
      });
      document.getElementById('it-save').addEventListener('click', function () {
        var btn = this;
        var msg = document.getElementById('it-msg');
        var id = document.getElementById('it-id').value;
        var d = {
          section: document.getElementById('it-sec').value.trim() || null,
          title: document.getElementById('it-title').value.trim(),
          leader: document.getElementById('it-leader').value.trim() || null,
          detail: document.getElementById('it-detail').value.trim() || null,
          updated_by: user.name, updated_at: nowIso()
        };
        if (chkBox) {
          /* 이미 체크한 기록(임시·완전보고, 보낸 부서, 처리 결과)은 이름이 같으면 그대로 남긴다 */
          var was = {};
          var old = itemById(id);
          checksOf(old).forEach(function (c2) { was[c2.t] = c2; });
          var md = modeOf(d.title);
          d.checks = chkBox.value.split('\n').map(function (t2) { return t2.trim(); })
            .filter(function (t2) { return t2; })
            .map(function (t2) {
              if (was[t2]) { var o = {}; Object.keys(was[t2]).forEach(function (k) { o[k] = was[t2][k]; }); return o; }
              return md === 'buseo' ? { t: t2, ok: false, at: null, tmp: false, full: false } : { t: t2, ok: false, at: null };
            });
        }
        if (!d.title) { msg.className = 'form-msg err'; msg.textContent = '순서 이름을 적어 주세요.'; return; }
        btn.disabled = true;
        msg.className = 'form-msg'; msg.textContent = '저장 중입니다...';
        db().then(function (c) {
          if (id) return c.from('meeting_items').update(d).eq('id', id).select();
          d.session_id = cur.id;
          d.sort = (items.length ? Math.max.apply(null, items.map(function (x) { return x.sort; })) : 0) + 10;
          return c.from('meeting_items').insert(d).select();
        }).then(function (r) {
          btn.disabled = false;
          var w = SHS.wrote(r);
          if (!w.ok) { msg.className = 'form-msg err'; msg.textContent = w.why; return; }
          loadItems();
        });
      });
    }

    load();
    return {
      reload: function () { if (cur) loadItems(); else load(); },
      /* 오늘의 노회에서 정회 · 속회를 누르면 순서지의 상태도 맞춘다 */
      setStatus: function (st) {
        if (!cur || RO || cur.status === st || cur.status === '준비' || cur.status === '폐회') return;
        upSession({ status: st }, loadItems);
      },
      session: function () { return cur; }
    };
  }

  /* 순서지 판 모양 — 화면마다 한 번만 넣는다 */
  var CSS = '.pc-bar{background:var(--gray-2,#e8eaef);border-radius:6px;height:14px;overflow:hidden}' +
    '.pc-bar>div{height:100%;background:#2a7a2a;transition:width .3s}' +
    '.pc-now{border:3px solid var(--accent,#b08d3e);border-radius:16px;background:#fff;padding:30px 34px;margin:18px 0 22px;box-shadow:0 6px 24px rgba(0,0,0,.10)}' +
    '.pc-now .pc-sec{font-size:1rem;color:var(--gray-5);letter-spacing:2px}' +
    '.pc-now h2{margin:8px 0 16px;font-size:2.2rem;line-height:1.25;color:var(--navy,#4b3f33)}' +
    '.pc-now .pc-lead{margin:0 0 14px;padding:14px 20px;border-radius:12px;background:var(--gray-1,#f4f2ec);font-size:1.15rem;color:var(--gray-6);display:flex;align-items:center;gap:14px;flex-wrap:wrap}' +
    '.pc-now .pc-lead strong{font-size:2rem;line-height:1.2;color:#b03a3a;font-weight:800}' +
    '.pc-now .pc-detail{font-size:1.08rem;line-height:1.65;color:var(--gray-6);white-space:pre-wrap;margin:0 0 16px}' +
    '.pc-now .field input{font-size:1.05rem;padding:12px 14px}' +
    '.pc-next{border-left:4px solid var(--gray-3,#d8dbe2);padding:6px 0 6px 14px;margin:16px 0 0;font-size:1.02rem;color:var(--gray-6)}' +
    '@media (max-width:640px){.pc-now{padding:20px 16px}.pc-now h2{font-size:1.6rem}.pc-now .pc-lead strong{font-size:1.5rem}}' +
    '.pc-st{display:inline-block;font-size:.74rem;border-radius:10px;padding:1px 8px;white-space:nowrap}' +
    '.pc-st.s대기{background:var(--gray-2,#e8eaef);color:var(--gray-6)}.pc-st.s진행중{background:#b03a3a;color:#fff}' +
    '.pc-st.s완료{background:#2a7a2a;color:#fff}.pc-st.s건너뜀{background:#b0731f;color:#fff}' +
    '.pc-done td{opacity:.62}.pc-cur td{background:#fdf6ea}' +
    '.pc-sechead td{background:var(--gray-1,#f4f5f8);font-weight:700;color:var(--navy,#4b3f33)}' +
    '.pc-tblwrap{overflow-x:auto}.pc-tbl td.left{min-width:220px}' +
    '.pc-chk{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:8px}.pc-chk li{margin:0}' +
    '.pc-chk button,.pc-bs button{display:inline-flex;align-items:center;gap:6px;cursor:pointer;border:1px solid var(--gray-3,#d8dbe2);background:#fff;border-radius:20px;padding:5px 13px;font-size:.82rem;color:var(--gray-6);font-family:inherit;min-height:32px}' +
    '.pc-chk button .mk,.pc-bs button .mk{font-weight:800;color:var(--gray-4,#c3c7d0)}' +
    '.pc-chk button.on,.pc-bs button.on{background:#eaf4ea;border-color:#2a7a2a;color:#245f24}' +
    '.pc-chk button.on .mk,.pc-bs button.on .mk{color:#2a7a2a}' +
    '.pc-chk button:disabled,.pc-bs button:disabled{cursor:default}' +
    '.pc-now .pc-chk{margin:0 0 16px}.pc-now .pc-chk button{font-size:1.05rem;padding:11px 22px}' +
    '.pc-bs{list-style:none;margin:6px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px}' +
    '.pc-bs li{margin:0;display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:8px;background:#fafafa;border:1px solid var(--gray-2,#eee)}' +
    '.pc-bs li.on{background:#f1f8f1}.pc-bs li.half{background:#fffaf0}' +
    '.pc-bs-n{flex:1;font-size:.86rem;font-weight:700;color:var(--gray-7,#444)}' +
    '.pc-bs.big{margin:0 0 16px}.pc-bs.big .pc-bs-n{font-size:1.05rem}.pc-bs.big button{font-size:.95rem;padding:8px 14px}' +
    '.pc-hn{list-style:none;margin:8px 0 0;padding:0}' +
    '.pc-hn li{margin:0 0 6px;padding:8px 10px;border:1px solid var(--gray-3,#d8dbe2);border-radius:8px;background:#fff}' +
    '.pc-hn li.on{border-color:#8cc79d}' +
    '.pc-hn-t{font-size:.92rem;line-height:1.5}' +
    '.pc-hn-ok{border:1px solid var(--gray-3);background:#fff;border-radius:50%;width:28px;height:28px;cursor:pointer;font-weight:800;color:var(--gray-4,#c3c7d0)}' +
    '.pc-hn-ok.on{background:#eaf4ea;border-color:#2a7a2a;color:#2a7a2a}' +
    '.pc-hn-act{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;font-size:.82rem;color:var(--gray-5)}' +
    '.pc-hn-act select{padding:4px 6px;border:1px solid var(--gray-3);border-radius:6px;font-family:inherit}' +
    '.pc-res{display:inline-block;font-size:.74rem;padding:1px 8px;border-radius:10px;background:var(--gray-1,#f4f5f8);color:var(--gray-6)}' +
    '.pc-res.r가결{background:#2a7a2a;color:#fff}.pc-res.r부결,.pc-res.r기각{background:#b03a3a;color:#fff}.pc-res.r보류{background:#b0731f;color:#fff}' +
    '.pc-now .pc-hn li{padding:12px 14px}.pc-now .pc-hn-t{font-size:1.08rem}' +
    '.pc-chkhead{font-size:1rem;color:var(--gray-6);margin:14px 0 6px}.pc-chkcnt{font-size:.72rem;color:var(--gray-5)}' +
    '.pc-note{font-size:.78rem;color:var(--gray-5);margin-top:4px}' +
    '.pc-headbtns{margin-top:10px;display:flex;gap:6px;flex-wrap:wrap}' +
    '.pc-ro{margin:0 0 12px;padding:8px 12px;border-radius:8px;background:#eef3fb;color:var(--navy);font-size:.88rem}' +
    '.pc-intro{color:var(--gray-5);font-size:.88rem}' +
    '.pc-align{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px;padding:10px 12px;border:1px dashed var(--gray-3);border-radius:8px;font-size:.8rem;color:var(--gray-5)}' +
    '.pc-align span{flex:1 1 300px}';
  function injectCss() {
    if (document.getElementById('pp-css')) return;
    var s = document.createElement('style');
    s.id = 'pp-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  window.SHSProceed = {
    mount: function (area, user, opts) { injectCss(); return mount(area, user, opts); },
    modeOf: modeOf
  };
})();

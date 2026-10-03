/* 총대 장로 임기 확인 · 공문 시안 (정기노회 4주 전)
 *
 * 정기노회 4주(28일) 전이 되면 서기가
 *   · 노회 장로 총대 가운데 남은 임기가 1년이 안 되는 분을 확인하고
 *   · 그 교회 당회장에게 다른 장로를 총대로 파송해 달라는 공문을 보낸다.
 *   (근거: 노회규칙 제16조 2항 — 노회총대는 정치 제10장 제2조에 의거하여 당회장이 제출한다)
 *
 * 남은 임기 — 회원 관리(admin.html)·시찰(sichal.html)의 '남은 임기' 칸과 같은 셈이다.
 *   정년일   = 만 71세가 되는 생일 하루 전 (SHS.retireDate)
 *   남은 임기 = 오늘부터 정년일까지 꽉 찬 개월 수 (N년 M개월 / M개월 / 한 달 미만 / 정년 경과)
 *   1년 미만  = 꽉 찬 개월 수가 12 미만 (정년이 지난 분도 넣는다)
 *
 * 장로 총대 — 노회 명단(roster)의 직분 '장로' 가운데 교체되지 않은 분(active ≠ false).
 *   노회 명단에 장로 줄이 없는 교회 명부(church_staff)의 총대장로 표시도 함께 본다
 *   (110 오늘의 노회 자격 판정과 같은 규칙).
 *
 * 정기노회 날 — 노회 일정 설정(meetings)의 봄·가을 정기노회 날짜,
 *   그 해 그 정기노회 날짜가 없으면 기준일 규칙(ops_dates, 기본 4월·10월 둘째 주 월요일).
 *
 * 쓰는 곳
 *   · elder-notice.html  — 명단과 공문 시안, 워드(.docx) 내려받기 (?demo=1 이면 예시 자료로 미리 보기)
 *   · 대시보드(board.js) — 서기에게 4주 전부터 알림 카드
 *   · 서버 알림         — supabase/111_elder_term_notice.sql (run_elder_term_notice)
 *
 * 워드 파일은 브라우저에서 바로 만든다 (외부 라이브러리 없이 WordprocessingML + 무압축 ZIP).
 */
var SHSElderNotice = (function () {
  'use strict';

  var LEAD_DAYS = 28;              /* 정기노회 4주 전부터 */
  var RETIRE_AGE = 71;             /* SHS 가 없을 때(노드 검사)만 쓰는 값 — main.js 와 같다 */
  var OFFICE = {
    addr: '경기도 안산시 단원구 와동공원로1안길 13-7 (반월교회 교육관 1층)',
    tel: '031-486-9993', fax: '031-486-9993', site: 'sihwasan.org'
  };
  var DEFAULT_OPS_DATES = { springMonth: 4, springWeek: 2, fallMonth: 10, fallWeek: 2 };
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  /* ---------- 작은 도구 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hasSHS(k) { return typeof SHS !== 'undefined' && SHS && typeof SHS[k] === 'function'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseYmd(s) {
    var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  var TODAY_OVERRIDE = null;       /* 예시 화면에서만 ?today=YYYY-MM-DD 로 바꿔 볼 수 있다 */
  function todayStart() {
    if (TODAY_OVERRIDE) return new Date(TODAY_OVERRIDE.getTime());
    var d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  /* 2026년 10월 12일(월) */
  function koDate(d, dow) {
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일' +
      (dow ? '(' + DOW[d.getDay()] + ')' : '');
  }
  /* 공문 일시 — 노회 공문 표기 그대로 (예: 2026년 09월 01일) */
  function koDate0(d) { return d.getFullYear() + '년 ' + pad2(d.getMonth() + 1) + '월 ' + pad2(d.getDate()) + '일'; }
  /* 정년일 — 회원 관리 화면 표기 그대로 (예: 2027. 3. 1.) */
  function dots(d) { return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.'; }
  function normChurch(s) { return String(s || '').replace(/\s/g, '').replace(/교회$/, ''); }
  function normName(s) { return String(s || '').replace(/\s/g, ''); }

  function nthMonday(y, month, week) {
    if (hasSHS('nthMonday')) return SHS.nthMonday(y, month, week);
    var first = new Date(y, month - 1, 1).getDay();
    return new Date(y, month - 1, 1 + ((8 - first) % 7) + 7 * (week - 1));
  }

  /* ---------- 정년 · 남은 임기 (회원 관리·시찰 화면과 같은 셈) ---------- */
  function retireDate(birth) {
    if (hasSHS('retireDate')) return SHS.retireDate(birth);
    var b = parseYmd(birth);
    if (!b) return null;
    return new Date(b.getFullYear() + RETIRE_AGE, b.getMonth(), b.getDate() - 1);
  }
  /* null = 생년월일 없음, -1 = 정년 경과, 0 이상 = 정년까지 꽉 찬 개월 수 */
  function remainMonths(birth, base) {
    var rd = retireDate(birth);
    if (!rd) return null;
    var t = base || todayStart();
    if (rd < t) return -1;
    var months = (rd.getFullYear() - t.getFullYear()) * 12 + (rd.getMonth() - t.getMonth());
    if (rd.getDate() < t.getDate()) months--;
    return months;
  }
  function labelOf(months) {
    if (months === null || months === undefined) return '생년월일 미등록';
    if (months < 0) return '정년 경과';
    var y = Math.floor(months / 12), mo = months % 12;
    return ((y ? y + '년 ' : '') + (mo ? mo + '개월' : (y ? '' : '한 달 미만'))).trim();
  }
  function remainLabel(birth, base) { return labelOf(remainMonths(birth, base)); }

  /* ---------- 권한 ---------- */
  /* 알림 카드·메뉴는 서기에게 (최고관리자는 관리를 위해 함께 본다) */
  function isClerk(u) { return !!u && (u.role === 'clerk' || u.role === 'superadmin'); }
  /* 화면 자체는 생년월일을 볼 수 있는 관리자(노회장·서기·간사·최고관리자) */
  function canUse(u) {
    return !!u && (u.role === 'president' || u.role === 'clerk' || u.role === 'staff' || u.role === 'superadmin');
  }

  /* ---------- 정기노회 날 ---------- */
  function pickMeeting(rows, opsDates, today) {
    var best = null;
    (rows || []).forEach(function (m) {
      if (!m || !m.meet_date || String(m.kind || '').indexOf('정기노회') === -1) return;
      var d = parseYmd(m.meet_date);
      if (!d || d < today) return;
      if (!best || d < best.date || (d.getTime() === best.date.getTime() && m.confirmed && !best.confirmed)) {
        best = { kind: m.kind, date: d, place: m.place || '', confirmed: !!m.confirmed, source: 'meetings' };
      }
    });
    var od = opsDates || DEFAULT_OPS_DATES;
    [today.getFullYear(), today.getFullYear() + 1].forEach(function (y) {
      [['봄 정기노회', od.springMonth || 4, od.springWeek || 2],
       ['가을 정기노회', od.fallMonth || 10, od.fallWeek || 2]].forEach(function (k) {
        var has = (rows || []).some(function (m) {
          return m && m.kind === k[0] && m.meet_date && String(m.meet_date).slice(0, 4) === String(y);
        });
        if (has) return;
        var d = nthMonday(y, Number(k[1]), Number(k[2]));
        if (d < today) return;
        if (!best || d < best.date) best = { kind: k[0], date: d, place: '', confirmed: false, source: 'rule' };
      });
    });
    return best;
  }
  /* 회기 — 그 날 시작하는 회기가 설정에 있으면 그 번호, 없으면 현재 회기 + 1 (오늘의 노회와 같은 셈) */
  function guessSession(sessions, date) {
    if (!sessions) return null;
    var hit = (sessions.list || []).filter(function (x) { return x && x.from === date; })[0];
    if (hit) return Number(hit.no);
    return sessions.current ? Number(sessions.current) + 1 : null;
  }
  function meetingName(m) {
    if (!m) return '정기노회';
    return m.sessionNo ? '제' + m.sessionNo + '회 정기노회' : m.kind;
  }

  /* 노회장·서기 — 사이트 관리의 임원 명부, 없으면 기초 자료(data.js) */
  function officersOf(list) {
    var src = (list && list.length) ? list
      : ((typeof SHSData !== 'undefined' && SHSData && SHSData.officers) || []);
    function find(role) {
      return src.filter(function (o) { return o && String(o.role || '').trim() === role; })[0] || null;
    }
    var p = find('노회장'), c = find('서기');
    return {
      president: (p && p.name) || '', presidentPos: (p && p.position) || '목사',
      clerk: (c && c.name) || '', clerkPos: (c && c.position) || '목사'
    };
  }

  function firstToken(s) {
    var t = String(s || '').trim().split(/\s+/)[0] || '';
    return t.replace(/(위임|담임|시무)?목사$/, '');
  }

  /* ---------- 자료 정리 (서버·예시 공통) ----------
   * raw = { roster, staff, meetings, settings: {ops_dates, sessions, officers}, churches, today? } */
  function build(raw) {
    var today = raw.today || todayStart();
    var st = raw.settings || {};
    var sessions = st.sessions || null;
    var meeting = pickMeeting(raw.meetings || [], st.ops_dates, today);
    if (meeting) {
      meeting.ymd = ymd(meeting.date);
      meeting.days = daysBetween(today, meeting.date);
      meeting.sessionNo = guessSession(sessions, meeting.ymd);
      meeting.name = meetingName(meeting);
      meeting.alertFrom = addDays(meeting.date, -LEAD_DAYS);
      meeting.inWindow = meeting.days >= 0 && meeting.days <= LEAD_DAYS;
    }
    var cur = sessions && sessions.current ? Number(sessions.current)
      : (meeting && meeting.sessionNo ? meeting.sessionNo - 1 : null);

    var pastorOf = {};
    (raw.churches || []).forEach(function (c) {
      if (c && c.name) pastorOf[normChurch(c.name)] = { pastor: firstToken(c.pastor), sichal: c.sichal || '' };
    });

    var list = [];
    function mk(id, name, church, sichal, birth, src) {
      var mo = remainMonths(birth, today);
      return {
        id: id, name: String(name || '').trim(), church: String(church || '').trim(),
        sichal: sichal || (pastorOf[normChurch(church)] || {}).sichal || '',
        birth_date: birth || null, retire: retireDate(birth), months: mo, remain: labelOf(mo),
        due: mo !== null && mo < 12, src: src
      };
    }
    var rosterElders = (raw.roster || []).filter(function (r) { return r && r.category === '장로'; });
    rosterElders.forEach(function (r) {
      if (r.active === false) return;                       /* 교체된 총대는 보지 않는다 */
      list.push(mk('r' + r.id, r.name, r.church, r.sichal, r.birth_date, 'roster'));
    });
    (raw.staff || []).forEach(function (s) {
      if (!s || !s.is_chongdae) return;
      var role = String(s.role || '');
      if (role.indexOf('장로') === -1 || role.indexOf('원로') !== -1 || role.indexOf('은퇴') !== -1) return;
      var dup = rosterElders.some(function (r) {
        return (s.roster_id && String(r.id) === String(s.roster_id)) ||
          (normName(r.name) === normName(s.name) && normChurch(r.church) === normChurch(s.church));
      });
      if (dup) return;                                      /* 노회 명단에 있으면 명단을 따른다 */
      list.push(mk('s' + s.id, s.name, s.church, null, s.birth_date, 'staff'));
    });

    function byChurch(a, b) {
      var c = a.church.localeCompare(b.church, 'ko');
      return c || a.name.localeCompare(b.name, 'ko');
    }
    var due = list.filter(function (x) { return x.due; }).sort(function (a, b) {
      return a.church.localeCompare(b.church, 'ko') || (a.months - b.months);
    });
    var unknown = list.filter(function (x) { return x.months === null; }).sort(byChurch);

    return {
      today: today, meeting: meeting, curSession: cur, officers: officersOf(st.officers),
      pastorOf: pastorOf, elders: list, due: due, unknown: unknown
    };
  }

  /* 서버에서 읽어 build 로 넘긴다. 생년월일은 관리자 함수(roster_births 등)로 따로 받는다. */
  function load(c) {
    function soft(p) { return p.then(function (x) { return x; }, function () { return { data: null }; }); }
    return Promise.all([
      c.from('roster').select(SHS.ROSTER_COLS).eq('category', '장로'),
      soft(c.from('church_staff').select(SHS.STAFF_COLS).eq('is_chongdae', true)),
      soft(c.from('meetings').select('id,kind,year,meet_date,place,confirmed')),
      soft(c.from('site_settings').select('key,value').in('key', ['ops_dates', 'sessions', 'officers'])),
      soft(c.from('sichal_churches').select('sichal,name,pastor'))
    ]).then(function (rs) {
      if (rs[0].error) throw rs[0].error;
      var roster = rs[0].data || [], staff = (rs[1] && rs[1].data) || [];
      var settings = {};
      ((rs[3] && rs[3].data) || []).forEach(function (r) { settings[r.key] = r.value; });
      return Promise.all([SHS.withBirths(c, roster, 'roster'), SHS.withBirths(c, staff, 'staff')])
        .then(function () {
          return build({
            roster: roster, staff: staff, meetings: (rs[2] && rs[2].data) || [],
            settings: settings, churches: (rs[4] && rs[4].data) || []
          });
        });
    });
  }

  /* ---------- 예시 자료 (?demo=1) — 실제 명단이 아니다 ---------- */
  function demoRaw(today) {
    today = today || todayStart();
    /* 정년일이 오늘부터 n개월(+d일) 뒤가 되도록 생년월일을 거꾸로 만든다 */
    function birthFor(months, extraDays) {
      var rd = new Date(today.getFullYear(), today.getMonth() + months, today.getDate() + (extraDays || 0));
      var b = new Date(rd.getFullYear() - RETIRE_AGE, rd.getMonth(), rd.getDate() + 1);
      return ymd(b);
    }
    return {
      today: today,
      roster: [
        { id: 901, name: '홍길동', church: '가온교회', sichal: '예시시찰', category: '장로', active: true, birth_date: birthFor(4, 10) },
        { id: 902, name: '김철수', church: '나래교회', sichal: '예시시찰', category: '장로', active: true, birth_date: birthFor(10, 5) },
        { id: 903, name: '이영희', church: '나래교회', sichal: '예시시찰', category: '장로', active: true, birth_date: birthFor(30) },
        { id: 904, name: '박민수', church: '다솜교회', sichal: '예시시찰', category: '장로', active: true, birth_date: birthFor(0, -20) },
        { id: 905, name: '최바른', church: '라온교회', sichal: '예시시찰', category: '장로', active: true, birth_date: null },
        { id: 906, name: '정한결', church: '가온교회', sichal: '예시시찰', category: '장로', active: false, birth_date: birthFor(2) }
      ],
      staff: [],
      meetings: [{ id: 1, kind: '가을 정기노회', year: 2026, meet_date: '2026-10-12', place: '수암제일교회', confirmed: true }],
      settings: { sessions: { current: 19, list: [] }, officers: null },
      churches: [
        { sichal: '예시시찰', name: '가온교회', pastor: '강예시 목사' },
        { sichal: '예시시찰', name: '나래교회', pastor: '남예시' },
        { sichal: '예시시찰', name: '다솜교회', pastor: '' }
      ]
    };
  }

  /* ---------- 공문 ---------- */
  function deadlineOf(data) {
    var m = data.meeting, t = data.today;
    if (!m) return addDays(t, 7);
    var d = addDays(m.date, -7);                 /* 노회 한 주 전까지 */
    return d < t ? (m.date < t ? t : m.date) : d;
  }
  function p2Text(data) {
    return '귀 교회의 노회 장로 총대 가운데 아래 장로님께서는 총회 정년(만 71세가 되는 생일 전날)까지 ' +
      '남은 임기가 1년이 되지 않습니다. 그동안 노회를 섬겨 주신 장로님의 수고에 깊이 감사드리며, ' +
      '노회규칙 제16조 제2항(노회총대는 정치 제10장 제2조에 의거하여 당회장이 제출한다)에 따라 ' +
      meetingName(data.meeting) + '부터 노회 총대로 섬기실 다른 장로님을 파송하여 주시기 바랍니다.';
  }
  function p3Text(dl) {
    return '변경된 장로 총대 명단은 시찰회를 거쳐 ' + koDate(dl, true) + '까지 노회 서기에게 제출하여 주시기 바랍니다.';
  }
  function p4Text(f) {
    return '문의 : 노회 서기 ' + (f.clerk || '') + ' ' + (f.clerkPos || '목사') + ' · 노회 사무실 ' + OFFICE.tel;
  }
  function defaults(data) {
    var dl = deadlineOf(data);
    var o = data.officers || {};
    var f = {
      noPrefix: '시화산노 제 ' + (data.curSession || '') + '-',
      noStart: '',
      date: ymd(data.today),
      from: '시화산노회장',
      title: meetingName(data.meeting) + ' 장로 총대 파송 안내',
      head2: '장로 총대 파송 안내',
      deadline: ymd(dl),
      p1: '성삼위 하나님의 은총이 섬기시는 교회와 가정 위에 항상 함께 하시기를 기원합니다.',
      p2: p2Text(data),
      p3: p3Text(dl),
      p4: '',
      seal: 'omit',
      president: o.president || '', presidentPos: o.presidentPos || '목사',
      clerk: o.clerk || '', clerkPos: o.clerkPos || '목사'
    };
    f.p4 = p4Text(f);
    return f;
  }

  /* 고른 장로를 교회별로 묶는다 (공문은 교회마다 한 통) */
  function churchesOf(data, sel) {
    var map = {}, out = [];
    data.due.concat(data.unknown).forEach(function (x) {
      if (!sel[x.id]) return;
      var k = normChurch(x.church) || '-';
      if (!map[k]) {
        map[k] = { key: k, church: x.church || '(교회 미등록)', pastor: (data.pastorOf[k] || {}).pastor || '', elders: [] };
        out.push(map[k]);
      }
      map[k].elders.push(x);
    });
    out.sort(function (a, b) { return a.church.localeCompare(b.church, 'ko'); });
    return out;
  }
  function defaultRecv(ch) {
    return ch.church + ' 당회장' + (ch.pastor ? ' ' + ch.pastor + ' 목사' : '');
  }

  /* 공문 한 통의 모양 — 화면 미리 보기와 워드 파일이 같은 것을 쓴다 */
  function letterModel(ch, idx, f, data, recv) {
    var base = parseYmd(f.date) || data.today;
    var start = parseInt(f.noStart, 10);
    var docNo = (f.noPrefix || '') + (isNaN(start) ? '　　' : String(start + idx)) + ' 호';
    var n = 0;
    function numbered(arr) {
      var out = [];
      arr.forEach(function (t) {
        t = String(t || '').trim();
        if (t) out.push({ n: ++n, t: t });
      });
      return out;
    }
    var paras = numbered([f.p1, f.p2]);
    var after = numbered([f.p3, f.p4]);
    var last = after.length ? after[after.length - 1] : paras[paras.length - 1];
    if (last) last.t += '  끝.';
    return {
      church: ch.church,
      head1: '대한예수교장로회 시화산노회',
      head2: f.head2 || '장로 총대 파송 안내',
      meta: [
        ['', docNo],
        ['일  시', koDate0(base)],
        ['발  신', f.from || ''],
        ['수  신', recv || defaultRecv(ch)],
        ['제  목', f.title || '']
      ],
      paras: paras,
      below: '- 아    래 -',
      table: {
        head: ['교회', '장로 총대', '정년일', '남은 임기'],
        rows: ch.elders.map(function (x) {
          return [ch.church, x.name + ' 장로', x.retire ? dots(x.retire) : '-',
                  x.birth_date ? remainLabel(x.birth_date, base) : '-'];
        })
      },
      note: '※ 남은 임기는 ' + koDate(base) + ' 기준, 총회 정년(만 71세 생일 전날)까지입니다.',
      after: after,
      sign: {
        pre: '대한예수교장로회', org: '시 화 산 노 회', seal: f.seal || 'omit',
        lines: [
          '노회장 ' + (f.president || '') + ' ' + (f.presidentPos || '목사'),
          '서　기 ' + (f.clerk || '') + ' ' + (f.clerkPos || '목사')
        ]
      },
      foot: '대한예수교장로회 시화산노회 · 노회 사무실 : ' + OFFICE.addr + '\n' +
        'TEL ' + OFFICE.tel + ' · FAX ' + OFFICE.fax + ' · ' + OFFICE.site
    };
  }
  function makeLetters(data, f, sel, recvMap) {
    return churchesOf(data, sel).map(function (ch, i) {
      return letterModel(ch, i, f, data, (recvMap && recvMap[ch.key]) || '');
    });
  }

  /* ---------- 화면 미리 보기 ---------- */
  function multiline(t) { return esc(t).replace(/\n/g, '<br>'); }
  function letterHtml(L) {
    function para(p) {
      return '<div class="en-p"><span class="n">' + p.n + '.</span><span class="t">' + multiline(p.t) + '</span></div>';
    }
    var h = '<div class="en-h1">' + esc(L.head1) + '</div>' +
      '<div class="en-h2">' + esc(L.head2) + '</div>' +
      '<div class="en-meta">' + L.meta.map(function (r) {
        return '<div>' + (r[0] ? '<span class="en-lab">' + esc(r[0]) + '</span> : ' : '') + esc(r[1]) + '</div>';
      }).join('') + '</div>' +
      '<div class="en-body">' + L.paras.map(para).join('') +
      '<div class="en-below">' + esc(L.below) + '</div>' +
      '<table class="en-tbl"><thead><tr>' + L.table.head.map(function (t) { return '<th>' + esc(t) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + L.table.rows.map(function (r) {
        return '<tr>' + r.map(function (t) { return '<td>' + esc(t) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>' +
      '<div class="en-note">' + esc(L.note) + '</div>' +
      L.after.map(para).join('') + '</div>' +
      '<div class="en-sign"><div class="en-org">' +
      '<span class="en-org-pre">대한예수교<br>장&nbsp;로&nbsp;회</span>' +
      '<span class="en-org-name">' + esc(L.sign.org) + '</span>' +
      (L.sign.seal === 'box' ? '<span class="en-sealbox" title="직인을 찍는 자리">직인</span>' : '<span class="en-seal">(직인생략)</span>') +
      '</div><div class="en-sign-lines">' + L.sign.lines.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('') +
      '</div></div>' +
      '<div class="en-foot">' + multiline(L.foot) + '</div>';
    return h;
  }

  /* ---------- 워드(.docx) 만들기 ----------
   * WordprocessingML 을 손으로 쓰고, 압축하지 않은(store) ZIP 으로 묶는다. */
  var F_HEAD = '맑은 고딕', F_BODY = '바탕';
  var W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
             'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  var TEXT_W = 9070;                 /* A4(11906) - 좌우 여백 1418 × 2 */

  function xesc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  /* 글 한 토막 — rPr 자식 순서는 스키마 순서(rFonts, b, bCs, color, spacing, sz, szCs, bdr)를 지킨다 */
  function wRun(text, o) {
    o = o || {};
    var rp = '';
    var font = o.font || F_BODY;
    rp += '<w:rFonts w:ascii="' + font + '" w:hAnsi="' + font + '" w:eastAsia="' + font + '" w:cs="' + font + '"/>';
    if (o.b) rp += '<w:b/><w:bCs/>';
    if (o.color) rp += '<w:color w:val="' + o.color + '"/>';
    if (o.spacing) rp += '<w:spacing w:val="' + o.spacing + '"/>';
    if (o.sz) rp += '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>';
    if (o.bdr) rp += '<w:bdr w:val="single" w:sz="8" w:space="0" w:color="B03A3A"/>';
    var lines = String(text == null ? '' : text).split('\n');
    var body = '';
    lines.forEach(function (ln, i) {
      if (i) body += '<w:br/>';
      var parts = ln.split('\t');
      parts.forEach(function (pt, j) {
        if (j) body += '<w:tab/>';
        if (pt !== '') body += '<w:t xml:space="preserve">' + xesc(pt) + '</w:t>';
      });
    });
    return '<w:r><w:rPr>' + rp + '</w:rPr>' + body + '</w:r>';
  }
  /* 문단 — pPr 자식 순서: keepNext, pageBreakBefore, pBdr, spacing, ind, jc */
  function wPara(runs, o) {
    o = o || {};
    var pp = '';
    if (o.keepNext) pp += '<w:keepNext/>';
    if (o.pageBreakBefore) pp += '<w:pageBreakBefore/>';
    if (o.borderTop || o.borderBottom) {
      pp += '<w:pBdr>' +
        (o.borderTop ? '<w:top w:val="single" w:sz="6" w:space="4" w:color="888888"/>' : '') +
        (o.borderBottom ? '<w:bottom w:val="single" w:sz="6" w:space="6" w:color="888888"/>' : '') +
        '</w:pBdr>';
    }
    pp += '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after || 0) + '" w:line="' +
      (o.line || 360) + '" w:lineRule="auto"/>';
    if (o.ind) {
      pp += '<w:ind w:left="' + (o.ind.left || 0) + '"' +
        (o.ind.hanging ? ' w:hanging="' + o.ind.hanging + '"' : '') + '/>';
    }
    if (o.jc) pp += '<w:jc w:val="' + o.jc + '"/>';
    return '<w:p><w:pPr>' + pp + '</w:pPr>' + (runs || '') + '</w:p>';
  }
  function wTable(t) {
    var widths = [2470, 2300, 2150, 2150];
    var border = function (side) { return '<w:' + side + ' w:val="single" w:sz="4" w:space="0" w:color="555555"/>'; };
    var x = '<w:tbl><w:tblPr><w:tblW w:w="' + TEXT_W + '" w:type="dxa"/><w:jc w:val="center"/>' +
      '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('') + '</w:tblBorders>' +
      '<w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>' +
      '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>' +
      '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>' +
      '</w:tblPr><w:tblGrid>' + widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>';
    function row(cells, head) {
      return '<w:tr>' + (head ? '<w:trPr><w:tblHeader/></w:trPr>' : '') + cells.map(function (c, i) {
        return '<w:tc><w:tcPr><w:tcW w:w="' + widths[i] + '" w:type="dxa"/>' +
          (head ? '<w:shd w:val="clear" w:color="auto" w:fill="EFEAE2"/>' : '') +
          '<w:vAlign w:val="center"/></w:tcPr>' +
          wPara(wRun(c, { font: head ? F_HEAD : F_BODY, b: head, sz: 21 }), { jc: 'center', line: 276 }) +
          '</w:tc>';
      }).join('') + '</w:tr>';
    }
    x += row(t.head, true);
    t.rows.forEach(function (r) { x += row(r, false); });
    return x + '</w:tbl>';
  }
  function letterXml(L, first) {
    var x = '';
    x += wPara(wRun(L.head1, { font: F_HEAD, b: true, sz: 34, spacing: 10 }),
      { jc: 'center', after: 40, pageBreakBefore: !first, line: 300 });
    x += wPara(wRun(L.head2, { font: F_HEAD, sz: 30 }), { jc: 'center', after: 360, line: 300 });
    L.meta.forEach(function (r, i) {
      x += wPara(wRun(r[0] ? r[0] + ' : ' + r[1] : r[1], { font: F_HEAD, sz: 22 }),
        { line: 300, after: i === L.meta.length - 1 ? 240 : 0, borderBottom: i === L.meta.length - 1 });
    });
    function para(p) {
      return wPara(wRun(p.n + '.\t' + p.t, { sz: 22 }), { ind: { left: 560, hanging: 340 }, after: 80, jc: 'both' });
    }
    L.paras.forEach(function (p) { x += para(p); });
    x += wPara(wRun(L.below, { sz: 22 }), { jc: 'center', before: 120, after: 120, keepNext: true });
    x += wTable(L.table);
    x += wPara(wRun(L.note, { sz: 18, color: '555555' }), { before: 60, after: 160, ind: { left: 120 } });
    L.after.forEach(function (p) { x += para(p); });
    /* 발신 명의 */
    var org = wRun(L.sign.pre + '  ', { font: F_HEAD, sz: 20 }) +
      wRun(L.sign.org, { font: F_BODY, b: true, sz: 40 }) +
      (L.sign.seal === 'box'
        ? wRun('   ', { sz: 22 }) + wRun(' 직 인 ', { font: F_HEAD, sz: 22, color: 'B03A3A', bdr: true })
        : wRun(' (직인생략)', { font: F_HEAD, sz: 22 }));
    x += wPara(org, { jc: 'right', before: 600, after: 200, keepNext: true, line: 300 });
    L.sign.lines.forEach(function (t, i) {
      x += wPara(wRun(t, { font: F_HEAD, sz: 24 }),
        { ind: { left: 5400 }, after: 40, keepNext: i < L.sign.lines.length - 1, line: 300 });
    });
    return x;
  }

  function docxParts(letters, title) {
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var body = letters.map(function (L, i) { return letterXml(L, i === 0); }).join('');
    /* 노회 사무실 안내는 쪽 바닥글로 둔다 (본문이 한 장을 넘지 않게, 여러 통이면 쪽마다) */
    var footer = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:ftr ' + W_NS + '>' +
      wPara(wRun((letters[0] && letters[0].foot) || '', { font: F_HEAD, sz: 16, color: '555555' }),
        { jc: 'center', borderTop: true, line: 260 }) +
      '</w:ftr>';
    var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document ' + W_NS + '><w:body>' + body +
      '<w:sectPr><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1418" w:right="1418" w:bottom="1134" w:left="1418" w:header="851" w:footer="567" w:gutter="0"/>' +
      '<w:cols w:space="425"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="' + F_BODY + '" w:hAnsi="' + F_BODY + '" w:eastAsia="' + F_BODY + '" w:cs="' + F_BODY + '"/>' +
      '<w:kern w:val="2"/><w:sz w:val="22"/><w:szCs w:val="22"/>' +
      '<w:lang w:val="en-US" w:eastAsia="ko-KR" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/><w:qFormat/>' +
      /* wordWrap 을 끄면(0) 한글 낱말 가운데서 줄이 바뀐다 — 어절 단위로 바뀌도록 넣지 않는다 */
      '<w:pPr><w:widowControl w:val="0"/><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/></w:pPr></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="a1"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/>' +
      '<w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar>' +
      '<w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/>' +
      '<w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      '</w:styles>';
    var settings = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:zoom w:percent="100"/><w:defaultTabStop w:val="800"/>' +
      '<w:characterSpacingControl w:val="doNotCompress"/>' +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
      '</w:settings>';
    var types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';
    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
      '</Relationships>';
    var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + xesc(title || '공문') + '</dc:title><dc:creator>대한예수교장로회 시화산노회</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
      '</cp:coreProperties>';
    var app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
      '<Application>sihwasan.org</Application></Properties>';
    return [
      { name: '[Content_Types].xml', data: types },
      { name: '_rels/.rels', data: rels },
      { name: 'word/document.xml', data: docXml },
      { name: 'word/_rels/document.xml.rels', data: docRels },
      { name: 'word/styles.xml', data: styles },
      { name: 'word/settings.xml', data: settings },
      { name: 'word/footer1.xml', data: footer },
      { name: 'docProps/core.xml', data: core },
      { name: 'docProps/app.xml', data: app }
    ];
  }

  /* UTF-8 바이트 */
  function utf8(s) {
    var out = [], i, c, d;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
  var CRC_T = null;
  function crc32(u8) {
    if (!CRC_T) {
      CRC_T = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_T[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) crc = CRC_T[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  /* 압축하지 않는 ZIP (store) */
  function zipStore(files) {
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    var chunks = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = typeof f.data === 'string' ? utf8(f.data) : f.data;
      var crc = crc32(data);
      var lh = new Uint8Array(30 + name.length), v = new DataView(lh.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true);
      v.setUint16(8, 0, true); v.setUint16(10, dosTime, true); v.setUint16(12, dosDate, true);
      v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true);
      v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
      lh.set(name, 30);
      var ch = new Uint8Array(46 + name.length), w = new DataView(ch.buffer);
      w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true);
      w.setUint16(8, 0x0800, true); w.setUint16(10, 0, true); w.setUint16(12, dosTime, true);
      w.setUint16(14, dosDate, true); w.setUint32(16, crc, true); w.setUint32(20, data.length, true);
      w.setUint32(24, data.length, true); w.setUint16(28, name.length, true); w.setUint16(30, 0, true);
      w.setUint16(32, 0, true); w.setUint16(34, 0, true); w.setUint16(36, 0, true);
      w.setUint32(38, 0, true); w.setUint32(42, offset, true);
      ch.set(name, 46);
      chunks.push(lh, data);
      central.push(ch);
      offset += lh.length + data.length;
    });
    var cdSize = 0;
    central.forEach(function (c) { cdSize += c.length; });
    var end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
    var all = chunks.concat(central, [end]);
    var total = 0;
    all.forEach(function (a) { total += a.length; });
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (a) { out.set(a, pos); pos += a.length; });
    return out;
  }
  /* 공문 여러 통 → .docx 바이트 (두 번째 통부터는 새 쪽에서 시작한다) */
  function buildDocx(letters, title) {
    return zipStore(docxParts(letters, title));
  }
  function fileNameOf(letters) {
    var safe = function (s) { return String(s || '').replace(/[\\\/:*?"<>|\s]+/g, ''); };
    if (letters.length === 1) return '공문_장로총대파송안내_' + safe(letters[0].church) + '.docx';
    return '공문_장로총대파송안내_전체(' + letters.length + '개교회).docx';
  }
  function download(bytes, name) {
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    if (window.navigator && window.navigator.msSaveOrOpenBlob) { window.navigator.msSaveOrOpenBlob(blob, name); return; }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /* ---------- 대시보드 알림 카드 (서기) ----------
   * 서버 알림(111 sql)이 아직 없어도 서기가 대시보드에서 바로 보도록 한다.
   * 정기노회 4주 전부터 노회 날까지만 나타난다. */
  function dashCard(slot, user) {
    if (!slot || !isClerk(user) || !user.cloud) return;
    if (!(typeof SHSCloud !== 'undefined' && SHSCloud.enabled && SHSCloud.enabled())) return;
    SHSCloud.init().then(function (c) { return c ? load(c) : null; }).then(function (data) {
      if (data) renderDash(slot, data, false);
    }).catch(function () {});
  }
  function renderDash(slot, data, demo) {
    var m = data.meeting;
    if (!m || !m.inWindow) { slot.innerHTML = ''; return; }
    var hideKey = 'shs_elder_card_' + m.ymd;
    if (!demo) {
      try { if (localStorage.getItem(hideKey)) return; } catch (x) {}
    }
    var chs = {};
    data.due.forEach(function (x) { chs[normChurch(x.church)] = 1; });
    var nCh = Object.keys(chs).length;
    var h = '<div class="admin-card en-dash" style="border-left:4px solid var(--red);margin-bottom:18px">' +
      '<h3 style="margin:0 0 6px">정기노회 4주 전 — 총대 장로 임기 확인</h3>' +
      '<p style="margin:0 0 10px;color:var(--gray-6)">' + esc(m.name) + ' · ' + esc(koDate(m.date, true)) +
      (m.place ? ' · ' + esc(m.place) : '') + ' (' + (m.days ? m.days + '일 남음' : '오늘') + ')</p>';
    if (data.due.length) {
      h += '<p style="margin:0 0 8px;line-height:1.7">남은 임기가 <strong>1년 미만</strong>인 장로 총대가 ' +
        '<strong>' + data.due.length + '명(' + nCh + '개 교회)</strong> 있습니다. ' +
        '해당 교회에 공문을 보내 다른 장로를 총대로 파송하도록 안내해 주세요.</p>' +
        '<ul style="margin:0 0 12px;padding-left:20px;line-height:1.8">' +
        data.due.map(function (x) {
          return '<li><strong>' + esc(x.church || '(교회 미등록)') + '</strong> ' + esc(x.name) + ' 장로 — ' +
            (x.months < 0 ? '<span class="fail">정년 경과</span>' : '남은 임기 ' + esc(x.remain)) +
            (x.retire ? ' <span style="color:var(--gray-5)">(정년 ' + esc(dots(x.retire)) + ')</span>' : '') + '</li>';
        }).join('') + '</ul>' +
        '<a class="btn" href="elder-notice.html' + (demo ? '?demo=1' : '') + '">공문 시안 보기 · 워드로 내려받기</a> ';
    } else {
      h += '<p style="margin:0 0 12px">남은 임기가 1년 미만인 장로 총대가 없습니다. ' +
        '이번 정기노회에는 공문을 보낼 교회가 없습니다.</p>' +
        '<a class="btn ghost sm" href="elder-notice.html' + (demo ? '?demo=1' : '') + '">명단 확인</a> ';
    }
    h += '<button type="button" class="btn ghost sm" data-en-hide>이번 정기노회에는 그만 보기</button>';
    if (data.unknown.length) {
      h += '<p style="margin:10px 0 0;font-size:0.84rem;color:var(--gray-5)">생년월일이 없어 확인하지 못한 장로 총대 ' +
        data.unknown.length + '명: ' + data.unknown.map(function (x) {
          return esc(x.name) + '(' + esc(x.church || '-') + ')';
        }).join(', ') + '</p>';
    }
    h += '</div>';
    slot.innerHTML = h;
    var hb = slot.querySelector('[data-en-hide]');
    if (hb) hb.addEventListener('click', function () {
      try { localStorage.setItem(hideKey, '1'); } catch (x) {}
      slot.innerHTML = '';
    });
  }

  /* ---------- 공문 화면 (elder-notice.html) ---------- */
  function mountPage(area) {
    if (!area) return;
    var q = location.search || '';
    var demo = /[?&]demo=1(&|$)/.test(q);
    if (demo) {
      var tm = q.match(/[?&]today=(\d{4}-\d{2}-\d{2})/);
      if (tm) TODAY_OVERRIDE = parseYmd(tm[1]);
      var data = build(demoRaw(todayStart()));
      page(area, data, true);
      return;
    }
    SHS.getUser().then(function (user) {
      if (!user) {
        area.innerHTML = '<div class="notice-banner">로그인이 필요합니다. ' +
          '<a class="btn sm" style="margin-left:8px" href="login.html">로그인 화면으로</a></div>';
        return;
      }
      if (!canUse(user)) {
        area.innerHTML = '<div class="notice-banner">이 화면은 <strong>노회 서기</strong>가 정기노회 전에 ' +
          '장로 총대의 임기를 확인하고 공문을 보내는 곳으로, 관리자(노회장·서기·간사)만 볼 수 있습니다. ' +
          '문의는 노회 사무실(' + OFFICE.tel + ')로 해 주시기 바랍니다.</div>';
        return;
      }
      if (!user.cloud || !(typeof SHSCloud !== 'undefined' && SHSCloud.enabled())) {
        area.innerHTML = '<div class="notice-banner">서버 로그인(구글 또는 이메일) 후 이용할 수 있습니다. ' +
          '<a class="btn sm" style="margin-left:8px" href="login.html">로그인 화면으로</a></div>';
        return;
      }
      area.innerHTML = '<p style="color:var(--gray-5)">장로 총대 명단을 불러오는 중...</p>';
      SHSCloud.init().then(function (c) { return load(c); }).then(function (data) {
        page(area, data, false);
        if (hasSHS('logAction')) SHS.logAction('view', '총대 장로 임기 확인·공문 열람', '');
      }).catch(function (err) {
        area.innerHTML = '<div class="notice-banner">장로 총대 명단을 불러오지 못했습니다: ' +
          esc((err && err.message) || err) + '</div>';
      });
    });
  }

  function page(area, data, demo) {
    var S = { data: data, f: defaults(data), sel: {}, recv: {}, cur: 0, dirty: {}, busy: false, demo: demo };
    data.due.forEach(function (x) { S.sel[x.id] = true; });
    var m = data.meeting;

    function line(x, checked) {
      return '<tr' + (x.months !== null && x.months < 0 ? ' style="background:#fbf1f1"' : '') + '>' +
        '<td><input type="checkbox" data-en-sel="' + esc(x.id) + '"' + (checked ? ' checked' : '') +
        ' style="width:auto" aria-label="' + esc(x.name) + ' 장로 공문 대상"></td>' +
        '<td>' + esc(x.church || '(교회 미등록)') + '</td>' +
        '<td>' + esc(x.name) + ' 장로' + (x.src === 'staff' ? ' <small style="color:var(--gray-5)">(교회 명부)</small>' : '') + '</td>' +
        '<td>' + (x.retire ? esc(dots(x.retire)) : '-') + '</td>' +
        '<td><span class="' + (x.months !== null && x.months < 0 ? 'fail' : '') + '">' + esc(x.remain) + '</span></td>' +
        '<td>' + esc(x.sichal || '-') + '</td></tr>';
    }

    var h = '';
    if (demo) {
      h += '<div class="notice-banner" style="border-left:4px solid var(--accent);text-align:left">' +
        '<strong>[예시 화면]</strong> 실제 명단이 아니라 예시 자료로 그린 화면입니다. ' +
        '서기가 로그인하면 노회 명단의 장로 총대로 같은 화면이 만들어집니다.</div>';
    }
    if (m) {
      h += '<div class="notice-banner" style="text-align:left;line-height:1.75">' +
        '<strong>' + esc(m.name) + '</strong> ' + esc(koDate(m.date, true)) + (m.place ? ' · ' + esc(m.place) : '') +
        ' — <strong>' + (m.days ? m.days + '일 남음' : '오늘') + '</strong>' +
        (m.source === 'rule' ? ' <small style="color:var(--gray-5)">(노회 일정 설정에 날짜가 없어 기준일 규칙으로 셈한 날짜)</small>' : '') +
        '<br>정기노회 4주 전(' + esc(koDate(m.alertFrom, true)) + ')부터 서기에게 알리는 항목입니다. ' +
        (m.inWindow ? '' : '<strong>아직 4주 전이 아닙니다.</strong> ') +
        '남은 임기(총회 정년까지)가 <strong>1년 미만</strong>인 장로 총대의 교회에 공문을 보내 다른 장로를 총대로 파송하도록 안내합니다.' +
        '<div style="font-size:0.82rem;color:var(--gray-5);margin-top:4px">근거: 노회규칙 제16조 2항 — 노회총대는 정치 제10장 제2조에 의거하여 당회장이 제출한다.</div></div>';
    } else {
      h += '<div class="notice-banner">다가오는 정기노회 날짜를 찾지 못했습니다. 노회 일정관리에서 정기노회 날짜를 정해 주세요.</div>';
    }

    h += '<h2>남은 임기 1년 미만 장로 총대 <small style="font-weight:400;color:var(--gray-5);font-size:0.9rem">(' + data.due.length + '명)</small></h2>';
    if (data.due.length) {
      h += '<div style="overflow-x:auto"><table class="tbl" style="min-width:620px"><thead><tr>' +
        '<th style="width:52px">공문</th><th>교회</th><th>장로 총대</th><th style="width:120px">정년일</th>' +
        '<th style="width:110px">남은 임기</th><th style="width:110px">시찰</th></tr></thead><tbody>' +
        data.due.map(function (x) { return line(x, true); }).join('') + '</tbody></table></div>';
    } else {
      h += '<p>남은 임기가 1년 미만인 장로 총대가 없습니다. 이번 정기노회에는 공문을 보낼 교회가 없습니다.</p>';
    }
    h += '<p style="font-size:0.82rem;color:var(--gray-5);margin-top:-12px">남은 임기는 회원 관리의 「남은 임기」와 같이 ' +
      '생년월일로 총회 정년(만 71세 생일 전날)까지 셈한 값입니다(오늘 기준). 이미 교체한 교회는 「공문」 표시를 빼 주세요.</p>';
    if (data.unknown.length) {
      h += '<details style="margin:6px 0 18px"><summary style="cursor:pointer">생년월일이 없어 확인하지 못한 장로 총대 ' +
        data.unknown.length + '명 <small style="color:var(--gray-5)">— 확인 후 공문 대상에 넣을 수 있습니다</small></summary>' +
        '<div style="overflow-x:auto;margin-top:8px"><table class="tbl" style="min-width:620px"><thead><tr>' +
        '<th style="width:52px">공문</th><th>교회</th><th>장로 총대</th><th style="width:120px">정년일</th>' +
        '<th style="width:110px">남은 임기</th><th style="width:110px">시찰</th></tr></thead><tbody>' +
        data.unknown.map(function (x) { return line(x, false); }).join('') + '</tbody></table></div></details>';
    }

    h += '<h2>공문 시안</h2><div id="en-letters"></div>';
    area.innerHTML = h;

    area.querySelectorAll('input[data-en-sel]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        S.sel[cb.getAttribute('data-en-sel')] = cb.checked;
        drawLetters();
      });
    });

    var box = document.getElementById('en-letters');
    var f = S.f;

    function field(k, label, type, extra) {
      var v = f[k] == null ? '' : f[k];
      if (type === 'textarea') {
        return '<div class="field"><label for="en-f-' + k + '">' + label + '</label>' +
          '<textarea id="en-f-' + k + '" data-f="' + k + '" rows="' + ((extra && extra.rows) || 4) + '">' + esc(v) + '</textarea></div>';
      }
      return '<div class="field"' + (extra && extra.style ? ' style="' + extra.style + '"' : '') + '><label for="en-f-' + k + '">' + label + '</label>' +
        '<input type="' + type + '" id="en-f-' + k + '" data-f="' + k + '" value="' + esc(v) + '"' +
        (extra && extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : '') + '></div>';
    }

    function drawLetters() {
      var chs = churchesOf(data, S.sel);
      if (!chs.length) {
        box.innerHTML = '<p style="color:var(--gray-5)">공문을 보낼 교회가 없습니다. 위 명단에서 「공문」에 표시하면 그 교회의 공문 시안이 만들어집니다.</p>';
        return;
      }
      if (S.cur >= chs.length) S.cur = 0;
      if (!document.getElementById('en-form')) {
        box.innerHTML =
          '<div class="en-wrap">' +
          '<form class="en-form admin-card" id="en-form" onsubmit="return false">' +
          '<h3 style="margin-bottom:10px">공문 내용 고치기</h3>' +
          '<p style="font-size:0.82rem;color:var(--gray-5);margin:0 0 12px">고친 내용은 오른쪽 시안과 워드 파일에 바로 반영됩니다. ' +
          '수신 칸만 교회마다 따로이고, 나머지는 모든 교회 공문에 같이 쓰입니다.</p>' +
          '<div class="en-row">' + field('noPrefix', '문서번호', 'text') + field('noStart', '시작 번호', 'number', { style: 'flex:0 0 96px', ph: '예: 26' }) + '</div>' +
          '<p class="en-hint">시작 번호를 적으면 교회 순서대로 번호가 하나씩 붙습니다. 비워 두면 번호 칸이 빈칸으로 나옵니다.</p>' +
          field('date', '일 시 (시행일)', 'date') +
          field('from', '발 신', 'text') +
          '<div class="field"><label for="en-recv">수 신 <small style="color:var(--gray-5)">(지금 보는 교회)</small></label>' +
          '<input type="text" id="en-recv"></div>' +
          field('title', '제 목', 'text') +
          field('deadline', '제출 기한', 'date') +
          field('p1', '1항', 'textarea', { rows: 2 }) +
          field('p2', '2항', 'textarea', { rows: 6 }) +
          field('p3', '3항', 'textarea', { rows: 3 }) +
          field('p4', '4항', 'textarea', { rows: 2 }) +
          '<div class="en-row">' + field('president', '노회장', 'text') + field('clerk', '서기', 'text') + '</div>' +
          '<div class="field"><label for="en-f-seal">직인</label><select id="en-f-seal" data-f="seal">' +
          '<option value="omit"' + (f.seal === 'omit' ? ' selected' : '') + '>(직인생략) — 노회 공문 표기</option>' +
          '<option value="box"' + (f.seal === 'box' ? ' selected' : '') + '>직인 찍을 자리 두기</option></select></div>' +
          '<button type="button" class="btn ghost sm" id="en-reset">처음 문구로 되돌리기</button>' +
          '</form>' +
          '<div class="en-preview">' +
          '<div class="en-tabs" id="en-tabs" role="tablist" aria-label="공문 받을 교회"></div>' +
          '<div class="en-actions">' +
          '<button type="button" class="btn" id="en-dl">워드 파일로 내려받기 (.docx)</button>' +
          '<button type="button" class="btn ghost" id="en-dl-all"></button>' +
          '<button type="button" class="btn ghost" id="en-print">인쇄</button>' +
          '<span class="form-msg" id="en-msg"></span></div>' +
          '<div class="en-paper-wrap"><div class="en-paper" id="en-paper"></div></div>' +
          '</div></div>';
        bindForm();
      }
      var tabs = document.getElementById('en-tabs');
      tabs.innerHTML = chs.map(function (ch, i) {
        return '<button type="button" role="tab" aria-selected="' + (i === S.cur) + '" data-en-tab="' + i + '"' +
          (i === S.cur ? ' class="active"' : '') + '>' + esc(ch.church) +
          ' <small>(' + ch.elders.length + '명)</small></button>';
      }).join('');
      tabs.querySelectorAll('button[data-en-tab]').forEach(function (b) {
        b.addEventListener('click', function () {
          S.cur = Number(b.getAttribute('data-en-tab'));
          drawLetters();
        });
      });
      document.getElementById('en-dl-all').textContent = '모든 교회 공문 한 파일로 (' + chs.length + '통)';
      document.getElementById('en-dl-all').classList.toggle('hidden', chs.length < 2);
      var ch = chs[S.cur];
      var recv = document.getElementById('en-recv');
      if (document.activeElement !== recv) recv.value = S.recv[ch.key] || defaultRecv(ch);
      var L = letterModel(ch, S.cur, f, data, S.recv[ch.key] || '');
      document.getElementById('en-paper').innerHTML = letterHtml(L);
    }

    function bindForm() {
      var form = document.getElementById('en-form');
      function onEdit(ev) {
        var el = ev.target, k = el.getAttribute('data-f');
        if (!k) return;
        f[k] = el.value;
        if (k === 'p3' || k === 'p4') S.dirty[k] = true;
        /* 기한·서기를 바꾸면 그 문구를 쓰는 항도 함께 고친다 (손으로 고친 항은 그대로 둔다) */
        if (k === 'deadline' && !S.dirty.p3) {
          var d = parseYmd(el.value);
          if (d) { f.p3 = p3Text(d); setVal('p3', f.p3); }
        }
        if (k === 'clerk' && !S.dirty.p4) { f.p4 = p4Text(f); setVal('p4', f.p4); }
        drawLetters();
      }
      function setVal(k, v) { var x = form.querySelector('[data-f="' + k + '"]'); if (x) x.value = v; }
      form.addEventListener('input', onEdit);
      form.addEventListener('change', onEdit);
      document.getElementById('en-recv').addEventListener('input', function (ev) {
        var chs = churchesOf(data, S.sel), ch = chs[S.cur];
        if (!ch) return;
        S.recv[ch.key] = ev.target.value;
        var L = letterModel(ch, S.cur, f, data, S.recv[ch.key]);
        document.getElementById('en-paper').innerHTML = letterHtml(L);
      });
      document.getElementById('en-reset').addEventListener('click', function () {
        if (!confirm('고친 문구를 모두 처음 문구로 되돌릴까요?')) return;
        var d0 = defaults(data);
        Object.keys(d0).forEach(function (k) { f[k] = d0[k]; setVal(k, d0[k]); });
        S.dirty = {}; S.recv = {};
        drawLetters();
      });
      function save(all) {
        var msg = document.getElementById('en-msg');
        if (S.busy) return;
        var chs = churchesOf(data, S.sel);
        if (!chs.length) return;
        S.busy = true;
        var btns = [document.getElementById('en-dl'), document.getElementById('en-dl-all')];
        btns.forEach(function (b) { b.disabled = true; });
        msg.className = 'form-msg'; msg.textContent = '워드 파일을 만드는 중...';
        setTimeout(function () {
          try {
            var letters = all
              ? chs.map(function (c, i) { return letterModel(c, i, f, data, S.recv[c.key] || ''); })
              : [letterModel(chs[S.cur], S.cur, f, data, S.recv[chs[S.cur].key] || '')];
            var name = fileNameOf(letters);
            download(buildDocx(letters, f.title), name);
            msg.className = 'form-msg ok'; msg.textContent = name + ' 을(를) 내려받았습니다.';
            if (!demo && hasSHS('logAction')) {
              SHS.logAction('create', '장로 총대 파송 안내 공문 내려받기',
                letters.map(function (L) { return L.church; }).join(', '));
            }
          } catch (x) {
            msg.className = 'form-msg err'; msg.textContent = '워드 파일을 만들지 못했습니다: ' + ((x && x.message) || x);
          }
          S.busy = false;
          btns.forEach(function (b) { b.disabled = false; });
        }, 30);
      }
      document.getElementById('en-dl').addEventListener('click', function () { save(false); });
      document.getElementById('en-dl-all').addEventListener('click', function () { save(true); });
      document.getElementById('en-print').addEventListener('click', function () { window.print(); });
    }

    drawLetters();
  }

  var api = {
    LEAD_DAYS: LEAD_DAYS,
    isClerk: isClerk,
    canUse: canUse,
    remainMonths: remainMonths,
    remainLabel: remainLabel,
    build: build,
    load: load,
    demoRaw: demoRaw,
    defaults: defaults,
    churchesOf: churchesOf,
    letterModel: letterModel,
    makeLetters: makeLetters,
    letterHtml: letterHtml,
    buildDocx: buildDocx,
    fileNameOf: fileNameOf,
    dashCard: dashCard,
    renderDash: renderDash,
    mountPage: mountPage
  };
  return api;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SHSElderNotice;

/* =====================================================================
 *  회의록 문서 — 내용을 담고, 회의록 규격대로 글을 짓는 곳
 *
 *  제15~18회 회의록의 서식을 그대로 따릅니다.
 *    표지 → 속표지 → 개회 문단 → Ⅰ. 개회예배 → Ⅱ. 회무처리 → Ⅲ. 폐회
 *    → 날짜 · 노회장/서기/회록서기 서명 → 별첨
 *
 *  화면(minutes-write.js)은 이 파일이 지은 글을 보여 주기만 합니다.
 * ===================================================================== */
var SHSMinutes = (function () {

  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function t(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

  /* 2026-09-14 → 주후 2026년 9월 14일(월) */
  function dateKo(d) {
    if (!d) return '';
    var p = String(d).split('-');
    if (p.length < 3) return String(d);
    var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return '주후 ' + Number(p[0]) + '년 ' + Number(p[1]) + '월 ' + Number(p[2]) + '일(' +
      WEEK[dt.getDay()] + ')';
  }
  /* 제 1 일 2026년 10월 12일(월) — 총회 표준 별지1의 날짜 표기 */
  function dateDay(d) {
    if (!d) return '';
    var p = String(d).split('-');
    if (p.length < 3) return String(d);
    var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return '제 1 일 ' + Number(p[0]) + '년 ' + Number(p[1]) + '월 ' + Number(p[2]) + '일(' +
      WEEK[dt.getDay()] + '요일)';
  }

  function dateSign(d) {
    if (!d) return '';
    var p = String(d).split('-');
    if (p.length < 3) return String(d);
    return '주후 ' + Number(p[0]) + '년 ' + Number(p[1]) + '월 ' + Number(p[2]) + '일';
  }

  /* 제20회 정기노회 / 제17회 제1차 임시노회 */
  function meetName(doc) {
    var no = num(doc.no);
    var head = no ? '제' + no + '회 ' : '';
    if (doc.kind === '임시노회') {
      return head + '제' + (num(doc.times) || 1) + '차 임시노회';
    }
    return head + (t(doc.kind) || '정기노회');
  }
  function docTitle(doc) { return meetName(doc) + ' 회의록'; }

  /* 이름 뒤에 직분을 붙여 부른다 — '박흥열' → '박흥열 목사' */
  function withTitle(name, pos) {
    var n = t(name);
    if (!n) return '';
    if (/(목사|장로|전도사|강도사|간사)$/.test(n)) return n;
    return n + ' ' + (t(pos) || '목사');
  }

  /* ---------------- 빈 문서 ---------------- */
  function blank() {
    return {
      kind: '정기노회', no: '', times: 1,
      meet_on: '', open_time: '오전 10시',
      church: '', pastor: '', addr: '', tel: '',
      moderator: '', clerk: '', minutes_clerk: '',
      worship: { from: '오전 10:00', to: '10:30', chair: '', silent: '다같이',
        hymn1: '', prayer: '', scripture: '', sermon: '', notice: '사회자',
        hymn2: '', benediction: '', end_time: '' },
      communion: { on: false, from: '', to: '', chair: '', hymn1: '', prayer: '',
        scripture: '', sermon: '', bread: '', cup: '', hymn2: '', benediction: '' },
      business: { time: '', hymn: '', scripture: '', prayer: '' },
      roll: { pt: '', pp: '', et: '', ep: '', vt: '', vp: '',
        pastors: '', assoc: '', elders: '', emeritus: '', retired: '' },
      items: [],
      close: { prayer: '', decision: '미진안건 처리는 임원회에 맡기기로 하고 폐회하기로 하다.',
        hymn: '', scripture: '', time: '', benediction: '' },
      attach: []
    };
  }

  /* ---------------- 정해진 문장 ----------------
   * 회의록마다 늘 같은 말로 적는 자리들입니다. */
  var S = {
    /* 개회 문단 */
    open: function (doc) {
      var w = doc.worship || {};
      return '대한예수교장로회 시화산노회 ' + meetName(doc) + '가 ' + dateSign(doc.meet_on) +
        ' ' + t(doc.open_time) + '에 ' + t(doc.addr) + ' 교회당에서 노회장 ' +
        withTitle(doc.moderator) + '의 인도로 회집하여 아래와 같이 개회 예배를 드리고 마치니 동일 ' +
        (t(w.end_time) || '오전 11시') + '이었다.';
    },
    /* 회무처리를 여는 문단 */
    business: function (doc) {
      var b = doc.business || {};
      return '동일 ' + t(b.time) + ' 같은 장소에서 노회장 ' + withTitle(doc.moderator) +
        '의 사회로 모여 찬송가 ' + t(b.hymn) + '을 부르고 ' +
        (t(b.scripture) ? '사회자가 성경 ' + t(b.scripture) + '을 봉독한 후 ' : '') +
        t(b.prayer) + '가 기도함으로 회무처리를 시작하다.';
    },
    /* 폐회 예배 (총회 표준 별지1 Ⅲ-2) */
    closeWorship: function (doc) {
      var c = doc.close || {};
      return '노회장 ' + withTitle(doc.moderator) + '의 사회로 찬송 ' + t(c.hymn) +
        '을 제창하고 인도자가 성경 ' + t(c.scripture) +
        '을 봉독하고 기도한 후 축도함으로 폐회예배를 마치다.';
    },
    /* 회원점명 */
    roll: function (doc) {
      var r = doc.roll || {};
      var tot = num(r.pt) + num(r.et) + num(r.vt);
      var pre = num(r.pp) + num(r.ep) + num(r.vp);
      return '서기 ' + withTitle(doc.clerk) + '가 회원을 호명하니 목사회원 ' + num(r.pt) + '명 중 ' +
        num(r.pp) + '명, 장로회원 ' + num(r.et) + '명 중 ' + num(r.ep) + '명, 목사 언권 회원 ' +
        num(r.vt) + '명 중 ' + num(r.vp) + '명 출석하여 총 재적 ' + tot + '명 중 ' + pre +
        '명 출석으로 성수가 됨을 보고 하다.';
    },
    declare: function (doc) {
      return '노회장 ' + withTitle(doc.moderator) + '가 대한예수교장로회 시화산노회 ' +
        meetName(doc) + '가 개회됨을 선언하다.';
    },
    order: function (doc) {
      return '서기 ' + withTitle(doc.clerk) + '가 ' + (num(doc.no) ? '제' + num(doc.no) + '회 ' : '') +
        '노회 회순을 유인물대로 보고 하니 채택하다.';
    },
    /* 각 부 · 시찰 보고 — 늘 같은 말로 적는다 */
    report: function (who) {
      return t(who) + '가 보고하니 유인물대로 받기로 동의 재청하니 가부를 물어 가결하다.';
    },
    adopt: function (doc) {
      return '회록서기 ' + withTitle(doc.minutes_clerk) + '가 금일 회의록을 낭독하니 채택하다.';
    },
    closeQuote: function (doc) {
      return '“교회가 나에게 허락한 권으로 지금 대한예수교장로회 시화산노회 ' + meetName(doc) +
        '가 폐회됨과 이 노회와 같이 조직된 노회가 다시 정한 날 정한 장소에 회집할 것을 선언합니다.”';
    },
    closeDeclare: function (doc) {
      var c = doc.close || {};
      return '노회장 ' + withTitle(doc.moderator) + '가 다음과 같이 폐회를 선언함으로 폐회하니 동일 ' +
        (t(c.time) || '오후 5시') + '이었다.';
    }
  };

  /* ---------------- 회무처리 항목 ----------------
   * 갈래(type)에 따라 본문 문장을 저절로 지어 준다. */
  function itemBody(doc, it) {
    var body = t(it.body);
    if (it.type === 'roll') return S.roll(doc) + (body ? '\n' + body : '');
    if (it.type === 'declare') return S.declare(doc);
    if (it.type === 'order') return S.order(doc);
    if (it.type === 'report') return S.report(it.who) + (body ? '\n' + body : '');
    if (it.type === 'adopt') return S.adopt(doc);
    return body;
  }

  /* 회원점명 항목에는 참석자 명단이 따라 붙는다 */
  function rollNames(doc) {
    var r = doc.roll || {};
    var out = [];
    function add(head, v) {
      if (!t(v)) return;
      out.push(head);
      t(v).split('\n').forEach(function (l) { if (t(l)) out.push(t(l)); });
    }
    if (t(r.pastors) || t(r.assoc) || t(r.elders) || t(r.emeritus) || t(r.retired)) {
      out.push('참석자 명단');
    }
    add('목사회원', r.pastors);
    add('부목사', r.assoc);
    add('장로총대', r.elders);
    add('원로 목사 (언권회원)', r.emeritus);
    add('은퇴 목사 (언권회원)', r.retired);
    return out;
  }

  /* ---------------- 글로 옮기기 ---------------- */
  function text(doc) {
    var L = [];
    var w = doc.worship || {}, cm = doc.communion || {}, c = doc.close || {};

    /* 표지 */
    L.push('대한예수교장로회 시화산노회');
    L.push(docTitle(doc));
    L.push('일시 : ' + dateKo(doc.meet_on) + ' ' + t(doc.open_time) + '부터~폐회시까지');
    L.push('장소 : ' + t(doc.church) + (t(doc.pastor) ? ' (' + withTitle(doc.pastor) + ' 시무)' : ''));
    if (t(doc.addr)) L.push(t(doc.addr));
    if (t(doc.tel)) L.push('TEL : ' + t(doc.tel));
    L.push('');
    /* 속표지 */
    L.push('대한예수교장로회 시화산노회');
    L.push(docTitle(doc));
    L.push(dateDay(doc.meet_on));
    L.push('');
    L.push(S.open(doc));
    L.push('');

    /* Ⅰ. 개회예배 */
    L.push('Ⅰ. 개회예배');
    L.push('- 예배순서(' + t(w.from) + (t(w.to) ? '-' + t(w.to) : '') + ')' +
      '          사회 : ' + (t(w.chair) || ('노회장 ' + withTitle(doc.moderator))));
    L.push('1) 묵도 : ' + (t(w.silent) || '다같이'));
    L.push('2) 찬송 : ' + t(w.hymn1) + ' / 다같이');
    L.push('3) 기도 : ' + t(w.prayer));
    L.push('4) 성경봉독 : ' + t(w.scripture));
    L.push('5) 설교 : ' + t(w.sermon));
    L.push('6) 광고 : ' + (t(w.notice) || '사회자'));
    L.push('7) 찬송 : ' + t(w.hymn2) + ' / 다같이');
    L.push('8) 축도 : ' + t(w.benediction));
    if (cm.on) {
      L.push('- 성찬예식 (' + t(cm.from) + (t(cm.to) ? '-' + t(cm.to) : '') + ')' +
        (t(cm.chair) ? '       집례 : ' + t(cm.chair) : ''));
      L.push('1) 묵도 : 다같이');
      L.push('2) 찬송 : ' + t(cm.hymn1) + ' / 다같이');
      L.push('3) 기도 : ' + t(cm.prayer));
      L.push('4) 성경봉독 : ' + t(cm.scripture));
      L.push('5) 설교 : ' + t(cm.sermon));
      L.push('6) 기도 : 설교자');
      L.push('7) 성찬식');
      if (t(cm.bread)) L.push('①분병: ' + t(cm.bread) + ' / 위원');
      if (t(cm.cup)) L.push('②분잔: ' + t(cm.cup) + ' / 위원');
      L.push('8) 찬송 : ' + t(cm.hymn2) + ' / 다같이');
      L.push('9) 축도 : ' + (t(cm.benediction) || '집례자'));
    }
    L.push('');

    /* Ⅱ. 회무처리 */
    L.push('Ⅱ. 회무처리');
    L.push(S.business(doc));
    var n = 0;
    (doc.items || []).forEach(function (it) {
      var head;
      if (it.type === 'recess' || it.type === 'resume') {
        head = '0. ' + (t(it.title) || (it.type === 'recess' ? '정회' : '속회'));
      } else {
        n++;
        head = n + '. ' + t(it.title);
      }
      L.push('');
      L.push(head);
      var b = itemBody(doc, it);
      if (b) b.split('\n').forEach(function (l) { L.push(l); });
      if (it.type === 'roll') rollNames(doc).forEach(function (l) { L.push(l); });
    });
    L.push('');

    /* Ⅲ. 폐회 — 결의 → 예배 → 선언 (총회 표준 별지1 순서) */
    L.push('Ⅲ. 폐회');
    var cn = 0;
    if (t(c.decision)) { cn++; L.push(cn + '. 폐회 결의'); L.push(t(c.decision)); }
    if (t(c.hymn) || t(c.scripture)) {
      cn++; L.push(cn + '. 폐회 예배'); L.push(S.closeWorship(doc));
    } else if (t(c.prayer)) {
      cn++; L.push(cn + '. 폐회기도'); L.push(t(c.prayer) + '가 기도 하다.');
    }
    cn++;
    L.push(cn + '. 폐회 선언');
    L.push(S.closeDeclare(doc));
    L.push(S.closeQuote(doc));
    L.push('');

    /* 날짜와 서명 */
    L.push(dateSign(doc.meet_on));
    L.push('대한예수교장로회 시화산노회');
    L.push('노 회 장  ' + withTitle(doc.moderator) + '  (인)');
    L.push('서    기  ' + withTitle(doc.clerk) + '  (인)');
    L.push('회록서기  ' + withTitle(doc.minutes_clerk) + '  (인)');

    /* 별첨 */
    (doc.attach || []).forEach(function (a, i) {
      if (!t(a.title) && !t(a.body)) return;
      L.push('');
      L.push('(별첨' + (i + 1) + ')');
      if (t(a.title)) L.push(t(a.title));
      t(a.body).split('\n').forEach(function (l) { L.push(l); });
    });

    return L.join('\n');
  }

  /* ---------------- 미리보기 · 인쇄용 ---------------- */
  function html(doc) {
    var w = doc.worship || {}, cm = doc.communion || {}, c = doc.close || {};
    function p(s, cls) { return '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(s) + '</p>'; }
    var h = '<div class="mw-paper">';

    /* 표지 (본 노회의 관행 — 제15~18회 회의록과 같다) */
    h += '<div class="mw-cover">' +
      '<div class="cv-org">대한예수교장로회 시화산노회</div>' +
      '<div class="cv-title">' + esc(docTitle(doc)) + '</div>' +
      '<div class="cv-meta">' +
      '<p>일시 : ' + esc(dateKo(doc.meet_on)) + ' ' + esc(doc.open_time) + '부터~폐회시까지</p>' +
      '<p>장소 : ' + esc(doc.church) + (t(doc.pastor) ? ' (' + esc(withTitle(doc.pastor)) + ' 시무)' : '') + '</p>' +
      (t(doc.addr) ? '<p>' + esc(doc.addr) + '</p>' : '') +
      (t(doc.tel) ? '<p>TEL : ' + esc(doc.tel) + '</p>' : '') + '</div>' +
      '<div class="cv-bottom">대한예수교장로회 시화산노회</div></div>';

    /* 상단 중앙 회의명 · 제N일 (총회 표준 별지1) */
    h += '<div class="mw-inner">' +
      '<div class="in-org">대한예수교장로회 시화산노회</div>' +
      '<div class="in-title">' + esc(docTitle(doc)) + '</div>' +
      '<div class="in-day">' + esc(dateDay(doc.meet_on)) + '</div></div>';

    h += p(S.open(doc));

    h += '<h3>Ⅰ. 개회예배</h3>';
    h += p('- 예배순서(' + t(w.from) + (t(w.to) ? '-' + t(w.to) : '') + ')' +
      '          사회 : ' + (t(w.chair) || ('노회장 ' + withTitle(doc.moderator))));
    h += '<div class="mw-ind">' +
      p('1) 묵도 : ' + (t(w.silent) || '다같이')) +
      p('2) 찬송 : ' + t(w.hymn1) + ' / 다같이') +
      p('3) 기도 : ' + t(w.prayer)) +
      p('4) 성경봉독 : ' + t(w.scripture)) +
      p('5) 설교 : ' + t(w.sermon)) +
      p('6) 광고 : ' + (t(w.notice) || '사회자')) +
      p('7) 찬송 : ' + t(w.hymn2) + ' / 다같이') +
      p('8) 축도 : ' + t(w.benediction)) + '</div>';
    if (cm.on) {
      h += p('- 성찬예식 (' + t(cm.from) + (t(cm.to) ? '-' + t(cm.to) : '') + ')' +
        (t(cm.chair) ? '       집례 : ' + t(cm.chair) : ''));
      h += '<div class="mw-ind">' +
        p('1) 묵도 : 다같이') +
        p('2) 찬송 : ' + t(cm.hymn1) + ' / 다같이') +
        p('3) 기도 : ' + t(cm.prayer)) +
        p('4) 성경봉독 : ' + t(cm.scripture)) +
        p('5) 설교 : ' + t(cm.sermon)) +
        p('6) 기도 : 설교자') +
        p('7) 성찬식') +
        (t(cm.bread) ? p('①분병: ' + t(cm.bread) + ' / 위원') : '') +
        (t(cm.cup) ? p('②분잔: ' + t(cm.cup) + ' / 위원') : '') +
        p('8) 찬송 : ' + t(cm.hymn2) + ' / 다같이') +
        p('9) 축도 : ' + (t(cm.benediction) || '집례자')) + '</div>';
    }

    h += '<h3>Ⅱ. 회무처리</h3>';
    h += p(S.business(doc));
    var n = 0;
    (doc.items || []).forEach(function (it) {
      var head;
      if (it.type === 'recess' || it.type === 'resume') {
        head = '0. ' + (t(it.title) || (it.type === 'recess' ? '정회' : '속회'));
      } else {
        n++;
        head = n + '. ' + t(it.title);
      }
      h += p(head, 'mw-num');
      var b = itemBody(doc, it);
      if (b) {
        h += '<div class="mw-ind">' + b.split('\n').map(function (l) { return p(l); }).join('') + '</div>';
      }
      if (it.type === 'roll') {
        var nm = rollNames(doc);
        if (nm.length) {
          h += '<div class="mw-ind">' + nm.map(function (l) { return p(l); }).join('') + '</div>';
        }
      }
    });

    h += '<h3>Ⅲ. 폐회</h3>';
    var cn = 0;
    if (t(c.decision)) {
      cn++;
      h += p(cn + '. 폐회 결의', 'mw-num') + '<div class="mw-ind">' + p(t(c.decision)) + '</div>';
    }
    if (t(c.hymn) || t(c.scripture)) {
      cn++;
      h += p(cn + '. 폐회 예배', 'mw-num') + '<div class="mw-ind">' + p(S.closeWorship(doc)) + '</div>';
    } else if (t(c.prayer)) {
      cn++;
      h += p(cn + '. 폐회기도', 'mw-num') + '<div class="mw-ind">' + p(t(c.prayer) + '가 기도 하다.') + '</div>';
    }
    cn++;
    h += p(cn + '. 폐회 선언', 'mw-num') +
      '<div class="mw-ind">' + p(S.closeDeclare(doc)) + p(S.closeQuote(doc), 'mw-quote') + '</div>';

    h += '<div class="mw-sign"><div class="d">' + esc(dateSign(doc.meet_on)) + '</div>' +
      '<div class="o">대한예수교장로회 시화산노회</div>' +
      '<div class="nm">노 회 장&nbsp;&nbsp;' + esc(withTitle(doc.moderator)) + '&nbsp;&nbsp;(인)</div>' +
      '<div class="nm">서&nbsp;&nbsp;&nbsp;&nbsp;기&nbsp;&nbsp;' + esc(withTitle(doc.clerk)) + '&nbsp;&nbsp;(인)</div>' +
      '<div class="nm">회록서기&nbsp;&nbsp;' + esc(withTitle(doc.minutes_clerk)) + '&nbsp;&nbsp;(인)</div></div>';

    (doc.attach || []).forEach(function (a, i) {
      if (!t(a.title) && !t(a.body)) return;
      h += '<h3>(별첨' + (i + 1) + ') ' + esc(a.title) + '</h3>';
      h += t(a.body).split('\n').map(function (l) { return p(l); }).join('');
    });

    return h + '</div>';
  }

  /* ---------------- 아직 비어 있는 곳 찾기 ---------------- */
  function missing(doc) {
    var out = [];
    if (!num(doc.no)) out.push('회기');
    if (!t(doc.meet_on)) out.push('회의 날짜');
    if (!t(doc.church)) out.push('장소(교회)');
    if (!t(doc.addr)) out.push('교회 주소');
    if (!t(doc.moderator)) out.push('노회장');
    if (!t(doc.clerk)) out.push('서기');
    if (!t(doc.minutes_clerk)) out.push('회록서기');
    if (!t((doc.worship || {}).sermon)) out.push('개회예배 설교');
    if (!num((doc.roll || {}).pp)) out.push('회원점명 출석 수');
    if (!(doc.items || []).length) out.push('회무처리 항목');
    if (!t((doc.close || {}).time)) out.push('폐회 시각');
    return out;
  }

  return {
    blank: blank, text: text, html: html, missing: missing,
    title: docTitle, meetName: meetName, dateKo: dateKo, withTitle: withTitle,
    sentences: S, itemBody: itemBody
  };
})();

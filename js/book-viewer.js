/* 책자 보기 틀 — 노회 보고서(회의자료)·노회 회의결의(회의결의서)가 함께 쓴다.
 *   왼쪽: 책자 목록(해마다) / 가운데: 차례(나무꼴) / 오른쪽: 쪽 본문(표·제목·점선 줄을 문서처럼)
 *   관리자: PDF 올리기(쪽마다 AI 가 읽음) · 이어서 읽기 · 전부 다시 읽기 · 이 쪽 글 고치기
 *   표: presbytery_reports(kind 로 구분) / presbytery_report_pages.  쪽은 BOOK 설정으로 자기 종류만 본다. */
window.SHSBook = {
  mount: function (BOOK) {
document.addEventListener('DOMContentLoaded', function () {
 SHS.getUser().then(function (user) {
  var area = document.getElementById('pr-area');
  var e = SHS.esc;

  /* 정회원 이상만 — 회의자료에는 재정·명단이 들어 있다 */
  var gate = SHS.memberGate(user, BOOK.gate);
  if (gate) { area.innerHTML = gate; return; }
  if (!user.cloud) {
    area.innerHTML = '<div class="notice-banner">' + BOOK.gate + '은(는) 서버 로그인(구글 또는 이메일) 후 볼 수 있습니다. ' +
      '<a class="btn sm" style="margin-left:10px" href="login.html">로그인 화면으로</a></div>';
    return;
  }
  var canEdit = SHSAuth.canManageMembers(user);
  var db = null, reports = [], cur = null, pages = [];
  var collapsed = {}, lastNo = null;   /* 차례에서 손으로 닫아 둔 묶음(쪽 번호), 지금 쪽 */
  var qs = new URLSearchParams(location.search);

  function pdfPageOf(p) { return p.pdf_page; }
  function label(r) { return r.title + (r.meet_on ? ' (' + r.meet_on + ')' : ''); }

  /* ---------- 틀 ---------- */
  area.innerHTML =
    '<div id="pr-upload" class="hidden"></div>' +
    '<form class="pr-search" id="pr-search"><input type="search" id="pr-q" placeholder="' + BOOK.searchHint + '"><button class="btn" type="submit">찾기</button></form>' +
    '<div id="pr-results" class="hidden"></div>' +
    '<div class="pr-wrap"><aside class="pr-side pr-books" id="pr-books"></aside><aside class="pr-side" id="pr-toc"></aside><div class="pr-page" id="pr-page"></div></div>';

  /* ---------- 목록 ---------- */
  function loadReports() {
    return db.from('presbytery_reports').select('*').in('kind', BOOK.kinds).order('meet_on', { ascending: false, nullsFirst: false }).order('id', { ascending: false })
      .then(function (r) {
        if (r.error) {
          area.insertAdjacentHTML('afterbegin', '<div class="notice-banner">보고서 표가 아직 없습니다. <code>supabase/131_presbytery_reports.sql</code> 을 실행해 주세요. <small>(' + e(r.error.message) + ')</small></div>');
          reports = [];
          return;
        }
        reports = r.data || [];
      });
  }
  /* 왼쪽 기둥 위: 올린 책자 목록 (해마다 묶어, 새것이 위) */
  function drawBooks() {
    var box = document.getElementById('pr-books');
    var h = '<div class="pr-side-h pr-books-h"><span>' + BOOK.sideTitle + '</span>' +
      (canEdit ? '<button type="button" class="pr-mini" id="pr-upload-btn">+ 올리기</button>' : '') + '</div>';
    if (!reports.length) h += '<div style="color:var(--gray-5);font-size:0.86rem">아직 올린 보고서가 없습니다.</div>';
    var year = null;
    reports.forEach(function (r) {
      var y = (r.meet_on || '').slice(0, 4) || '날짜 미정';
      if (y !== year) { year = y; h += '<div class="pr-year">' + e(y) + '</div>'; }
      h += '<a href="#" class="pr-book' + (cur && cur.id === r.id ? ' on' : '') + '" data-r="' + r.id + '">' + e(r.title) +
        '<small>' + e((r.meet_on || '') + (r.status && r.status !== '완료' ? ' · ' + r.status : '')) + '</small></a>';
    });
    box.innerHTML = h;
    box.querySelectorAll('.pr-book').forEach(function (b) {
      b.addEventListener('click', function (ev) { ev.preventDefault(); openReport(Number(b.dataset.r)); });
    });
    var up = box.querySelector('#pr-upload-btn');
    if (up) up.addEventListener('click', uploadForm);
  }
  function openReport(id, pageNo, q) {
    cur = reports.filter(function (r) { return r.id === id; })[0] || null;
    drawBooks();
    if (!cur) return;
    db.from('presbytery_report_pages').select('id,pdf_page,page_no,heading,text').eq('report_id', id)
      .order('pdf_page').order('page_no', { nullsFirst: true })
      .then(function (r) {
        pages = (r.data || []);
        drawSide();
        if (pageNo != null) showPage(pageNo, q);
        else if (pages.length) showPage(firstPageNo(), '');
        else document.getElementById('pr-page').innerHTML = '<p style="color:var(--gray-5)">아직 읽어 둔 쪽이 없습니다.</p>';
      });
  }
  function firstPageNo() {
    var p = pages.filter(function (x) { return x.page_no != null; })[0];
    return p ? p.page_no : (pages[0] ? pages[0].pdf_page : 1);
  }
  /* 차례 나무: 책자의 차례(1단계)에, 그 구간 쪽들의 제목을 2단계로 붙인다.
   * (예: "노회 주소록 102" 아래 원로목사 102 · 북부시찰 103 · 상록시찰 105 · 남부시찰 107 …) */
  function norm(t) { return String(t || '').replace(/\s+/g, '').replace(/^\d+[.)]/, ''); }
  function tocTree() {
    var toc = (Array.isArray(cur.toc) ? cur.toc : []).map(function (t) {
      return { title: String(t.title || '').trim(), page: parseInt(t.page, 10), level: t.level > 1 ? 2 : 1 };
    }).filter(function (t) { return t.title && t.page; });
    /* 쪽 제목에서 뽑은 항목 (잇따라 같은 제목은 하나로, 차례에 이미 있는 것은 뺀다) */
    var derived = [], last = null;
    pages.forEach(function (pg) {
      if (pg.page_no == null) return;
      var hd = String(pg.heading || '').replace(/\s+/g, ' ').trim();
      if (!hd) return;
      if (norm(hd) === last) return;
      last = norm(hd);
      if (toc.some(function (t) { return t.page === pg.page_no && norm(t.title) === norm(hd); })) return;
      derived.push({ title: hd, page: pg.page_no, level: 2 });
    });
    if (!toc.length) return derived.map(function (d, i) {   /* 차례가 없으면 쪽 제목들이 1단계 — 끝 쪽은 다음 항목 바로 앞까지 */
      d.level = 1; d.end = i < derived.length - 1 ? Math.max(d.page, derived[i + 1].page - 1) : 9999; d.kids = []; return d;
    });
    var tops = toc.filter(function (t) { return t.level === 1; });
    if (!tops.length) tops = toc.slice();
    tops.sort(function (x, y) { return x.page - y.page; });
    var subs = toc.filter(function (t) { return tops.indexOf(t) === -1; }).concat(derived);
    /* 같은 쪽에 차례 항목("감사헌의부")과 쪽 제목("감사헌의부 보고")이 둘 다 있으면 쪽 제목 하나만 남긴다 */
    var byPage = {};
    subs.forEach(function (k) {
      var cur = byPage[k.page];
      if (!cur) { byPage[k.page] = [k]; return; }
      var b = norm(k.title), kept = false;
      for (var i = 0; i < cur.length; i++) {
        var a = norm(cur[i].title);
        if (a === b || a.indexOf(b) !== -1) { kept = true; break; }                 /* 이미 같거나 더 자세한 것이 있다 */
        if (b.indexOf(a) !== -1) { cur[i] = k; kept = true; break; }                /* 새것이 더 자세하면 바꾼다 */
      }
      if (!kept) cur.push(k);
    });
    subs = [];
    Object.keys(byPage).forEach(function (pg) { subs = subs.concat(byPage[pg]); });
    tops.forEach(function (t, i) {
      t.end = i < tops.length - 1 ? tops[i + 1].page - 1 : 9999;
      var seen = {};
      t.kids = subs.filter(function (k) { return k.page >= t.page && k.page <= t.end && !(k.page === t.page && norm(k.title) === norm(t.title)); })
        .sort(function (x, y) { return x.page - y.page; })
        .filter(function (k) { var key = k.page + '|' + norm(k.title); return !seen[key] && (seen[key] = 1); });
    });
    return tops;
  }
  function drawSide(curNo) {
    lastNo = curNo;
    var side = document.getElementById('pr-toc');
    var tree = tocTree();
    var h = '<div class="pr-side-h">차례</div>';
    if (!tree.length) h += '<div style="color:var(--gray-5);font-size:0.86rem">차례가 없습니다</div>';
    /* 지금 쪽이 든 1단계 항목은 하나만 (같은 쪽에서 시작하는 항목이 여럿이면 뒤의 것) */
    var curTop = null;
    if (curNo != null) tree.forEach(function (t) { if (curNo >= t.page && curNo <= t.end) curTop = t; });
    h += tree.map(function (t) {
      var open = t === curTop && !collapsed[t.page];
      var kidOn = null;
      if (open) t.kids.forEach(function (k) { if (k.page <= curNo) kidOn = k; });
      var s = '<a href="#" data-p="' + t.page + '"' + (t.kids.length ? ' data-sec="1" data-open="' + (open ? 1 : 0) + '"' : '') + ' class="pr-toc' + (t.kids.length ? ' sec' : '') + (open && !kidOn ? ' on' : '') + '">' + e(t.title) + '<span>' + t.page + '</span></a>';
      if (open && t.kids.length) {
        s += '<div class="pr-kids">' + t.kids.map(function (k) {
          return '<a href="#" data-p="' + k.page + '" class="pr-toc lv2' + (kidOn === k ? ' on' : '') + '">' + e(k.title) + '<span>' + k.page + '</span></a>';
        }).join('') + '</div>';
      }
      return s;
    }).join('');
    h += '<div class="pr-side-h" style="margin-top:14px">쪽으로 가기</div>' +
      '<div class="pr-jump"><input type="number" id="pr-jump" min="1" placeholder="쪽"><button class="btn ghost sm" id="pr-jump-go">이동</button></div>' +
      (cur.file_path ? '<button class="btn ghost sm" id="pr-pdf" style="margin-top:10px;width:100%">PDF 원본 열기</button>' : '');
    side.innerHTML = h;
    side.querySelectorAll('a[data-p]').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        var pg = parseInt(a.dataset.p, 10);
        if (a.dataset.sec === '1') {
          if (a.dataset.open === '1') { collapsed[pg] = true; drawSide(lastNo); return; }   /* 열린 묶음을 다시 누르면 닫는다 */
          delete collapsed[pg];
        }
        showPage(pg, '');
      });
    });
    side.querySelector('#pr-jump-go').addEventListener('click', function () {
      var n = parseInt(document.getElementById('pr-jump').value, 10);
      if (n) showPage(n, '');
    });
    var pdf = side.querySelector('#pr-pdf');
    if (pdf) pdf.addEventListener('click', function () { openPdf(null); });
  }
  function openPdf(pdfPage) {
    if (!cur || !cur.file_path) return;
    db.storage.from('archive-files').createSignedUrl(cur.file_path, 600).then(function (r) {
      if (r.error || !r.data) { alert('PDF 를 열지 못했습니다: ' + (r.error && r.error.message)); return; }
      window.open(r.data.signedUrl + (pdfPage ? '#page=' + pdfPage : ''), '_blank', 'noopener');
    });
  }
  function hl(text, q) {
    var t = e(text);
    if (q) { var re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'); t = t.replace(re, '<mark class="ai-hl">$&</mark>'); }
    return t;
  }
  /* AI 가 받아 적은 글을 문서답게 그린다.
   *  · 마크다운 표("| 칸 | 칸 |", 구분줄 "|---|") 또는 "ㄱ | ㄴ | ㄷ" 줄이 잇따르면 표 (첫 줄이 짧은 낱말들이면 머리글)
   *  · "## 제목", "1. 항목", "가. 항목", "■ 항목" 은 작은 제목
   *  · "묵 도 ------ 다 같 이" 처럼 점선으로 이어진 줄은 양끝 맞춤
   *  · 줄바꿈 없이 " | "로만 이어진 글(예전 읽기 결과)은 " | "를 줄바꿈으로 본다
   *  · 그 밖은 문단 */
  function renderDoc(text, q, heading) {
    var src = String(text || '').replace(/\r/g, '');
    if (src.indexOf('\n') === -1 && (src.match(/ \| /g) || []).length >= 2) src = src.replace(/ \| /g, '\n');
    var lines = src.split('\n');
    var html = '', table = null, headDone = false;
    function sig(c) { return String(c || '').replace(/\d+/g, '0').replace(/[가-힣]+/g, '가').replace(/[A-Za-z]+/g, 'a').replace(/\s+/g, ''); }
    function line(t) {
      var m = t.match(/^#{1,4}\s+(.*)$/);
      if (m) {
        var h = m[1].trim();
        if (!headDone && heading && h.replace(/\s+/g, '') === String(heading).replace(/\s+/g, '')) { headDone = true; return; }  /* 쪽 제목과 같으면 한 번만 */
        html += '<h4 class="pr-h">' + hl(h, q) + '</h4>'; return;
      }
      if (/[-]{4,}|…{2,}|·{4,}|\.{5,}/.test(t)) {
        var parts = t.split(/([-]{4,}|…{2,}|·{4,}|\.{5,})/);
        html += '<div class="pr-line">' + parts.map(function (x, i) {
          return (i % 2) ? '<span class="pr-lead"></span>' : (x.trim() ? '<span>' + hl(x.trim(), q) + '</span>' : '');
        }).join('') + '</div>';
        return;
      }
      if (t.length <= 30 && /^(\d{1,2}\s*[.)]|[가-힣]\s*[.)]|[①-⑳]|[■◈●◎□○※◆▶])\s*\S/.test(t) && !/[.。,]\s*$/.test(t)) {
        html += '<p class="pr-sub">' + hl(t, q) + '</p>'; return;
      }
      html += '<p>' + hl(t, q) + '</p>';
    }
    function flushTable() {
      if (!table) return;
      var rows = table.filter(function (r) { return r.some(Boolean); }); table = null;   /* 모두 빈 칸인 행은 뺀다 */
      if (!rows.length) return;
      if (rows.length === 1) { rows[0].forEach(function (c) { if (c) line(c); }); return; }   /* 한 줄뿐이면 표가 아니라 줄 나눔 */
      var cols = Math.max.apply(null, rows.map(function (r) { return r.length; }));
      var full = rows.filter(function (r) { return r.length === cols; });
      rows = rows.map(function (r) {
        if (r.length >= cols) return r;
        /* 칸이 모자라면: 첫 칸이 온전한 행의 둘째 칸과 닮았으면 앞 칸이 비었던 것, 아니면 뒤를 채운다 */
        var front = full.some(function (f) { return sig(f[1]) === sig(r[0]) && sig(f[0]) !== sig(r[0]); });
        var pad = []; for (var i = r.length; i < cols; i++) pad.push('');
        return front ? pad.concat(r) : r.concat(pad);
      });
      var head = rows[0].every(function (c) { return c.length <= 12 && !/\d{2,}/.test(c); }) && rows[0].filter(Boolean).length >= 2;
      html += '<div class="pr-tblwrap"><table class="pr-tbl">' + rows.map(function (cells, i) {
        var tag = head && i === 0 ? 'th' : 'td';
        return '<tr>' + cells.map(function (c) { return '<' + tag + (c.length <= 8 ? ' class="nw"' : '') + '>' + hl(c, q) + '</' + tag + '>'; }).join('') + '</tr>';
      }).join('') + '</table></div>';
    }
    lines.forEach(function (ln) {
      var t = ln.trim();
      if (!t) { flushTable(); return; }
      if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(t)) return;        /* 마크다운 표 구분줄 */
      if (t.indexOf('|') !== -1 && ((t.match(/\|/g) || []).length >= 2 || / \| /.test(t))) {
        var cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
        table = table || []; table.push(cells); return;
      }
      flushTable();
      line(t);
    });
    flushTable();
    return html || '<p style="color:var(--gray-5)">(빈 면)</p>';
  }
  function showPage(pageNo, q) {
    var box = document.getElementById('pr-page');
    var hit = pages.filter(function (p) { return p.page_no === pageNo; });
    if (!hit.length) hit = pages.filter(function (p) { return p.pdf_page === pageNo && p.page_no == null; });
    if (!hit.length) {
      /* 가장 가까운 쪽 */
      var near = pages.filter(function (p) { return p.page_no != null; }).sort(function (a, b) { return Math.abs(a.page_no - pageNo) - Math.abs(b.page_no - pageNo); })[0];
      if (near) { hit = [near]; pageNo = near.page_no; }
    }
    if (!hit.length) { box.innerHTML = '<p style="color:var(--gray-5)">' + pageNo + '쪽을 찾지 못했습니다.</p>'; return; }
    var p = hit[0];
    var nos = pages.map(function (x) { return x.page_no; }).filter(function (n) { return n != null; }).sort(function (a, b) { return a - b; });
    var i = nos.indexOf(p.page_no);
    var prev = i > 0 ? nos[i - 1] : null, next = i >= 0 && i < nos.length - 1 ? nos[i + 1] : null;
    box.innerHTML =
      '<div class="pr-page-head"><div><span class="pr-page-no">' + (p.page_no != null ? p.page_no + '쪽' : 'PDF ' + p.pdf_page + '쪽') + '</span>' +
      (p.heading ? '<h2 class="pr-heading">' + e(p.heading) + '</h2>' : '') + '</div>' +
      '<div class="pr-page-btns">' +
      (prev != null ? '<button class="btn ghost sm" data-go="' + prev + '">&larr; ' + prev + '쪽</button> ' : '') +
      (next != null ? '<button class="btn ghost sm" data-go="' + next + '">' + next + '쪽 &rarr;</button> ' : '') +
      (cur.file_path ? '<button class="btn sm" id="pr-pdf-page">PDF 원본 ' + p.pdf_page + '쪽</button>' : '') + '</div></div>' +
      '<div class="pr-text">' + renderDoc(p.text || '', q, p.heading) + '</div>' +
      (canEdit ? '<div style="margin-top:12px;text-align:right"><button class="btn ghost sm" id="pr-edit-page">이 쪽 글 고치기</button></div>' : '');
    box.querySelectorAll('[data-go]').forEach(function (b) { b.addEventListener('click', function () { showPage(parseInt(b.dataset.go, 10), ''); }); });
    var pb = box.querySelector('#pr-pdf-page'); if (pb) pb.addEventListener('click', function () { openPdf(p.pdf_page); });
    var ed = box.querySelector('#pr-edit-page'); if (ed) ed.addEventListener('click', function () { editPage(p); });
    drawSide(p.page_no);
    if (history.replaceState) history.replaceState(null, '', BOOK.page + '?r=' + cur.id + '&p=' + (p.page_no != null ? p.page_no : p.pdf_page) + (q ? '&q=' + encodeURIComponent(q) : ''));
    var first = box.querySelector('mark.ai-hl');
    if (first) setTimeout(function () { first.scrollIntoView({ block: 'center' }); }, 60);
  }
  function editPage(p) {
    var box = document.getElementById('pr-page');
    box.insertAdjacentHTML('beforeend',
      '<div class="admin-card" id="pr-editbox" style="margin-top:12px"><h3 style="margin-top:0">쪽 글 고치기 (AI 가 잘못 읽은 글자를 바로잡습니다)</h3>' +
      '<div class="inline-form"><div class="field" style="flex:0 0 120px"><label>쪽 번호</label><input type="number" id="pe-no" value="' + (p.page_no != null ? p.page_no : '') + '"></div>' +
      '<div class="field"><label>제목</label><input type="text" id="pe-head" value="' + e(p.heading || '') + '"></div></div>' +
      '<div class="field"><label>글</label><textarea id="pe-text" rows="16">' + e(p.text || '') + '</textarea></div>' +
      '<button class="btn" id="pe-save">저장</button> <button class="btn ghost" id="pe-cancel">취소</button><div class="form-msg" id="pe-msg"></div></div>');
    document.getElementById('pe-cancel').addEventListener('click', function () { document.getElementById('pr-editbox').remove(); });
    document.getElementById('pe-save').addEventListener('click', function () {
      var d = { page_no: parseInt(document.getElementById('pe-no').value, 10) || null, heading: document.getElementById('pe-head').value.trim() || null, text: document.getElementById('pe-text').value };
      db.from('presbytery_report_pages').update(d).eq('id', p.id).then(function (r) {
        var m = document.getElementById('pe-msg');
        if (r.error) { m.className = 'form-msg err'; m.textContent = r.error.message; return; }
        SHSCloud.log('update', '노회 보고서 쪽 수정', cur.title + ' ' + (d.page_no || '') + '쪽');
        openReport(cur.id, d.page_no, '');
      });
    });
  }

  /* ---------- 찾기 ---------- */
  document.getElementById('pr-search').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var q = document.getElementById('pr-q').value.trim();
    var box = document.getElementById('pr-results');
    if (!q) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = '<p style="color:var(--gray-5)">찾는 중…</p>';
    var pat = '*' + q.replace(/[,()*"']/g, ' ').trim() + '*';
    db.from('presbytery_report_pages').select('id,report_id,pdf_page,page_no,heading,text')
      .or('heading.ilike.' + pat + ',text.ilike.' + pat).order('report_id', { ascending: false }).order('page_no').limit(60)
      .then(function (r) {
        if (r.error) { box.innerHTML = '<p class="form-msg err">' + e(r.error.message) + '</p>'; return; }
        var rows = r.data || [];
        if (!rows.length) { box.innerHTML = '<p style="color:var(--gray-5)">「' + e(q) + '」을(를) 찾지 못했습니다.</p>'; return; }
        var byRep = {};
        reports.forEach(function (x) { byRep[x.id] = x; });
        box.innerHTML = '<div class="pr-res-h">「' + e(q) + '」 ' + rows.length + '곳 <button type="button" class="btn ghost sm" id="pr-res-x">닫기</button></div>' +
          rows.map(function (p) {
            var t = p.text || '', i = t.indexOf(q), s = Math.max(0, i - 70), snip = (s > 0 ? '…' : '') + t.slice(s, s + 220) + (s + 220 < t.length ? '…' : '');
            return '<a href="#" class="pr-res" data-r="' + p.report_id + '" data-p="' + (p.page_no != null ? p.page_no : p.pdf_page) + '">' +
              '<span class="pr-res-t">' + e(byRep[p.report_id] ? byRep[p.report_id].title : '보고서') + ' · ' + (p.page_no != null ? p.page_no + '쪽' : 'PDF ' + p.pdf_page) +
              (p.heading ? ' · ' + e(p.heading) : '') + '</span><span class="pr-res-s">' + hl(snip, q) + '</span></a>';
          }).join('');
        box.querySelector('#pr-res-x').addEventListener('click', function () { box.classList.add('hidden'); });
        box.querySelectorAll('.pr-res').forEach(function (a) {
          a.addEventListener('click', function (ev) {
            ev.preventDefault();
            var rid = Number(a.dataset.r), pn = parseInt(a.dataset.p, 10);
            if (!cur || cur.id !== rid) openReport(rid, pn, q); else showPage(pn, q);
            document.getElementById('pr-page').scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        });
      });
  });

  /* ---------- 올리기 (관리자): PDF → 저장소 → 쪽마다 그림으로 → AI 창구가 글로 → 표에 담기 ---------- */
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  function loadPdfjs() {
    return new Promise(function (res, rej) {
      if (window.pdfjsLib) { res(window.pdfjsLib); return; }
      var s = document.createElement('script'); s.src = PDFJS;
      s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; res(window.pdfjsLib); };
      s.onerror = function () { rej(new Error('pdf.js 를 불러오지 못했습니다.')); };
      document.head.appendChild(s);
    });
  }
  function token() {
    return db.auth.getSession().then(function (r) { return r && r.data && r.data.session ? r.data.session.access_token : null; });
  }
  function ocr(imageB64, pdfPage, hint) {
    return token().then(function (tk) {
      return fetch(SHSAI.url + '/ocr', {
        method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageB64, media_type: 'image/jpeg', pdf_page: pdfPage, hint: hint || '' })
      });
    }).then(function (r) {
      return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }).then(function (j) { if (!r.ok && !j.error) j.error = 'HTTP ' + r.status; return j; });
    });
  }
  function renderPage(pdf, n) {
    return pdf.getPage(n).then(function (page) {
      var v1 = page.getViewport({ scale: 1 });
      var scale = Math.min(2.2, 1568 / Math.max(v1.width, v1.height));
      var vp = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        return canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
      });
    });
  }
  /* 파일 이름에서 회기·종류·연도를 읽는다: "제18회기 정기노회(가을) 2025.pdf", "제19회 회의결의서 (PDF).pdf" */
  function guessFromName(name) {
    var g = { session: null, kind: null, year: null, season: null };
    var m = String(name || '').match(/제\s*(\d{1,3})\s*회/); if (m) g.session = parseInt(m[1], 10);
    m = String(name || '').match(/(20\d\d)/); if (m) g.year = m[1];
    if (/봄/.test(name)) g.season = '봄'; else if (/가을/.test(name)) g.season = '가을';
    if (/결의/.test(name)) g.kind = BOOK.kinds.indexOf('회의결의서') !== -1 ? '회의결의서' : null;
    else if (/임원회/.test(name)) g.kind = BOOK.kinds.indexOf('임원회') !== -1 ? '임원회' : (BOOK.kinds.indexOf('임원회 결의') !== -1 ? '임원회 결의' : null);
    else if (/임시/.test(name)) g.kind = BOOK.kinds.indexOf('임시노회') !== -1 ? '임시노회' : null;
    if (!g.kind) g.kind = BOOK.kinds[0];
    return g;
  }
  /* 파일이 정해지면(끌어다 놓기·고르기) 칸을 채우고, 회기를 알면 바로 읽기 시작 */
  function fileChosen(f) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { msg('up-msg', false, 'PDF 파일만 올릴 수 있습니다: ' + f.name); return; }
    var dt = new DataTransfer(); dt.items.add(f);
    document.getElementById('up-file').files = dt.files;
    document.getElementById('up-fields').classList.remove('hidden');
    document.getElementById('up-drop').classList.add('has');
    document.getElementById('up-drop-name').textContent = f.name + ' (' + Math.round(f.size / 1048576) + 'MB)';
    var g = guessFromName(f.name);
    var sessEl = document.getElementById('up-session'), kindEl = document.getElementById('up-kind'), titleEl = document.getElementById('up-title');
    if (g.session) sessEl.value = g.session;
    if (g.kind) kindEl.value = g.kind;
    if (g.session) titleEl.value = BOOK.titleOf(g.session, kindEl.value) + (g.year ? ' (' + g.year + (g.season ? ' ' + g.season : '') + ')' : '');
    if (g.session && titleEl.value.trim()) {
      msg('up-msg', true, '「' + titleEl.value + '」로 올리고 바로 읽기 시작합니다. (회의 날짜는 읽은 뒤 책자 목록에서 고칠 수 있습니다)');
      setTimeout(startUpload, 400);
    } else {
      msg('up-msg', false, '파일 이름에서 회기를 알 수 없습니다. 회기와 제목을 적고 「올리고 읽기 시작」을 누르세요.');
      sessEl.focus();
    }
  }
  function uploadForm() {
    var box = document.getElementById('pr-upload');
    if (box.innerHTML) { box.classList.toggle('hidden'); return; }
    box.classList.remove('hidden');
    var y = new Date().getFullYear();
    box.innerHTML =
      '<div class="admin-card pr-upcard" style="margin-bottom:18px"><h3 style="margin-top:0">' + BOOK.uploadTitle + '</h3>' +
      '<div class="pr-drop" id="up-drop" tabindex="0" role="button" aria-label="PDF 올리기">' +
      '<div class="pr-drop-ic">⇩</div><strong>PDF 를 여기에 끌어다 놓으세요</strong>' +
      '<span>또는 눌러서 파일 고르기 · 올리면 AI 가 아래 규칙대로 쪽마다 읽어 지금 책자들과 같은 모양으로 정리합니다</span>' +
      '<em id="up-drop-name"></em></div>' +
      '<p style="font-size:0.86rem;color:var(--gray-6)">저장소에 PDF 원본을 보관하고 쪽마다 글로 받아 적습니다. 58쪽이면 5분쯤 걸리며 AI 비용이 조금 듭니다(쪽당 수십 원). 중간에 끊겨도 「이어서 읽기」로 이어집니다.</p>' +
      '<details class="pr-rules"><summary>AI 가 책자를 정리하는 규칙</summary><ul>' +
      '<li>보이는 글자 그대로 받아 적고 요약하지 않습니다. 이름·교회·숫자·날짜·금액은 특히 정확하게.</li>' +
      '<li>줄마다 줄바꿈으로 나누고, 큰 제목·작은 제목은 따로 한 줄(화면에서 제목 글씨로 보입니다).</li>' +
      '<li>표는 표로: 첫 줄이 칸 이름, 모든 행의 칸 수를 맞추고 빈 칸은 빈 채로, 한 칸에 겹친 이름은 「·」로 이어서(예: 김종택·이성팔).</li>' +
      '<li>표 밖의 합계·비고 줄은 표 다음에 따로, 나란한 두 표는 따로따로.</li>' +
      '<li>차례·예배 순서처럼 점선으로 이어진 줄은 점선을 남겨 「항목 …… 쪽」 꼴로(화면에서 양끝 맞춤).</li>' +
      '<li>인쇄된 쪽 번호(아래 가운데 동그라미 숫자)를 그 면의 쪽으로 삼고, 차례 면은 차례로 삼습니다.</li>' +
      '</ul><p style="margin:6px 0 0;font-size:0.84rem;color:var(--gray-6)">이 규칙은 AI 서버(워커)의 읽기 지시에 들어 있습니다. 잘못 읽은 쪽은 「이 쪽 글 고치기」로 바로잡고, 책자 전체를 새 규칙으로 다시 정리하려면 「전부 다시 읽기」를 누릅니다.</p></details>' +
      '<div id="up-fields" class="hidden"><div class="inline-form">' +
      '<div class="field" style="flex:0 0 110px"><label>회기</label><input type="number" id="up-session" placeholder="20"></div>' +
      '<div class="field" style="flex:0 0 140px"><label>종류</label><select id="up-kind">' + BOOK.kinds.map(function (k) { return '<option>' + k + '</option>'; }).join('') + '</select></div>' +
      '<div class="field" style="flex:0 0 170px"><label>회의 날짜</label><input type="date" id="up-date"></div>' +
      '<div class="field"><label>제목</label><input type="text" id="up-title" placeholder="예: 제20회 정기노회 회의자료 (' + y + ' 가을)"></div></div>' +
      '<input type="file" id="up-file" accept="application/pdf" hidden>' +
      '<button class="btn" id="up-go">올리고 읽기 시작</button> ' +
      '<button class="btn ghost" id="up-resume">이어서 읽기 (이미 올린 책자)</button></div> ' +
      '<div style="margin-top:8px"><button class="btn ghost sm" id="up-redo">고른 책자 전부 다시 읽기 (저장된 PDF 로)</button></div>' +
      '<div class="form-msg" id="up-msg"></div><div class="pr-progress hidden" id="up-prog"><div class="pr-bar"><span id="up-bar"></span></div><div id="up-prog-t"></div></div></div>';
    /* 끌어다 놓기 / 눌러서 고르기 */
    var drop = document.getElementById('up-drop'), fileEl = document.getElementById('up-file');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; fileChosen(f); });
    drop.addEventListener('click', function () { fileEl.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileEl.click(); } });
    fileEl.addEventListener('change', function () { fileChosen(this.files[0]); });
    /* 쪽 어디에 떨어뜨려도 받는다 (브라우저가 PDF 를 열어 버리지 않게) */
    document.addEventListener('dragover', function (e) { if (e.dataTransfer && [].slice.call(e.dataTransfer.types || []).indexOf('Files') !== -1) e.preventDefault(); });
    document.addEventListener('drop', function (e) { if (e.target.closest && e.target.closest('#up-drop')) return; if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); fileChosen(e.dataTransfer.files[0]); drop.scrollIntoView({ block: 'center', behavior: 'smooth' }); } });
    document.getElementById('up-session').addEventListener('change', function () {
      var t = document.getElementById('up-title');
      if (!t.value) t.value = BOOK.titleOf(this.value, document.getElementById('up-kind').value);
    });
    document.getElementById('up-go').addEventListener('click', startUpload);
    document.getElementById('up-resume').addEventListener('click', function () {
      var f = document.getElementById('up-file').files[0];
      if (!cur) { msg('up-msg', false, '먼저 위 목록에서 이어서 읽을 책자를 고르고, 같은 PDF 파일을 고른 뒤 누르세요.'); return; }
      if (!f) { msg('up-msg', false, '같은 PDF 파일을 골라 주세요 (그림으로 바꾸는 데 필요합니다).'); return; }
      readAll(cur, f);
    });
    /* 다시 읽기: 두 번 눌러야 실행 (읽어 둔 글을 모두 지우고 저장된 PDF 로 새로 읽는다) */
    var redoArmed = false, redoLabel = '이 책자 전부 다시 읽기 (저장된 PDF 로)';
    document.getElementById('up-redo').addEventListener('click', function () {
      if (!cur) { msg('up-msg', false, '먼저 위 목록에서 다시 읽을 책자를 고르세요.'); return; }
      if (!cur.file_path) { msg('up-msg', false, '이 책자는 저장된 PDF 가 없습니다. 같은 PDF 를 골라 「이어서 읽기」를 쓰세요.'); return; }
      if (!redoArmed) { redoArmed = true; this.textContent = '정말 다시 읽기 — 읽어 둔 글을 모두 지우고 새로 읽습니다 (AI 비용 발생)'; this.classList.add('danger'); return; }
      redoArmed = false; this.textContent = redoLabel; this.classList.remove('danger');
      redoAll(cur);
    });
  }
  /* 저장된 PDF 를 내려받아 모든 쪽을 새로 읽는다 */
  function redoAll(rep) {
    msg('up-msg', true, '저장된 PDF 를 내려받는 중…');
    return db.storage.from('archive-files').createSignedUrl(rep.file_path, 600).then(function (r) {
      if (r.error) throw r.error;
      return fetch(r.data.signedUrl).then(function (x) { if (!x.ok) throw new Error('PDF 내려받기 실패 (HTTP ' + x.status + ')'); return x.arrayBuffer(); });
    }).then(function (buf) {
      return db.from('presbytery_report_pages').delete().eq('report_id', rep.id).then(function (r) {
        if (r.error) throw r.error;
        pages = [];
        return db.from('presbytery_reports').update({ status: '읽는 중', toc: [] }).eq('id', rep.id);
      }).then(function () {
        SHSCloud.log('update', BOOK.logName + ' 다시 읽기', rep.title);
        return readAll(rep, buf);
      });
    }).catch(function (x) { msg('up-msg', false, (x && x.message) || String(x)); });
  }
  function msg(id, ok, t) { var m = document.getElementById(id); m.className = 'form-msg ' + (ok ? 'ok' : 'err'); m.textContent = t; }
  function prog(done, total, t) {
    var p = document.getElementById('up-prog'); p.classList.remove('hidden');
    document.getElementById('up-bar').style.width = Math.round(done / Math.max(1, total) * 100) + '%';
    document.getElementById('up-prog-t').textContent = t || (done + ' / ' + total + ' 쪽');
  }
  function startUpload() {
    var f = document.getElementById('up-file').files[0];
    var sess = parseInt(document.getElementById('up-session').value, 10) || null;
    var kind = document.getElementById('up-kind').value;
    var date = document.getElementById('up-date').value || null;
    var title = document.getElementById('up-title').value.trim();
    if (!f) { msg('up-msg', false, 'PDF 파일을 골라 주세요.'); return; }
    if (!title) { msg('up-msg', false, '제목을 적어 주세요.'); return; }
    if (f.size > 48 * 1024 * 1024) { msg('up-msg', false, '48MB 보다 큰 파일은 올릴 수 없습니다.'); return; }
    var key = 'reports/' + BOOK.filePrefix + (sess || 0) + '-' + Date.now() + '.pdf';
    msg('up-msg', true, 'PDF 를 저장소에 올리는 중… (' + Math.round(f.size / 1048576) + 'MB)');
    db.storage.from('archive-files').upload(key, f, { contentType: 'application/pdf', upsert: false }).then(function (r) {
      if (r.error) throw r.error;
      return db.from('presbytery_reports').insert({ session: sess, kind: kind, title: title, meet_on: date, file_path: key, file_name: f.name, created_by: user.name, status: '읽는 중' }).select('*').single();
    }).then(function (r) {
      if (r.error) throw r.error;
      var rep = r.data;
      reports.unshift(rep); cur = rep; drawBooks();
      /* 자료실 > 회의자료에도 보이게 */
      if (BOOK.archiveSection) db.from('archive_items').insert({ section: BOOK.archiveSection, title: title, description: BOOK.archiveDesc, doc_date: date, access: 'member', file_path: key, file_name: f.name, updated_by: user.name }).then(function () {}, function () {});
      SHSCloud.log('create', BOOK.logName + ' 올리기', title);
      return readAll(rep, f);
    }).catch(function (x) { msg('up-msg', false, (x && x.message) || String(x)); });
  }
  /* 쪽마다: 그림 → /ocr → 표 (이미 읽은 쪽은 건너뛴다) */
  function readAll(rep, file) {
    var done = 0, total = 0, tocAll = [], failed = [];
    var bufP = file && typeof file.arrayBuffer === 'function' ? file.arrayBuffer() : Promise.resolve(file);   /* File 또는 ArrayBuffer */
    return Promise.all([loadPdfjs(), bufP, db.from('presbytery_report_pages').select('pdf_page').eq('report_id', rep.id)])
      .then(function (rs) {
        var pdfjs = rs[0], buf = rs[1], have = {};
        ((rs[2] && rs[2].data) || []).forEach(function (x) { have[x.pdf_page] = 1; });
        return pdfjs.getDocument({ data: buf }).promise.then(function (pdf) {
          total = pdf.numPages;
          if (!rep.pdf_pages) db.from('presbytery_reports').update({ pdf_pages: total }).eq('id', rep.id).then(function () {});
          var n = 0;
          function next() {
            n++;
            if (n > total) return finish();
            if (have[n]) { done++; prog(done, total, done + ' / ' + total + ' 쪽 (이미 읽음)'); return next(); }
            prog(done, total, n + '쪽을 그림으로 바꾸는 중…');
            return renderPage(pdf, n).then(function (b64) {
              prog(done, total, n + '쪽을 AI 가 읽는 중… (' + (done + 1) + ' / ' + total + ')');
              return ocr(b64, n, rep.title);
            }).then(function (o) {
              if (!o || o.error) { failed.push(n + '쪽: ' + ((o && o.error) || '응답 없음')); done++; return next(); }
              var rows = [], byNo = {};
              (o.pages || []).forEach(function (p) {
                var no = (p.no == null || isNaN(parseInt(p.no, 10))) ? null : parseInt(p.no, 10);
                var key = no == null ? 'x' : String(no);
                if (byNo[key]) {   /* 같은 쪽 번호가 둘이면(또는 번호 없는 면이 둘이면) 글을 이어 붙인다 */
                  byNo[key].text = [byNo[key].text, p.text || ''].filter(Boolean).join('\n\n');
                  if (!byNo[key].heading && p.heading) byNo[key].heading = p.heading;
                  return;
                }
                byNo[key] = { report_id: rep.id, pdf_page: n, page_no: no, heading: p.heading || null, text: p.text || '' };
                rows.push(byNo[key]);
              });
              if (!rows.length) rows = [{ report_id: rep.id, pdf_page: n, page_no: null, heading: null, text: '' }];
              (o.toc || []).forEach(function (t) { tocAll.push(t); });
              return db.from('presbytery_report_pages').insert(rows).then(function (r) {
                if (r.error) failed.push(n + '쪽 저장: ' + r.error.message);
                done++; prog(done, total);
                return next();
              });
            }).catch(function (x) { failed.push(n + '쪽: ' + (x && x.message)); done++; return next(); });
          }
          return next();
        });
      }).then(function () {}).catch(function (x) { msg('up-msg', false, (x && x.message) || String(x)); });

    /* 차례 면의 글에서 "4. 서기 사무 보고 ----- 22" / "북부시찰 ----- 35" 같은 줄을 읽는다 */
    function tocFromText(text) {
      var out = [];
      /* 차례 면은 줄바꿈 또는 표 구분(' | ')으로 항목이 나뉜다 */
      String(text || '').split(/\n|\s\|\s/).forEach(function (ln) {
        var m = ln.trim().match(/^(\d+\s*[.)]\s*)?([^\d\-·…|]{2,60}?)\s*[-·…\.|~ ]{3,}\s*(\d{1,3})(?:\s*[~\-]\s*\d{1,3})?\s*$/);
        if (!m) return;
        var title = m[2].replace(/\s+/g, ' ').trim();
        if (!title || /차\s*례|목\s*차/.test(title)) return;
        out.push({ title: title, page: parseInt(m[3], 10), level: m[1] ? 1 : 2 });
      });
      return out;
    }
    function finish() {
      return db.from('presbytery_report_pages').select('page_no,heading,text').eq('report_id', rep.id).order('pdf_page').order('page_no').then(function (r) {
        var all = r.data || [];
        /* 1순위: 차례 면에서 읽은 것 */
        var toc = [];
        all.forEach(function (p) {
          if (/차\s*례|목\s*차/.test((p.heading || '') + ' ' + String(p.text || '').slice(0, 40))) {
            var t = tocFromText(p.text);
            if (t.length > toc.length) toc = t;
          }
        });
        /* 2순위: AI 가 따로 준 차례 */
        if (toc.length < 3) {
          var t2 = tocAll.filter(function (t) { return t && t.title && t.page; }).map(function (t) { return { title: String(t.title).trim(), page: parseInt(t.page, 10) || t.page, level: t.level || 1 }; });
          if (t2.length > toc.length) toc = t2;
        }
        /* 3순위: 제목이 있는 쪽들 */
        if (!toc.length) {
          var seen = {};
          toc = all.filter(function (p) { return p.heading && p.page_no != null && !seen[p.heading] && (seen[p.heading] = 1); })
            .map(function (p) { return { title: p.heading, page: p.page_no, level: 1 }; });
        }
        return db.from('presbytery_reports').update({ toc: toc, status: failed.length ? '일부 미읽음' : '완료', updated_at: new Date().toISOString() }).eq('id', rep.id);
      }).then(function () {
        msg('up-msg', !failed.length, failed.length ? '읽기를 마쳤지만 ' + failed.length + '쪽은 실패했습니다: ' + failed.slice(0, 5).join(' / ') + ' — 「이어서 읽기」로 다시 시도하세요.' : '모두 읽었습니다.');
        /* 주소록은 잘 바뀌지 않으므로 새 책자와 대조해 달라진 것만 고친다 */
        if (BOOK.directoryCompare) document.getElementById('up-msg').insertAdjacentHTML('beforeend', ' <a class="btn sm" style="margin-left:8px" href="directory.html?compare=' + rep.id + '">노회 주소록과 대조하기 →</a>');
        SHSCloud.log('update', BOOK.logName + ' 읽기 완료', rep.title + ' ' + total + '쪽' + (failed.length ? ' (실패 ' + failed.length + ')' : ''));
        return loadReports().then(function () { openReport(rep.id); });
      });
    }
  }

  /* ---------- 시작 ---------- */
  SHSCloud.init().then(function (c) {
    db = c;
    return loadReports();
  }).then(function () {
    drawBooks();
    if (canEdit) uploadForm();   /* 서기·노회장·간사·최고관리자: 올리기 상자를 늘 보인다 */
    var rid = parseInt(qs.get('r'), 10), pn = parseInt(qs.get('p'), 10), q = qs.get('q') || '';
    if (q) document.getElementById('pr-q').value = q;
    if (rid && reports.some(function (r) { return r.id === rid; })) openReport(rid, isNaN(pn) ? null : pn, q);
    else if (reports.length) openReport(reports[0].id, isNaN(pn) ? null : pn, q);
    if (q && !rid) { var f = document.getElementById('pr-search'); f.dispatchEvent(new Event('submit')); }
  });
 });
});
  }
};

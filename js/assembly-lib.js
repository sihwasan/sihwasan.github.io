/* 시화산노회 홈페이지 - 총회자료실 뷰어
 *
 * 총회 헌법·규정·회의결의·보고서를 data/assembly/*.json에서 읽어 보여준다.
 * 자료 원본: 대한예수교장로회총회(합동) 총회전자자료실(gapck.org).
 * 보고서 파일(PDF)은 저장소 용량 문제로 복사하지 않고 총회 원본으로 연결한다.
 */
var AsmLib = (function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getJson(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error(path + ' ' + r.status);
      return r.json();
    });
  }

  function fail(el, msg) {
    el.innerHTML = '<div class="lib-error">' + esc(msg || '자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.') + '</div>';
  }

  /* 본문 첫머리가 섹션 제목과 같은 h3면 제거(제목 중복 방지) */
  function dropDupHeading(box, title) {
    var first = box.firstElementChild;
    if (first && /^H[2-5]$/.test(first.tagName) &&
        first.textContent.replace(/\s+/g, '') === String(title).replace(/\s+/g, '')) {
      first.parentNode.removeChild(first);
    }
  }

  /* ---------- 헌법·규정 공용 문서 뷰어 ---------- */
  function initDocs(cfg) {
    var tabsEl = document.getElementById('lib-tabs');
    var sideEl = document.getElementById('lib-side');
    var docEl = document.getElementById('lib-doc');
    var srchEl = document.getElementById('lib-search');
    if (!tabsEl || !sideEl || !docEl) return;

    var books = [], current = null;

    /* #b5 (책) · #b5-s3 (장) · #b5-s3-a35 (장 안의 제35조) — AI 검색의 근거 링크가 쓴다 */
    function hashTarget() {
      var m = (location.hash || '').match(/^#b(\d+)(?:-s(\d+))?(?:-a(\d+))?/);
      return m ? { n: parseInt(m[1], 10), s: m[2] != null ? parseInt(m[2], 10) : null, a: m[3] != null ? parseInt(m[3], 10) : null } : null;
    }
    function bookNoFromHash() { var t = hashTarget(); return t ? t.n : null; }
    /* 장(섹션)과 조문으로 옮겨 가 표시한다 */
    function jumpTo(t) {
      if (!t || t.s == null) return;
      var sec = document.getElementById('lib-sec-' + t.s);
      if (!sec) return;
      var target = sec;
      if (t.a != null) {
        var re = new RegExp('^\\s*제\\s*' + t.a + '\\s*조(?!\\d)');
        var heads = sec.querySelectorAll('h5, .tit_dept_2, h4, h3');
        for (var i = 0; i < heads.length; i++) {
          if (re.test(heads[i].textContent || '')) { target = heads[i]; break; }
        }
      }
      document.querySelectorAll('.lib-hit').forEach(function (x) { x.classList.remove('lib-hit'); });
      target.classList.add('lib-hit');
      [60, 500, 1500].forEach(function (ms) { setTimeout(function () { target.scrollIntoView({ block: 'start' }); }, ms); });
    }

    function renderTabs() {
      tabsEl.innerHTML = books.map(function (b) {
        return '<button type="button" class="lib-tab' + (current && current.n === b.n ? ' on' : '') +
          '" data-n="' + b.n + '">' + esc(b.title) + '</button>';
      }).join('');
    }

    function renderSide(doc, filter) {
      var q = (filter || '').trim();
      var html = '';
      var shown = 0;
      doc.secs.forEach(function (s, i) {
        if (s.lv > 0 && cfg.tocLv0Only) return;
        if (q && s.t.indexOf(q) === -1) return;
        shown++;
        html += '<a href="#b' + doc.n + '" data-i="' + i + '" class="lv' + s.lv + '">' + esc(s.t) + '</a>';
      });
      sideEl.innerHTML = html ||
        '<div class="lib-side-empty">' + (q ? '‘' + esc(q) + '’ 검색 결과가 없습니다' : '목차가 없습니다') + '</div>';
      return shown;
    }

    function renderDoc(doc) {
      var html = '';
      doc.secs.forEach(function (s, i) {
        html += '<section class="lib-sec lv' + s.lv + '" id="lib-sec-' + i + '">' +
          (s.t ? '<h3 class="lib-sec-title">' + esc(s.t) + '</h3>' : '') +
          '<div class="lib-sec-body" data-i="' + i + '"></div></section>';
      });
      docEl.innerHTML = html;
      doc.secs.forEach(function (s, i) {
        var box = docEl.querySelector('.lib-sec-body[data-i="' + i + '"]');
        box.innerHTML = s.c || '';
        dropDupHeading(box, s.t);
      });
    }

    function select(n, keepScroll) {
      var b = null;
      books.forEach(function (x) { if (x.n === n) b = x; });
      if (!b) b = books[0];
      if (!b) return;
      current = b;
      renderTabs();
      if (srchEl) srchEl.value = '';
      sideEl.innerHTML = '<div class="lib-side-empty">불러오는 중…</div>';
      docEl.innerHTML = '<div class="lib-loading">본문을 불러오는 중입니다…</div>';
      var t = hashTarget();
      var deep = t && t.n === b.n && t.s != null ? t : null;
      if (history.replaceState) history.replaceState(null, '', deep ? location.hash : '#b' + b.n);
      getJson(cfg.itemUrl(b.n)).then(function (doc) {
        if (current !== b) return;
        b.doc = doc;
        renderSide(doc, '');
        renderDoc(doc);
        if (deep) jumpTo(deep);
        else if (!keepScroll) window.scrollTo(0, 0);
      }).catch(function () { fail(docEl); });
    }

    tabsEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.lib-tab');
      if (btn) select(parseInt(btn.getAttribute('data-n'), 10));
    });
    sideEl.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-i]');
      if (!a) return;
      e.preventDefault();
      var sec = document.getElementById('lib-sec-' + a.getAttribute('data-i'));
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if (srchEl) {
      srchEl.addEventListener('input', function () {
        if (current && current.doc) renderSide(current.doc, srchEl.value);
      });
    }

    getJson(cfg.indexUrl).then(function (idx) {
      books = idx[cfg.listKey] || [];
      var note = document.getElementById('lib-updated');
      if (note && idx.updated) note.textContent = '자료 기준일 ' + idx.updated + ' · 출처: 총회전자자료실(gapck.org)';
      select(bookNoFromHash() || (books[0] && books[0].n), true);
    }).catch(function () { fail(docEl); });

    window.addEventListener('hashchange', function () {
      var t = hashTarget();
      if (!t) return;
      if (!current || current.n !== t.n) select(t.n);
      else jumpTo(t);
    });
  }

  /* ---------- 회의결의 ---------- */
  function initResolutions() {
    var listEl = document.getElementById('res-list');
    var viewEl = document.getElementById('res-view');
    var srchEl = document.getElementById('lib-search');
    if (!listEl || !viewEl) return;

    var rows = [];

    function sessFromHash() {
      var m = (location.hash || '').match(/^#s(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    }
    /* #s110-i3 → 그 회기 본문의 4번째 ■ 항목 (AI 검색의 근거 링크) */
    function itemFromHash() {
      var m = (location.hash || '').match(/^#s\d+-i(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    }
    function jumpToItem(i) {
      var cont = viewEl.querySelector('.lib-res-cont');
      if (!cont || i == null) return;
      var walker = document.createTreeWalker(cont, NodeFilter.SHOW_TEXT);
      var n, k = -1, hit = null;
      while ((n = walker.nextNode())) {
        if (n.nodeValue.indexOf('■') === -1) continue;
        k++;
        if (k === i) { hit = n.parentNode; break; }
      }
      if (!hit) return;
      document.querySelectorAll('.lib-hit').forEach(function (x) { x.classList.remove('lib-hit'); });
      hit.classList.add('lib-hit');
      [60, 500, 1500].forEach(function (ms) { setTimeout(function () { hit.scrollIntoView({ block: 'start' }); }, ms); });
    }

    function renderList(filter) {
      var q = (filter || '').trim();
      var html = '<table class="tbl lib-res-tbl"><thead><tr>' +
        '<th style="width:90px">회기</th><th style="width:90px">연도</th>' +
        '<th>총회장</th><th class="hide-m">장소</th></tr></thead><tbody>';
      var shown = 0;
      rows.forEach(function (r) {
        var hay = r.s + '회 ' + r.year + ' ' + r.chairman + ' ' + r.loc + ' ' + r.title;
        if (q && hay.indexOf(q) === -1) return;
        shown++;
        html += '<tr class="res-row" data-s="' + r.s + '">' +
          '<td><strong>제' + r.s + '회</strong></td>' +
          '<td>' + esc(r.year) + '</td>' +
          '<td>' + esc(r.chairman) + '</td>' +
          '<td class="left hide-m">' + esc(r.loc) + '</td></tr>';
      });
      html += '</tbody></table>';
      if (!shown) html = '<div class="lib-side-empty">검색 결과가 없습니다.</div>';
      listEl.innerHTML = html;
    }

    function showList() {
      viewEl.classList.add('hidden');
      listEl.classList.remove('hidden');
      if (history.replaceState) history.replaceState(null, '', location.pathname);
    }

    function showItem(s) {
      listEl.classList.add('hidden');
      viewEl.classList.remove('hidden');
      viewEl.innerHTML = '<div class="lib-loading">불러오는 중입니다…</div>';
      var item = sessFromHash() === s ? itemFromHash() : null;
      if (history.replaceState) history.replaceState(null, '', item != null ? location.hash : '#s' + s);
      getJson('data/assembly/resolution-' + s + '.json').then(function (r) {
        viewEl.innerHTML =
          '<button type="button" class="btn ghost" id="res-back">&larr; 목록으로</button>' +
          '<div class="lib-res-head">' +
          '<h2>제' + r.s + '회 총회 (' + esc(r.year) + '년)</h2>' +
          '<div class="lib-res-meta">' +
          (r.chairman ? '<span><strong>총회장</strong> ' + esc(r.chairman) + '</span>' : '') +
          (r.issuer && r.issuer !== '-' ? '<span><strong>서기</strong> ' + esc(r.issuer) + '</span>' : '') +
          (r.loc ? '<span><strong>장소</strong> ' + esc(r.loc) + '</span>' : '') +
          '</div></div>' +
          '<div class="lib-doc lib-res-cont"></div>';
        viewEl.querySelector('.lib-res-cont').innerHTML = r.cont || '<p>등록된 내용이 없습니다.</p>';
        var back = document.getElementById('res-back');
        if (back) back.addEventListener('click', function () { showList(); });
        if (item != null) jumpToItem(item); else window.scrollTo(0, 0);
      }).catch(function () { fail(viewEl); });
    }

    listEl.addEventListener('click', function (e) {
      var tr = e.target.closest('.res-row');
      if (tr) showItem(parseInt(tr.getAttribute('data-s'), 10));
    });
    if (srchEl) srchEl.addEventListener('input', function () { renderList(srchEl.value); });

    getJson('data/assembly/resolutions-index.json').then(function (idx) {
      rows = idx.list || [];
      var note = document.getElementById('lib-updated');
      if (note && idx.updated) note.textContent = '자료 기준일 ' + idx.updated + ' · 출처: 총회전자자료실(gapck.org)';
      renderList('');
      var s = sessFromHash();
      if (s) showItem(s);
    }).catch(function () { fail(listEl); });

    window.addEventListener('hashchange', function () {
      var s = sessFromHash();
      if (s) showItem(s); else showList();
    });
  }

  /* ---------- 보고서 (총회 원본 파일로 연결) ---------- */
  /* ---------- 총회 보고서 ----------
   * reports.json 의 회기 목록(갈래 > 보고서 > 소항목)을 보이고, 본문이 있는 회기(sess.text = report-<회기>.json,
   * tools/assembly-report 가 PDF 에서 뽑은 글)는 누르면 그 자리에서 본문을 읽고(#s111-r12) 제목·본문을 검색한다.
   * 본문이 없는 항목은 예전처럼 총회 원본 PDF 로 연결한다. AI 검색의 근거 링크도 #s<회기>-r<번호> 를 쓴다. */
  function initReports() {
    var tabsEl = document.getElementById('lib-tabs');
    var treeEl = document.getElementById('rpt-tree');
    var docEl = document.getElementById('rpt-doc');
    var srchEl = document.getElementById('rpt-search');
    var resEl = document.getElementById('rpt-results');
    if (!tabsEl || !treeEl) return;

    var sessions = [], years = {}, current = null, texts = {}, term = '', timer = null;

    function parseHash() {
      var m = (location.hash || '').match(/^#s(\d+)(?:-r(\d+))?/);
      return m ? { s: parseInt(m[1], 10), r: m[2] ? parseInt(m[2], 10) : null } : { s: null, r: null };
    }
    function words() {
      return term.toLowerCase().split(/\s+/).filter(function (w) { return w.length >= 2 || /^\d+$/.test(w); }).slice(0, 6);
    }
    /* 검색어를 노란 밑줄로 (AI 근거 밑줄과 같은 모양) */
    function hl(html) {
      var ws = words();
      if (!ws.length) return html;
      var re = new RegExp('(' + ws.map(function (w) { return esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'gi');
      return html.replace(re, '<mark class="ai-hl">$1</mark>');
    }

    function renderTabs() {
      tabsEl.innerHTML = sessions.map(function (s) {
        var y = s.year || years[s.s];
        return '<button type="button" class="lib-tab' + (current === s ? ' on' : '') +
          '" data-s="' + s.s + '">제' + s.s + '회' + (y ? ' (' + y + ')' : '') + '</button>';
      }).join('');
    }

    function pdfLink(u, label) {
      return '<a class="rpt-pdf" href="' + esc(encodeURI(u)) + '" target="_blank" rel="noopener" title="총회 원본 파일(PDF)">' + (label || 'PDF') + '</a>';
    }
    /* 본문이 있으면 본문으로, 없으면 PDF 로 */
    function nodeHtml(n) {
      var main;
      if (n.x) {
        main = '<a class="rpt-file" href="#s' + current.s + '-r' + n.x + '">' + hl(esc(n.t)) + '<span class="rpt-ext">본문</span></a>' +
          (n.u ? ' ' + pdfLink(n.u) : '');
      } else if (n.u) {
        main = '<a class="rpt-file" href="' + esc(encodeURI(n.u)) + '" target="_blank" rel="noopener">' + hl(esc(n.t)) + '<span class="rpt-ext">PDF</span></a>';
      } else {
        main = '<span class="rpt-name">' + hl(esc(n.t)) + '</span>';
      }
      var kids = (n.k || []).filter(titleMatch).map(nodeHtml).join('');
      return '<li>' + main + (kids ? '<ul>' + kids + '</ul>' : '') + '</li>';
    }
    /* 검색어가 있을 때 제목 목록 거르기 — 제목이나 아래 항목이 맞으면 남긴다 */
    function titleMatch(n) {
      var ws = words();
      if (!ws.length) return true;
      var t = String(n.t || '').toLowerCase();
      if (ws.every(function (w) { return t.indexOf(w) !== -1; })) return true;
      return (n.k || []).some(titleMatch);
    }

    function renderTree() {
      if (!current) return;
      var groups = (current.groups || []).filter(titleMatch);
      treeEl.innerHTML = groups.map(function (g) {
        var kids = (g.k || []).filter(titleMatch);
        /* 갈래 자체의 글(총대명단·헌의안처럼 하위 항목이 없는 갈래, 또는 갈래 전체 PDF)은 목록 첫 줄에 */
        var whole = (g.x || g.u) ? nodeHtml({ t: g.t + (kids.length ? ' (전문)' : ''), x: g.x, u: g.u }) : '';
        return '<details class="rpt-group" open><summary>' + hl(esc(g.t)) +
          (g.k && g.k.length ? ' <span class="rpt-cnt">' + g.k.length + '</span>' : '') + '</summary>' +
          '<ul class="rpt-list">' + whole + kids.map(nodeHtml).join('') + '</ul></details>';
      }).join('') || '<div class="lib-side-empty">' + (term ? '제목에서 찾지 못했습니다.' : '등록된 보고서가 없습니다.') + '</div>';
    }

    /* ----- 본문 ----- */
    function loadText(sess) {
      if (!sess.text) return Promise.resolve(null);
      if (texts[sess.s]) return Promise.resolve(texts[sess.s]);
      return getJson('data/assembly/' + sess.text).then(function (d) {
        d.byId = {};
        (d.entries || []).forEach(function (e) { d.byId[e.i] = e; });
        texts[sess.s] = d;
        return d;
      });
    }
    function trailOf(doc, e) {
      var t = [];
      for (var i = e.i - 2; i >= 0; i--) {
        var p = doc.entries[i];
        if (p.lv < (t.length ? t[0].lv : e.lv)) { t.unshift(p); if (p.lv === 0) break; }
      }
      return t.map(function (p) { return p.t; });
    }
    function bodyHtml(text) {
      var marker = /^([①-⑳㉑-㉟]|[가-힣]\.\s|\(?\d{1,3}[.)]\s|\d{1,3}\)|[∙•·■□○●◆◇▶▷]|제\s*\d+\s*[조장절]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.)/;
      return String(text || '').split('\n').map(function (l) {
        l = l.trim();
        if (!l) return '';
        return '<p class="ln' + (marker.test(l) ? ' it' : '') + '">' + hl(esc(l)) + '</p>';
      }).join('');
    }
    function showDoc(r) {
      if (!docEl) return;
      treeEl.classList.add('hidden');
      if (resEl) resEl.classList.add('hidden');
      docEl.classList.remove('hidden');
      docEl.innerHTML = '<div class="lib-loading">본문을 불러오는 중...</div>';
      var sess = current;
      loadText(sess).then(function (doc) {
        var e = doc && doc.byId[r];
        if (!e) { fail(docEl, '그 보고서의 본문이 없습니다.'); return; }
        var trail = trailOf(doc, e);
        var prev = doc.entries[e.i - 2], next = doc.entries[e.i];
        while (prev && prev.text.length < 40) prev = doc.entries[prev.i - 2];
        while (next && next.text.length < 40) next = doc.entries[next.i];
        var pages = e.p1 > e.p0 ? (e.p0 === 1 ? e.p1 + '쪽' : e.p0 + '~' + e.p1 + '쪽') : (e.p0 === 1 ? '1쪽' : e.p0 + '쪽');
        docEl.innerHTML =
          '<button type="button" class="btn ghost sm rpt-back" data-back="1">← 목록으로</button>' +
          '<div class="lib-res-head"><h2>' + esc(e.t) + '</h2>' +
          '<div class="lib-res-meta"><span><strong>' + esc(doc.title) + '</strong>' + (doc.year ? ' (' + doc.year + '년)' : '') + '</span>' +
          (trail.length ? '<span>' + esc(trail.join(' > ')) + '</span>' : '') +
          '<span>' + pages + '</span>' +
          (e.u ? '<span>' + pdfLink(e.u, '원본 PDF') + '</span>' : '') + '</div></div>' +
          '<div class="lib-res-cont rpt-body ai-target" id="rpt-body">' + (e.text.length < 40 ? '<p class="ln">(이 항목은 제목만 있고 본문이 없습니다)</p>' : bodyHtml(e.text)) + '</div>' +
          '<p class="lib-note">' + esc(sess.note || '본문은 총회 보고서 PDF 에서 글자만 뽑은 것입니다. 표·그림은 원본을 보십시오.') + '</p>' +
          '<div class="rpt-nav">' +
          (prev ? '<a href="#s' + sess.s + '-r' + prev.i + '">← ' + esc(prev.t) + '</a>' : '<span></span>') +
          (next ? '<a href="#s' + sess.s + '-r' + next.i + '">' + esc(next.t) + ' →</a>' : '<span></span>') + '</div>';
        /* 검색어가 있으면 첫 표시로, 없으면 맨 위로 */
        var first = docEl.querySelector('mark.ai-hl');
        if (first) setTimeout(function () { first.scrollIntoView({ block: 'center' }); }, 60);
        else docEl.scrollIntoView({ block: 'start' });
      }).catch(function () { fail(docEl); });
    }
    function showList() {
      if (docEl) { docEl.classList.add('hidden'); docEl.innerHTML = ''; }
      treeEl.classList.remove('hidden');
      renderTree();
      runSearch();
    }

    /* ----- 본문 검색 ----- */
    function snippet(text, ws) {
      var low = text.toLowerCase(), at = -1;
      for (var i = 0; i < ws.length && at === -1; i++) at = low.indexOf(ws[i]);
      if (at === -1) return '';
      var a = Math.max(0, at - 70), b = Math.min(text.length, at + 110);
      return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\n/g, ' ') + (b < text.length ? '…' : '');
    }
    function runSearch() {
      if (!resEl) return;
      var ws = words();
      if (!ws.length || !current || !current.text) { resEl.classList.add('hidden'); resEl.innerHTML = ''; return; }
      var sess = current, my = term;
      resEl.classList.remove('hidden');
      resEl.innerHTML = '<div class="lib-loading">본문에서 찾는 중...</div>';
      loadText(sess).then(function (doc) {
        if (my !== term || sess !== current) return;
        var hits = [];
        doc.entries.forEach(function (e) {
          if (e.text.length < 40) return;
          var low = (e.t + '\n' + e.text).toLowerCase(), score = 0;
          for (var i = 0; i < ws.length; i++) {
            var n = 0, k = 0;
            while ((k = low.indexOf(ws[i], k)) !== -1 && n < 200) { n++; k += ws[i].length; }
            if (!n) { score = 0; break; }
            score += n;
          }
          if (score) hits.push({ e: e, score: score });
        });
        hits.sort(function (a, b) { return b.score - a.score; });
        if (!hits.length) { resEl.innerHTML = '<div class="lib-side-empty">본문에서 「' + esc(term) + '」을(를) 찾지 못했습니다.</div>'; return; }
        resEl.innerHTML = '<div class="rpt-res-head">본문에서 <strong>' + hits.length + '</strong>개 보고서 찾음' +
          (hits.length > 60 ? ' (많이 나온 60개만 보입니다)' : '') + '</div>' +
          hits.slice(0, 60).map(function (h) {
            var trail = trailOf(doc, h.e);
            return '<a class="rpt-hit" href="#s' + sess.s + '-r' + h.e.i + '"><span class="rpt-hit-t">' + hl(esc(h.e.t)) +
              '<small>' + esc(trail.join(' > ')) + ' · ' + h.score + '곳</small></span>' +
              '<span class="rpt-snip">' + hl(esc(snippet(h.e.text, ws))) + '</span></a>';
          }).join('');
      }).catch(function () { fail(resEl); });
    }

    function select(s, r) {
      current = null;
      sessions.forEach(function (x) { if (x.s === s) current = x; });
      if (!current) current = sessions[0];
      if (!current) return;
      renderTabs();
      if (r) showDoc(r); else showList();
    }
    function go(s, r) {
      var h = '#s' + s + (r ? '-r' + r : '');
      if (location.hash === h) select(s, r);
      else location.hash = h;   /* hashchange 가 그린다 */
    }

    tabsEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.lib-tab');
      if (btn) go(parseInt(btn.getAttribute('data-s'), 10), null);
    });
    if (docEl) docEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-back]')) { e.preventDefault(); go(current.s, null); }
    });
    if (srchEl) srchEl.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        term = srchEl.value.trim();
        if (docEl && !docEl.classList.contains('hidden')) {
          var h = parseHash();
          if (h.r) showDoc(h.r);   /* 본문을 보는 중이면 그 안에서 표시만 바꾼다 */
          return;
        }
        renderTree();
        runSearch();
      }, 250);
    });

    Promise.all([
      getJson('data/assembly/reports.json'),
      getJson('data/assembly/resolutions-index.json').catch(function () { return { list: [] }; })
    ]).then(function (rs) {
      sessions = rs[0].sessions || [];
      (rs[1].list || []).forEach(function (r) { years[r.s] = r.year; });
      var note = document.getElementById('lib-updated');
      if (note && rs[0].updated) note.textContent = '자료 기준일 ' + rs[0].updated + ' · 출처: 총회전자자료실(gapck.org)';
      var h = parseHash();
      select(h.s || (sessions[0] && sessions[0].s), h.r);
    }).catch(function () { fail(treeEl); });

    window.addEventListener('hashchange', function () {
      var h = parseHash();
      if (!h.s) return;
      select(h.s, h.r);
    });
  }

  return { initDocs: initDocs, initResolutions: initResolutions, initReports: initReports };
})();

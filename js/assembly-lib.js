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

    function bookNoFromHash() {
      var m = (location.hash || '').match(/^#b(\d+)/);
      return m ? parseInt(m[1], 10) : null;
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
      if (history.replaceState) history.replaceState(null, '', '#b' + b.n);
      getJson(cfg.itemUrl(b.n)).then(function (doc) {
        if (current !== b) return;
        b.doc = doc;
        renderSide(doc, '');
        renderDoc(doc);
        if (!keepScroll) window.scrollTo(0, 0);
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
      var n = bookNoFromHash();
      if (n && (!current || current.n !== n)) select(n);
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
      if (history.replaceState) history.replaceState(null, '', '#s' + s);
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
        window.scrollTo(0, 0);
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
  function initReports() {
    var tabsEl = document.getElementById('lib-tabs');
    var treeEl = document.getElementById('rpt-tree');
    if (!tabsEl || !treeEl) return;

    var sessions = [], years = {}, current = null;

    function sessFromHash() {
      var m = (location.hash || '').match(/^#s(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    }

    function renderTabs() {
      tabsEl.innerHTML = sessions.map(function (s) {
        var y = years[s.s] ? ' (' + years[s.s] + ')' : '';
        return '<button type="button" class="lib-tab' + (current === s ? ' on' : '') +
          '" data-s="' + s.s + '">제' + s.s + '회' + y + '</button>';
      }).join('');
    }

    function nodeHtml(n) {
      var link = n.u
        ? '<a class="rpt-file" href="' + esc(encodeURI(n.u)) + '" target="_blank" rel="noopener">' +
          esc(n.t) + '<span class="rpt-ext">PDF</span></a>'
        : '<span class="rpt-name">' + esc(n.t) + '</span>';
      var kids = (n.k || []).map(nodeHtml).join('');
      return '<li>' + link + (kids ? '<ul>' + kids + '</ul>' : '') + '</li>';
    }

    function renderTree() {
      if (!current) return;
      treeEl.innerHTML = current.groups.map(function (g) {
        return '<details class="rpt-group" open><summary>' + esc(g.t) +
          (g.k ? ' <span class="rpt-cnt">' + g.k.length + '</span>' : '') + '</summary>' +
          '<ul class="rpt-list">' + (g.k || []).map(nodeHtml).join('') +
          (g.u ? '<li>' + nodeHtml({ t: g.t + ' (전문)', u: g.u }).replace(/^<li>|<\/li>$/g, '') + '</li>' : '') +
          '</ul></details>';
      }).join('') || '<div class="lib-side-empty">등록된 보고서가 없습니다.</div>';
    }

    function select(s) {
      current = null;
      sessions.forEach(function (x) { if (x.s === s) current = x; });
      if (!current) current = sessions[0];
      if (!current) return;
      renderTabs();
      renderTree();
      if (history.replaceState) history.replaceState(null, '', '#s' + current.s);
    }

    tabsEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.lib-tab');
      if (btn) select(parseInt(btn.getAttribute('data-s'), 10));
    });

    Promise.all([
      getJson('data/assembly/reports.json'),
      getJson('data/assembly/resolutions-index.json').catch(function () { return { list: [] }; })
    ]).then(function (rs) {
      sessions = rs[0].sessions || [];
      (rs[1].list || []).forEach(function (r) { years[r.s] = r.year; });
      var note = document.getElementById('lib-updated');
      if (note && rs[0].updated) note.textContent = '자료 기준일 ' + rs[0].updated + ' · 출처: 총회전자자료실(gapck.org)';
      select(sessFromHash() || (sessions[0] && sessions[0].s));
    }).catch(function () { fail(treeEl); });

    window.addEventListener('hashchange', function () {
      var s = sessFromHash();
      if (s && (!current || current.s !== s)) select(s);
    });
  }

  return { initDocs: initDocs, initResolutions: initResolutions, initReports: initReports };
})();

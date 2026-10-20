/* 시화산노회 AI 자료 검색 (첫 화면 검색창)
 *
 * 로그인한 정회원 이상에게 히어로 아래에 검색창을 보여 준다. 질문을 보내면
 * 창구(cloudflare/ai)가 Claude 에게 묻고, 답이 글자 단위로 흘러온다(SSE).
 * 답 속의 [R3] 같은 근거 번호는 누를 수 있는 꼬리표가 되고, 누르면 오른쪽
 * 서랍(휴대전화는 아래 서랍)에 그 자료 원문과 홈페이지 화면이 열린다.
 * 서랍은 답을 가리지 않는다 — 답은 그대로 보이고 서랍만 옆에 선다.
 *
 * 화면:  index.html 의 <div id="ai-hero">  (SHSAI.mount)
 * 창구:  SHS_AI_URL (아래 기본값) — /ask
 */
var SHSAI = (function () {
  var WORKER = window.SHS_AI_URL || 'https://sihwasan-ai.sihwasan.workers.dev';
  var ROLES = ['superadmin', 'president', 'clerk', 'staff', 'officer', 'member'];
  var EXAMPLES = [
    '권징조례에서 해벌은 어떻게 하나요?',
    '이번 회기 노회 임원은 누구인가요?',
    '다음 정기노회는 언제, 어디서 열리나요?',
    '위임목사 청빙 절차를 알려 주세요',
    '노회규칙에서 서기의 직무는?'
  ];

  var box = null, user = null, convo = [], busy = false, drawer = null;
  var quotesOf = {};   /* 근거 번호 → AI 가 적어 준 원문 구절들 (답에서 뽑아 둔다) */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function token() {
    return SHSCloud.init().then(function (c) {
      if (!c) return null;
      return c.auth.getSession().then(function (r) {
        return r && r.data && r.data.session ? r.data.session.access_token : null;
      });
    });
  }

  /* ---------- 답 글을 화면 글로 ---------- */
  function inline(s) {
    /* [R3]{{원문 구절}} — 구절은 밑줄용으로 챙겨 두고 화면에는 번호만 */
    s = s.replace(/\[(R\d+)\]\{\{([^{}]*)\}\}/g, function (m, r, q) {
      q = q.trim();
      if (q) { quotesOf[r] = quotesOf[r] || []; if (quotesOf[r].indexOf(q) === -1) quotesOf[r].push(q); }
      return '[' + r + ']';
    });
    s = s.replace(/\{\{[^{}]*\}\}/g, '').replace(/\{\{[^}]*$/, '');   /* 흘러오는 중의 반쪽 구절은 감춘다 */
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[(R\d+)\]/g, function (m, r) {
      return '<button type="button" class="aih-ref" data-ref="' + r + '" title="근거 보기">' + r.slice(1) + '</button>';
    });
    /* 같은 근거가 잇따라 붙으면 사이 공백을 지운다 */
    s = s.replace(/<\/button>\s+<button type="button" class="aih-ref"/g, '</button><button type="button" class="aih-ref"');
    return s;
  }
  function render(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    var html = '', list = null, para = [];
    function flushPara() {
      if (para.length) { html += '<p>' + inline(para.join(' ')) + '</p>'; para = []; }
    }
    function flushList() {
      if (list) { html += '<' + list.tag + '>' + list.items.map(function (i) { return '<li>' + inline(i) + '</li>'; }).join('') + '</' + list.tag + '>'; list = null; }
    }
    lines.forEach(function (ln) {
      var t = ln.trim();
      if (!t) { flushPara(); flushList(); return; }
      var m = t.match(/^[-•·]\s+(.*)$/);
      var n = t.match(/^(\d+)[.)]\s+(.*)$/);
      if (m || n) {
        flushPara();
        var tag = m ? 'ul' : 'ol';
        if (!list || list.tag !== tag) { flushList(); list = { tag: tag, items: [] }; }
        list.items.push(m ? m[1] : n[2]);
        return;
      }
      if (/^#{1,4}\s/.test(t)) { flushPara(); flushList(); html += '<p><strong>' + inline(t.replace(/^#+\s*/, '')) + '</strong></p>'; return; }
      flushList();
      para.push(t);
    });
    flushPara(); flushList();
    return html;
  }

  /* ---------- 화면 ---------- */
  function mount(el, u) {
    box = el; user = u;
    if (!box) return;
    if (!u || !u.cloud || ROLES.indexOf(u.role) === -1) { box.innerHTML = ''; box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML =
      '<form class="aih-form" id="aih-form" autocomplete="off">' +
      '<span class="aih-tag">AI 검색</span>' +
      '<input type="text" id="aih-q" maxlength="1500" placeholder="노회·총회 자료에 대해 물어보세요 (예: 권징조례에서 해벌 절차는?)">' +
      '<button type="submit" class="aih-go" id="aih-go">묻기</button></form>' +
      '<div class="aih-chips" id="aih-chips">' +
      EXAMPLES.map(function (q) { return '<button type="button" class="aih-chip" data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') +
      '</div>' +
      '<div class="aih-panel hidden" id="aih-panel"></div>';
    box.querySelector('#aih-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var q = box.querySelector('#aih-q').value.trim();
      if (q) ask(q);
    });
    box.querySelectorAll('.aih-chip').forEach(function (b) {
      b.addEventListener('click', function () { ask(b.dataset.q); });
    });
    box.addEventListener('click', function (ev) {
      var r = ev.target.closest('.aih-ref, .aih-src');
      if (r) { ev.preventDefault(); openSource(r.dataset.ref); return; }
      if (ev.target.closest('#aih-new')) { ev.preventDefault(); reset(); }
    });
  }

  function reset() {
    convo = [];
    var p = box.querySelector('#aih-panel');
    p.innerHTML = ''; p.classList.add('hidden');
    box.querySelector('#aih-chips').classList.remove('hidden');
    var inp = box.querySelector('#aih-q');
    inp.value = ''; inp.placeholder = '노회·총회 자료에 대해 물어보세요 (예: 권징조례에서 해벌 절차는?)';
    closeDrawer();
  }

  function panelHtml() {
    var h = '';
    /* 최신 문답이 맨 위 — 검색창 바로 아래에 새 답이 나오므로 화면을 옮기지 않아도 된다 */
    convo.map(function (c, i) { return { c: c, i: i }; }).reverse().forEach(function (x) {
      var c = x.c, i = x.i;
      h += '<div class="aih-item" data-i="' + i + '">' +
        '<div class="aih-q">' + esc(c.q) + '</div>' +
        '<div class="aih-status' + (c.status ? '' : ' hidden') + '" id="aih-st-' + i + '">' + esc(c.status || '') + '</div>' +
        '<div class="aih-a" id="aih-a-' + i + '">' + render(c.text()) + (c.error ? '<p class="aih-err">' + esc(c.error) + '</p>' : '') + '</div>' +
        '<div class="aih-srcs" id="aih-src-' + i + '">' + sourcesHtml(c) + '</div>' +
        '</div>';
    });
    h += '<div class="aih-foot"><span class="aih-note">답은 홈페이지에 실린 자료에서 찾은 것으로, 근거 번호를 누르면 원문을 볼 수 있습니다. 중요한 일은 원문을 확인해 주세요.</span>' +
      '<button type="button" class="btn ghost sm" id="aih-new">새 질문</button></div>';
    return h;
  }
  function sourcesHtml(c) {
    if (!c.sources || !c.sources.length) return '';
    var cited = c.sources.filter(function (s) { return s.cited; });
    var rest = c.sources.filter(function (s) { return !s.cited; });
    function one(s) {
      return '<button type="button" class="aih-src" data-ref="' + s.ref + '"><span class="aih-src-n">' + s.ref.slice(1) + '</span>' +
        '<span class="aih-src-t">' + esc(s.title) + '</span><span class="aih-src-k">' + esc(s.kind) + '</span></button>';
    }
    var h = '';
    if (cited.length) h += '<div class="aih-src-head">근거</div>' + cited.map(one).join('');
    if (rest.length) h += '<details class="aih-more"><summary>함께 살펴본 자료 ' + rest.length + '건</summary>' + rest.map(one).join('') + '</details>';
    return h;
  }

  function ask(q) {
    if (busy) return;
    var inp = box.querySelector('#aih-q');
    var item = { q: q, turns: {}, sources: null, status: '', error: '',
      text: function () { var ks = Object.keys(this.turns).map(Number).sort(function (a, b) { return a - b; }); var self = this; return ks.map(function (k) { return self.turns[k]; }).join(''); } };
    var history = [];
    convo.forEach(function (c) { if (c.done) { history.push({ role: 'user', content: c.q }); history.push({ role: 'assistant', content: c.text() }); } });
    convo.push(item);
    var i = convo.length - 1;
    var panel = box.querySelector('#aih-panel');
    panel.classList.remove('hidden');
    box.querySelector('#aih-chips').classList.add('hidden');
    item.status = '질문을 보내는 중';
    panel.innerHTML = panelHtml();
    inp.value = ''; inp.placeholder = '이어서 물어보기';
    busy = true;
    box.querySelector('#aih-go').disabled = true;

    var aEl = function () { return document.getElementById('aih-a-' + i); };
    var stEl = function () { return document.getElementById('aih-st-' + i); };
    function paint() { var a = aEl(); if (a) a.innerHTML = render(item.text()) + (item.error ? '<p class="aih-err">' + esc(item.error) + '</p>' : ''); }
    function status(t) { item.status = t || ''; var s = stEl(); if (s) { s.textContent = item.status; s.classList.toggle('hidden', !item.status); } }

    token().then(function (tk) {
      if (!tk) throw new Error('로그인이 확인되지 않습니다. 다시 로그인해 주세요.');
      return fetch(WORKER + '/ask', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, history: history.slice(-6) })
      });
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ('창구 오류 (HTTP ' + r.status + ')')); });
      }
      if (!r.body) throw new Error('이 브라우저는 흘려받기(streaming)를 지원하지 않습니다.');
      var reader = r.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      function handle(ev, data) {
        if (ev === 'status') status(data.text);
        else if (ev === 'delta') { item.turns[data.n] = (item.turns[data.n] || '') + data.text; status(''); paint(); }
        else if (ev === 'retract') { delete item.turns[data.n]; paint(); }
        else if (ev === 'sources') { item.sources = data.list || []; var s = document.getElementById('aih-src-' + i); if (s) s.innerHTML = sourcesHtml(item); }
        else if (ev === 'error') { item.error = data.message || '오류'; status(''); paint(); }
        else if (ev === 'done') { status(''); }
      }
      function pump() {
        return reader.read().then(function (x) {
          if (x.done) return;
          buf += dec.decode(x.value, { stream: true });
          var k;
          while ((k = buf.indexOf('\n\n')) !== -1) {
            var chunk = buf.slice(0, k); buf = buf.slice(k + 2);
            var ev = '', data = '';
            chunk.split('\n').forEach(function (ln) {
              if (ln.indexOf('event:') === 0) ev = ln.slice(6).trim();
              else if (ln.indexOf('data:') === 0) data += ln.slice(5).trim();
            });
            if (ev) { try { handle(ev, JSON.parse(data || '{}')); } catch (e) {} }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      item.error = (e && e.message) || String(e);
      status('');
      paint();
    }).then(function () {
      item.done = true;
      if (!item.text() && !item.error) { item.error = '답을 받지 못했습니다. 다시 시도해 주세요.'; paint(); }
      busy = false;
      var go = box.querySelector('#aih-go'); if (go) go.disabled = false;
    });
  }

  /* ---------- 근거 서랍 ---------- */
  function findSource(ref) {
    for (var i = convo.length - 1; i >= 0; i--) {
      var s = (convo[i].sources || []).filter(function (x) { return x.ref === ref; })[0];
      if (s) return s;
    }
    return null;
  }
  function embedUrl(url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return '';          /* 바깥 주소(총회 PDF 등)는 틀 안에 넣지 않는다 */
    var hash = '', base = url;
    var h = url.indexOf('#');
    if (h !== -1) { hash = url.slice(h); base = url.slice(0, h); }
    return base + (base.indexOf('?') !== -1 ? '&' : '?') + 'embed=1' + hash;
  }
  function openSource(ref) {
    var s = findSource(ref);
    if (!s) return;
    if (!drawer) {
      drawer = document.createElement('aside');
      drawer.id = 'aih-drawer';
      drawer.setAttribute('aria-label', '근거 자료');
      document.body.appendChild(drawer);
      drawer.addEventListener('click', function (ev) {
        if (ev.target.closest('#aih-dr-close')) closeDrawer();
      });
      document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeDrawer(); });
    }
    var ext = /^https?:\/\//i.test(s.url || '');
    drawer.innerHTML =
      '<div class="aih-dr-head"><span class="aih-dr-n">' + esc(s.ref.slice(1)) + '</span>' +
      '<div class="aih-dr-ttl"><strong>' + esc(s.title) + '</strong><span>' + esc(s.kind) + '</span></div>' +
      (s.url ? '<a class="btn ghost sm" href="' + esc(s.url) + '" target="_blank" rel="noopener">새 창</a> ' : '') +
      '<button type="button" class="aih-dr-x" id="aih-dr-close" aria-label="닫기">&times;</button></div>' +
      (s.snippet ? '<div class="aih-dr-snip">' + esc(s.snippet) + '</div>' : '') +
      (s.url && !ext ? '<iframe class="aih-dr-frame" src="' + esc(embedUrl(s.url)) + '" title="' + esc(s.title) + '"></iframe>'
        : (s.url ? '<p class="aih-dr-ext">총회 원본 파일은 <a href="' + esc(s.url) + '" target="_blank" rel="noopener">새 창</a>에서 열립니다.</p>' : ''));
    /* 핵심 구절 밑줄: 원문 조각에는 바로, 아래 화면에는 그 화면이 다 그려진 뒤에 */
    var quotes = (s.quotes || []).concat(quotesOf[ref] || []).filter(function (q, i, a) { return q && a.indexOf(q) === i; });
    var toks = tokensOf(quotes.join(' ') + ' ' + sentenceFor(ref));
    var snip = drawer.querySelector('.aih-dr-snip');
    if (snip) underline(snip, null, quotes, toks);
    var fr = drawer.querySelector('iframe');
    if (fr) fr.addEventListener('load', function () { whenReady(fr, function (doc, start, root) { underline(root, start, quotes, toks); }); });
    drawer.classList.add('open');
    document.body.classList.add('aih-drawer-open');
    box.querySelectorAll('.aih-ref.on, .aih-src.on').forEach(function (b) { b.classList.remove('on'); });
    box.querySelectorAll('[data-ref="' + ref + '"]').forEach(function (b) { b.classList.add('on'); });
  }
  /* ---------- 핵심 구절 밑줄 ---------- */
  function norm(t) { return String(t || '').replace(/\s+/g, ''); }
  function tokensOf(t) {
    var out = [], seen = {};
    String(t || '').toLowerCase().replace(/[^0-9a-z가-힣]+/g, ' ').split(' ').forEach(function (w) {
      var m = w.match(/^(.+?)(으로부터|에서는|에게는|으로는|으로서|으로써|이라는|라는|에서|에게|으로|로서|로써|까지|부터|처럼|마다|조차|마저|보다|이란|이든|이나|하고|과는|와는|은|는|이|가|을|를|의|에|와|과|도|로|만)$/);
      if (m && m[1].length >= 2) w = m[1];
      if (w.length >= 2 && !seen[w]) { seen[w] = 1; out.push(w); }
    });
    return out;
  }
  /* 답에서 그 근거 번호가 달린 문장 (구절이 없을 때 낱말 겹침으로 찾는 데 쓴다) */
  function sentenceFor(ref) {
    for (var i = convo.length - 1; i >= 0; i--) {
      var parts = String(convo[i].text() || '').split(/\n|(?<=[.!?。])\s+/);
      var hit = parts.filter(function (p) { return p.indexOf('[' + ref + ']') !== -1; });
      if (hit.length) return hit.join(' ').replace(/\[R\d+\](\{\{[^{}]*\}\})?/g, ' ').replace(/\*\*/g, '');
    }
    return '';
  }
  /* 시작점부터 다음 항목(다음 조문 제목·다음 ■)까지의 글 마디들 */
  function textNodesFrom(root, startEl, limit) {
    var doc = root.ownerDocument;
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [], started = !startEl, n;
    var startIsItem = startEl && startEl.textContent.indexOf('■') !== -1;
    var startIsHead = startEl && /^H[2-6]$/.test(startEl.tagName);
    while ((n = walker.nextNode())) {
      if (!started) {
        if (startEl.contains(n) || (startEl.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) started = true; else continue;
      }
      if (!n.nodeValue.trim()) continue;
      var p = n.parentNode;
      if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE') continue;
      if (nodes.length && startEl && !startEl.contains(n)) {
        if (startIsItem && n.nodeValue.indexOf('■') !== -1) break;
        if (startIsHead && /^H[2-6]$/.test(p.tagName)) break;
        if (p.className && /tit_dept_2/.test(p.className)) break;
      }
      nodes.push(n);
      if (nodes.length >= limit) break;
    }
    return nodes;
  }
  /* 띄어쓰기를 무시하고 구절을 찾아 <mark> 로 감싼다. 첫 표시 요소를 돌려준다. */
  function markExact(nodes, quote, doc) {
    var q = norm(quote).toLowerCase();
    if (q.length < 4) return null;
    var map = [], str = '';
    nodes.forEach(function (n, ni) {
      var t = n.nodeValue;
      for (var i = 0; i < t.length; i++) { if (/\s/.test(t[i])) continue; map.push([ni, i]); str += t[i].toLowerCase(); }
    });
    var at = str.indexOf(q);
    if (at === -1) return null;
    var sPos = map[at], ePos = map[at + q.length - 1], first = null;
    for (var ni = sPos[0]; ni <= ePos[0]; ni++) {
      var n = nodes[ni], t = n.nodeValue;
      var from = ni === sPos[0] ? sPos[1] : 0, to = ni === ePos[0] ? ePos[1] + 1 : t.length;
      if (!t.slice(from, to).trim()) continue;
      var mark = doc.createElement('mark'); mark.className = 'aih-key'; mark.textContent = t.slice(from, to);
      var frag = doc.createDocumentFragment();
      if (from > 0) frag.appendChild(doc.createTextNode(t.slice(0, from)));
      frag.appendChild(mark);
      if (to < t.length) frag.appendChild(doc.createTextNode(t.slice(to)));
      n.parentNode.replaceChild(frag, n);
      if (!first) first = mark;
    }
    return first;
  }
  /* 구절을 못 찾으면 낱말이 가장 많이 겹치는 문단에 띠를 두른다 */
  function markBlock(nodes, tokens) {
    if (tokens.length < 2) return null;
    var seen = [], best = null, bestScore = 0;
    nodes.forEach(function (n) {
      var el = n.parentNode;
      while (el && !/^(P|LI|DIV|TD|TH|H[1-6]|SECTION|BLOCKQUOTE|ARTICLE)$/.test(el.tagName)) el = el.parentNode;
      if (!el || seen.indexOf(el) !== -1) return;
      seen.push(el);
      var t = norm(el.textContent).toLowerCase();
      if (t.length < 6 || t.length > 1200) return;
      var sc = 0;
      tokens.forEach(function (w) { if (t.indexOf(norm(w)) !== -1) sc++; });
      if (sc > bestScore) { bestScore = sc; best = el; }
    });
    if (best && bestScore >= Math.max(2, Math.ceil(tokens.length * 0.3))) { best.classList.add('aih-key-block'); return best; }
    return null;
  }
  function underline(root, startEl, quotes, tokens) {
    if (!root) return;
    var doc = root.ownerDocument, first = null;
    (quotes || []).forEach(function (q) {
      var m = markExact(textNodesFrom(root, startEl, 1500), q, doc);
      if (m && !first) first = m;
    });
    if (!first) first = markBlock(textNodesFrom(root, startEl, 1500), tokens || []);
    if (first && root !== drawer && root.ownerDocument !== document) {
      setTimeout(function () { try { first.scrollIntoView({ block: 'center' }); } catch (e) {} }, 120);
    }
  }
  /* 서랍 속 화면이 자료를 다 그릴 때까지 기다렸다가 (조문·결의 항목·회의록 낱말 표시가 나타나면) 부른다 */
  function whenReady(fr, cb) {
    var tries = 0;
    (function poll() {
      var doc = null;
      try { doc = fr.contentDocument; } catch (e) { return; }
      if (!doc || !doc.body) { if (tries++ < 30) setTimeout(poll, 300); return; }
      var t = doc.querySelector('.ai-target') || doc.querySelector('.lib-hit') || doc.querySelector('mark.ai-hl');
      if (!t) { if (tries++ < 30) { setTimeout(poll, 300); return; } cb(doc, null, doc.querySelector('main') || doc.body); return; }
      var root = t.classList.contains('ai-target') ? t
        : (t.closest('.lib-sec-body, .lib-res-cont, .rule-article, #minutes-view') || t.parentNode);
      var start = t.classList.contains('ai-target') ? null : (t.tagName === 'MARK' ? null : t);
      cb(doc, start, root);
    })();
  }

  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('open');
    document.body.classList.remove('aih-drawer-open');
    var f = drawer.querySelector('iframe'); if (f) f.remove();
    if (box) box.querySelectorAll('.aih-ref.on, .aih-src.on').forEach(function (b) { b.classList.remove('on'); });
  }

  return { mount: mount, ask: ask, url: WORKER };
})();

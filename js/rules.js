/* 회칙 조문 보여주기
 *
 * 조문은 서버에 담겨 있고, 관리자가 홈페이지에서 직접 고칠 수 있다.
 * 서버에 조문이 없거나 연결이 안 되면 회칙 페이지에 원래 실려 있는
 * 조문이 그대로 보이므로, 회칙이 빈 화면이 되는 일은 없다.
 */
var SHSRules = (function () {

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 서버에서 문서와 조문을 가져온다 */
  function load(book) {
    if (!(window.SHSCloud && SHSCloud.enabled())) return Promise.resolve(null);
    return SHSCloud.init().then(function (c) {
      if (!c) return null;
      return Promise.all([
        c.from('rule_docs').select('*').eq('book', book).order('sort'),
        c.from('rule_articles').select('*').eq('book', book).order('sort')
      ]).then(function (rs) {
        if (rs[0].error || rs[1].error) return null;
        var docs = rs[0].data || [];
        if (!docs.length) return null;
        return { docs: docs, articles: rs[1].data || [] };
      });
    }).catch(function () { return null; });
  }

  /* 본문 한 덩어리를 항 목록으로 만든다.
   * 줄을 바꾸면 항이 나뉘고, 한 줄뿐이면 그냥 문단으로 둔다. */
  function bodyHtml(body) {
    var lines = String(body || '').split('\n').map(function (l) { return l.trim(); })
      .filter(function (l) { return l; });
    if (!lines.length) return '';
    if (lines.length === 1) return '<p>' + esc(lines[0]) + '</p>';
    return '<ol>' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ol>';
  }

  /* 조문 꼬리표: rule-main-a12 (노회규칙 제12조) — AI 검색의 근거 링크가 쓴다 */
  function artId(docKey, title) {
    var m = String(title || '').match(/제\s*(\d+)\s*조/);
    return m ? docKey + '-a' + m[1] : '';
  }
  /* 주소의 #rule-main-a12 로 그 탭을 켜고 조문으로 옮겨 간다.
   * 서버 조문이든 화면에 미리 실린 조문이든 똑같이 동작한다. */
  function applyHash(container) {
    var m = (location.hash || '').match(/^#(rule-[a-z]+)(?:-a(\d+))?$/);
    if (!m || !container) return;
    var btn = container.querySelector('.tabs button[data-tab="' + m[1] + '"]');
    if (btn && !btn.classList.contains('active')) btn.click();
    if (!m[2]) return;
    var panel = document.getElementById(m[1]);
    if (!panel) return;
    /* 미리 실린 조문에는 꼬리표가 없으니 제목을 보고 붙인다 */
    panel.querySelectorAll('.rule-article').forEach(function (a) {
      if (!a.id) { var h4 = a.querySelector('h4'); var id = h4 ? artId(m[1], h4.textContent) : ''; if (id) a.id = id; }
    });
    var el = document.getElementById(m[1] + '-a' + m[2]);
    if (!el) return;
    container.querySelectorAll('.rule-article.ai-target').forEach(function (x) { x.classList.remove('ai-target'); });
    el.classList.add('ai-target');
    setTimeout(function () { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
  }

  function docHtml(doc, arts) {
    var h = '';
    if (doc.intro) {
      h += String(doc.intro).split('\n').filter(function (l) { return l.trim(); })
        .map(function (l) { return '<p>' + esc(l.trim()) + '</p>'; }).join('');
    }
    var chapter = null;
    arts.forEach(function (a) {
      if (a.chapter && a.chapter !== chapter) {
        chapter = a.chapter;
        h += '<div class="rule-chapter">' + esc(a.chapter) + '</div>';
      }
      var id = artId(doc.key, a.title);
      h += '<div class="rule-article"' + (id ? ' id="' + id + '"' : '') + '>' +
        (a.title ? '<h4>' + esc(a.title) + '</h4>' : '') +
        bodyHtml(a.body) + '</div>';
    });
    if (doc.revisions) {
      h += '<h3>개정 연혁</h3><p style="font-size:0.9rem">' + esc(doc.revisions) + '</p>';
    }
    return h;
  }

  /* 회칙 페이지를 서버 조문으로 다시 그린다 */
  function render(book, container, user) {
    if (!container) return Promise.resolve(false);
    return load(book).then(function (d) {
      if (!d) { applyHash(container); window.addEventListener('hashchange', function () { applyHash(container); }); return false; }

      var byDoc = {};
      d.articles.forEach(function (a) {
        (byDoc[a.doc_key] = byDoc[a.doc_key] || []).push(a);
      });

      var tabs = container.querySelector('.tabs');
      var panels = container.querySelectorAll('.tab-panel');
      if (!tabs || !panels.length) return false;

      tabs.innerHTML = d.docs.map(function (doc, i) {
        return '<button class="' + (i === 0 ? 'active' : '') + '" data-tab="' + esc(doc.key) + '">' +
          esc(doc.name) + '</button>';
      }).join('');

      /* 기존 칸을 지우고 서버 문서 수만큼 다시 만든다 */
      var host = panels[0].parentNode;
      Array.prototype.forEach.call(panels, function (p) { host.removeChild(p); });
      d.docs.forEach(function (doc, i) {
        var p = document.createElement('div');
        p.className = 'tab-panel' + (i === 0 ? ' active' : '');
        p.id = doc.key;
        p.innerHTML = docHtml(doc, byDoc[doc.key] || []);
        host.appendChild(p);
      });

      tabs.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          tabs.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          container.querySelectorAll('.tab-panel').forEach(function (p) {
            p.classList.toggle('active', p.id === b.dataset.tab);
          });
          /* 주소 해시를 탭에 맞추고, 왼쪽 묶음 메뉴(각종 내규의 가지)도 따라 켜지게 */
          if (b.dataset.tab && history.pushState && location.hash !== '#' + b.dataset.tab) {
            history.pushState(null, '', '#' + b.dataset.tab);
            window.dispatchEvent(new Event('hashchange'));
          }
        });
      });

      /* 관리자에게는 고치러 가는 길을 보여준다 */
      if (user && window.SHSAuth && SHSAuth.canManageMembers(user)) {
        var bar = document.createElement('p');
        bar.style.cssText = 'text-align:right;margin-bottom:14px';
        bar.innerHTML = '<a class="btn sm" href="archive-edit.html#tab-rules">회칙 개정 반영하기</a>';
        tabs.parentNode.insertBefore(bar, tabs);
      }
      applyHash(container);
      window.addEventListener('hashchange', function () { applyHash(container); });
      return true;
    });
  }

  return { load: load, render: render, bodyHtml: bodyHtml, esc: esc, applyHash: applyHash };
})();

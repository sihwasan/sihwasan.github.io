/* 이름 고르기 — 노회 명단에서 찾아 넣는다
 *
 * 홈페이지에서 사람 이름을 적는 칸은 모두 이 모듈을 쓴다.
 * 손으로 적지 않고 <노회 명단(roster)>에서 찾아 고르므로,
 *   · 오타나 띄어쓰기가 달라 사람이 안 잡히는 일이 없고
 *   · 어디에 적히든 이름 모양이 한결같다.
 *
 * 이름을 적는 두 가지 모양 — 여기 한 곳에서 정한다.
 *   한 사람 칸  : '강명우 목사'      (이름 + 직분)
 *   여러 사람 칸: '강명우, 이동진'   (이름만, 쉼표로 나눔)
 * 뒤에서 사람을 찾을 때는 첫 낱말(이름)만 견주므로 두 모양 모두 통한다.
 *
 * 쓰는 법
 *   SHSNames.attach(칸, { style: 'withPos' })      한 사람
 *   SHSNames.attach(칸, { multi: true })           여러 사람 (쉼표)
 *
 * 다루는 법
 *   글자를 적으면 아래에 후보가 뜬다. ↑↓로 옮기고 Enter 또는 눌러서 확정한다.
 *   Esc 를 누르면 닫힌다. 명단에 없는 이름도 그냥 적어 둘 수 있다.
 */
var SHSNames = (function () {
  'use strict';

  var rows = null;      /* 노회 명단. 한 번 불러오면 담아 둔다 */
  var loading = null;

  function esc(s) { return SHS.esc(s); }

  /* ---------- 이름 모양 ---------- */
  function plain(r)   { return String(r.name || '').trim(); }
  function withPos(r) {
    var p = String(r.position || '').trim();
    return (plain(r) + (p ? ' ' + p : '')).trim();
  }
  function full(r) {
    var c = String(r.church || '').trim();
    return withPos(r) + (c ? '(' + c + ')' : '');
  }
  var STYLES = { plain: plain, withPos: withPos, full: full };

  function format(r, style) { return (STYLES[style] || withPos)(r); }

  /* 적혀 있는 값에서 이름만 떼어 낸다. '강명우 목사(반석교회)' → '강명우' */
  function nameOf(s) {
    return String(s || '').trim().split(/[\s(]/)[0];
  }

  /* ---------- 노회 명단 불러오기 ---------- */
  function ready() {
    if (rows) return Promise.resolve(rows);
    if (loading) return loading;
    if (!(window.SHSCloud && SHSCloud.enabled())) {
      rows = [];
      return Promise.resolve(rows);
    }
    loading = SHSCloud.init().then(function (c) {
      return c.from('roster').select('id,name,church,position,category,sichal,church_addr,address,postcode,birth_date,phone')
              .order('category').order('sort').order('id');
    }).then(function (r) {
      rows = (r && r.data) || [];
      return rows;
    }).catch(function () { rows = []; return rows; });
    return loading;
  }

  /* 이름 하나로 명단에서 찾기 (다른 화면에서도 쓴다) */
  function find(name) {
    var n = nameOf(name);
    return (rows || []).filter(function (r) { return r.name === n; })[0] || null;
  }

  /* ---------- 후보 고르기 ----------
   * 적힌 그대로('이재용 목사')도 찾아야 한다. 칸에 이미 이름이 들어 있는
   * 채로 눌렀을 때 후보가 하나도 안 뜨면 명부와 이어져 있지 않은 것처럼
   * 보이기 때문이다. 그래도 못 찾으면 이름만 떼어 다시 찾는다. */
  function hay(r) {
    return [r.name, r.position, r.church].filter(Boolean).join(' ');
  }
  function match(q) {
    var s = String(q || '').trim();
    if (!s) return (rows || []).slice(0, 20);
    var hit = (rows || []).filter(function (r) { return hay(r).indexOf(s) !== -1; });
    if (!hit.length) {
      var n = nameOf(s);
      if (n && n !== s) hit = (rows || []).filter(function (r) { return (r.name || '').indexOf(n) !== -1; });
    }
    return hit.slice(0, 20);
  }

  /* ---------- 명부와 맞추기 ----------
   * 적힌 이름을 명부에서 찾아 늘 같은 모양으로 고쳐 준다.
   * 명부에 없는 이름은 그대로 두고 알려만 준다. */
  function fix(value, opts) {
    opts = opts || {};
    var style = opts.style || (opts.multi ? 'plain' : 'withPos');
    var parts = opts.multi
      ? String(value || '').split(',')
      : [String(value || '')];
    var unknown = [];
    var out = parts.map(function (x) {
      var t = String(x || '').trim();
      if (!t) return '';
      var r = find(t);
      if (r) return format(r, style);
      unknown.push(nameOf(t));
      return t;
    }).filter(function (x) { return x; });
    return { value: out.join(opts.multi ? ', ' : ''), unknown: unknown };
  }

  /* ---------- 칸에 붙이기 ---------- */
  function attach(input, opts) {
    if (!input || input.dataset.npReady) return;
    input.dataset.npReady = '1';
    opts = opts || {};
    var multi = !!opts.multi;
    var style = opts.style || (multi ? 'plain' : 'withPos');

    input.setAttribute('autocomplete', 'off');
    if (!input.placeholder) {
      input.placeholder = multi
        ? '이름을 적어 찾은 뒤 고르세요 (여러 명은 쉼표로 나뉩니다)'
        : '이름을 적어 찾은 뒤 고르세요';
    }

    /* 칸을 감싸고 그 아래에 후보 상자를 둔다 */
    var wrap = document.createElement('span');
    wrap.className = 'np-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var box = document.createElement('div');
    box.className = 'np-box hidden';
    box.setAttribute('role', 'listbox');
    wrap.appendChild(box);

    /* 명부에 없는 이름을 적었을 때 알려 주는 자리 */
    var warn = document.createElement('div');
    warn.className = 'np-warn hidden';
    wrap.appendChild(warn);

    var list = [], active = -1;

    /* 적힌 이름을 명부와 맞춰 보고, 없는 이름이 있으면 알려 준다 */
    function verify() {
      if (!rows || !rows.length) { warn.classList.add('hidden'); return; }
      var r = fix(input.value, { multi: multi, style: style });
      if (r.value !== input.value) input.value = r.value;
      if (r.unknown.length) {
        warn.textContent = '회원 명부에 없는 이름입니다 — ' + r.unknown.join(', ');
        warn.classList.remove('hidden');
      } else {
        warn.classList.add('hidden');
      }
      input.classList.toggle('np-bad', !!r.unknown.length);
    }

    /* 여러 사람 칸에서는 마지막 쉼표 뒤가 지금 적는 부분이다 */
    function head() {
      if (!multi) return '';
      var v = input.value;
      var i = v.lastIndexOf(',');
      return i === -1 ? '' : v.slice(0, i + 1);
    }
    function token() {
      if (!multi) return input.value;
      var v = input.value;
      var i = v.lastIndexOf(',');
      return (i === -1 ? v : v.slice(i + 1)).trim();
    }

    function close() { box.classList.add('hidden'); active = -1; }

    function open() {
      list = match(token());
      if (!list.length) { close(); return; }
      box.innerHTML = list.map(function (r, i) {
        return '<div class="np-item' + (i === active ? ' on' : '') + '" data-np="' + i + '" role="option">' +
          '<span class="np-n">' + esc(r.name) + '</span>' +
          '<span class="np-p">' + esc(r.position || '') + '</span>' +
          '<span class="np-c">' + esc(r.church || '') + '</span>' +
          '</div>';
      }).join('');
      box.classList.remove('hidden');
    }

    function pick(i) {
      var r = list[i];
      if (!r) return;
      if (multi) {
        var h = head();
        input.value = (h ? h + ' ' : '') + plain(r) + ', ';
      } else {
        input.value = format(r, style);
      }
      close();
      input.focus();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (multi) open();
    }

    function move(d) {
      if (box.classList.contains('hidden')) { open(); return; }
      active = Math.max(0, Math.min(list.length - 1, active + d));
      box.querySelectorAll('.np-item').forEach(function (el, i) {
        el.classList.toggle('on', i === active);
      });
      var on = box.querySelector('.np-item.on');
      if (on) on.scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', function () { active = -1; open(); });
    input.addEventListener('focus', function () { ready().then(open); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); move(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(-1); }
      else if (ev.key === 'Escape') { close(); }
      else if (ev.key === 'Enter') {
        if (box.classList.contains('hidden') || !list.length) return;
        ev.preventDefault();
        pick(active === -1 ? 0 : active);
      }
    });
    box.addEventListener('mousedown', function (ev) {
      var it = ev.target.closest ? ev.target.closest('[data-np]') : null;
      if (!it) return;
      ev.preventDefault();          /* 칸에서 초점이 빠지지 않게 */
      pick(+it.dataset.np);
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        close();
        /* 여러 사람 칸은 끝에 남은 쉼표를 다듬는다 */
        if (multi) {
          input.value = input.value.split(',')
            .map(function (x) { return x.trim(); })
            .filter(function (x) { return x; })
            .join(', ');
        }
        verify();
      }, 120);
    });

    /* 처음 그릴 때 이미 적혀 있던 이름도 한 번 맞춰 본다 */
    ready().then(verify);
  }

  /* 한 화면에 있는 칸을 한꺼번에 붙인다.
   *   <input data-names>            한 사람 (이름 직분)
   *   <input data-names="multi">    여러 사람 (쉼표)
   *   <input data-names="plain">    한 사람 (이름만) */
  function attachAll(root) {
    ready().then(function () {
      (root || document).querySelectorAll('input[data-names]').forEach(function (el) {
        var v = el.getAttribute('data-names') || '';
        attach(el, v === 'multi' ? { multi: true }
                 : v === 'plain' ? { style: 'plain' }
                 : v === 'full'  ? { style: 'full' }
                 : {});
      });
    });
  }

  return {
    ready: ready,
    attach: attach,
    attachAll: attachAll,
    find: find,
    fix: fix,
    nameOf: nameOf,
    format: format,
    all: function () { return (rows || []).slice(); }
  };
})();

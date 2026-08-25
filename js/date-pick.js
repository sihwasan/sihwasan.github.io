/* 생년월일 고르기 — 손으로 적거나 굴려서 고른다
 *
 * <input type="date"> 는 휴대전화에서 달력이 뜹니다. 1955년처럼 오래된 해를
 * 고르려면 달을 수십 번 넘겨야 하고, 손으로 적기도 마땅치 않습니다.
 * 그래서 이 모듈은 그 칸을 두 가지 방법으로 바꿔 놓습니다.
 *
 *   1) 손으로 적기 — 1955-03-21 처럼 그냥 적으면 됩니다.
 *      19550321 · 1955.3.21 · 1955/3/21 로 적으셔도 알아서 맞춰 줍니다.
 *   2) 굴려서 고르기 — 연 · 월 · 일 세 칸을 둡니다.
 *      휴대전화에서는 이 칸이 룰렛처럼 돌아가므로 연도를 단번에 찾습니다.
 *
 * 두 가지는 늘 같은 값을 가리킵니다. 한쪽을 바꾸면 다른 쪽도 따라옵니다.
 *
 * 쓰는 법
 *   SHSDate.attach(칸)              한 칸에 붙인다
 *   SHSDate.attachAll(범위)         data-birth 가 붙은 칸에 한꺼번에 붙인다
 *   SHSDate.get(칸)                 제대로 된 날짜(YYYY-MM-DD) 또는 빈 문자열
 *   SHSDate.ok(칸)                  비어 있거나 제대로 된 날짜면 참
 */
var SHSDate = (function () {
  'use strict';

  var MIN_YEAR = 1900;

  function esc(s) { return (window.SHS && SHS.esc) ? SHS.esc(s) : String(s == null ? '' : s); }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* 그 달이 며칠까지 있는가 (윤년까지 본다) */
  function daysIn(y, m) {
    if (!y || !m) return 31;
    return new Date(y, m, 0).getDate();
  }

  /* 적힌 것을 YYYY-MM-DD 로 다듬는다. 알아볼 수 없으면 빈 문자열. */
  function norm(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';

    var y, m, d;
    var m1 = s.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D*$/);   /* 1955-3-21, 1955.3.21 */
    var m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);                /* 19550321 */
    if (m1) { y = +m1[1]; m = +m1[2]; d = +m1[3]; }
    else if (m2) { y = +m2[1]; m = +m2[2]; d = +m2[3]; }
    else return '';

    if (y < MIN_YEAR || y > new Date().getFullYear()) return '';
    if (m < 1 || m > 12) return '';
    if (d < 1 || d > daysIn(y, m)) return '';
    return y + '-' + pad(m) + '-' + pad(d);
  }

  /* 숫자만 죽 적으실 때 - 를 알아서 끼워 넣는다.
   *   19550321 → 1955-03-21
   * 다만 1948.7.9 나 1955-3-21 처럼 손수 나누어 적으신 것은 건드리지 않는다.
   * 도중에 뜯어고치면 적기가 되레 어려워지므로, 칸을 떠날 때 한 번에 다듬는다. */
  function fmt(n) {
    if (n.length <= 4) return n;
    if (n.length <= 6) return n.slice(0, 4) + '-' + n.slice(4);
    return n.slice(0, 4) + '-' + n.slice(4, 6) + '-' + n.slice(6);
  }
  function live(raw) {
    var s = String(raw || '');
    if (!/^[\d-]*$/.test(s)) return s;                 /* . / 등을 쓰셨다 */
    if ((s.match(/-/g) || []).length >= 2) return s;   /* 이미 손수 나누어 적으셨다 */
    return fmt(s.replace(/\D/g, '').slice(0, 8));
  }

  function opts(from, to, unit, sel, down) {
    var out = ['<option value="">' + unit + '</option>'], i;
    if (down) { for (i = from; i >= to; i--) out.push(one(i)); }
    else { for (i = from; i <= to; i++) out.push(one(i)); }
    function one(v) {
      return '<option value="' + v + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' +
        v + unit + '</option>';
    }
    return out.join('');
  }

  function attach(input) {
    if (!input || input.dataset.dpReady) return;
    input.dataset.dpReady = '1';

    var start = norm(input.value);
    var thisYear = new Date().getFullYear();

    /* 달력 대신 손으로 적는 칸으로 바꾼다 */
    input.type = 'text';
    input.value = start;
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'bday');
    input.setAttribute('maxlength', '10');
    if (!input.placeholder) input.placeholder = '1955-03-21';

    var wrap = document.createElement('div');
    wrap.className = 'dp-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var rows = document.createElement('div');
    rows.className = 'dp-rows';
    var p = start ? start.split('-') : ['', '', ''];
    rows.innerHTML =
      '<select class="dp-y" aria-label="태어난 해">' +
      opts(thisYear, MIN_YEAR, '년', p[0] ? +p[0] : '', true) + '</select>' +
      '<select class="dp-m" aria-label="태어난 달">' +
      opts(1, 12, '월', p[1] ? +p[1] : '') + '</select>' +
      '<select class="dp-d" aria-label="태어난 날">' +
      opts(1, 31, '일', p[2] ? +p[2] : '') + '</select>';
    wrap.appendChild(rows);

    var hint = document.createElement('div');
    hint.className = 'dp-hint hidden';
    wrap.appendChild(hint);

    var ys = rows.querySelector('.dp-y');
    var ms = rows.querySelector('.dp-m');
    var ds = rows.querySelector('.dp-d');

    /* 2월 30일 같은 날이 남지 않도록 날 칸을 그 달에 맞춘다 */
    function trimDays() {
      var max = daysIn(+ys.value, +ms.value);
      var keep = ds.value;
      ds.innerHTML = opts(1, max, '일', keep && +keep <= max ? +keep : '');
    }

    function fromWheels() {
      trimDays();
      if (ys.value && ms.value && ds.value) {
        input.value = ys.value + '-' + pad(+ms.value) + '-' + pad(+ds.value);
      } else {
        input.value = '';
      }
      say();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function toWheels() {
      var v = norm(input.value);
      if (!v) return;
      var q = v.split('-');
      ys.value = String(+q[0]);
      ms.value = String(+q[1]);
      trimDays();
      ds.value = String(+q[2]);
    }

    /* 알아들을 수 없게 적혀 있으면 알려 준다 */
    function say(typing) {
      var raw = input.value.trim();
      /* 적는 도중에는 아직 모자란 것일 뿐이므로 채근하지 않는다 */
      var bad = !!raw && !norm(raw) && !(typing && raw.replace(/\D/g, '').length < 8);
      input.classList.toggle('dp-bad', bad);
      hint.classList.toggle('hidden', !bad);
      if (bad) hint.textContent = '날짜를 알아볼 수 없습니다. 1955-03-21 처럼 적어 주세요.';
    }

    input.addEventListener('input', function () {
      var was = input.value;
      var at = input.selectionStart === was.length;
      var now = live(was);
      if (now !== was) {
        input.value = now;
        if (at) { try { input.setSelectionRange(now.length, now.length); } catch (x) {} }
      }
      if (norm(input.value)) toWheels();
      say(true);
    });
    input.addEventListener('blur', function () {
      var v = norm(input.value);
      if (v) { input.value = v; toWheels(); }
      say();
    });
    [ys, ms, ds].forEach(function (el) { el.addEventListener('change', fromWheels); });

    say();
  }

  function attachAll(root) {
    (root || document).querySelectorAll('input[data-birth]').forEach(attach);
  }

  function get(input) { return input ? norm(input.value) : ''; }
  function ok(input) {
    if (!input) return false;
    var raw = String(input.value || '').trim();
    return !raw || !!norm(raw);
  }

  return { attach: attach, attachAll: attachAll, get: get, ok: ok, norm: norm };
})();

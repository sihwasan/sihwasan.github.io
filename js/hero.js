/* 시화산노회 메인 히어로 인터랙티브 배경
 *
 * 시흥·화성·안산 세 지역을 별자리처럼 잇고, 그 둘레에 교회 불빛 입자들이
 * 서로 연결된다 — "건물마다 서로 연결하여 주 안에서 성전이 되어 가고"(엡 2:21).
 * 하단의 잔잔한 물결은 세 지역이 함께 품은 서해와 시화호를 나타낸다.
 *
 * 외부 라이브러리 없이 캔버스만 사용한다.
 * 관리자가 사이트 관리에서 배경 사진을 지정하면(.hero.has-image)
 * 스스로 멈추고 기존 사진 히어로로 돌아간다.
 */
(function () {
  'use strict';

  var canvas = document.getElementById('hero-canvas');
  if (!canvas || !canvas.getContext) return;
  var hero = canvas.closest ? canvas.closest('.hero') : document.querySelector('.hero');
  if (!hero) return;
  var ctx = canvas.getContext('2d');
  var note = document.getElementById('hero-cities-note');
  var chips = [].slice.call(document.querySelectorAll('.city-chip'));

  var GOLD = '217,185,106';
  var GOLD_BRIGHT = '244,216,148';
  var BLUE = '150,182,232';

  /* 세 도시 — 실제 지리(시흥 북쪽, 안산 서남쪽, 화성 남쪽)를 본뜬 배치.
   * 글 오른쪽에 여백이 넉넉하면 그 안에 세로 삼각형으로(side),
   * 여백이 모자라면 글 아래 확보해 둔 띠 안에 낮은 삼각형으로(band) 놓는다.
   * tx: side일 때 삼각형 폭 안에서의 가로 비율, fy: 세로 비율.
   * bx: band일 때 가운데 기준 가로 비율, sby: 바닥에서 올라온 픽셀 거리. */
  var CITIES = [
    { key: 'si',  name: '시흥', syl: '시', tx: 0.55, fy: 0.225, bx: -0.22, sby: 96, phase: 0.0, s: 1 },
    { key: 'san', name: '안산', syl: '산', tx: 0.00, fy: 0.505, bx:  0.00, sby: 46, phase: 4.2, s: 1 },
    { key: 'hwa', name: '화성', syl: '화', tx: 1.00, fy: 0.740, bx:  0.26, sby: 74, phase: 2.1, s: 1 }
  ];
  var EDGES = [[0, 1], [1, 2], [2, 0]];

  var NOTES = {
    def: '세 지역이 모여 한 이름, ‘시화산’을 이룹니다',
    si:  '시화산의 ‘시’ — 시흥의 교회들',
    hwa: '시화산의 ‘화’ — 화성의 교회들',
    san: '시화산의 ‘산’ — 안산의 교회들'
  };

  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var w = 0, h = 0, dpr = 1, small = false, nodeR = 22;
  var band = false, sideXS = 0, sideTW = 0;
  var cont = hero.querySelector('.container');
  var parts = [], sparks = [];
  var mouse = { x: -9999, y: -9999, on: false };
  var par = { x: 0, y: 0 };            /* 패럴랙스(부드럽게 따라오는 값) */
  var canvasHover = null, chipHover = null, pinned = null;
  var rafId = null, visible = true;

  function activeKey() { return chipHover || canvasHover || pinned; }

  /* ---------- 크기 · 입자 ---------- */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = hero.clientWidth; h = hero.clientHeight;
    small = w < 900; /* style.css의 모바일 분기(max-width: 900px)와 같게 */

    /* 글 상자(.container)는 내용 폭만큼 줄어 가운데 정렬된다.
     * 그 오른쪽에 남는 자리가 210px보다 좁으면 띠(band) 배치로 바꾼다. */
    band = small;
    if (!band && cont) {
      var hr = hero.getBoundingClientRect();
      var cRight = cont.getBoundingClientRect().right - hr.left;
      var zw = w - 50 - (cRight + 24);
      if (zw < 210) {
        band = true;
      } else {
        sideTW = Math.min(300, zw);
        sideXS = cRight + 24 + (zw - sideTW) / 2;
      }
    }
    /* 띠 배치일 때는 글 아래 공간을 넓혀 별자리 자리를 만든다
     * (900px 이하는 style.css가 이미 같은 값을 준다) */
    if (cont) {
      var pb = band ? '148px' : '';
      if (cont.style.paddingBottom !== pb) cont.style.paddingBottom = pb;
      h = hero.clientHeight;
    }

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    nodeR = band
      ? Math.max(14, Math.min(18, w * 0.022))
      : Math.max(19, Math.min(30, w * 0.022));
  }

  function seed() {
    var n = Math.max(26, Math.min(70, Math.round(w * h / 15000)));
    parts = [];
    for (var i = 0; i < n; i++) {
      parts.push({
        fx: Math.random(), fy: 0.04 + Math.random() * 0.88,
        r: 0.8 + Math.random() * 1.5,
        ax: 5 + Math.random() * 14, ay: 4 + Math.random() * 10,
        sa: 0.10 + Math.random() * 0.25, sb: 0.08 + Math.random() * 0.22,
        pa: Math.random() * 6.283, pb: Math.random() * 6.283,
        tw: Math.random() * 6.283,
        x: 0, y: 0
      });
    }
  }

  function cityXY(c, t) {
    if (band) {
      return {
        x: w * 0.5 + c.bx * Math.min(w, 640) + par.x * 1.6,
        y: h - c.sby + Math.sin(t * 0.45 + c.phase) * 2.5 + par.y * 1.6
      };
    }
    return {
      x: sideXS + c.tx * sideTW + par.x * 1.6,
      y: c.fy * h + Math.sin(t * 0.45 + c.phase) * 3.5 + par.y * 1.6
    };
  }

  /* ---------- 그리기 ---------- */
  function drawWaves(t) {
    wave(h - 24, 7, w / 2.6, 0.5, 'rgba(26, 54, 102, 0.55)', t);
    wave(h - 12, 9, w / 3.4, -0.34, 'rgba(58, 108, 156, 0.25)', t);
  }
  function wave(baseY, amp, wl, speed, color, t) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (var x = 0; x <= w + 8; x += 8) {
      ctx.lineTo(x, baseY + Math.sin((x / wl) * 6.283 + t * speed) * amp);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function render(t) {
    ctx.clearRect(0, 0, w, h);

    /* 패럴랙스 목표점을 향해 서서히 이동 */
    var tx = mouse.on && !reduced ? (mouse.x - w / 2) * -0.014 : 0;
    var ty = mouse.on && !reduced ? (mouse.y - h / 2) * -0.014 : 0;
    par.x += (tx - par.x) * 0.05;
    par.y += (ty - par.y) * 0.05;

    drawWaves(t);

    var act = activeKey();
    var pos = [], i, j, c, p;
    for (i = 0; i < CITIES.length; i++) pos.push(cityXY(CITIES[i], t));
    var actPos = null;
    for (i = 0; i < CITIES.length; i++) if (CITIES[i].key === act) actPos = pos[i];

    /* 입자 위치 계산 — 고향 자리 주변을 떠다니다 마우스·선택 도시 쪽으로 쏠린다 */
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      var px = p.fx * w + Math.sin(t * p.sa + p.pa) * p.ax + par.x;
      var py = p.fy * h + Math.cos(t * p.sb + p.pb) * p.ay + par.y;
      if (mouse.on) {
        var dxm = mouse.x - px, dym = mouse.y - py;
        var dm = Math.sqrt(dxm * dxm + dym * dym);
        if (dm < 170 && dm > 0.001) {
          var f = (1 - dm / 170) * 16;
          px += dxm / dm * f; py += dym / dm * f;
        }
      }
      if (actPos) {
        var dxa = actPos.x - px, dya = actPos.y - py;
        var da = Math.sqrt(dxa * dxa + dya * dya);
        if (da < 240 && da > 0.001) {
          var fa = (1 - da / 240) * 26;
          px += dxa / da * fa; py += dya / da * fa;
        }
      }
      p.x = px; p.y = py;
    }

    /* 입자끼리 잇는 선 */
    ctx.lineWidth = 1;
    for (i = 0; i < parts.length; i++) {
      for (j = i + 1; j < parts.length; j++) {
        var dx = parts[i].x - parts[j].x, dy = parts[i].y - parts[j].y;
        var d2 = dx * dx + dy * dy;
        if (d2 < 9025) { /* 95px */
          var a = (1 - Math.sqrt(d2) / 95) * 0.14;
          ctx.strokeStyle = 'rgba(' + BLUE + ',' + a.toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(parts[i].x, parts[i].y);
          ctx.lineTo(parts[j].x, parts[j].y);
          ctx.stroke();
        }
      }
    }

    /* 마우스와 잇는 선 */
    if (mouse.on) {
      for (i = 0; i < parts.length; i++) {
        var mdx = parts[i].x - mouse.x, mdy = parts[i].y - mouse.y;
        var md = Math.sqrt(mdx * mdx + mdy * mdy);
        if (md < 150) {
          ctx.strokeStyle = 'rgba(' + BLUE + ',' + ((1 - md / 150) * 0.3).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(parts[i].x, parts[i].y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }
    }

    /* 선택된 도시로 모여드는 금색 선 */
    if (actPos) {
      for (i = 0; i < parts.length; i++) {
        var adx = parts[i].x - actPos.x, ady = parts[i].y - actPos.y;
        var ad = Math.sqrt(adx * adx + ady * ady);
        if (ad < 240) {
          ctx.strokeStyle = 'rgba(' + GOLD + ',' + ((1 - ad / 240) * 0.22).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(parts[i].x, parts[i].y);
          ctx.lineTo(actPos.x, actPos.y);
          ctx.stroke();
        }
      }
    }

    /* 입자(교회 불빛) */
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      var tw = reduced ? 0.55 : 0.42 + 0.28 * Math.sin(t * 1.2 + p.tw);
      ctx.fillStyle = 'rgba(226,235,250,' + tw.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.fill();
    }

    /* 세 도시를 잇는 선(넓은 은은한 빛 + 본선) */
    for (i = 0; i < EDGES.length; i++) {
      var A = pos[EDGES[i][0]], B = pos[EDGES[i][1]];
      var hot = act && (CITIES[EDGES[i][0]].key === act || CITIES[EDGES[i][1]].key === act);
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(' + GOLD + ',' + (hot ? 0.10 : 0.05) + ')';
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      ctx.lineWidth = hot ? 1.4 : 1;
      ctx.strokeStyle = 'rgba(' + GOLD + ',' + (hot ? 0.55 : 0.26) + ')';
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();

      /* 선을 따라 오가는 빛 — 교제와 연결 */
      if (!reduced) {
        var pp = (t * 0.055 + i * 0.37) % 1;
        var lx = A.x + (B.x - A.x) * pp, ly = A.y + (B.y - A.y) * pp;
        var lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 7);
        lg.addColorStop(0, 'rgba(' + GOLD_BRIGHT + ',0.85)');
        lg.addColorStop(1, 'rgba(' + GOLD_BRIGHT + ',0)');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(lx, ly, 7, 0, 6.283); ctx.fill();
      }
    }

    /* 도시 노드 */
    for (i = 0; i < CITIES.length; i++) {
      c = CITIES[i];
      var P = pos[i];
      var on = act === c.key;
      var target = on ? 1.26 : 1;
      c.s += (target - c.s) * (reduced ? 1 : 0.1);
      var r = nodeR * c.s;

      /* 둘레 빛무리 */
      var g = ctx.createRadialGradient(P.x, P.y, r * 0.4, P.x, P.y, r * 3);
      g.addColorStop(0, on ? 'rgba(' + GOLD + ',0.30)' : 'rgba(96,132,196,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(P.x, P.y, r * 3, 0, 6.283); ctx.fill();

      /* 선택 시 퍼져 나가는 물결 고리 */
      if (on && !reduced) {
        var ph = (t * 0.55 + i * 0.3) % 1;
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(' + GOLD_BRIGHT + ',' + ((1 - ph) * 0.45).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(P.x, P.y, r * (1.15 + ph * 1.2), 0, 6.283); ctx.stroke();
      }

      /* 본체 */
      ctx.fillStyle = on ? 'rgba(20,40,74,0.88)' : 'rgba(13,30,58,0.72)';
      ctx.beginPath(); ctx.arc(P.x, P.y, r, 0, 6.283); ctx.fill();
      ctx.lineWidth = on ? 1.6 : 1;
      ctx.strokeStyle = on ? 'rgba(' + GOLD_BRIGHT + ',0.95)' : 'rgba(' + GOLD + ',0.55)';
      ctx.beginPath(); ctx.arc(P.x, P.y, r, 0, 6.283); ctx.stroke();

      /* 이름 한 글자(시·화·산) */
      ctx.font = '600 ' + Math.round(r * 0.95) + 'px "Noto Serif KR", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = on ? 'rgba(' + GOLD_BRIGHT + ',1)' : 'rgba(' + GOLD + ',0.9)';
      ctx.fillText(c.syl, P.x, P.y + r * 0.06);

      /* 도시 이름 — 띠 배치에서는 아래가 좁아 옆에 붙인다 */
      ctx.font = '500 ' + (band ? 11 : 13) + 'px "Noto Sans KR", sans-serif';
      ctx.fillStyle = on ? '#ffffff' : 'rgba(205,218,240,0.85)';
      if (band) {
        ctx.textAlign = 'left';
        ctx.fillText(c.name, P.x + r + 7, P.y);
        ctx.textAlign = 'center';
      } else {
        ctx.fillText(c.name, P.x, P.y + r + 16);
      }
    }

    /* 클릭 시 흩어지는 불꽃 */
    for (i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i];
      s.x += s.vx; s.y += s.vy; s.vy += 0.02; s.life -= 0.022;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.fillStyle = 'rgba(' + GOLD_BRIGHT + ',' + s.life.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.6, 0, 6.283); ctx.fill();
    }
  }

  /* ---------- 상태 · UI 동기화 ---------- */
  function syncUI() {
    var k = activeKey();
    if (note) {
      note.textContent = NOTES[k] || NOTES.def;
      note.classList.toggle('on', !!k);
    }
    chips.forEach(function (b) {
      var key = b.getAttribute('data-city');
      b.classList.toggle('on', key === k);
      b.setAttribute('aria-pressed', key === pinned ? 'true' : 'false');
    });
    if (reduced) renderOnce();
  }

  function pick(x, y, t) {
    for (var i = 0; i < CITIES.length; i++) {
      var P = cityXY(CITIES[i], t);
      var dx = x - P.x, dy = y - P.y;
      var lim = nodeR * CITIES[i].s + 16;
      if (dx * dx + dy * dy < lim * lim) return CITIES[i].key;
    }
    return null;
  }

  function burst(x, y) {
    for (var i = 0; i < 16; i++) {
      var a = Math.random() * 6.283, v = 0.7 + Math.random() * 1.9;
      sparks.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1 });
    }
  }

  /* ---------- 애니메이션 루프 ---------- */
  function tick(now) {
    rafId = null;
    if (hero.classList.contains('has-image')) return; /* 관리자 사진 모드 */
    if (!visible || document.hidden) return;
    render(now / 1000);
    rafId = requestAnimationFrame(tick);
  }
  function kick() {
    if (!reduced && rafId === null) rafId = requestAnimationFrame(tick);
  }
  function renderOnce() { render(3); }

  /* ---------- 이벤트 ---------- */
  hero.addEventListener('mousemove', function (e) {
    var rc = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rc.left;
    mouse.y = e.clientY - rc.top;
    mouse.on = true;
    var k = pick(mouse.x, mouse.y, performance.now() / 1000);
    if (k !== canvasHover) { canvasHover = k; syncUI(); }
    hero.style.cursor = k ? 'pointer' : '';
    kick();
  });
  hero.addEventListener('mouseleave', function () {
    mouse.on = false; mouse.x = -9999; mouse.y = -9999;
    if (canvasHover) { canvasHover = null; syncUI(); }
    hero.style.cursor = '';
  });
  /* 터치 화면: 손가락을 따라 불빛이 모인다(스크롤은 막지 않는다) */
  hero.addEventListener('touchmove', function (e) {
    if (!e.touches || !e.touches.length) return;
    var rc = canvas.getBoundingClientRect();
    mouse.x = e.touches[0].clientX - rc.left;
    mouse.y = e.touches[0].clientY - rc.top;
    mouse.on = true;
    kick();
  }, { passive: true });
  hero.addEventListener('touchend', function () {
    mouse.on = false; mouse.x = -9999; mouse.y = -9999;
  });
  hero.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.city-chip')) return;
    var rc = canvas.getBoundingClientRect();
    var x = e.clientX - rc.left, y = e.clientY - rc.top;
    var k = pick(x, y, performance.now() / 1000);
    if (k) {
      pinned = pinned === k ? null : k;
      if (!reduced) burst(x, y);
    } else if (pinned) {
      pinned = null;
    } else {
      return;
    }
    syncUI();
  });

  chips.forEach(function (b) {
    var key = b.getAttribute('data-city');
    b.addEventListener('mouseenter', function () { chipHover = key; syncUI(); });
    b.addEventListener('mouseleave', function () { chipHover = null; syncUI(); });
    b.addEventListener('focus', function () { chipHover = key; syncUI(); });
    b.addEventListener('blur', function () { chipHover = null; syncUI(); });
    b.addEventListener('click', function () {
      pinned = pinned === key ? null : key;
      syncUI();
      kick();
    });
  });

  var rsTimer = null;
  function onResize() {
    clearTimeout(rsTimer);
    rsTimer = setTimeout(function () {
      if (hero.clientWidth === w && hero.clientHeight === h) return;
      resize(); seed();
      if (reduced) renderOnce(); else kick();
    }, 120);
  }
  window.addEventListener('resize', onResize);
  if ('ResizeObserver' in window) {
    new ResizeObserver(onResize).observe(hero);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) kick();
    }).observe(hero);
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) kick();
  });

  /* ---------- 시작 ---------- */
  resize();
  seed();
  syncUI();
  renderOnce(); /* 애니메이션 프레임을 기다리지 않고 첫 장면을 바로 그린다 */
  if (document.fonts && document.fonts.ready) {
    /* 본문 폰트가 늦게 로드되면 글 상자 폭이 변하므로 자리를 다시 잡고 그린다 */
    document.fonts.ready.then(function () { resize(); renderOnce(); });
  }
  kick();
})();

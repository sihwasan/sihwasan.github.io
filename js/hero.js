/* 시화산노회 메인 히어로 인터랙티브 배경
 *
 * 한반도 지도 위 경기만의 시흥·안산·화성 자리에서 하나의 원이 열리고,
 * 세 도시가 원둘레를 따라 돌다가 마우스를 얹으면 가운데로 모여
 * '시화산' 하나가 된다 — "그의 안에서 건물마다 서로 연결하여
 * 주 안에서 성전이 되어 가고"(엡 2:21).
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
  var cont = hero.querySelector('.container');

  /* 차분한 팔레트: 아이보리 헤어라인 + 쿨 블루 */
  var IVORY = '236,229,212';
  var COOL  = '158,180,216';
  var TEXT  = '224,232,244';

  /* 세 도시 — 원둘레 위의 자리(시흥 북, 화성 동남, 안산 서남) */
  var TAU = Math.PI * 2;
  var CITIES = [
    { key: 'si',  name: '시흥', syl: '시', ang: -TAU / 4,           s: 1 },
    { key: 'hwa', name: '화성', syl: '화', ang: -TAU / 4 + TAU / 3, s: 1 },
    { key: 'san', name: '안산', syl: '산', ang: -TAU / 4 + TAU * 2 / 3, s: 1 }
  ];

  var NOTES = {
    def: '세 지역이 모여 한 이름, ‘시화산’을 이룹니다',
    si:  '시화산의 ‘시’ — 시흥의 교회들',
    hwa: '시화산의 ‘화’ — 화성의 교회들',
    san: '시화산의 ‘산’ — 안산의 교회들',
    one: '시흥 · 화성 · 안산, 주 안에서 하나 — 시화산노회'
  };

  /* 남한 해안선(경도, 위도) — 서해안 굴곡·태안·호미곶·남해안이 살아 있는 윤곽 */
  var KOREA = [
    [126.77, 37.70], [126.52, 37.55], [126.62, 37.35], [126.45, 37.25],
    [126.62, 37.05], [126.42, 36.98], [126.13, 36.75], [126.30, 36.62],
    [126.20, 36.32], [126.55, 36.05], [126.42, 35.78], [126.60, 35.58],
    [126.25, 35.25], [126.20, 34.95], [126.30, 34.78], [126.12, 34.55],
    [126.35, 34.35], [126.65, 34.28], [126.95, 34.35], [127.30, 34.42],
    [127.52, 34.60], [127.70, 34.48], [127.90, 34.72], [128.05, 34.62],
    [128.38, 34.78], [128.52, 34.62], [128.75, 34.85], [128.85, 35.05],
    [129.05, 35.08], [129.25, 35.32], [129.36, 35.70], [129.42, 35.95],
    [129.57, 36.05], [129.38, 36.12], [129.42, 36.45], [129.45, 36.80],
    [129.36, 37.10], [129.20, 37.44], [128.95, 37.70], [128.75, 37.95],
    [128.60, 38.20], [128.37, 38.61], [128.10, 38.33], [127.50, 38.32],
    [127.10, 38.34], [126.88, 38.00]
  ];
  var LON0 = 125.90, LONW = 3.80, LAT0 = 38.75, LATH = 5.65;
  var ASPECT = 0.545; /* 경도 3.8° x cos(36°) 대 위도 5.65°(제주 포함) */
  var REGION = [126.80, 37.30]; /* 시흥·안산·화성 권역(경기만) */
  var JEJU = { lon: 126.53, lat: 33.38, rx: 0.36, ry: 0.14 };

  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var w = 0, h = 0, dpr = 1, small = false, band = false;
  var ring = { x: 0, y: 0, r: 90 };
  var nodeR = 17;
  var map = { on: false, x: 0, y: 0, w: 0, h: 0 };
  var parts = [], sparks = [];
  var mouse = { x: -9999, y: -9999, on: false };
  var par = { x: 0, y: 0 };
  var canvasHover = null, chipHover = null, pinned = null;
  var merge = 0, mergePin = false, mergeShown = false;
  var rafId = null, visible = true;

  function activeKey() { return chipHover || canvasHover || pinned; }

  function geo(lon, lat) {
    return {
      x: map.x + (lon - LON0) / LONW * map.w,
      y: map.y + (LAT0 - lat) / LATH * map.h
    };
  }

  /* ---------- 크기 · 배치 ---------- */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = hero.clientWidth; h = hero.clientHeight;
    small = w < 900; /* style.css의 모바일 분기(max-width: 900px)와 같게 */

    /* 글 상자(.container)는 내용 폭만큼 줄어 가운데 정렬된다.
     * 오른쪽 남는 자리가 좁으면 글 아래 띠(band)로 내려간다. */
    band = small;
    var zoneLeft = 0, zw = 0;
    if (!band && cont) {
      var hr = hero.getBoundingClientRect();
      var cRight = cont.getBoundingClientRect().right - hr.left;
      zoneLeft = cRight + 24;
      zw = w - 50 - zoneLeft;
      if (zw < 210) band = true;
    }
    /* 띠 배치일 때는 글 아래 공간을 넓혀 원이 들어갈 자리를 만든다
     * (900px 이하는 style.css가 이미 같은 값을 준다) */
    if (cont) {
      var pb = band ? '212px' : '';
      if (cont.style.paddingBottom !== pb) cont.style.paddingBottom = pb;
      h = hero.clientHeight;
    }

    if (band) {
      ring.r = 56; nodeR = 12; ring.y = h - 112;
      if (w >= 560) {
        /* 태블릿: 원 옆에 작은 지도를 함께 보여 준다 */
        map.h = Math.min(190, h * 0.32); map.w = map.h * ASPECT;
        map.x = w - 26 - map.w; map.y = h - 26 - map.h; map.on = true;
        ring.x = (w - map.w - 26) * 0.5;
      } else {
        map.on = false; ring.x = w * 0.5;
      }
    } else {
      /* 지도를 오른쪽에 크게 깔고, 원은 지도 위 경기만(시화산 권역)에 얹는다 */
      map.h = Math.min(h * 0.88, 420);
      map.w = map.h * ASPECT;
      var availW = w - 30 - (zoneLeft - 20);
      if (map.w > availW) { map.w = availW; map.h = map.w / ASPECT; }
      map.x = w - 30 - map.w;
      map.y = (h - map.h) / 2 - 6;
      map.on = map.w > 100;
      var rp = geo(REGION[0], REGION[1]);
      ring.r = Math.max(52, Math.min(76, zw * 0.22 + 14));
      ring.x = Math.max(rp.x, zoneLeft - 14 + ring.r);
      ring.y = Math.min(Math.max(rp.y, ring.r + 14), h - 44 - ring.r);
      nodeR = Math.max(13, Math.min(17, ring.r * 0.20));
    }

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed() {
    var n = Math.max(20, Math.min(46, Math.round(w * h / 24000)));
    parts = [];
    for (var i = 0; i < n; i++) {
      parts.push({
        fx: Math.random(), fy: 0.04 + Math.random() * 0.88,
        r: 0.6 + Math.random() * 1.2,
        ax: 5 + Math.random() * 12, ay: 4 + Math.random() * 9,
        sa: 0.08 + Math.random() * 0.20, sb: 0.07 + Math.random() * 0.18,
        pa: Math.random() * TAU, pb: Math.random() * TAU,
        tw: Math.random() * TAU,
        x: 0, y: 0
      });
    }
  }

  function nodeXY(c, t, m) {
    var rot = reduced ? 0 : t * 0.05;
    var a = c.ang + rot;
    var rr = ring.r * (1 - 0.88 * m);
    return {
      x: ring.x + Math.cos(a) * rr + par.x,
      y: ring.y + Math.sin(a) * rr + par.y,
      a: a
    };
  }

  /* ---------- 그리기 ---------- */
  function wave(baseY, amp, wl, speed, color, t) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (var x = 0; x <= w + 8; x += 8) {
      ctx.lineTo(x, baseY + Math.sin((x / wl) * TAU + t * speed) * amp);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawMap(t) {
    var i, p;
    ctx.save();
    ctx.translate(par.x, par.y);

    /* 해안선 — 점들을 곡선으로 이어 부드럽게 */
    var pts = [];
    for (i = 0; i < KOREA.length; i++) pts.push(geo(KOREA[i][0], KOREA[i][1]));
    var n = pts.length;
    ctx.beginPath();
    ctx.moveTo((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
    for (i = 1; i <= n; i++) {
      var p1 = pts[i % n], p2 = pts[(i + 1) % n];
      ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(120,150,200,0.055)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(' + COOL + ',0.34)';
    ctx.stroke();

    /* 제주 */
    var j = geo(JEJU.lon, JEJU.lat);
    ctx.beginPath();
    ctx.ellipse(j.x, j.y, JEJU.rx / LONW * map.w, JEJU.ry / LATH * map.h, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(' + COOL + ',0.25)';
    ctx.stroke();

    /* 시화산 권역 표식 + 퍼지는 고리 */
    var rp = geo(REGION[0], REGION[1]);
    if (!reduced) {
      var ph = (t * 0.35) % 1;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, 4 + ph * 14, 0, TAU);
      ctx.strokeStyle = 'rgba(' + IVORY + ',' + ((1 - ph) * 0.35).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(rp.x, rp.y, 2.6, 0, TAU);
    ctx.fillStyle = 'rgba(' + IVORY + ',0.9)';
    ctx.fill();

    /* 권역과 원을 잇는 가는 선 */
    var dx = rp.x - ring.x, dy = rp.y - ring.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > ring.r + 12) {
      var ex = ring.x + dx / d * (ring.r + 6);
      var ey = ring.y + dy / d * (ring.r + 6);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(rp.x - dx / d * 8, rp.y - dy / d * 8);
      ctx.strokeStyle = 'rgba(' + COOL + ',0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function render(t) {
    ctx.clearRect(0, 0, w, h);

    var tx = mouse.on && !reduced ? (mouse.x - w / 2) * -0.010 : 0;
    var ty = mouse.on && !reduced ? (mouse.y - h / 2) * -0.010 : 0;
    par.x += (tx - par.x) * 0.05;
    par.y += (ty - par.y) * 0.05;

    wave(h - 22, 6, w / 2.6, 0.45, 'rgba(18, 40, 76, 0.50)', t);
    wave(h - 11, 8, w / 3.4, -0.30, 'rgba(52, 96, 140, 0.20)', t);

    if (map.on) drawMap(t);

    /* 하나 됨의 정도(0=세 도시, 1=한 점) */
    var mTarget = mergePin ? 1 : 0;
    if (!mergePin && mouse.on) {
      var mdx = mouse.x - ring.x, mdy = mouse.y - ring.y;
      if (Math.sqrt(mdx * mdx + mdy * mdy) < ring.r * 0.8 && !canvasHover) mTarget = 1;
    }
    merge += (mTarget - merge) * (reduced ? 1 : 0.06);
    if (merge < 0.001) merge = 0;

    var act = activeKey();
    var i, j, c, p;
    var pos = [];
    for (i = 0; i < CITIES.length; i++) pos.push(nodeXY(CITIES[i], t, merge));
    var actPos = null;
    for (i = 0; i < CITIES.length; i++) if (CITIES[i].key === act) actPos = pos[i];

    /* 입자(교회 불빛) */
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      var px = p.fx * w + Math.sin(t * p.sa + p.pa) * p.ax + par.x;
      var py = p.fy * h + Math.cos(t * p.sb + p.pb) * p.ay + par.y;
      if (mouse.on) {
        var dxm = mouse.x - px, dym = mouse.y - py;
        var dm = Math.sqrt(dxm * dxm + dym * dym);
        if (dm < 160 && dm > 0.001) {
          var f = (1 - dm / 160) * 13;
          px += dxm / dm * f; py += dym / dm * f;
        }
      }
      if (actPos) {
        var dxa = actPos.x - px, dya = actPos.y - py;
        var da = Math.sqrt(dxa * dxa + dya * dya);
        if (da < 220 && da > 0.001) {
          var fa = (1 - da / 220) * 20;
          px += dxa / da * fa; py += dya / da * fa;
        }
      }
      p.x = px; p.y = py;
    }
    ctx.lineWidth = 1;
    for (i = 0; i < parts.length; i++) {
      for (j = i + 1; j < parts.length; j++) {
        var ldx = parts[i].x - parts[j].x, ldy = parts[i].y - parts[j].y;
        var d2 = ldx * ldx + ldy * ldy;
        if (d2 < 6400) { /* 80px */
          ctx.strokeStyle = 'rgba(' + COOL + ',' + ((1 - Math.sqrt(d2) / 80) * 0.10).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(parts[i].x, parts[i].y);
          ctx.lineTo(parts[j].x, parts[j].y);
          ctx.stroke();
        }
      }
      var twk = reduced ? 0.45 : 0.34 + 0.24 * Math.sin(t * 1.1 + parts[i].tw);
      ctx.fillStyle = 'rgba(' + TEXT + ',' + twk.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(parts[i].x, parts[i].y, parts[i].r, 0, TAU);
      ctx.fill();
    }
    if (mouse.on) {
      for (i = 0; i < parts.length; i++) {
        var qdx = parts[i].x - mouse.x, qdy = parts[i].y - mouse.y;
        var qd = Math.sqrt(qdx * qdx + qdy * qdy);
        if (qd < 140) {
          ctx.strokeStyle = 'rgba(' + COOL + ',' + ((1 - qd / 140) * 0.22).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(parts[i].x, parts[i].y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }
    }

    /* ---------- 하나 됨의 원 ---------- */
    var cx = ring.x + par.x, cy = ring.y + par.y;

    /* 바깥 원 */
    ctx.beginPath();
    ctx.arc(cx, cy, ring.r, 0, TAU);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(' + COOL + ',' + (0.26 + merge * 0.2).toFixed(3) + ')';
    ctx.stroke();

    /* 원둘레를 도는 빛 */
    if (!reduced) {
      for (i = 0; i < 2; i++) {
        var pa = ((t * 0.045 + i * 0.5) % 1) * TAU;
        var lx = cx + Math.cos(pa) * ring.r, ly = cy + Math.sin(pa) * ring.r;
        var lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 6);
        lg.addColorStop(0, 'rgba(' + IVORY + ',0.75)');
        lg.addColorStop(1, 'rgba(' + IVORY + ',0)');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(lx, ly, 6, 0, TAU); ctx.fill();
      }
    }

    /* 선택된 도시로 향하는 반지름 선 */
    if (actPos && merge < 0.5) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(actPos.x, actPos.y);
      ctx.strokeStyle = 'rgba(' + IVORY + ',' + (0.35 * (1 - merge * 2)).toFixed(3) + ')';
      ctx.stroke();
    }

    /* 도시 노드 */
    for (i = 0; i < CITIES.length; i++) {
      c = CITIES[i];
      var P = pos[i];
      var on = act === c.key;
      c.s += ((on ? 1.22 : 1) - c.s) * (reduced ? 1 : 0.1);
      var r = nodeR * c.s * (1 - 0.30 * merge);
      var fade = 1 - merge;

      if (fade < 0.03) continue;

      var g = ctx.createRadialGradient(P.x, P.y, r * 0.4, P.x, P.y, r * 2.6);
      g.addColorStop(0, on
        ? 'rgba(' + IVORY + ',' + (0.24 * fade).toFixed(3) + ')'
        : 'rgba(' + COOL + ',' + (0.16 * fade).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(P.x, P.y, r * 2.6, 0, TAU); ctx.fill();

      if (on && !reduced) {
        var ph = (t * 0.55) % 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(' + IVORY + ',' + ((1 - ph) * 0.4 * fade).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(P.x, P.y, r * (1.2 + ph * 1.1), 0, TAU); ctx.stroke();
      }

      ctx.fillStyle = 'rgba(10,22,42,' + (0.78 * fade).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(P.x, P.y, r, 0, TAU); ctx.fill();
      ctx.lineWidth = on ? 1.4 : 1;
      ctx.strokeStyle = on
        ? 'rgba(' + IVORY + ',' + (0.9 * fade).toFixed(3) + ')'
        : 'rgba(255,255,255,' + (0.38 * fade).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(P.x, P.y, r, 0, TAU); ctx.stroke();

      /* 이름 한 글자 */
      ctx.font = '600 ' + Math.round(r * 0.92) + 'px "Noto Serif KR", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(' + IVORY + ',' + (0.92 * fade).toFixed(3) + ')';
      ctx.fillText(c.syl, P.x, P.y + r * 0.05);

      /* 도시 이름 — 원 바깥 제자리에 똑바로 */
      var la = P.a;
      var lx2 = ring.x + Math.cos(la) * (ring.r + nodeR + 16) + par.x;
      var ly2 = ring.y + Math.sin(la) * (ring.r + nodeR + 16) + par.y;
      ctx.font = '500 ' + (band ? 10.5 : 12) + 'px "Noto Sans KR", sans-serif';
      ctx.fillStyle = on
        ? 'rgba(255,255,255,' + (0.95 * fade).toFixed(3) + ')'
        : 'rgba(' + TEXT + ',' + (0.72 * fade).toFixed(3) + ')';
      ctx.fillText(c.name, lx2, ly2);
    }

    /* 가운데 — 셋이 하나로 */
    if (merge > 0.02) {
      var gr = 22 + merge * (ring.r * 0.34);
      var cg = ctx.createRadialGradient(cx, cy, 2, cx, cy, gr * 2.2);
      cg.addColorStop(0, 'rgba(' + IVORY + ',' + (0.30 * merge).toFixed(3) + ')');
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(cx, cy, gr * 2.2, 0, TAU); ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, gr, 0, TAU);
      ctx.fillStyle = 'rgba(10,22,42,' + (0.66 * merge).toFixed(3) + ')';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(' + IVORY + ',' + (0.75 * merge).toFixed(3) + ')';
      ctx.stroke();

      var ta = Math.max(0, (merge - 0.45) / 0.55);
      if (ta > 0) {
        ctx.font = '600 ' + Math.round(ring.r * 0.30) + 'px "Noto Serif KR", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(' + IVORY + ',' + (0.95 * ta).toFixed(3) + ')';
        ctx.fillText('시화산', cx, cy + 1);
      }
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, 1.8, 0, TAU);
      ctx.fillStyle = 'rgba(' + IVORY + ',0.5)';
      ctx.fill();
    }

    /* 안내 문구를 하나 됨 상태와 맞춘다 */
    var nowMerged = merge > 0.5;
    if (nowMerged !== mergeShown) {
      mergeShown = nowMerged;
      if (note && !activeKey()) {
        note.textContent = nowMerged ? NOTES.one : NOTES.def;
        note.classList.toggle('on', nowMerged);
      }
    }

    /* 클릭 불꽃 */
    for (i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i];
      s.x += s.vx; s.y += s.vy; s.vy += 0.015; s.life -= 0.025;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.fillStyle = 'rgba(' + IVORY + ',' + s.life.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.4, 0, TAU); ctx.fill();
    }
  }

  /* ---------- 상태 · UI 동기화 ---------- */
  function syncUI() {
    var k = activeKey();
    if (note) {
      note.textContent = NOTES[k] || (mergeShown ? NOTES.one : NOTES.def);
      note.classList.toggle('on', !!k || mergeShown);
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
      var P = nodeXY(CITIES[i], t, merge);
      var dx = x - P.x, dy = y - P.y;
      var lim = nodeR * CITIES[i].s + 14;
      if (dx * dx + dy * dy < lim * lim) return CITIES[i].key;
    }
    return null;
  }

  function inRing(x, y) {
    var dx = x - ring.x, dy = y - ring.y;
    return Math.sqrt(dx * dx + dy * dy) < ring.r * 0.8;
  }

  function burst(x, y) {
    for (var i = 0; i < 10; i++) {
      var a = Math.random() * TAU, v = 0.6 + Math.random() * 1.6;
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
      mergePin = false;
      if (!reduced) burst(x, y);
    } else if (inRing(x, y)) {
      mergePin = !mergePin;      /* 원 안을 누르면 하나 됨 고정 */
      pinned = null;
    } else if (pinned || mergePin) {
      pinned = null; mergePin = false;
    } else {
      return;
    }
    syncUI();
    kick();
  });

  chips.forEach(function (b) {
    var key = b.getAttribute('data-city');
    b.addEventListener('mouseenter', function () { chipHover = key; syncUI(); });
    b.addEventListener('mouseleave', function () { chipHover = null; syncUI(); });
    b.addEventListener('focus', function () { chipHover = key; syncUI(); });
    b.addEventListener('blur', function () { chipHover = null; syncUI(); });
    b.addEventListener('click', function () {
      pinned = pinned === key ? null : key;
      mergePin = false;
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

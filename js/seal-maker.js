/* 전자 도장 만들기
 *
 * 이름·직책·소속을 넣으면 인주색 도장 그림(PNG, 투명 바탕)을 그려 준다.
 * 모양은 여섯 가지 — 원형(테두리 글+가운데 / 바둑판 이름 / 세로 이름),
 * 사각(3×3 바둑판·전통 / 직책+이름 / 3줄). 글꼴은 궁서·바탕·고딕.
 *
 * 만들기 전에 반드시 동의를 받는다:
 *   · 본인 확인 — 내 이름의 도장이며 남의 도장을 흉내 낸 것이 아니다
 *   · 권한 부여 — 이 도장을 내 계정으로 노회 문서에 찍는 데 쓴다
 * 동의한 시각과 문구 판은 내 도장(member_seals)에 함께 남는다.
 *
 *   SHSSealMaker.open({
 *     kind: 'pastor' | 'church',        // 내 도장 / 교회 직인
 *     name, church, title,             // 기본값
 *     onSave: function (dataUrl, meta) // 저장 (동의 뒤에 불린다)
 *   })
 */
var SHSSealMaker = (function () {
  'use strict';

  var RED = '#c8102e';
  var CONSENT_VER = '2026-09-v1';

  var PRESETS = [
    { id: 'round-ring',  shape: 'round',  name: '원형 · 테두리 글 + 가운데',   hint: '바깥을 따라 소속·직책, 가운데에 이름이나 <印>' },
    { id: 'round-name',  shape: 'round',  name: '원형 · 이름 바둑판',          hint: '이름 세 자 + 印 을 2×2로' },
    { id: 'round-vert',  shape: 'round',  name: '원형 · 이름 세로',            hint: '이름을 세로 한 줄로' },
    { id: 'square-grid', shape: 'square', name: '사각 · 바둑판 (전통)',        hint: '오른쪽 위부터 세로로 읽는 전통 배열' },
    { id: 'square-title', shape: 'square', name: '사각 · 직책 + 이름',         hint: '위에 직책 작게, 아래에 이름 크게' },
    { id: 'square-lines', shape: 'square', name: '사각 · 3줄',                 hint: '소속 · 직책 · 이름을 세 줄로' }
  ];
  var FONTS = [
    { id: 'gungsuh', name: '궁서체 (붓글씨)', css: '"Gungsuh","궁서","GungsuhChe",serif' },
    { id: 'batang',  name: '바탕체 (또렷)',   css: '"Batang","바탕","Noto Serif KR",serif' },
    { id: 'gothic',  name: '고딕 (굵게)',     css: '"Malgun Gothic","맑은 고딕","Noto Sans KR",sans-serif' }
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function chars(s) { return Array.from(String(s || '').replace(/\s+/g, '')); }
  function fontCss(id) { return (FONTS.filter(function (f) { return f.id === id; })[0] || FONTS[0]).css; }

  /* 글자 크기를 칸에 맞춘다 */
  function fitFont(ctx, text, family, maxW, maxH) {
    var size = maxH;
    ctx.font = 'bold ' + size + 'px ' + family;
    while (size > 8 && ctx.measureText(text).width > maxW) { size -= 2; ctx.font = 'bold ' + size + 'px ' + family; }
    return size;
  }
  function drawChar(ctx, ch, x, y, size, family) {
    ctx.font = 'bold ' + size + 'px ' + family;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y + size * 0.04);
  }

  /* 바둑판 배열 — 전통(오른쪽 위부터 세로) / 현대(왼쪽 위부터 가로) */
  function gridCells(list, cols, rows, dir) {
    var out = [];
    if (dir === 'trad') {
      /* 세로 열을 오른쪽부터 채운다. 글자 수가 모자라면 열 수를 줄이고 가운데로 모은다 */
      var nCol = Math.min(cols, Math.ceil(list.length / rows));
      var first = cols - 1 - Math.floor((cols - nCol) / 2);   /* 맨 오른쪽 열 번호 (가운데 정렬) */
      list.forEach(function (ch, i) {
        var c = first - Math.floor(i / rows), r = i % rows;
        out.push({ ch: ch, c: c, r: r });
      });
    } else {
      list.forEach(function (ch, i) { out.push({ ch: ch, c: i % cols, r: Math.floor(i / cols) }); });
    }
    return out;
  }

  /* 인주 자국처럼 군데군데 살짝 벗겨진 느낌 */
  function texture(ctx, size, seed) {
    var rnd = (function (s) { return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; })(seed || 7);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    var n = Math.round(size * 0.9);
    for (var i = 0; i < n; i++) {
      var x = rnd() * size, y = rnd() * size, r = 0.6 + rnd() * 2.4;
      ctx.globalAlpha = 0.35 + rnd() * 0.55;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- 그리기 ---------- */
  function render(o) {
    var S = o.size || 600, cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    var ctx = cv.getContext('2d');
    var fam = fontCss(o.font);
    var cx = S / 2, cy = S / 2;
    ctx.fillStyle = RED; ctx.strokeStyle = RED; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var main = chars(o.main), ring = chars(o.ring), sub = chars(o.sub), line3 = chars(o.line3);
    var p = o.preset;

    if (p === 'round-ring' || p === 'round-name' || p === 'round-vert') {
      var R = S * 0.46;
      ctx.lineWidth = S * 0.028;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

      if (p === 'round-ring') {
        var Rin = S * 0.30;
        ctx.lineWidth = S * 0.014;
        ctx.beginPath(); ctx.arc(cx, cy, Rin, 0, Math.PI * 2); ctx.stroke();
        /* 테두리 글: 위 가운데(★)에서 시계 방향으로 고르게 */
        var items = ['★'].concat(ring);
        var rr = (R + Rin) / 2, n = items.length;
        var fs = Math.min(S * 0.11, (2 * Math.PI * rr / Math.max(n, 8)) * 0.9);
        items.forEach(function (ch, i) {
          var ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
          ctx.save();
          ctx.translate(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
          ctx.rotate(ang + Math.PI / 2);
          drawChar(ctx, ch, 0, 0, ch === '★' ? fs * 0.8 : fs, fam);
          ctx.restore();
        });
        /* 가운데: 1~2자는 세로, 3~4자는 2×2 */
        var inner = main.length ? main : ['印'];
        if (inner.length <= 2) {
          var fs2 = Rin * (inner.length === 1 ? 1.25 : 0.82);
          inner.forEach(function (ch, i) {
            drawChar(ctx, ch, cx, cy + (i - (inner.length - 1) / 2) * fs2 * 1.02, fs2, fam);
          });
        } else {
          var cell = Rin * 0.72, fs3 = cell * 0.9;
          gridCells(inner.slice(0, 4), 2, 2, o.dir || 'trad').forEach(function (g) {
            drawChar(ctx, g.ch, cx + (g.c - 0.5) * cell, cy + (g.r - 0.5) * cell, fs3, fam);
          });
        }
      } else if (p === 'round-name') {
        var list = main.slice();
        if (list.length === 3) list.push('印');
        if (list.length <= 2) {
          var f1 = R * (list.length === 1 ? 1.1 : 0.72);
          list.forEach(function (ch, i) { drawChar(ctx, ch, cx, cy + (i - (list.length - 1) / 2) * f1 * 1.02, f1, fam); });
        } else {
          var cell2 = R * 0.62, f2 = cell2 * 0.92;
          gridCells(list.slice(0, 4), 2, 2, o.dir || 'trad').forEach(function (g) {
            drawChar(ctx, g.ch, cx + (g.c - 0.5) * cell2, cy + (g.r - 0.5) * cell2, f2, fam);
          });
        }
      } else {
        var lv = main.length ? main : ['印'];
        var fv = Math.min(R * 0.9, (R * 1.7) / lv.length * 0.98);
        lv.forEach(function (ch, i) { drawChar(ctx, ch, cx, cy + (i - (lv.length - 1) / 2) * fv * 1.0, fv, fam); });
      }
    } else {
      /* 사각: 바깥 굵은 테두리(살짝 둥근 모서리) */
      var m = S * 0.05, w = S - m * 2, rad = S * 0.03;
      ctx.lineWidth = S * 0.026;
      roundRect(ctx, m, m, w, w, rad); ctx.stroke();
      var inner2 = m + S * 0.045;   /* 글자 영역 */
      var iw = S - inner2 * 2;

      if (p === 'square-grid') {
        var all = main.concat(sub, line3);
        if (!all.length) all = ['印'];
        var rows = all.length <= 4 ? 2 : 3, cols = rows;
        if (all.length > 9) all = all.slice(0, 9);
        var cellW = iw / cols, fg = cellW * 0.86;
        gridCells(all, cols, rows, o.dir || 'trad').forEach(function (g) {
          drawChar(ctx, g.ch, inner2 + (g.c + 0.5) * cellW, inner2 + (g.r + 0.5) * cellW, fg, fam);
        });
      } else if (p === 'square-title') {
        var t = sub.join(''), nm = main.join('') || '印';
        var y1 = inner2 + iw * 0.27, y2 = inner2 + iw * 0.7;
        if (t) {
          var ft = fitFont(ctx, t, fam, iw * 0.92, iw * 0.24);
          drawChar(ctx, t, cx, y1, ft, fam);
        } else { y2 = cy; }
        var fn = fitFont(ctx, nm, fam, iw * 0.94, iw * 0.42);
        drawChar(ctx, nm, cx, y2, fn, fam);
      } else {
        var lines = [main.join(''), sub.join(''), line3.join('')].filter(function (x) { return x; });
        if (!lines.length) lines = ['印'];
        var lh = iw / lines.length;
        lines.forEach(function (ln, i) {
          var fl = fitFont(ctx, ln, fam, iw * 0.94, lh * 0.78);
          drawChar(ctx, ln, cx, inner2 + lh * (i + 0.5), fl, fam);
        });
      }
    }
    if (o.texture !== false) texture(ctx, S, o.seed || 7);
    return cv;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  /* 저장용 PNG (420px, 투명 바탕) */
  function toPng(o) {
    var big = render(Object.assign({}, o, { size: 840 }));
    var out = document.createElement('canvas');
    out.width = 420; out.height = 420;
    out.getContext('2d').drawImage(big, 0, 0, 420, 420);
    return out.toDataURL('image/png');
  }

  /* ---------- 화면 ---------- */
  var mdl = null;
  function ensureModal() {
    if (mdl) return mdl;
    mdl = document.createElement('div');
    mdl.className = 'mdl';
    mdl.id = 'sm-mdl';
    mdl.innerHTML = '<div class="mdl-box wide"><button class="mdl-close" id="sm-close">&times;</button><div id="sm-body"></div></div>';
    document.body.appendChild(mdl);
    mdl.querySelector('#sm-close').addEventListener('click', close);
    mdl.addEventListener('click', function (ev) { if (ev.target === mdl) close(); });
    return mdl;
  }
  function close() { if (mdl) mdl.classList.remove('open'); }

  function open(opts) {
    opts = opts || {};
    var isChurch = opts.kind === 'church';
    var st = {
      preset: isChurch ? 'round-ring' : 'round-name',
      font: 'gungsuh',
      main: isChurch ? '직인' : (opts.name || ''),
      ring: isChurch ? (opts.church || '') : (opts.church || ''),
      sub: isChurch ? '' : (opts.title || ''),
      line3: '',
      dir: 'trad', texture: true, seed: 7
    };
    var box = ensureModal().querySelector('#sm-body');
    ensureModal().classList.add('open');

    function draw() {
      var need = { ring: st.preset === 'round-ring', sub: st.preset !== 'round-name' && st.preset !== 'round-vert', line3: st.preset === 'square-lines' || st.preset === 'square-grid', dir: /grid|round-ring|round-name/.test(st.preset) };
      box.innerHTML =
        '<h2>' + (isChurch ? '교회 직인 만들기' : '내 도장 만들기') + '</h2>' +
        '<p style="font-size:0.88rem;color:var(--gray-6);margin:-8px 0 14px">글자를 넣고 모양·글꼴을 고르면 바로 그려집니다. ' +
        '마음에 들면 <strong>저장</strong>을 누르세요 — 저장 전에 동의를 묻습니다. 투명 바탕 PNG로 만들어집니다.</p>' +
        '<div style="display:flex;gap:22px;flex-wrap:wrap">' +
        '<div style="flex:0 0 260px;text-align:center">' +
        '<div id="sm-prev" style="width:240px;height:240px;margin:0 auto;background:repeating-conic-gradient(#f3f0ea 0 25%,#fff 0 50%) 0 0/20px 20px;border:1px solid var(--gray-2);border-radius:8px;display:flex;align-items:center;justify-content:center"></div>' +
        '<div style="margin-top:8px"><button type="button" class="btn ghost sm" id="sm-shuffle">질감 바꾸기</button></div>' +
        '</div>' +
        '<div style="flex:1;min-width:280px">' +
        '<div class="field"><label>모양</label><select id="sm-preset">' +
        PRESETS.map(function (p) { return '<option value="' + p.id + '"' + (p.id === st.preset ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
        '</select><small style="color:var(--gray-5)" id="sm-hint"></small></div>' +
        '<div class="inline-form">' +
        '<div class="field" style="flex:0 0 170px"><label>글꼴</label><select id="sm-font">' +
        FONTS.map(function (f) { return '<option value="' + f.id + '"' + (f.id === st.font ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('') + '</select></div>' +
        (need.dir ? '<div class="field" style="flex:0 0 190px"><label>읽는 방향</label><select id="sm-dir">' +
          '<option value="trad"' + (st.dir === 'trad' ? ' selected' : '') + '>전통 (오른쪽 위부터 세로)</option>' +
          '<option value="modern"' + (st.dir === 'modern' ? ' selected' : '') + '>현대 (왼쪽 위부터 가로)</option></select></div>' : '') +
        '</div>' +
        '<div class="field"><label>' + (st.preset === 'round-ring' ? '가운데 글 (이름 또는 印·직인)' : (st.preset === 'square-title' ? '이름 (크게)' : (st.preset === 'square-lines' ? '첫째 줄' : '이름'))) + '</label>' +
        '<input type="text" id="sm-main" value="' + esc(st.main) + '" maxlength="12"></div>' +
        (need.ring ? '<div class="field"><label>테두리 글 (소속·직책, 예: 시화산노회 감사헌의부)</label><input type="text" id="sm-ring" value="' + esc(st.ring) + '" maxlength="24"></div>' : '') +
        (need.sub ? '<div class="field"><label>' + (st.preset === 'square-title' ? '직책 (위에 작게, 예: 감사부장)' : (st.preset === 'square-lines' ? '둘째 줄' : '직책·소속 (바둑판에 이어 채움)')) + '</label><input type="text" id="sm-sub" value="' + esc(st.sub) + '" maxlength="12"></div>' : '') +
        (need.line3 ? '<div class="field"><label>' + (st.preset === 'square-lines' ? '셋째 줄' : '더 채울 글자 (선택)') + '</label><input type="text" id="sm-line3" value="' + esc(st.line3) + '" maxlength="12"></div>' : '') +
        '<div class="field"><label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" id="sm-tex" style="width:auto;margin:0"' + (st.texture ? ' checked' : '') + '> 인주 자국처럼 살짝 벗겨진 질감</label></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' +
        '<button type="button" class="btn" id="sm-save">' + (isChurch ? '교회 직인으로 저장' : '내 도장으로 저장') + '</button>' +
        '<a class="btn ghost" id="sm-dl" download="' + esc((isChurch ? (opts.church || '교회') + ' 직인' : (opts.name || '도장')) + '.png') + '">PNG 내려받기</a>' +
        '<button type="button" class="btn ghost" id="sm-cancel">닫기</button></div>' +
        '<div class="form-msg" id="sm-msg"></div>' +
        '</div></div>';
      var hint = PRESETS.filter(function (p) { return p.id === st.preset; })[0];
      box.querySelector('#sm-hint').textContent = hint ? hint.hint : '';
      preview();
      box.querySelector('#sm-preset').addEventListener('change', function () { st.preset = this.value; draw(); });
      box.querySelector('#sm-font').addEventListener('change', function () { st.font = this.value; preview(); });
      var dirEl = box.querySelector('#sm-dir'); if (dirEl) dirEl.addEventListener('change', function () { st.dir = this.value; preview(); });
      ['main', 'ring', 'sub', 'line3'].forEach(function (k) {
        var el = box.querySelector('#sm-' + k);
        if (el) el.addEventListener('input', function () { st[k] = this.value; preview(); });
      });
      box.querySelector('#sm-tex').addEventListener('change', function () { st.texture = this.checked; preview(); });
      box.querySelector('#sm-shuffle').addEventListener('click', function () { st.seed = Math.floor(Math.random() * 100000) + 1; preview(); });
      box.querySelector('#sm-cancel').addEventListener('click', close);
      box.querySelector('#sm-save').addEventListener('click', consent);
    }
    function preview() {
      var cv = render(Object.assign({}, st, { size: 480 }));
      cv.style.width = '220px'; cv.style.height = '220px';
      var pv = box.querySelector('#sm-prev'); pv.innerHTML = ''; pv.appendChild(cv);
      var dl = box.querySelector('#sm-dl'); if (dl) dl.href = toPng(st);
    }

    /* ----- 동의 ----- */
    function consent() {
      if (!chars(st.main).length && !chars(st.sub).length && !chars(st.ring).length) {
        var m0 = box.querySelector('#sm-msg'); m0.className = 'form-msg err'; m0.textContent = '도장에 넣을 글자를 적어 주세요.'; return;
      }
      var png = toPng(st);
      box.innerHTML =
        '<h2>동의와 권한 부여</h2>' +
        '<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">' +
        '<img src="' + png + '" alt="도장" style="width:150px;height:150px;flex:0 0 150px;background:repeating-conic-gradient(#f3f0ea 0 25%,#fff 0 50%) 0 0/16px 16px;border:1px solid var(--gray-2);border-radius:8px">' +
        '<div style="flex:1;min-width:260px;font-size:0.92rem">' +
        '<p>이 전자 도장은 <strong>' + esc(opts.name || '본인') + '</strong> 님의 계정에 저장되어 ' +
        (isChurch ? '<strong>교회상황 보고서</strong> 등 교회 문서의 (직인) 자리에' : '<strong>청원서</strong>·보고서·감사필 등 노회 문서의 (인) 자리에') +
        ' 찍힙니다. 저장하려면 아래 두 가지에 동의해 주세요.</p>' +
        '<div class="field"><label style="display:flex;gap:8px;align-items:flex-start;font-weight:400;line-height:1.5"><input type="checkbox" id="sm-c1" style="width:auto;margin:4px 0 0;flex:0 0 auto"><span>' +
        '<strong>본인 확인</strong> — 이 도장은 내 이름(또는 내가 대표하는 교회)의 도장이며, 다른 사람의 이름이나 다른 기관의 직인을 흉내 낸 것이 아닙니다.</span></label></div>' +
        '<div class="field"><label style="display:flex;gap:8px;align-items:flex-start;font-weight:400;line-height:1.5"><input type="checkbox" id="sm-c2" style="width:auto;margin:4px 0 0;flex:0 0 auto"><span>' +
        '<strong>권한 부여</strong> — 이 도장을 홈페이지에서 내 계정으로 문서에 찍는 데 사용하는 것을 허락합니다. 도장은 본인만 보고 지울 수 있으며, 찍힌 문서에는 찍은 사람과 시각이 남습니다.</span></label></div>' +
        '<p style="font-size:0.8rem;color:var(--gray-5)">동의한 시각과 문구 판(' + CONSENT_VER + ')이 도장과 함께 저장됩니다.</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button type="button" class="btn" id="sm-agree" disabled>동의하고 저장</button>' +
        '<button type="button" class="btn ghost" id="sm-back">뒤로</button></div>' +
        '<div class="form-msg" id="sm-msg2"></div>' +
        '</div></div>';
      var c1 = box.querySelector('#sm-c1'), c2 = box.querySelector('#sm-c2'), ok = box.querySelector('#sm-agree');
      function upd() { ok.disabled = !(c1.checked && c2.checked); }
      c1.addEventListener('change', upd); c2.addEventListener('change', upd);
      box.querySelector('#sm-back').addEventListener('click', draw);
      ok.addEventListener('click', function () {
        ok.disabled = true; ok.textContent = '저장 중…';
        var meta = { preset: st.preset, font: st.font, main: st.main, ring: st.ring, sub: st.sub, line3: st.line3, dir: st.dir, texture: st.texture, consent_ver: CONSENT_VER };
        Promise.resolve(opts.onSave ? opts.onSave(png, meta) : null).then(function () {
          close();
        }, function (err) {
          var m2 = box.querySelector('#sm-msg2'); m2.className = 'form-msg err';
          m2.textContent = (err && err.message) || '저장하지 못했습니다.';
          ok.disabled = false; ok.textContent = '동의하고 저장';
        });
      });
    }

    draw();
  }

  return { open: open, render: render, toPng: toPng, PRESETS: PRESETS, FONTS: FONTS, CONSENT_VER: CONSENT_VER };
})();

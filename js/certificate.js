/* 시화산노회 홈페이지 - 증명서 양식
 *
 * 서기가 발급할 때와 신청자가 내려받을 때 똑같은 양식을 쓰도록
 * 증명서 그리는 일을 이 파일에 모아 두었다.
 *
 * 종이 크기는 A4(210 x 297mm)에 맞추었고, 인쇄 화면에서 "대상"을
 * "PDF로 저장"으로 고르면 그대로 PDF 파일이 된다.
 */
var SHSCert = (function () {
  'use strict';

  var NOHOE = '대한예수교장로회 시화산노회';
  var OFFICE = '경기도 안산시 단원구 와동공원로1안길 13-7 (반월교회 교육관 1층) · 전화 031-486-9993';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 2026-04-13 → 2026년 4월 13일 */
  function dateKo(d) {
    var t = d ? new Date(String(d).length <= 10 ? d + 'T00:00:00' : d) : new Date();
    if (isNaN(t)) t = new Date();
    return t.getFullYear() + '년 ' + (t.getMonth() + 1) + '월 ' + t.getDate() + '일';
  }

  /* 받침에 따라 '로'/'으로' 를 고른다 (목사로, 직원으로) */
  function ro(word) {
    var ch = String(word || '').slice(-1).charCodeAt(0);
    var jong = ch >= 0xAC00 && ch <= 0xD7A3 ? (ch - 0xAC00) % 28 : 0;
    return jong && jong !== 8 ? '으로' : '로';   /* ㄹ 받침은 '로' */
  }

  /* 2001-04-01 → 2001년 4월 */
  function ymKo(d) {
    var t = d ? new Date(String(d).length <= 10 ? d + 'T00:00:00' : d) : null;
    if (!t || isNaN(t)) return '';
    return t.getFullYear() + '년 ' + (t.getMonth() + 1) + '월';
  }

  /* ---------- 직인·도장의 실물 크기 ----------
   * 증명서의 도장은 실물과 같은 크기(mm)로 찍는다. 크기는 도장 그림의
   * 긴 변(원형은 지름, 사각은 한 변)을 기준으로 한다.
   *   · 단체 사각 직인은 7푼(21mm)이 가장 흔하고 큰 기관은 8푼(24mm)을 쓴다.
   *   · 개인 도장은 5푼(15mm)이 가장 흔하다. (1푼 = 3mm)
   * 실제 도장 크기는 관리자 → 직인·도장에서 mm로 적어 두며, 발급할 때
   * 증명서에 함께 담긴다(seals[key].mm). 값이 없는 옛 증명서는 아래 기본값. */
  var SEAL_MM = { '노회직인': 21, '노회장': 15, '서기': 15, '회록서기': 15 };

  function sealMm(key, s) {
    var v = Number(s && s.mm);
    if (!(v >= 5 && v <= 60)) v = SEAL_MM[key] || 15;
    return Math.round(v * 10) / 10;
  }

  /* 발급 명의 옆에 찍는 도장 한 개.
   * 상자는 실물의 4배로 잡고 CSS(.cert-seal)가 1/4 로 줄여 그린다 — 인쇄할 때
   * 브라우저가 상자를 1px 단위로 맞추며 생기는 크기 오차를 줄이려는 것. */
  function sealImg(key, s, alt) {
    var mm = sealMm(key, s);
    return '<img class="cert-seal" data-seal-mm="' + mm + '" src="' + esc(s.url) + '" alt="' + esc(alt) + '"' +
      ' style="width:' + (mm * 4) + 'mm;height:' + (mm * 4) + 'mm;right:-' + (mm + 0.6).toFixed(1) + 'mm">';
  }

  /* 도장 그림에서 인영(찍힌 부분)만 남긴다.
   *  · 흰 바탕은 투명하게 — PDF를 뜨는 html2canvas는 겹쳐 찍기(multiply)를
   *    못 하므로, 흰 바탕이 글씨를 가리지 않게 한다.
   *  · 둘레의 빈 여백은 잘라 낸다 — 여백이 남아 있으면 그만큼 도장이 작게
   *    찍혀 실물 크기와 어긋난다.
   * 그림을 읽을 수 없으면(다른 주소의 그림 등) 그대로 둔다. */
  function inkCanvas(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    var d = cx.getImageData(0, 0, w, h);
    var p = d.data, rows = new Uint32Array(h), cols = new Uint32Array(w);
    for (var y = 0, i = 0; y < h; y++) {
      for (var x = 0; x < w; x++, i += 4) {
        if (p[i] > 235 && p[i + 1] > 235 && p[i + 2] > 235) p[i + 3] = 0;
        if (p[i + 3] > 40) { rows[y]++; cols[x]++; }
      }
    }
    /* 티끌 한두 점은 인영으로 치지 않는다 */
    var ty = Math.max(1, Math.round(w * 0.004)), tx = Math.max(1, Math.round(h * 0.004));
    var top = 0, bottom = h - 1, left = 0, right = w - 1;
    while (top < h && rows[top] < ty) top++;
    while (bottom > top && rows[bottom] < ty) bottom--;
    while (left < w && cols[left] < tx) left++;
    while (right > left && cols[right] < tx) right--;
    if (top >= h || left >= w) return null;          /* 인영이 없다 */
    cx.putImageData(d, 0, 0);
    var out = document.createElement('canvas');
    out.width = right - left + 1; out.height = bottom - top + 1;
    out.getContext('2d').drawImage(cv, left, top, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  /* 화면·인쇄·PDF 어디서든 도장 그림이 뜨면 한 번만 다듬는다 */
  function tidySeal(img) {
    if (img._shsTidy) return img._shsTidy;
    img._shsTidy = new Promise(function (resolve) {
      function run() {
        try {
          var cv = inkCanvas(img);
          if (cv) {
            img.addEventListener('load', function () { resolve(); }, { once: true });
            img.addEventListener('error', function () { resolve(); }, { once: true });
            img.src = cv.toDataURL('image/png');
            return;
          }
        } catch (x) { /* 읽을 수 없는 그림은 그대로 둔다 */ }
        resolve();
      }
      if (img.complete && img.naturalWidth) run();
      else {
        img.addEventListener('load', run, { once: true });
        img.addEventListener('error', function () { resolve(); }, { once: true });
      }
    });
    return img._shsTidy;
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    /* load 는 위로 번지지 않으므로 잡는 단계(capture)에서 듣는다 */
    document.addEventListener('load', function (ev) {
      var t = ev.target;
      if (t && t.tagName === 'IMG' && t.hasAttribute('data-seal-mm') && !t._shsTidy) tidySeal(t);
    }, true);
  }

  /* 도장 그림 주소 → 여백을 잘라 낸 그림(data URL). 발급할 때 증명서에 담는다.
   * max: 긴 변의 픽셀 수 (21mm 직인이 300px이면 약 360dpi) */
  function sealData(url, max) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var src = inkCanvas(img);
          if (!src) { src = document.createElement('canvas'); src.width = img.naturalWidth; src.height = img.naturalHeight; src.getContext('2d').drawImage(img, 0, 0); }
          var sc = Math.min(1, (max || 300) / Math.max(src.width, src.height));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(src.width * sc));
          cv.height = Math.max(1, Math.round(src.height * sc));
          var cx = cv.getContext('2d');
          cx.imageSmoothingQuality = 'high';
          cx.drawImage(src, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/png'));
        } catch (x) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  /* 서류 종류별 증명 문구 */
  function bodyText(rec) {
    var church = rec.church || '';
    var pos = rec.position || rec.pos || '';
    switch (rec.doc_type || rec.doc) {
      case '재직증명서':
        if (rec.served_from) {
          var now = new Date();
          return '위 사람은 본 노회에 소속한 ' + pos + '로서 ' + ymKo(rec.served_from) +
            '부터 ' + now.getFullYear() + '년 ' + (now.getMonth() + 1) + '월 현재 ' +
            '대한예수교장로회 ' + church + ' ' + pos + ro(pos) + ' 재직하고 있음을 증명합니다.';
        }
        return '위 사람은 ' + NOHOE + ' 소속 ' + church + ' ' + pos + ro(pos) + ' 재직 중임을 증명합니다.';
      case '대표자증명서':
        return '위 사람은 ' + NOHOE + ' 소속 ' + church + '의 대표자임을 증명합니다.';
      case '직인증명서':
        return '상기 직인은 대한예수교장로회 ' + church + ' 사용 직인임을 증명합니다.';
      case '은퇴목사확인서':
        return '위 사람은 ' + NOHOE + ' 소속 은퇴목사임을 확인합니다.';
      case '안수증명서':
        return '위의 기록한 목사는 ' + NOHOE + '에서 안수 받았음을 증명합니다.' +
          (rec.ordained_on ? ' (안수일자: ' + ymKo(rec.ordained_on) + ')' : '');
      default:
        return '위 사람은 ' + NOHOE + ' 소속 ' + church + ' ' + pos + '임을 증명합니다.';
    }
  }

  /* 증명서 한 장. rec는 doc_issues 한 줄과 같은 모양이다. */
  function sheet(rec) {
    var seals = rec.seals || {};
    var pos = rec.position || rec.pos || '';
    var docName = rec.doc_type || rec.doc || '증명서';
    var body = rec.body_text || bodyText(rec);
    /* 노회장·서기 도장은 발급 명의 줄에 찍으므로 여기서는 뺀다 */
    var signRows = ['회록서기'].filter(function (k) {
      return seals[k] && seals[k].url;
    });

    var h = '<div class="cert-sheet' + (rec.void_yn ? ' cert-void' : '') +
      (docName === '직인증명서' ? ' cert-sealdoc' : '') + '">';
    if (rec.void_yn) {
      h += '<div class="cert-void-mark">무효</div>';
    }
    /* 상단 왼쪽: 진위 확인 QR과 발급번호를 한 줄에 둔다 */
    var qrHtml = '';
    if (rec.verify_code && typeof qrcode === 'function') {
      try {
        var q0 = qrcode(0, 'M');
        q0.addData('https://sihwasan.org/verify.html?c=' + rec.verify_code);
        q0.make();
        qrHtml = '<div class="cert-verify">' +
          '<img src="' + q0.createDataURL(4, 0) + '" alt="진위 확인 QR">' +
          '<div class="t">진위 확인 sihwasan.org/verify<br>' +
          '확인번호 ' + esc(rec.verify_code) + '</div></div>';
      } catch (ignore) { /* QR을 못 만들어도 증명서 발급은 막지 않는다 */ }
    }
    h += '<div class="cert-top">' +
      '<div class="c-no">' + esc(rec.doc_no || rec.no || '') + '</div>' +
      qrHtml + '</div>';
    h += '<h2>' + esc(docName) + '</h2>';

    if (docName === '직인증명서') {
      /* 직인증명서는 사람이 아니라 교회의 직인을 증명한다.
       * 교회명·주소·담임교역자·직위·용도를 적고, 그 교회의 직인을 함께 보인다. */
      h += '<table class="c-body"><tbody>' +
        '<tr><td>교 회 명</td><td>' + esc(rec.church) + '</td></tr>' +
        '<tr><td>주　　소</td><td>' + esc(rec.church_addr || rec.address || '') + '</td></tr>' +
        '<tr><td>담임교역자</td><td>' + esc(rec.name) + '</td></tr>' +
        '<tr><td>직　　위</td><td>' + esc(pos) + '</td></tr>' +
        '<tr><td>용　　도</td><td>' + esc(rec.purpose || '-') + '</td></tr>' +
        '</tbody></table>';
      /* 교회 직인은 인쇄한 뒤 실물 도장을 찍는다. 상자는 비워 둔다. */
      h += '<div class="c-sealbox">' +
        '<div class="c-sealbox-t">' + esc(rec.church) + ' 직인</div>' +
        '<div class="c-sealbox-b"></div></div>';
      h += '<div class="c-text">' + esc(body) + '</div>';
    } else {
      h += '<table class="c-body"><tbody>' +
        '<tr><td>성　　명</td><td>' + esc(rec.name) + '</td></tr>' +
        '<tr><td>직　　위</td><td>' + esc(pos) + '</td></tr>' +
        '<tr><td>소　　속</td><td>대한예수교장로회 ' + esc(rec.church) + '</td></tr>' +
        '<tr><td>용　　도</td><td>' + esc(rec.purpose || '-') + '</td></tr>' +
        '</tbody></table>';
      h += '<div class="c-text">' + esc(body) + '</div>';
    }
    h += '<div class="c-date">' + esc(dateKo(rec.issued_on || rec.date)) + '</div>';

    /* 발급 명의: 노회 이름(직인) / 노회장 성명(도장) / 서기 성명(도장)
     * 도장은 실물 크기로 찍히므로, 위아래 줄의 도장이 서로 닿지 않게
     * 줄 사이를 도장 크기에 맞추어 띄운다. */
    var lines = [{ key: '노회직인', text: NOHOE, alt: '노회 직인' },
      { key: '노회장', text: '노회장' + (rec.president ? ' ' + esc(rec.president) + ' 목사' : ''), alt: '노회장 도장' }];
    if (rec.clerk) lines.push({ key: '서기', text: '서　기 ' + esc(rec.clerk) + ' 목사', alt: '서기 도장' });
    var prevMm = 0;
    lines.forEach(function (ln, idx) {
      var s = seals[ln.key] && seals[ln.key].url ? seals[ln.key] : null;
      var mm = s ? sealMm(ln.key, s) : 0;
      var gap = idx && prevMm && mm ? Math.max(4.8, (prevMm + mm) / 2 - 9) : 0;
      h += '<div class="cert-issuer-wrap"' + (gap ? ' style="margin-top:' + gap.toFixed(1) + 'mm"' : '') +
        '><div class="c-issuer">' + ln.text + (s ? sealImg(ln.key, s, ln.alt) : '') + '</div></div>';
      prevMm = mm;
    });

    if (signRows.length) {
      h += '<div class="cert-signs">' + signRows.map(function (k) {
        var s = seals[k];
        return '<span class="row">' + esc(k) + (s.holder ? ' ' + esc(s.holder) : '') +
          sealImg(k, s, k + ' 도장') + '</span>';
      }).join('') + '</div>';
    }

    h += '<div class="cert-foot">' + esc(OFFICE) + '</div>';
    h += '</div>';
    return h;
  }

  /* 파일 이름: 소속증명서_홍길동_20260816 (날짜는 발급일 기준) */
  function fileName(rec) {
    var src = rec.issued_on || rec.date;
    var d = src ? new Date(String(src).length <= 10 ? src + 'T00:00:00' : src) : new Date();
    if (isNaN(d)) d = new Date();
    var ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
    return ((rec.doc_type || rec.doc || '증명서') + '_' + (rec.name || '') + '_' + ymd)
      .replace(/[\\/:*?"<>|]/g, '');
  }

  /* 인쇄(= PDF로 저장) 화면을 연다.
   * 인쇄 대화상자에서 대상을 "PDF로 저장"으로 고르면 PDF 파일이 된다. */
  function print(rec) {
    var prev = document.title;
    if (rec) document.title = fileName(rec);
    window.focus();
    window.print();
    setTimeout(function () { document.title = prev; }, 800);
  }

  /* ---------- PDF 바로 내려받기 ----------
   * 증명서를 화면 밖에 A4 크기로 그려 놓고 html2pdf.js(html2canvas 기반)로
   * 그림을 떠서 PDF로 저장한다. 글자를 그림으로 담기 때문에 한글이 깨지지
   * 않고, 화면에 보이는 양식 그대로 파일이 된다. */
  var CDN = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js';
  var loading = null;

  /* html2pdf.js는 내려받기 단추를 처음 눌렀을 때에만 불러온다 */
  function loadTool() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = CDN;
      s.onload = function () {
        if (window.html2pdf) resolve(window.html2pdf);
        else reject(new Error('PDF 저장 도구를 불러오지 못했습니다.'));
      };
      s.onerror = function () {
        loading = null;
        reject(new Error('PDF 저장 도구를 불러오지 못했습니다. 인터넷 연결을 확인하시고 다시 눌러 주세요.'));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  /* 증명서를 화면 밖에 A4로 그려 놓고 PDF 만들 준비를 마친다.
   * 준비가 끝나면 make(작업) 을 불러 주고, 끝나면 무대를 치운다. */
  function onStage(rec, make) {
    return loadTool().then(function (html2pdf) {
      var stage = document.createElement('div');
      stage.className = 'cert-pdf-stage';
      stage.setAttribute('aria-hidden', 'true');
      stage.innerHTML = sheet(rec);
      stage.firstChild.classList.add('cert-pdf-a4');
      document.body.appendChild(stage);
      var seals = [];
      /* 도장은 흰 바탕을 빼고 여백을 잘라 실물 크기로 앉힌 뒤에 그림을 뜬다 */
      stage.querySelectorAll('img[data-seal-mm]').forEach(function (img) { seals.push(tidySeal(img)); });
      /* 글꼴이 다 준비된 뒤에 그려야 한글이 제 모양으로 담긴다 */
      var fonts = (document.fonts && document.fonts.ready)
        ? document.fonts.ready.then(null, function () {}) : Promise.resolve();
      return Promise.all(seals.concat([fonts])).then(function () {
        return make(html2pdf().set({
          margin: 0,
          filename: fileName(rec) + '.pdf',
          image: { type: 'jpeg', quality: 0.98 },
          /* scrollX·scrollY 0: 화면이 내려가 있어도 증명서가 밀리지 않게 한다 */
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(stage.firstChild));
      }).then(function (out) { stage.remove(); return out; },
        function (x) { stage.remove(); throw x; });
    });
  }

  function downloadPdf(rec) {
    return onStage(rec, function (w) { return w.save(); });
  }

  /* 파일로 떨어뜨리지 않고 PDF 알맹이만 만들어 돌려준다.
   * 발급하는 순간 이것을 노회 보관소에 올려 둔다. */
  function pdfBlob(rec) {
    return onStage(rec, function (w) { return w.outputPdf('blob'); });
  }

  return {
    sheet: sheet,
    bodyText: bodyText,
    sealMm: sealMm,
    sealData: sealData,
    SEAL_MM: SEAL_MM,
    dateKo: dateKo,
    fileName: fileName,
    print: print,
    downloadPdf: downloadPdf,
    pdfBlob: pdfBlob
  };
})();

/* 영수증 사진을 브라우저 안에서 읽기 (AI 없이 · 무료)
 *
 * 회계가 장부에 영수증 사진을 놓으면 먼저 이 부품이 회계의 브라우저 안에서 글자를 읽는다
 * (Tesseract.js — 사진이 밖으로 나가지 않고 돈이 들지 않는다). 읽은 글에서 정해 둔 규칙으로
 * 일자·사용처·금액·결제 수단을 찾아 ledger.js 가 입력칸에 미리 채운다.
 * 금액이나 일자를 못 찾으면 weak 를 참으로 돌려주고, 화면은 「AI로 다시 읽기」를 권한다
 * (그때만 영수증 창구 cloudflare/receipts → Claude Haiku 5.5 를 부른다).
 *
 *   SHSReceiptOCR.read(file, onProgress)  → Promise<결과>
 *   SHSReceiptOCR.parse(text, opts)       → 결과 (글만 주고 규칙만 돌린다 — 시험용)
 *   결과 = { taken_on, vendor, amount, payment, items, confidence, note, weak, source: 'ocr', text }
 *          (영수증 창구가 돌려주는 모양과 같다)
 *
 * 처음 한 번은 글자 인식 프로그램과 한글 자료를 받아 오느라 10~20초 걸린다.
 * 그다음부터는 브라우저에 저장된 것을 쓰므로 몇 초 안에 읽는다.
 * 손글씨는 거의 읽지 못한다 — 그런 영수증은 AI 로 읽는다.
 */
(function (root) {
  'use strict';

  var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';

  /* ================= 읽은 글에서 값 찾기 ================= */

  /* 금액을 가리키는 말 — 무게가 클수록 최종 결제액일 가능성이 높다 */
  var AMOUNT_KEYS = [
    ['합계금액', 10], ['총결제금액', 10], ['결제금액', 9], ['받을금액', 9], ['청구금액', 9], ['총합계', 9],
    ['이체금액', 9], ['입금액', 8], ['송금액', 8],
    ['승인금액', 8], ['결제할금액', 8], ['판매총액', 8], ['총금액', 8], ['공급대가총액', 8], ['이용금액', 8],
    ['합계', 7], ['총액', 7], ['카드결제', 6], ['신용카드', 5], ['현금', 4], ['금액', 3]
  ];
  /* 이런 말이 있는 줄의 숫자는 최종 결제액이 아니다 (무게 9 이상인 말이 함께 있으면 예외) */
  var AMOUNT_SKIP = ['부가세', '부가가치세', '과세', '면세', '공급가', '세액', '할인', '포인트', '거스름', '잔돈',
    '받은금액', '봉사료', '단가', '수량', '승인번호', '카드번호', '가맹점번호', '사업자', '전화', 'TEL', '할부'];

  var DATE_KEYS = ['거래일시', '거래일자', '결제일시', '결제일자', '승인일시', '판매일', '매출일', '작성년월일',
    '작성일', '발행일', '일시', '일자', '날짜'];

  /* 사용처(상호)를 가리키는 말 — 통합 카드 영수증은 '가맹점'이 결제 대행사라 판매자상호를 먼저 본다 */
  var VENDOR_KEYS = [['판매자상호', 10], ['상호명', 9], ['상호', 8], ['매장명', 8], ['점포명', 8], ['업체명', 8],
    ['가맹점명', 7], ['판매처', 7], ['받는분', 6], ['받는사람', 6], ['수취인', 6], ['가맹점', 5], ['예금주', 5]];
  var VENDOR_STOP = ['성명', '대표자', '대표', '사업자', '등록번호', '전화', 'TEL', '주소'];
  /* 맨 위 몇 줄에서 상호를 짐작할 때 건너뛸 말 */
  var VENDOR_GENERIC = ['영수증', '매출전표', '전표', '카드', '신용', '고객', '현금', '거래', '사업자', '전화', '주소',
    '대표', '귀하', '일시', '번호', '승인', '합계', '금액', '감사', '발행', '회원', '통합', '정보', '공급자', '공급받는',
    '확인증', '이체', '영수', '청구', '계산서', '계좌', '은행', '출금', '입금'];
  /* 주소 줄 — '서애로5길 42', '봉담읍', '2층' */
  var ADDRESS = /[가-힣](로|길)\s*\d|[가-힣](읍|면|동)\s|\d+\s*(번지|층)|(특별|광역)시|(^|\s)(서울|경기|인천|부산|대구|광주|대전|울산|세종)(\s|도)/;

  function compact(s) { return String(s || '').replace(/\s+/g, ''); }
  function upper(s) { return String(s || '').toUpperCase(); }
  function hasAny(c, words) {
    var u = upper(c);
    for (var i = 0; i < words.length; i++) if (u.indexOf(upper(words[i])) !== -1) return words[i];
    return '';
  }
  /* '상호' → /상\s*호/ — 글자 사이에 띄어쓰기가 끼어 읽혀도 찾는다 */
  function spaced(word) {
    return new RegExp(word.split('').map(function (ch) {
      return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('\\s*'), 'i');
  }

  /* 한 줄을 고르게 — 전각 글자, 원화 기호, 숫자 사이에 잘못 읽힌 글자, 숫자 안의 띄어쓰기 */
  function tidy(line) {
    var s = String(line || '')
      .replace(/[，]/g, ',').replace(/[．]/g, '.').replace(/[：]/g, ':')
      .replace(/[₩￦\\]/g, ' ')
      .replace(/(^|[^A-Za-z])W(?=\s*\d)/g, '$1 ');
    function zero(m, a) { return a + '0'; }
    function one(m, a) { return a + '1'; }
    for (var i = 0; i < 3; i++) {
      s = s.replace(/(\d)[Oo](?=[\d,])/g, zero).replace(/([\d,])[Oo](?=\d)/g, zero)
           .replace(/(\d)[lI|](?=[\d,])/g, one).replace(/([\d,])[lI|](?=\d)/g, one);
    }
    return s.replace(/(\d)\s*([,.])\s*(\d{3})(?!\d)/g, '$1$2$3');
  }

  /* 줄 안의 금액 같은 숫자들 — 날짜·시각·전화·사업자·카드 번호는 먼저 지운다 */
  function moneyIn(line) {
    var s = line
      .replace(/\d{2,4}\s*[-.\/년]\s*\d{1,2}\s*[-.\/월]\s*\d{1,2}\s*일?/g, ' ')
      .replace(/\d{1,2}\s*:\s*\d{2}(\s*:\s*\d{2})?/g, ' ')
      .replace(/[\d*Xx]+(\s*-\s*[\d*Xx]+)+/g, ' ')
      .replace(/\d*\*+[\d*]*/g, ' ');
    var out = [], re = /\d{1,3}(?:[,.]\d{3})+|\d+/g, m;
    while ((m = re.exec(s))) {
      var digits = m[0].replace(/[,.]/g, '');
      if (digits.length > 9) continue;          /* 승인번호처럼 긴 숫자 */
      var n = parseInt(digits, 10);
      if (n >= 10) out.push(n);
    }
    return out;
  }

  function findAmount(lines) {
    var best = null;
    lines.forEach(function (ln, i) {
      var c = compact(ln), w = 0;
      AMOUNT_KEYS.forEach(function (k) { if (c.indexOf(k[0]) !== -1 && k[1] > w) w = k[1]; });
      if (!w) return;
      if (w < 9 && hasAny(c, AMOUNT_SKIP)) return;
      var nums = moneyIn(ln), same = true;
      /* '공급대가총액'처럼 제목 아래 줄에 금액이 적히는 양식 */
      if (!nums.length && i + 1 < lines.length) { nums = moneyIn(lines[i + 1]); same = false; }
      if (!nums.length) return;
      var v = nums[nums.length - 1];
      var score = w * 10 + (same ? 1 : 0);
      if (!best || score >= best.score) best = { value: v, score: score, weight: w };
    });
    if (best) return best;
    /* 금액을 가리키는 말이 없으면 천 단위 쉼표가 있는 가장 큰 숫자 (확신 낮음) */
    var max = 0;
    lines.forEach(function (ln) {
      if (hasAny(compact(ln), AMOUNT_SKIP)) return;
      if (!/\d[,.]\d{3}/.test(ln)) return;
      moneyIn(ln).forEach(function (n) { if (n > max) max = n; });
    });
    return max >= 100 ? { value: max, score: 0, weight: 0 } : null;
  }

  function realDate(y, m, d) {
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function findDate(lines, today) {
    var t = today || new Date();
    var max = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate() + 1);
    var min = Date.UTC(t.getFullYear() - 3, t.getMonth(), t.getDate());
    var best = null;
    lines.forEach(function (ln, i) {
      var c = compact(tidy(ln));
      var re = /(\d{2,4})[.\-\/년](\d{1,2})[.\-\/월](\d{1,2})/g, m;
      while ((m = re.exec(c))) {
        var before = c.charAt(m.index - 1);
        if (/\d/.test(before)) continue;           /* 더 긴 숫자의 일부 */
        var ys = m[1], y = parseInt(ys, 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
        if (ys.length === 3) continue;
        if (ys.length === 2) y += 2000;
        if (!realDate(y, mo, d)) continue;
        var at = Date.UTC(y, mo - 1, d);
        if (at > max || at < min) continue;
        var score = (hasAny(c, DATE_KEYS) ? 5 : 0) + (ys.length === 4 ? 2 : 0);
        if (!best || score > best.score) best = { value: y + '-' + pad(mo) + '-' + pad(d), score: score };
      }
    });
    return best;
  }

  /* '익 선 디 자 인' 처럼 한 글자씩 띄어 읽힌 상호를 붙이고, 앞뒤 군더더기를 지운다 */
  function cleanName(s) {
    var v = String(s || '').replace(/^[\s:;|\-·.,]+/, '').replace(/[|_~]+/g, ' ').trim();
    var stop = -1;
    VENDOR_STOP.forEach(function (w) {
      var m = spaced(w).exec(v);
      if (m && m.index > 0 && (stop === -1 || m.index < stop)) stop = m.index;
    });
    if (stop > 0) v = v.slice(0, stop);
    v = v.replace(/[\d\-\s()]{6,}$/, '').replace(/[^가-힣A-Za-z0-9()&.\s\-]/g, ' ').replace(/\s+/g, ' ').trim();
    /* 한 글자씩 떨어진 한글만 서로 붙인다 — '익 선 디 자 인' → '익선디자인', '한우마을 정육식당'은 그대로 */
    v = v.replace(/(^|\s)((?:[가-힣]\s){1,}[가-힣])(?=\s|$)/g, function (m, a, run) { return a + run.replace(/\s/g, ''); });
    if (!/[가-힣A-Za-z]{2,}/.test(v.replace(/\s/g, ''))) return '';
    return v.slice(0, 40);
  }

  function findVendor(lines) {
    var best = null;
    lines.forEach(function (ln, i) {
      var c = compact(ln);
      VENDOR_KEYS.forEach(function (k) {
        if (c.indexOf(k[0]) === -1) return;
        if (best && best.weight >= k[1]) return;
        var m = spaced(k[0]).exec(ln);
        var v = m ? cleanName(ln.slice(m.index + m[0].length)) : '';
        if (!v && i + 1 < lines.length && !hasAny(compact(lines[i + 1]), ['대표', '사업자', '번호'])) v = cleanName(lines[i + 1]);
        if (v) best = { value: v, weight: k[1] };
      });
    });
    if (best) return best;
    /* 상호를 가리키는 말이 없으면 맨 위 몇 줄에서 짐작한다 (확신 낮음) */
    for (var i = 0; i < Math.min(6, lines.length); i++) {
      var c = compact(lines[i]);
      if ((c.match(/[가-힣]/g) || []).length < 2) continue;
      /* 한글·숫자가 대부분이어야 한다 — 손글씨를 잘못 읽은 'Aku Barb 기하' 같은 줄을 거른다 */
      if ((c.match(/[가-힣\d]/g) || []).length < c.length * 0.6) continue;
      if (hasAny(c, VENDOR_GENERIC) || ADDRESS.test(lines[i])) continue;
      /* '상 후 : 명성문구'처럼 이름표가 잘못 읽혔으면 쌍점 뒤만 */
      var colon = lines[i].indexOf(':');
      var v = cleanName(colon > 0 && colon < 8 ? lines[i].slice(colon + 1) : lines[i]);
      if (v && v.length <= 25) return { value: v, weight: 0 };
    }
    return null;
  }

  function findPayment(c) {
    if (/계좌이체|무통장|이체확인/.test(c)) return '계좌이체';
    var card = /신용|체크카드|카드번호|카드결제|카드종류|카드사|승인번호|일시불|할부/.test(c);
    if (!card && /현금|받은금액|거스름/.test(c)) return '현금';
    if (card) return '카드';
    return null;
  }

  /* 읽은 글 → 영수증 값. ocrConf 는 글자 인식이 스스로 매긴 확신(0~100) */
  function parse(text, opts) {
    opts = opts || {};
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return tidy(l).trim(); })
      .filter(function (l) { return l.length > 0; });
    var amount = findAmount(lines);
    var date = findDate(lines, opts.today);
    var vendor = findVendor(lines);
    var payment = findPayment(compact(lines.join(' ')));
    /* 인쇄된 영수증은 대개 85 이상, 손글씨가 섞이면 60 안팎으로 나온다 */
    var blurry = typeof opts.ocrConf === 'number' && opts.ocrConf < 70;
    /* 글자가 흐리게 읽혔으면(손글씨 등) 짐작한 값은 버린다 — 엉뚱한 값을 칸에 채우지 않는다 */
    if (blurry && amount && !amount.weight) amount = null;
    if (blurry && vendor && !vendor.weight) vendor = null;

    var conf = 'low';
    if (amount && amount.weight >= 7 && date) conf = 'high';
    else if (amount && amount.weight > 0) conf = 'medium';
    if (blurry) conf = conf === 'high' ? 'medium' : 'low';

    var notes = [];
    if (!amount) notes.push('금액을 찾지 못했습니다');
    else if (!amount.weight) notes.push('합계 금액이 분명하지 않습니다');
    if (!date) notes.push('일자를 찾지 못했습니다');
    if (!vendor) notes.push('사용처를 찾지 못했습니다');
    if (blurry) notes.push('글자가 흐리게 읽혔습니다');

    return {
      taken_on: date ? date.value : null,
      vendor: vendor ? vendor.value : null,
      amount: amount ? amount.value : null,
      payment: payment,
      items: [],
      confidence: conf,
      note: notes.length ? notes.join(' · ') + '.' : null,
      weak: !amount || !amount.weight || !date || conf === 'low',
      source: 'ocr',
      ocr_conf: typeof opts.ocrConf === 'number' ? Math.round(opts.ocrConf) : null,
      text: String(text || '').slice(0, 2000)
    };
  }

  /* ================= 사진에서 글자 읽기 ================= */

  var scriptP = null, workerP = null, progressFn = null;

  function loadScript() {
    if (root.Tesseract) return Promise.resolve();
    if (!scriptP) {
      scriptP = new Promise(function (resolve, reject) {
        var sc = document.createElement('script');
        sc.src = TESS_URL;
        sc.onload = function () { resolve(); };
        sc.onerror = function () { scriptP = null; reject(new Error('글자 인식 프로그램을 받지 못했습니다 (인터넷 연결 확인)')); };
        document.head.appendChild(sc);
      });
    }
    return scriptP;
  }

  var STAGES = {
    'loading tesseract core': '글자 인식 프로그램 받는 중',
    'initializing tesseract': '글자 인식 준비 중',
    'loading language traineddata': '한글 자료 받는 중',
    'initializing api': '글자 인식 준비 중',
    'recognizing text': '글자 읽는 중'
  };
  function getWorker() {
    if (!workerP) {
      workerP = loadScript().then(function () {
        return root.Tesseract.createWorker(['kor', 'eng'], 1, {
          logger: function (m) {
            if (!progressFn || !m) return;
            var label = STAGES[m.status];
            if (!label) return;
            var pct = typeof m.progress === 'number' && m.progress > 0 && m.progress < 1 ? ' ' + Math.round(m.progress * 100) + '%' : '';
            progressFn(label + pct);
          }
        });
      }).then(function (w) {
        return w.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' }).then(function () { return w; });
      });
      workerP.catch(function () { workerP = null; });
    }
    return workerP;
  }

  /* 사진을 글자 읽기 좋게 — 짧은 변을 1000~1600px 로 맞추고, 회색으로 바꿔 대비를 늘린다 (바랜 감열지) */
  function prepare(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var short = Math.min(w, h), long = Math.max(w, h), sc = 1;
        if (short < 1000) sc = 1000 / short;
        if (short * sc > 1600) sc = 1600 / short;
        if (long * sc > 3200) sc = 3200 / long;
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * sc));
        cv.height = Math.max(1, Math.round(h * sc));
        var cx = cv.getContext('2d');
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        var id = cx.getImageData(0, 0, cv.width, cv.height), px = id.data, n = px.length / 4;
        var hist = new Array(256).fill(0), g = new Uint8ClampedArray(n);
        for (var i = 0; i < n; i++) {
          var v = Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
          g[i] = v; hist[v]++;
        }
        var lo = 0, hi = 255, acc = 0;
        for (lo = 0; lo < 255; lo++) { acc += hist[lo]; if (acc > n * 0.02) break; }
        acc = 0;
        for (hi = 255; hi > 0; hi--) { acc += hist[hi]; if (acc > n * 0.02) break; }
        var span = Math.max(1, hi - lo);
        for (var j = 0; j < n; j++) {
          var s = Math.max(0, Math.min(255, Math.round((g[j] - lo) * 255 / span)));
          px[j * 4] = px[j * 4 + 1] = px[j * 4 + 2] = s;
        }
        cx.putImageData(id, 0, 0);
        resolve(cv);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('사진 파일을 열지 못했습니다')); };
      img.src = url;
    });
  }

  function read(file, onProgress) {
    if (!file || !/^image\//.test(file.type || 'image/')) return Promise.reject(new Error('사진 파일이 아닙니다'));
    progressFn = onProgress || null;
    return Promise.all([prepare(file), getWorker()]).then(function (xs) {
      return xs[1].recognize(xs[0]);
    }).then(function (r) {
      progressFn = null;
      var d = (r && r.data) || {};
      return parse(d.text || '', { ocrConf: typeof d.confidence === 'number' ? d.confidence : undefined });
    }, function (err) {
      progressFn = null;
      throw err;
    });
  }

  /* 사진을 놓기 전에 미리 받아 두고 싶을 때 (입력칸을 열 때 등) */
  function preload() { return getWorker().then(function () { return true; }, function () { return false; }); }

  root.SHSReceiptOCR = { read: read, parse: parse, preload: preload };
})(typeof window !== 'undefined' ? window : globalThis);

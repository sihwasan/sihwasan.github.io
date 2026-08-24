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

  /* 서류 종류별 증명 문구 */
  function bodyText(rec) {
    var church = rec.church || '';
    var pos = rec.position || rec.pos || '';
    switch (rec.doc_type || rec.doc) {
      case '재직증명서':
        return '위 사람은 ' + NOHOE + ' 소속 ' + church + ' ' + pos + '(으)로 재직 중임을 증명합니다.';
      case '대표자증명서':
        return '위 사람은 ' + NOHOE + ' 소속 ' + church + '의 대표자임을 증명합니다.';
      case '직인증명서':
        return '위 ' + church + '의 직인은 본 노회에 등록된 직인임을 증명합니다.';
      case '은퇴목사확인서':
        return '위 사람은 ' + NOHOE + ' 소속 은퇴목사임을 확인합니다.';
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
    var signRows = ['노회장', '서기', '회록서기'].filter(function (k) {
      return seals[k] && seals[k].url;
    });

    var h = '<div class="cert-sheet' + (rec.void_yn ? ' cert-void' : '') + '">';
    if (rec.void_yn) {
      h += '<div class="cert-void-mark">무효</div>';
    }
    h += '<div class="c-no">' + esc(rec.doc_no || rec.no || '') + '</div>';
    h += '<h2>' + esc(docName) + '</h2>';
    h += '<table class="c-body"><tbody>' +
      '<tr><td>성　　명</td><td>' + esc(rec.name) + '</td></tr>' +
      '<tr><td>직　　위</td><td>' + esc(pos) + '</td></tr>' +
      '<tr><td>소　　속</td><td>대한예수교장로회 ' + esc(rec.church) + '</td></tr>' +
      '<tr><td>용　　도</td><td>' + esc(rec.purpose || '-') + '</td></tr>' +
      '</tbody></table>';
    h += '<div class="c-text">' + esc(body) + '</div>';
    h += '<div class="c-date">' + esc(dateKo(rec.issued_on || rec.date)) + '</div>';

    h += '<div class="cert-issuer-wrap"><div class="c-issuer">' + NOHOE + '장' +
      (rec.president ? ' ' + esc(rec.president) : '') +
      (seals['노회직인'] && seals['노회직인'].url
        ? '<img class="cert-seal" src="' + esc(seals['노회직인'].url) + '" alt="노회 직인">' : '') +
      '</div></div>';

    if (signRows.length) {
      h += '<div class="cert-signs">' + signRows.map(function (k) {
        var s = seals[k];
        return '<span class="row">' + esc(k) + (s.holder ? ' ' + esc(s.holder) : '') +
          '<img src="' + esc(s.url) + '" alt="' + esc(k) + ' 도장"></span>';
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

  /* 화면에서는 도장을 mix-blend-mode(multiply)로 겹쳐 찍지만, PDF를 뜨는
   * html2canvas는 이를 지원하지 않는다. 흰 바탕 도장이 글씨를 가리지 않도록
   * 내려받기 직전에 도장 그림의 흰 바탕을 투명하게 바꿔 둔다. */
  function sealToAlpha(img) {
    return new Promise(function (resolve) {
      function run() {
        try {
          if (!img.naturalWidth) { resolve(); return; }
          var cv = document.createElement('canvas');
          cv.width = img.naturalWidth;
          cv.height = img.naturalHeight;
          var cx = cv.getContext('2d');
          cx.drawImage(img, 0, 0);
          var d = cx.getImageData(0, 0, cv.width, cv.height);
          var p = d.data;
          for (var i = 0; i < p.length; i += 4) {
            if (p[i] > 235 && p[i + 1] > 235 && p[i + 2] > 235) p[i + 3] = 0;
          }
          cx.putImageData(d, 0, 0);
          img.onload = null;
          img.src = cv.toDataURL('image/png');
        } catch (x) {}
        resolve();
      }
      if (img.complete) run();
      else { img.onload = run; img.onerror = function () { resolve(); }; }
    });
  }

  function downloadPdf(rec) {
    return loadTool().then(function (html2pdf) {
      var stage = document.createElement('div');
      stage.className = 'cert-pdf-stage';
      stage.setAttribute('aria-hidden', 'true');
      stage.innerHTML = sheet(rec);
      stage.firstChild.classList.add('cert-pdf-a4');
      document.body.appendChild(stage);
      var seals = [];
      stage.querySelectorAll('img').forEach(function (img) { seals.push(sealToAlpha(img)); });
      /* 글꼴이 다 준비된 뒤에 그려야 한글이 제 모양으로 담긴다 */
      var fonts = (document.fonts && document.fonts.ready)
        ? document.fonts.ready.then(null, function () {}) : Promise.resolve();
      return Promise.all(seals.concat([fonts])).then(function () {
        return html2pdf().set({
          margin: 0,
          filename: fileName(rec) + '.pdf',
          image: { type: 'jpeg', quality: 0.98 },
          /* scrollX·scrollY 0: 화면이 내려가 있어도 증명서가 밀리지 않게 한다 */
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(stage.firstChild).save();
      }).then(function () { stage.remove(); },
        function (x) { stage.remove(); throw x; });
    });
  }

  return {
    sheet: sheet,
    bodyText: bodyText,
    dateKo: dateKo,
    fileName: fileName,
    print: print,
    downloadPdf: downloadPdf
  };
})();

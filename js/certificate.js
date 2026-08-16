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

  /* 파일 이름: 소속증명서_홍길동_20260816 */
  function fileName(rec) {
    var d = new Date();
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

  return {
    sheet: sheet,
    bodyText: bodyText,
    dateKo: dateKo,
    fileName: fileName,
    print: print
  };
})();

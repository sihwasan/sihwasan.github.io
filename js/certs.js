/* 증명서 보관소 연결
 *
 * 발급한 증명서 PDF는 Cloudflare R2에, 발급 기록은 Supabase에 나누어
 * 보관한다. 발급할 때 만든 그 파일을 그대로 내려받으므로 언제 받아도
 * 모습이 똑같다.
 *
 * 보관소가 설정되어 있지 않거나 보관에 실패했더라도 발급은 그대로
 * 성공한다. 그런 건은 예전처럼 브라우저가 새로 그려서 내려받는다.
 * 그래서 이 파일 때문에 증명서를 못 받는 일은 없다.
 *
 * 비밀 열쇠는 이 파일에 없다. 보관소에는 로그인 증표만 보내고,
 * 누가 무엇을 받을 수 있는지는 Supabase가 정한다.
 */
var SHSCerts = (function () {
  'use strict';

  function base() {
    var b = (window.SHS_CERTS && SHS_CERTS.base) || '';
    return b.replace(/\/+$/, '');
  }

  function enabled() { return !!base(); }

  /* 로그인 증표를 얻는다. 보관소는 이 증표로 권한을 확인한다. */
  function token() {
    if (!(window.SHSCloud && SHSCloud.enabled())) return Promise.resolve(null);
    return SHSCloud.init().then(function (c) {
      if (!c) return null;
      return c.auth.getSession().then(function (r) {
        return (r && r.data && r.data.session && r.data.session.access_token) || null;
      });
    }).catch(function () { return null; });
  }

  function ask(method, path, id, body, type) {
    if (!enabled()) return Promise.reject(new Error('증명서 보관소가 설정되지 않았습니다.'));
    return token().then(function (t) {
      if (!t) throw new Error('로그인이 확인되지 않았습니다.');
      var h = { 'Authorization': 'Bearer ' + t };
      if (type) h['Content-Type'] = type;
      return fetch(base() + path + '?issue_id=' + encodeURIComponent(id), {
        method: method, headers: h, body: body || undefined
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        var err = new Error(j.error || ('보관소에 연결하지 못했습니다. (' + r.status + ')'));
        err.status = r.status;
        err.noFile = !!j.no_file;
        throw err;
      });
    });
  }

  /* 발급한 증명서 PDF를 보관소에 올린다.
   * 성공하면 { key, path, url, size } 를 돌려준다. */
  function upload(issueId, blob) {
    return ask('POST', '/upload', issueId, blob, 'application/pdf');
  }

  /* 내려받을 주소를 받아 온다 (10분간 유효).
   * 보관본이 없으면 noFile 이 참인 오류가 난다. */
  function signed(issueId) {
    return ask('GET', '/sign', issueId, null, null);
  }

  /* 보관본을 지운다. 실패해도 예외를 던지지 않는다. */
  function remove(issueId) {
    if (!enabled()) return Promise.resolve(false);
    return ask('POST', '/delete', issueId, null, null)
      .then(function () { return true; }, function () { return false; });
  }

  /* 보관본이 있는 발급 건인지 (doc_issues 한 줄을 그대로 넘긴다) */
  function stored(rec) {
    return !!(rec && rec.pdf_uploaded_at && rec.pdf_path);
  }

  /* 브라우저에 파일로 떨어뜨린다 */
  function saveBlob(blob, name) {
    var u = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = u;
    a.download = name || 'certificate.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
  }

  /* 보관해 둔 증명서를 내려받는다.
   * 보관본이 없거나 보관소에 문제가 있으면 거절되므로,
   * 부르는 쪽에서 예전 방식(브라우저가 새로 그리기)으로 넘어가면 된다. */
  function download(issueId) {
    return signed(issueId).then(function (j) {
      if (!j || !j.url) throw new Error('보관된 증명서를 찾지 못했습니다.');
      return fetch(j.url).then(function (r) {
        if (!r.ok) throw new Error('보관된 증명서를 내려받지 못했습니다. (' + r.status + ')');
        return r.blob();
      }).then(function (b) {
        saveBlob(b, j.filename);
        return true;
      }, function () {
        /* 브라우저가 막아서 직접 받지 못하면 새 창으로 열어 준다 */
        window.open(j.url, '_blank', 'noopener');
        return true;
      });
    });
  }

  /* ---------- 발급 직후 : 만든 PDF를 보관소에 올려 둔다 ----------
   * 올리지 못해도 발급은 그대로다. 이 함수는 실패로 끝나지 않으며,
   * 보관에 성공하면 pdf_* 가 채워진 발급 기록을, 실패하면 받은 것을
   * 그대로 돌려준다. */
  function keep(rec) {
    if (!enabled() || !rec || !rec.id || !window.SHSCert) return Promise.resolve(rec);
    return SHSCert.pdfBlob(rec).then(function (blob) {
      return upload(rec.id, blob);
    }).then(function (j) {
      var at = new Date().toISOString();
      return SHSCloud.init().then(function (c) {
        return c.from('doc_issues').update({
          pdf_url: j.url, pdf_path: j.path || j.key,
          pdf_size: j.size, pdf_uploaded_at: at
        }).eq('id', rec.id);
      }).then(function (r) {
        if (r && r.error) throw r.error;
        rec.pdf_url = j.url;
        rec.pdf_path = j.path || j.key;
        rec.pdf_size = j.size;
        rec.pdf_uploaded_at = at;
        return rec;
      });
    }).catch(function () { return rec; });
  }

  /* ---------- 내려받기 (한 군데로 모아 둔다) ----------
   * 보관본이 있으면 그 파일을 그대로 주고, 없으면 예전처럼 브라우저가
   * 증명서를 새로 그려서 PDF로 만든다. 어느 쪽이든 받는 모습은 같다.
   *
   * 무효 처리된 증명서는 보관본에 '무효' 표시가 없으므로, 보관본을 쓰지
   * 않고 늘 새로 그린다. */
  function get(rec) {
    var fresh = function () { return SHSCert.downloadPdf(rec); };
    if (!enabled() || !rec || !rec.id || rec.void_yn || !stored(rec)) return fresh();
    return download(rec.id).catch(fresh);
  }

  return {
    enabled: enabled,
    upload: upload,
    signed: signed,
    download: download,
    remove: remove,
    stored: stored,
    saveBlob: saveBlob,
    keep: keep,
    get: get
  };
})();

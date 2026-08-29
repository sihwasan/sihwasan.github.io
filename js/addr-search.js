/* 도로명주소 검색 (다음 우편번호 서비스)
 *
 * 주소 칸 옆의 [주소 검색] 단추가 이 헬퍼를 부른다. 검색 창에서 주소를
 * 고르면 도로명주소가 주소 칸에, 우편번호가 우편번호 칸에 저절로 채워진다.
 * 새 창(팝업)은 차단되는 일이 많아, 화면 위에 덮는 층 안에 심어서 연다.
 *
 *   SHSAddr.open(주소input, 우편번호input)
 *   단추에 data-addrsearch="주소id,우편번호id" 를 붙여도 된다.
 */
var SHSAddr = (function () {
  'use strict';

  var loading = null;

  function ensure() {
    if (window.daum && window.daum.Postcode) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      s.onload = resolve;
      s.onerror = function () {
        loading = null;
        reject(new Error('주소 검색을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  function open(addrEl, postEl) {
    if (!addrEl || addrEl.disabled) return;
    ensure().then(function () {
      var old = document.getElementById('addr-modal');
      if (old) old.remove();
      var ov = document.createElement('div');
      ov.id = 'addr-modal';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,25,45,.55);z-index:400;' +
        'display:flex;align-items:center;justify-content:center;padding:20px';
      ov.innerHTML = '<div style="background:#fff;border-radius:8px;width:100%;max-width:520px;' +
        'position:relative;padding:8px;box-shadow:0 10px 40px rgba(0,0,0,.3)">' +
        '<button class="addr-x" aria-label="닫기" style="position:absolute;top:4px;right:10px;' +
        'border:none;background:none;font-size:1.4rem;color:#888;cursor:pointer">&times;</button>' +
        '<div class="addr-embed" style="height:460px;margin-top:28px"></div></div>';
      document.body.appendChild(ov);
      function close() { ov.remove(); }
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      ov.querySelector('.addr-x').addEventListener('click', close);

      new window.daum.Postcode({
        oncomplete: function (data) {
          var addr = data.roadAddress || data.address || '';
          if (data.buildingName && addr.indexOf(data.buildingName) === -1) {
            addr += ' (' + data.buildingName + ')';
          }
          addrEl.value = addr;
          if (postEl && !postEl.disabled) postEl.value = data.zonecode || '';
          close();
          addrEl.focus();
          /* 값이 스크립트로 바뀌었음을 화면 코드에 알린다 */
          addrEl.dispatchEvent(new Event('input', { bubbles: true }));
          if (postEl) postEl.dispatchEvent(new Event('input', { bubbles: true }));
        },
        width: '100%',
        height: '100%'
      }).embed(ov.querySelector('.addr-embed'));
    }).catch(function (x) { alert(x.message); });
  }

  /* 문서 어디서든 data-addrsearch="주소id,우편번호id" 단추를 누르면 열린다 */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-addrsearch]') : null;
    if (!b) return;
    ev.preventDefault();
    var ids = String(b.dataset.addrsearch).split(',');
    open(document.getElementById(ids[0]), document.getElementById(ids[1] || ''));
  });

  return { open: open };
})();

/* 앱 안의 브라우저(카카오톡·네이버 앱·인스타그램 등)에서 구글 로그인 막힘 안내
 *
 * 카카오톡·네이버 앱 같은 앱이 링크를 자기 안의 브라우저(웹뷰)로 열면
 * 구글 로그인이 끝까지 진행되지 않는다. 특히 2단계 인증(휴대전화의 "예, 본인이 맞습니다")을
 * 눌러도 페이지가 다음으로 넘어가지 못하고 비밀번호 화면으로 되돌아간다.
 * (2026-09-11 네이버 앱에서 실제로 보고된 증상. 구글은 웹뷰에서의 로그인을 정식으로 지원하지 않는다.)
 *
 * 그래서 로그인·회원가입 화면에서
 *   · 앱 안 브라우저면 노란 안내를 보이고,
 *   · 구글 단추를 누르면 구글로 가지 않고 기본 브라우저(크롬·사파리)로 이 주소를 열어 준다.
 *     - 카카오톡 : kakaotalk://web/openExternal (안드로이드·아이폰 모두)
 *     - 안드로이드 : intent:// 로 크롬 열기 (크롬이 없으면 원래 주소로)
 *     - 아이폰의 네이버 앱 등 : 자동으로 열 방법이 없어 메뉴 사용법과 「주소 복사」를 안내
 *   이메일 로그인과 네이버 로그인은 앱 안에서도 되므로 그 길도 함께 알린다.
 *
 *   SHSInApp.kind()            → { id, name } 또는 null (보통 브라우저)
 *   SHSInApp.mount(구글 단추)  → 단추 앞에 안내를 넣는다 (앱 안 브라우저일 때만)
 *   SHSInApp.guardGoogle(단추) → 단추를 누르면 구글 대신 기본 브라우저 열기
 */
var SHSInApp = (function () {
  'use strict';

  var ua = navigator.userAgent || '';
  var isAndroid = /Android/i.test(ua);
  var isIOS = /iPhone|iPad|iPod/i.test(ua);

  function detect() {
    if (/KAKAOTALK/i.test(ua)) return { id: 'kakao', name: '카카오톡' };
    if (/NAVER\(inapp/i.test(ua)) return { id: 'naver', name: '네이버 앱' };
    if (/Instagram/i.test(ua)) return { id: 'instagram', name: '인스타그램' };
    if (/FBAN|FBAV|FB_IAB/i.test(ua)) return { id: 'facebook', name: '페이스북' };
    if (/\bLine\//i.test(ua)) return { id: 'line', name: '라인' };
    if (/DaumApps|DaumDevice/i.test(ua)) return { id: 'daum', name: '다음 앱' };
    if (/\bBAND\b/.test(ua) && (isAndroid || isIOS)) return { id: 'band', name: '밴드 앱' };
    /* 안드로이드 웹뷰는 사용자 에이전트에 '; wv)' 표시가 붙는다 */
    if (isAndroid && /; wv\)/.test(ua)) return { id: 'webview', name: '앱 안의 브라우저' };
    return null;
  }
  var K = detect();

  function pageUrl() { return location.href.split('#')[0]; }

  /* 자동으로 기본 브라우저를 열 수 있는가 */
  function canOpen() {
    return !!K && (K.id === 'kakao' || isAndroid);
  }

  /* 기본 브라우저로 이 주소를 연다. 열렸는지 알 수는 없으므로 안내도 함께 보인다 */
  function openExternal(url) {
    url = url || pageUrl();
    if (K && K.id === 'kakao') {
      location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
      return true;
    }
    if (isAndroid) {
      var bare = url.replace(/^https?:\/\//, '');
      location.href = 'intent://' + bare + '#Intent;scheme=https;package=com.android.chrome;' +
        'S.browser_fallback_url=' + encodeURIComponent(url) + ';end';
      return true;
    }
    return false;
  }

  function copyUrl(btn) {
    var url = pageUrl();
    function done(ok) {
      if (!btn) return;
      var t = btn.textContent;
      btn.textContent = ok ? '복사했습니다' : '복사하지 못했습니다';
      setTimeout(function () { btn.textContent = t; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
      return;
    }
    try {
      var ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      done(ok);
    } catch (e) { done(false); }
  }

  /* 앱마다 「다른 브라우저로 열기」 메뉴 위치가 다르다 */
  function manualSteps() {
    if (!K) return '';
    if (K.id === 'naver') return '화면 오른쪽 아래 <strong>≡</strong> 메뉴 → <strong>다른 브라우저로 열기</strong>';
    if (K.id === 'kakao') return '화면 오른쪽 위 <strong>⋮</strong> → <strong>다른 브라우저로 열기</strong>';
    if (isIOS) return '공유(내보내기) 단추 → <strong>Safari로 열기</strong>';
    return '오른쪽 위 <strong>⋮</strong> 메뉴 → <strong>다른 브라우저로 열기</strong>(또는 크롬으로 열기)';
  }

  function html() {
    return '<div class="notice-banner" id="inapp-notice" style="border-color:#e0c060;background:#fdf8e6;text-align:left">' +
      '<strong>' + K.name + ' 안에서는 구글 로그인이 끝까지 되지 않습니다.</strong> ' +
      '<span style="font-size:0.88rem">(2단계 인증에서 「예」를 눌러도 다음으로 넘어가지 못하고 비밀번호 화면으로 돌아갑니다)</span><br>' +
      '<span style="font-size:0.92rem">크롬·사파리 같은 <strong>기본 브라우저에서 이 주소를 열어</strong> 로그인해 주세요. ' +
      manualSteps() + '</span>' +
      '<div style="margin-top:8px">' +
      (canOpen() ? '<button type="button" class="btn sm" id="inapp-open">기본 브라우저로 열기</button> ' : '') +
      '<button type="button" class="btn ghost sm" id="inapp-copy">주소 복사</button></div>' +
      '<div style="font-size:0.82rem;color:var(--gray-5);margin-top:6px">이메일·비밀번호 로그인과 네이버 로그인은 여기서도 그대로 됩니다.</div>' +
      '</div>';
  }

  /* 구글 단추 앞에 안내를 넣는다. 보통 브라우저면 아무것도 하지 않는다 */
  function mount(beforeEl) {
    if (!K || !beforeEl || document.getElementById('inapp-notice')) return !!K;
    var box = document.createElement('div');
    box.innerHTML = html();
    var el = box.firstChild;
    beforeEl.parentNode.insertBefore(el, beforeEl);
    var ob = document.getElementById('inapp-open');
    if (ob) ob.addEventListener('click', function () { openExternal(); });
    var cb = document.getElementById('inapp-copy');
    if (cb) cb.addEventListener('click', function () { copyUrl(cb); });
    return true;
  }

  /* 구글 단추를 누르면 구글로 가지 않고 기본 브라우저를 연다.
   * 이 함수는 원래 클릭 처리기보다 먼저 등록해야 한다 (같은 요소에서는 등록 순서대로 실행된다). */
  function guardGoogle(btn) {
    if (!K || !btn) return;
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      mount(btn);
      if (!openExternal()) {
        var n = document.getElementById('inapp-notice');
        if (n) { n.scrollIntoView({ behavior: 'smooth', block: 'center' }); n.style.boxShadow = '0 0 0 3px #e0c060'; }
      }
    }, true);
  }

  return { kind: function () { return K; }, mount: mount, guardGoogle: guardGoogle, openExternal: openExternal };
})();

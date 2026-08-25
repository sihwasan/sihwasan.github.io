/* 시화산노회 홈페이지 - Supabase 연결 설정
 *
 * 아래 두 값은 Supabase 대시보드에서 확인합니다.
 *   Project Settings → API → Project URL / Project API keys(anon public)
 *
 * anon 키는 브라우저에 공개되는 것이 정상입니다.
 * 실제 접근 제어는 데이터베이스의 RLS 정책이 담당하므로 이 키만으로는
 * 권한 없는 자료를 볼 수 없습니다.
 */

var SHS_SUPABASE = {
  url: 'https://ltbhgwozkffenahqdzfj.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0Ymhnd296a2ZmZW5haHFkemZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNDk0MDYsImV4cCI6MjEwMTkyNTQwNn0.nSptHsi7nTCWTiyTe_Kl9xpxyHJ3pkhRGoZLI1BdsnI',

  /* 로그인(구글) 후 돌아올 주소.
   * 주소를 고정해 두면 새 주소(sihwasan.org)에서 로그인했을 때
   * 옛 주소로 튕겨 나가므로, 지금 보고 있는 주소를 그대로 쓴다.
   * ※ Supabase 대시보드 Authentication → URL Configuration 의
   *   Redirect URLs 에 쓰는 주소가 모두 등록되어 있어야 한다. */
  redirectTo: (function () {
    try {
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        return location.origin +
               location.pathname.replace(/[^/]*$/, '') +
               'auth-callback.html';
      }
    } catch (e) { /* 파일로 직접 열어 본 경우 */ }
    return 'https://sihwasan.org/auth-callback.html';
  })()
};

/* 설정이 완료되었는지 확인 */
SHS_SUPABASE.ready = function () {
  return !!(this.url && this.anonKey);
};

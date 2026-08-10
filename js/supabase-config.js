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
  anonKey: '',   /* ← 여기에 anon public 키를 붙여넣으세요 */

  /* 로그인 후 돌아올 주소 */
  redirectTo: 'https://sihwasan.github.io/auth-callback.html'
};

/* 설정이 완료되었는지 확인 */
SHS_SUPABASE.ready = function () {
  return !!(this.url && this.anonKey);
};

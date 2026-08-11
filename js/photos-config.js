/* 사진 보관소 주소 (Cloudflare)
 *
 * base 가 비어 있으면 사진은 예전처럼 Supabase에 올라갑니다.
 * Cloudflare 보관소를 켜면 아래 주소가 채워지고, 그때부터
 *   사진 → Cloudflare,  글·명단·기록 → Supabase
 * 로 나뉘어 보관됩니다. 이미 올라간 사진은 그대로 보입니다.
 */
var SHS_PHOTOS = {
  base: ''
};

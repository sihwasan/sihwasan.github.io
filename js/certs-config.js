/* 증명서 보관소 주소 (Cloudflare)
 *
 * base 가 비어 있으면 증명서를 보관하지 않고, 예전처럼 내려받을 때마다
 * 브라우저가 증명서를 새로 그려서 PDF로 만듭니다.
 * 주소가 채워져 있으면 발급하는 순간 만든 PDF를 보관소에 한 번 올려 두고,
 * 다음부터는 그 파일을 그대로 내려받습니다.
 *
 * 사진 보관소(js/photos-config.js)와 서로 다른 보관함을 씁니다.
 */
var SHS_CERTS = {
  base: 'https://sihwasan-certs.sihwasan.workers.dev'
};

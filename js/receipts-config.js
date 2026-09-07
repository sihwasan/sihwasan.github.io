/* 영수증 자동 읽기 창구 주소 (Cloudflare Worker → Claude API)
 *
 * base 가 비어 있으면 자동 읽기를 하지 않고 사진만 보관합니다.
 * 창구(cloudflare/receipts)를 배포하고 ANTHROPIC_API_KEY 를 넣으면
 * 영수증을 올릴 때 일자·사용처·금액을 읽어 입력칸에 미리 채웁니다.
 * 저장은 언제나 회계가 확인한 뒤에 합니다.
 */
var SHS_RECEIPTS = {
  base: 'https://sihwasan-receipts.sihwasan.workers.dev'
};

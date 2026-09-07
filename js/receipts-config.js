/* 영수증 자동 읽기 창구 주소 (Cloudflare Worker → Claude API)
 *
 * base 가 비어 있으면 자동 읽기를 하지 않고 사진만 보관합니다.
 * 창구(cloudflare/receipts)를 배포하고 ANTHROPIC_API_KEY 를 넣으면
 * 영수증을 올릴 때 일자·사용처·금액을 읽어 입력칸에 미리 채웁니다.
 * 저장은 언제나 회계가 확인한 뒤에 합니다.
 */
var SHS_RECEIPTS = {
  /* 이 워커는 kds08200820 계정에 올라가 있다 (다른 워커 셋과 다른 계정). */
  base: 'https://sihwasan-receipts.kds08200820.workers.dev'
};

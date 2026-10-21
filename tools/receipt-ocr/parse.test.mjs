/* node tools/receipt-ocr/parse.test.mjs
 * 영수증 브라우저 OCR(js/receipt-ocr.js)의 '읽은 글 → 일자·사용처·금액·결제 수단' 규칙 시험.
 * 글은 시험용으로 그린 영수증을 Tesseract.js 가 실제로 읽은 그대로다 (잘못 읽은 글자 포함).
 * 실제 영수증 글은 공개 저장소에 넣지 않는다.
 */
import '../../js/receipt-ocr.js';

const { parse } = globalThis.SHSReceiptOCR;
const today = new Date('2026-10-22T09:00:00+09:00');
let fails = 0, passes = 0;
function ok(c, m) { if (c) { passes++; console.log('  통과', m); } else { fails++; console.log('  실패', m); } }
function check(name, text, exp, opts) {
  const r = parse(text, Object.assign({ today }, opts || {}));
  console.log('[' + name + ']', JSON.stringify({ taken_on: r.taken_on, vendor: r.vendor, amount: r.amount, payment: r.payment, confidence: r.confidence, weak: r.weak }));
  Object.keys(exp).forEach((k) => ok(r[k] === exp[k], name + ' ' + k + ' = ' + JSON.stringify(exp[k]) + (r[k] === exp[k] ? '' : ' (받음 ' + JSON.stringify(r[k]) + ')')));
  return r;
}

/* 편의점 POS 영수증 — 합계금액·받을금액·신용카드가 모두 있고, 부가세·과세물품가액은 건너뛴다 */
check('편의점', `GS25 화성봉담점
사업자번호: 123-45-67890
대표: 김철수 6ㄴ031-123-4567
경기도 화성시 봉담읍 동화길 12
[영수증] 2026-10-15 14:32:07
상품명                                 수량 =9
생수 2Ｌ                                       2 2400
종이컵 50입                               1 3500
과세물품가액                                   9,000
부가세                                          900
합계금액                                      9,900
받을금액                                      9,900
신용카드                                      9,900
카드번호 5409-12+*.++%+.3456
SOUYD 30012345 일시불`, { taken_on: '2026-10-15', vendor: 'GS25 화성봉담점', amount: 9900, payment: '카드', weak: false });

/* 카드 매출전표 — 두 자리 연도(26/10/08), 가맹점명, 공급가액·부가세 대신 합계 */
check('카드전표', `카드매출전표 (고객용)
가맹점명 : 한우마을 정육식당
사업자번호 135-81-12345
대표자 박영희
거래일시 26/10/08 12:45
카드종류 국민카드
승인번호 77889911
공급가액                                       136,364
부가세                                          13,636
합계                                          150,000`, { taken_on: '2026-10-08', vendor: '한우마을 정육식당', amount: 150000, payment: '카드', confidence: 'high' });

/* 간이영수증 — '상 호' 띄어 읽힘, 성명은 잘라 냄, 쉼표 대신 점(35.000), 년월일 */
check('간이영수증', `영수증
시화산노회 귀하
상 호 : 명성문구    성 명 : 이민호
사업자등록번호 : 214-12-55555
작성년월일 : 2026년 9월 30일
품목                                            금액
A4 BX] 5박스                                 35.000
볼펜 1다스                                    10,000
합계금액.                                     45,000원
위 금액을 영수함`, { taken_on: '2026-09-30', vendor: '명성문구', amount: 45000, payment: null });

/* 이체확인증 — 받는분이 사용처, 이체금액, 계좌이체 */
check('이체확인', `이체확인증
이체일시 2026.09.01 10:21:33
출금계좌 =% 352-***.1234-53
받는분 홍길동
입금은행 국민은행
이체금액                300,000원
수수료                    0원`, { taken_on: '2026-09-01', vendor: '홍길동', amount: 300000, payment: '계좌이체' });

/* 통합 카드 영수증 모양 — '가맹점명'(결제 대행사)보다 '판매자상호'를 먼저, 승인금액·합계 */
check('통합카드', `통합 카드 영수증
카드사/승인번호                      신한/11112222
거래종류/할부                     신용(개인) / 일시불
결제일자                      2026-03-18 07:44:40
판매자상호                             시험도장방
대표자명                              홍길동
사업자등록번호                       111-22.33333
전화번호                           02-123-4567
가맹점명                     결제대행 주식회사
승인금액                              21,700
부가세액                                                                                                1972
봉사료                                  0
합계                               21,700`, { taken_on: '2026-03-18', vendor: '시험도장방', amount: 21700, payment: '카드' });

/* 손글씨 — 글자 인식이 흐리게 읽음(확신 57). 짐작한 엉뚱한 값은 버리고 AI 를 권한다 */
check('손글씨', `4  A  o>
No. 3  [iT @ J
Aku Barb 、 기하
  501-03-26147
 서울 중구 서애로5길 42 25
22: y stlw bpe.ev0 ||
|G) boy dom | 1299여이
 Ww £8 .099
위 금액을 영수(청구)함.`, { amount: null, taken_on: null, vendor: null, weak: true, confidence: 'low' }, { ocrConf: 57 });

/* 날짜 규칙 — 앞날·3년 넘은 날·없는 날짜는 받지 않는다 */
check('미래 날짜', '거래일시 2027-01-05\n합계 10,000', { taken_on: null, amount: 10000 });
check('없는 날짜', '거래일시 2026-02-30\n합계 10,000', { taken_on: null });
/* 합계 말이 없으면 천 단위 쉼표가 있는 가장 큰 숫자 — 확신 낮음 */
check('합계 말 없음', '어느가게\n2026-10-01\n떡 12,000\n음료 3,000', { amount: 12000, confidence: 'low', weak: true });

console.log(`\n통과 ${passes} / 실패 ${fails}`);
if (fails) process.exit(1);

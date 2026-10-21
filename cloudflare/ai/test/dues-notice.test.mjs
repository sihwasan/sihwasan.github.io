/* node cloudflare/ai/test/dues-notice.test.mjs
 * 상회비 3개월 이상 미납 — 납부촉구 공문 대상 (137 sql) 이 임원 업무 보고서 자료에 바르게 들어가는지
 *   1) overdueNotices: 기한 지난 달(이번 달 제외·유예일) · 3개월 이상 · 월액 0원 제외 · 공문 발송 여부
 *   2) stableContext: 「상회비 3개월 이상 미납 — 납부촉구 공문」 자리 (137 실행 전이면 오류 표시만)
 *   3) 직책별 지시: 회계(월례회 보고)·서기(공문 발송)·노회장(보고 받음)
 */
import { overdueNotices, stableContext, NOTICE_MIN_MONTHS } from '../src/reports.js';

let fails = 0, passes = 0;
function ok(c, m) { if (c) { passes++; console.log('  통과', m); } else { fails++; console.log('  실패', m); } }

function bundle(today, notice) {
  return {
    today: today, fiscal_year: 2026, settings: {}, officers: [],
    dues_rates: [
      { church: '반석', sichal: '남부시찰', pastor: '강명우', monthly: 10 },      // 4~9월 미납 → 6개월
      { church: '안산샬롬', sichal: '북부시찰', pastor: '송요한', monthly: 5 },   // 4·5·6 냄, 7·8·9 미납 → 3개월
      { church: '연수', sichal: '남부시찰', pastor: '김성신', monthly: 10 },      // 9월만 미납 → 1개월
      { church: '서안문호', sichal: '상록시찰', pastor: '김종수(임)', monthly: 0 } // 월액 0원 → 대상 아님
    ],
    dues_payments: [
      { church: '안산샬롬', month: 4 }, { church: '안산샬롬', month: 5 }, { church: '안산샬롬', month: 6 },
      { church: '연수', month: 4 }, { church: '연수', month: 5 }, { church: '연수', month: 6 }, { church: '연수', month: 7 }, { church: '연수', month: 8 }
    ],
    dues_notice: notice
  };
}

console.log('[대상 셈]');
let od = overdueNotices(bundle('2026-10-21', { fy: 2026, grace_days: 3, notices: [], reports: [] }));
ok(NOTICE_MIN_MONTHS === 3, '기준 3개월');
ok(od.rows.map((r) => r.church).join(',') === '반석,안산샬롬', '10월 21일: 반석(6개월)·안산샬롬(3개월)만, 1개월·월액 0원은 빠짐 — ' + od.rows.map((r) => r.church).join(','));
ok(od.rows[0].late.join('·') === '4·5·6·7·8·9' && od.rows[0].amount === 60 && od.total === 75, '이번 달(10월)은 아직 기한 전 · 합계 75만원');
ok(od.rows.every((r) => !r.sent) && od.sent === 0 && od.report === null, '공문 미발송');

od = overdueNotices(bundle('2026-10-02', { fy: 2026, grace_days: 3, notices: [], reports: [] }));
ok(od.rows.map((r) => r.church).join(',') === '반석', '10월 2일(유예일 안): 9월분은 아직 안 셈 → 안산샬롬 2개월로 빠짐');
ok(od.rows[0].late.join('·') === '4·5·6·7·8', '반석 4~8월');

od = overdueNotices(bundle('2026-10-21', { fy: 2026, grace_days: 3, reports: [{ month: '2026-10', churches: 2, amount: 75, by: '김득철 회계' }],
  notices: [{ church: '반석', doc_no: '시화산노 제 20-12 호', sent_on: '2026-10-21', sent_by: '권병렬 서기', months: [4, 5, 6, 7, 8, 9], amount: 60 },
            { church: '반석', doc_no: '시화산노 제 20-3 호', sent_on: '2026-08-01', sent_by: '권병렬 서기', months: [4, 5, 6], amount: 30 }] }));
ok(od.rows[0].sent === '2026-10-21' && od.rows[0].doc_no === '시화산노 제 20-12 호' && !od.rows[1].sent && od.sent === 1, '가장 최근 발송을 쓴다');
ok(od.report && od.report.month === '2026-10', '마지막 월례회 보고');

/* 137 실행 전 — 발송 기록 없이 셈만 */
od = overdueNotices(bundle('2026-10-21', { error: 'ai_report_dues_notices 실패 (HTTP 404)' }));
ok(od.rows.length === 2 && od.grace === 3 && od.sent === 0, '137 전에도 대상은 셈 (유예일 기본 3일)');

console.log('[자료 글]');
let ctx = stableContext(bundle('2026-10-21', { fy: 2026, grace_days: 3, notices: [{ church: '반석', doc_no: '시화산노 제 20-12 호', sent_on: '2026-10-21', sent_by: '권병렬 서기' }], reports: [] }));
ok(/## 상회비 3개월 이상 미납 — 납부촉구 공문/.test(ctx), '자리 제목');
ok(/- 반석 \(남부시찰\) · 담임 강명우 · 밀린 달 4·5·6·7·8·9월 \(6개월, 60만원\) · 공문 발송 2026-10-21 시화산노 제 20-12 호 \(권병렬 서기\)/.test(ctx), '반석 줄 (발송함)');
ok(/- 안산샬롬 \(북부시찰\) · 담임 송요한 · 밀린 달 7·8·9월 \(3개월, 15만원\) · 공문 미발송/.test(ctx), '안산샬롬 줄 (미발송)');
ok(/대상 2곳 · 미납 합계 75만원 · 공문 보낸 곳 1\/2 · 홈페이지에 올린 월례회 보고 없음/.test(ctx), '요약 줄');
ok(ctx.indexOf('서안문호 (상록시찰) · 담임 김종수(임) · 밀린 달') === -1, '월액 0원 교회는 공문 자리에 없음');
ctx = stableContext(bundle('2026-10-21', { error: 'ai_report_dues_notices 실패 (HTTP 404)' }));
ok(/## 상회비 3개월 이상 미납 — 납부촉구 공문 \(노회규칙 제28·29조, 미리 계산함\) \(자료를 읽지 못함: ai_report_dues_notices/.test(ctx), '137 전이면 읽지 못함 표시');

console.log('[직책별 지시]');
const src = (await import('node:fs')).readFileSync(new URL('../src/reports.js', import.meta.url), 'utf8');
const guide = (k) => { const i = src.indexOf('  ' + k + ':\n'); return src.slice(i, src.indexOf('\n  ', src.indexOf("',\n", i) + 2)); };
ok(/월례 보고서\(매월 첫째 월요일\)에 「3개월 이상 미납 보고」/.test(guide('treasurer')) && /월례회 보고서 → 보고하기/.test(guide('treasurer')), '회계: 월례회 보고');
ok(/「공문 미발송」인 교회는 「납부촉구 공문 발송」/.test(guide('clerk')) && /발송 기록/.test(guide('clerk')), '서기: 공문 발송');
ok(/공문 발송 진행\(보낸 곳\/대상\)/.test(guide('president')), '노회장: 보고 받음');

console.log((fails ? '실패 ' + fails + '건, ' : '') + '통과 ' + passes + '건');
process.exit(fails ? 1 : 0);

/* node cloudflare/ai/test/search.test.mjs  — 색인 검색이 제대로 고르는지 눈으로 본다 */
import { readFileSync } from 'node:fs';
import { Index, terms, snippets } from '../src/search.js';

const idx = new Index(JSON.parse(readFileSync(new URL('../../../data/ai/index.json', import.meta.url), 'utf8')).chunks);
console.log('chunks', idx.N);

const Q = [
  ['권징조례에서 해벌은 어떻게 하나요', { scope: 'constitution' }],
  ['목사 면직 후 해벌과 복직 절차', {}],
  ['제110회 총회에서 결의한 노회 분립', { scope: 'resolutions' }],
  ['위임목사 청빙 절차', {}],
  ['노회 임원 선거 규정', { scope: 'rules' }]
];
for (const [q, o] of Q) {
  console.log('\n### ' + q, JSON.stringify(terms(q)));
  const t0 = Date.now();
  const r = idx.search(q, Object.assign({ k: 5 }, o));
  console.log('   (' + (Date.now() - t0) + 'ms)');
  r.forEach(c => console.log('  -', c.score, '|', c.label, '|', c.url, '|', c.text.slice(0, 70).replace(/\n/g, ' ')));
}
console.log('\n### article 권징조례 35');
idx.article('권징조례', 35).forEach(c => console.log('  -', c.label, c.url, c.text.slice(0, 80).replace(/\n/g, ' ')));
console.log('\n### article 정치 1 제10장');
idx.article('정치', 1, '제10장').forEach(c => console.log('  -', c.label, c.url));
console.log('\n### snippet', snippets('가나다 손병민 목사의 위임 청원은 가결하다. 다음 안건. 손병민씨 이명이래 청원 건.', ['손병민'], 40, 2));

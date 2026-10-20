/* 임원 업무 보고서 — 매일 아침 6시(한국) AI 가 노회 자료로 임원마다 직책에 맞는 보고서를 쓴다.
 *
 * 흐름 (runReports)
 *   1) Supabase 의 ai_report_bundle(열쇠) 로 노회 자료를 한 번에 받는다 (128 sql — 창구 비밀 열쇠 REPORT_KEY 로만 열림).
 *   2) 새로 등록된 회의록(최근 120일, 아직 안 읽은 것)이 있으면 결의에서 「해야 할 일」을 뽑아 ai_tasks 에 넣는다.
 *   3) 임원마다(최고관리자 제외) 직책별 지시로 보고서를 쓴다. 노회 자료는 모두에게 같으므로 캐시해 두고
 *      (첫 번째 부름이 캐시를 만들고 나머지는 싸게 읽는다), 직책 지시만 바꾼다.
 *   4) ai_report_save(열쇠, …) 로 저장한다. 같은 날 다시 만들면 바꿔 쓴다.
 *
 * 보고서 모양 (structured outputs, REPORT_SCHEMA)
 *   { headline, sections:[{title, items[]}], todos:[{title, detail, target_kind, target_name, contact_name,
 *     contact_phone, due, priority, message, task_id}], checks[] }
 *   todos 의 message 는 상대에게 바로 보낼 연락 문안이다 — 화면의 「연락하기」가 홈페이지 알림·문자용 복사로 쓴다.
 */

const DUTY_NAME = {
  president: '노회장', vice_president: '부노회장', clerk: '서기', vice_clerk: '부서기', minutes: '회록서기',
  treasurer: '회계', staff: '간사', officer: '임원'
};

/* 임원 계정 → 보고서 갈래 */
export function dutyOf(o) {
  const t = String((o && o.title) || '').trim();
  if (o.role === 'president') return 'president';
  if (o.role === 'clerk') return 'clerk';
  if (o.role === 'staff') return 'staff';
  if (t === '회계' || t === '부회계') return 'treasurer';
  if (t === '회록서기' || t === '회록부서기' || t === '부회록서기') return 'minutes';
  if (t === '부서기') return 'vice_clerk';
  if (t === '부노회장') return 'vice_president';
  return 'officer';
}

const DUTY_GUIDE = {
  president:
    '노회장 보고서입니다. 노회 전체를 총괄하는 눈으로 씁니다.\n' +
    '- 다가오는 정기노회·임원회·행사와 그 준비 상태 (노회규칙에 정한 소집·공고 기한이 있으면 날짜로 계산해 알림)\n' +
    '- 결의 이행(할 일 목록) 진행률, 늦어지거나 연락이 안 된 일, 부서별로 막힌 곳\n' +
    '- 노회장이 결정·승인·서명할 일 (서류 발급 승인, 지급 확인, 청원 처리 등)\n' +
    '- 재정 요약: 상회비 수납 현황과 미납, 노회 장부의 큰 수입·지출\n' +
    '- todos 는 노회장이 직접 할 일이나 노회장이 부탁할 상대(서기·회계·부장)로, 3~6개.',
  vice_president:
    '부노회장 보고서입니다. 노회장을 보좌하는 눈으로 노회 전반을 짧게 요약하고, 부노회장이 맡거나 도울 수 있는 일(다음 노회 준비, 늦어진 결의 이행 독려)을 제안합니다. todos 는 2~4개.',
  clerk:
    '서기 보고서입니다. 서기의 사무 보조로서 씁니다.\n' +
    '- 회의록 등록 뒤 결의에 따라 진행할 일을 부서별(상비부·시찰·기관)로 정리: 누가, 무엇을, 언제까지, 지금 상태\n' +
    '- 오늘 연락할 곳: 각 상비부장·시찰장·기관 대표에게 보낼 연락 문안을 todos 의 message 로 만든다 (연락처는 자료의 연락처에서)\n' +
    '- 서류 발급 신청·청원서 접수 처리, 일정 공지·소집 통지 기한 (노회규칙 근거와 날짜 계산)\n' +
    '- 연락했는데 진행이 없는 일은 다시 연락하도록 checks 와 todos 에 올린다\n' +
    '- todos 는 연락·처리할 일 중심으로 4~10개.',
  vice_clerk:
    '부서기 보고서입니다. 서기를 보좌하는 눈으로, 서기 할 일 가운데 부서기가 나눠 맡을 수 있는 연락·정리 일을 제안하고, 서기 유고 시 대행할 일을 짚습니다. todos 는 2~5개.',
  minutes:
    '회록서기 보고서입니다.\n' +
    '- 정기노회·임시노회 회의록의 작성·등록 상태 (회의 날짜와 등록 날짜를 비교해 늦었는지)\n' +
    '- 결의 내용을 할 일 목록과 맞춰 빠진 결의가 없는지, 회의록에서 고칠 곳(성수·인원 등)\n' +
    '- todos 는 회의록 정리·확인 요청 중심으로 2~5개.',
  treasurer:
    '회계 보고서입니다 (부회계도 같은 보고서를 받습니다).\n' +
    '- 상회비 수입 집계: 이번 회기 낸 교회·안 낸 교회, 수납액·미납액(만원 단위). 미리 계산된 자료의 숫자를 그대로 쓰고 다시 계산하지 않는다\n' +
    '- 미납 교회마다 담임목사에게 정중한 납부 안내 문안을 todos 의 message 로 (밀린 달과 금액 포함). 미납이 많으면 많이 밀린 곳부터 최대 8곳\n' +
    '- 세례의무금 현황\n' +
    '- 노회 장부: 최근 등록한 수입·지출, 영수증이 없는 지출, 받는 분이 아직 확인하지 않은 지급(지급 확인 대기)\n' +
    '- 재정 상황을 등록한 뒤 노회장·서기에게 확인을 요청할 일을 todos 로\n' +
    '- 미비한 점(영수증 누락, 분류 없음, 확인 대기 오래됨)은 checks 에 고칠 방법과 함께.',
  staff:
    '간사 보고서입니다. 노회 사무실 업무 중심으로: 서류 발급 신청(입금 확인·발급 대기), 청원서 접수, 일정 등록·공지할 것, 사무실에서 연락할 일. todos 는 2~6개.',
  officer:
    '임원 보고서입니다. 이 임원의 직책에 맞춰 노회 전반 요약과 도울 수 있는 일을 짧게 씁니다. todos 는 1~4개.'
};

const COMMON_RULES = [
  '당신은 대한예수교장로회(합동) 시화산노회 임원들의 사무 보조입니다. 매일 아침 임원 한 분께 드릴 업무 보고서를 씁니다.',
  '아래 「노회 자료」에 있는 사실만 근거로 씁니다. 자료에 없는 사람·날짜·금액·결의를 지어내지 않습니다. 자료가 비었거나 오류면 그렇다고 짧게 적습니다.',
  '날짜는 오늘(자료의 기준일)을 기준으로 계산해 「D-5」「3일 지남」처럼 알립니다. 기한이 지난 일을 먼저 씁니다.',
  '노회규칙·내규에 근거가 있으면 「(노회규칙 제9조)」처럼 짧게 밝힙니다.',
  '형식: headline 은 한 문장 요약(60자 안). sections 는 2~5개, 각 항목은 1~2문장의 짧은 존댓말. 굵게·제목 기호·이모지는 쓰지 않습니다.',
  'todos: 오늘 할 일. title 은 짧게, detail 은 무엇을 왜, target_kind 는 대상 갈래, target_name 은 부서·교회·기관 이름, contact_name 은 연락할 사람 이름(자료의 조직·연락처에서, 없으면 빈 칸), contact_phone 은 자료의 연락처에 있는 전화(없으면 빈 칸), due 는 YYYY-MM-DD(없으면 빈 칸), priority 는 높음·보통·낮음.',
  'todos 의 message 는 contact_name 께 그대로 보낼 수 있는 연락 문안입니다: 「○○ 목사님(장로님), 시화산노회 서기 ○○○입니다.」처럼 보내는 임원의 직책·이름으로 시작해, 무엇을 언제까지 부탁드리는지 3~6문장 정중한 존댓말로. 연락할 상대가 없으면 빈 칸.',
  'todos 의 task_id: 「할 일 목록」의 번호와 같은 일이면 그 번호, 새로 제안하는 일이면 0. 이미 「완료」·「해당 없음」인 할 일은 다시 올리지 않습니다.',
  'checks: 고쳐야 할 미비점(빠진 기록, 오래된 확인 대기, 틀려 보이는 숫자)을 고칠 방법과 함께. 없으면 빈 목록.',
  '전화번호는 contact_phone 칸에만 적고 본문(sections·message)에는 적지 않습니다.'
].join('\n');

export const REPORT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['headline', 'sections', 'todos', 'checks'],
  properties: {
    headline: { type: 'string' },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'items'],
      properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } } } },
    todos: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['title', 'detail', 'target_kind', 'target_name', 'contact_name', 'contact_phone', 'due', 'priority', 'message', 'task_id'],
      properties: {
        title: { type: 'string' }, detail: { type: 'string' },
        target_kind: { type: 'string', enum: ['상비부', '시찰', '기관', '교회', '임원', '회원', '기타'] },
        target_name: { type: 'string' }, contact_name: { type: 'string' }, contact_phone: { type: 'string' },
        due: { type: 'string' }, priority: { type: 'string', enum: ['높음', '보통', '낮음'] },
        message: { type: 'string' }, task_id: { type: 'integer' }
      } } },
    checks: { type: 'array', items: { type: 'string' } }
  }
};

export const TASK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['tasks'],
  properties: { tasks: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['owner', 'dept_kind', 'dept_name', 'title', 'detail', 'due_date', 'contact_name', 'quote'],
    properties: {
      owner: { type: 'string', enum: ['president', 'clerk', 'treasurer', 'minutes', 'staff', 'officer'] },
      dept_kind: { type: 'string', enum: ['상비부', '시찰', '기관', '교회', '임원', '기타'] },
      dept_name: { type: 'string' }, title: { type: 'string' }, detail: { type: 'string' },
      due_date: { type: 'string' }, contact_name: { type: 'string' }, quote: { type: 'string' }
    } } } }
};

/* ---------- 자료를 글로 ---------- */
function arr(x) { return Array.isArray(x) ? x : []; }
function err(x) { return x && !Array.isArray(x) && x.error ? ' (자료를 읽지 못함: ' + String(x.error).slice(0, 80) + ')' : ''; }
function d10(s) { return String(s || '').slice(0, 10); }
function won(n) { return Number(n || 0).toLocaleString('ko-KR'); }

/* 상회비: 회기(4월~이듬해 3월)마다 내야 할 달과 낸 달을 맞춰 미납을 미리 계산한다 (tools.js search_dues 와 같은 셈) */
export function duesSummary(b) {
  const rates = arr(b.dues_rates), pays = arr(b.dues_payments);
  const today = String(b.today || ''), fy = Number(b.fiscal_year || 0);
  const curY = Number(today.slice(0, 4)), curM = Number(today.slice(5, 7));
  const fiscalNow = curM >= 4 ? curY : curY - 1;
  const order = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
  const elapsed = fy === fiscalNow ? (curM >= 4 ? curM - 3 : curM + 9) : (fy < fiscalNow ? 12 : 0);
  const due = order.slice(0, elapsed);
  const byChurch = {};
  pays.forEach(function (p) { (byChurch[p.church] = byChurch[p.church] || []).push(p); });
  let paidTotal = 0, arrearsTotal = 0;
  const rows = rates.map(function (r) {
    const rate = Number(r.monthly || 0);
    const ps = byChurch[r.church] || [];
    const pm = ps.map(function (p) { return Number(p.month); });
    const unpaid = rate ? due.filter(function (m) { return pm.indexOf(m) === -1; }) : [];
    const paid = ps.reduce(function (a, p) { return a + (p.amount == null ? rate : Number(p.amount)); }, 0);
    paidTotal += paid; arrearsTotal += unpaid.length * rate;
    return { church: r.church, sichal: r.sichal, pastor: r.pastor, rate: rate, paid: paid, unpaid: unpaid, arrears: unpaid.length * rate,
      last: ps.length ? ps.map(function (p) { return d10(p.paid_on); }).sort().slice(-1)[0] : '' };
  });
  return { fy: fy, months: due.length, rows: rows, paidTotal: paidTotal, arrearsTotal: arrearsTotal,
    unpaidChurches: rows.filter(function (r) { return r.unpaid.length; }).length };
}

/* 모든 임원에게 같은 노회 자료 (캐시되는 부분 — 할 일 목록은 바뀌므로 따로) */
export function stableContext(b) {
  const L = [];
  const st = b.settings || {};
  L.push('# 노회 자료 (기준일 ' + b.today + ', 상회비 회기 ' + b.fiscal_year + '년 4월~' + (Number(b.fiscal_year) + 1) + '년 3월)');
  L.push('', '## 임원' + err(b.settings));
  arr(st.officers).forEach(function (o) { L.push('- ' + (o.role || '') + ': ' + (o.name || '') + ' ' + (o.position || '') + (o.church ? ' (' + o.church + ')' : '')); });
  if (st.sessions && st.sessions.current) L.push('- 현 회기: ' + JSON.stringify(st.sessions.current));
  L.push('', '## 홈페이지 계정이 있는 임원 (보고서를 받는 분)');
  arr(b.officers).forEach(function (o) { L.push('- ' + o.name + ' · ' + (o.title || DUTY_NAME[dutyOf(o)]) + (o.church ? ' · ' + o.church : '')); });

  L.push('', '## 정기노회·임시노회' + err(b.meetings));
  arr(b.meetings).forEach(function (m) { L.push('- ' + (m.kind || '') + ' ' + (m.year || '') + ': ' + (m.meet_date || '날짜 미정') + (m.place ? ' · ' + m.place : '') + (m.confirmed ? ' (확정)' : ' (미확정)')); });
  L.push('', '## 노회 일정 (지난 7일 ~ 앞으로 60일)' + err(b.schedule));
  arr(b.schedule).forEach(function (s) { L.push('- ' + (s.date || s.label || '') + ' ' + s.title); });

  L.push('', '## 회의록 (최근)' + (b.minutes_error ? ' (읽지 못함)' : ''));
  arr(b.minutes).forEach(function (m) { L.push('- [회의록 ' + m.id + '] ' + m.title + ' · 회의 ' + (m.meeting_date || '?') + ' · 등록 ' + d10(m.created_at)); });
  L.push('', '## 최근 결의사항 (자료실)' + err(b.resolutions));
  arr(b.resolutions).forEach(function (r) { L.push('### ' + r.session + (r.held_on ? ' (' + r.held_on + ')' : ''), String(r.items || '').slice(0, 6000)); });

  L.push('', '## 상비부 조직' + err(b.committees));
  arr(b.committees).forEach(function (c) {
    L.push('- ' + c.name + ': 부장 ' + (c.head || '-') + ' / 서기 ' + (c.clerk || '-') + ' / 회계 ' + (c.treasurer || '-') + (c.duty ? ' · 맡은 일: ' + String(c.duty).slice(0, 120) : ''));
  });
  L.push('', '## 상비부 할 일(끝나지 않은 것)·가까운 일정' + err(b.committee_events));
  arr(b.committee_events).forEach(function (e) { L.push('- ' + e.committee + ' [' + e.kind + '] ' + e.title + (e.date ? ' · ' + e.date : '')); });
  L.push('', '## 시찰회' + err(b.sichals));
  arr(b.sichals).forEach(function (s) { L.push('- ' + s.name + ': 시찰장 ' + (s.head || '-') + ' / 서기 ' + (s.clerk || '-') + ' / 회계 ' + (s.treasurer || '-') + (s.churches ? ' · 교회: ' + s.churches : '')); });
  L.push('', '## 기관 파송 이사·위원' + err(b.boards));
  arr(b.boards).forEach(function (x) { L.push('- ' + x.kind + ': ' + x.name + ' ' + (x.position || '') + (x.church ? ' (' + x.church + ')' : '')); });
  L.push('', '## 회원 연락처 (이름 · 교회 · 직분 · 전화)' + err(b.contacts));
  arr(b.contacts).forEach(function (c) { L.push('- ' + c.name + ' · ' + (c.church || '') + ' · ' + (c.position || '') + (c.officer_title ? ' · ' + c.officer_title : '') + ' · ' + (c.phone || '전화 없음')); });

  const ds = duesSummary(b);
  L.push('', '## 상회비 (이번 회기, 단위 만원 — 미리 계산함)' + err(b.dues_rates));
  L.push('- 내야 할 달 ' + ds.months + '개월 · 교회 ' + ds.rows.length + '곳 · 미납 있는 교회 ' + ds.unpaidChurches + '곳 · 받은 합계 ' + ds.paidTotal + '만원 · 미납 합계 ' + ds.arrearsTotal + '만원');
  ds.rows.forEach(function (r) {
    L.push('- ' + r.church + (r.sichal ? ' (' + r.sichal + ')' : '') + ' · 담임 ' + (r.pastor || '-') + ' · 월 ' + r.rate + '만원 · 낸 금액 ' + r.paid + '만원' +
      (r.rate ? (r.unpaid.length ? ' · 미납 ' + r.unpaid.join('·') + '월 (' + r.arrears + '만원)' : ' · 미납 없음') : ' · 면제') + (r.last ? ' · 마지막 납부 ' + r.last : ''));
  });
  L.push('', '## 세례의무금 (올해, 원)' + err(b.bapdues));
  arr(b.bapdues).forEach(function (x) { L.push('- ' + x.church + ' · 목표 ' + won(x.target) + ' · 납입 ' + won(x.paid) + (x.paid_on ? ' (' + x.paid_on + ')' : '')); });

  const lg = b.ledger || {};
  L.push('', '## 노회 장부 (원)' + err(lg));
  arr(lg.books).forEach(function (k) {
    const t = arr(lg.totals).filter(function (x) { return x.book === k.id; });
    const inc = t.filter(function (x) { return x.kind === '수입'; })[0] || {}, out = t.filter(function (x) { return x.kind === '지출'; })[0] || {};
    L.push('- ' + k.owner + ' ' + k.year + '년 장부: 이월 ' + won(k.opening) + ' · 수입 ' + won(inc.sum) + ' (' + (inc.n || 0) + '건) · 지출 ' + won(out.sum) + ' (' + (out.n || 0) + '건)');
  });
  L.push('### 최근 항목');
  arr(lg.recent).forEach(function (e) { L.push('- ' + (e.date || '') + ' ' + e.kind + ' ' + won(e.amount) + ' · ' + (e.category || '분류 없음') + ' · ' + e.title + (e.kind === '지출' ? (e.receipt ? ' · 영수증 있음' : ' · 영수증 없음') : '') + ' · 등록 ' + d10(e.created)); });
  L.push('### 지급 확인 대기 (받는 분이 아직 확인 안 함)');
  arr(lg.payouts_waiting).forEach(function (p) { L.push('- ' + (p.date || '') + ' ' + p.recipient + (p.church ? ' (' + p.church + ')' : '') + ' · ' + won(p.amount) + ' · ' + (p.title || '')); });

  L.push('', '## 처리 중인 서류 발급 신청' + err(b.doc_requests));
  arr(b.doc_requests).forEach(function (d) {
    const extra = Object.keys(d).filter(function (k) { return ['id', 'name', 'church', 'doc_type', 'status', 'created_at', 'updated_at', 'position', 'copies'].indexOf(k) === -1 && d[k] != null && d[k] !== '' && typeof d[k] !== 'object'; })
      .map(function (k) { return k + '=' + String(d[k]).slice(0, 30); }).join(', ');
    L.push('- ' + d10(d.created_at) + ' ' + d.doc_type + ' · ' + d.name + (d.church ? ' (' + d.church + ')' : '') + ' · 상태 ' + d.status + (extra ? ' · ' + extra : ''));
  });
  L.push('', '## 청원서 (최근 90일)' + err(b.petitions));
  arr(b.petitions).forEach(function (p) { L.push('- ' + d10(p.at) + ' ' + p.sichal + ' · ' + p.form + ' · ' + p.title + ' · ' + p.status + (p.by ? ' · ' + p.by : '')); });

  L.push('', '## 노회규칙·내규 (전문)' + err(b.rules));
  arr(b.rules).forEach(function (a) { L.push([a.chapter, a.title].filter(Boolean).join(' ') + '\n' + String(a.body || '')); });
  return L.join('\n');
}

/* 날마다 바뀌는 할 일 목록 */
export function taskContext(b) {
  const L = ['# 할 일 목록 (결의·회칙에서 나온 일, 번호 = task_id)' + err(b.tasks)];
  const ts = arr(b.tasks);
  if (!ts.length) L.push('- (아직 없음)');
  ts.forEach(function (t) {
    L.push('- [' + t.id + '] ' + (DUTY_NAME[t.owner] || t.owner) + ' 담당 · ' + (t.dept_kind || '') + ' ' + (t.dept_name || '') + ' · ' + t.title +
      ' · 상태 ' + t.status + (t.due ? ' · 기한 ' + t.due : '') + (t.contact ? ' · 연락 ' + t.contact : '') + (t.source ? ' · 출처 ' + t.source : '') +
      (t.detail ? '\n  ' + String(t.detail).slice(0, 300) : '') + (t.note ? '\n  기록: ' + String(t.note).replace(/\n/g, ' / ').slice(-300) : ''));
  });
  return L.join('\n');
}

/* ---------- Supabase (열쇠로 여는 두 문) ---------- */
async function rpc(env, fn, args) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const t = await r.text();
  if (!r.ok) throw new Error(fn + ' 실패 (HTTP ' + r.status + '): ' + t.slice(0, 200));
  try { return JSON.parse(t); } catch (e) { throw new Error(fn + ' 응답을 읽지 못함'); }
}

function textOf(res) {
  return res.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
}
function parseJson(res, what) {
  if (res.stop_reason === 'refusal') throw new Error(what + ': 모델이 거절함');
  if (res.stop_reason === 'max_tokens') throw new Error(what + ': 답이 너무 길어 잘림');
  try { return JSON.parse(textOf(res)); } catch (e) { throw new Error(what + ': JSON 을 읽지 못함'); }
}
function usageOf(res) {
  const u = res.usage || {};
  return { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
           output: u.output_tokens || 0, cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0 };
}

/* 회의록에서 할 일 뽑기 */
async function extractTasks(deps, b, minutes, system, model, effort) {
  const prompt = '아래는 새로 등록된 노회 회의록입니다. 결의·보고·청원 처리에서 노회 이후 실제로 진행해야 할 일을 빠짐없이 뽑아 주세요.\n' +
    '- 한 일 하나에 한 줄. 이미 끝난 일(보고를 받았다 등 회의 안에서 끝난 일)은 넣지 않습니다.\n' +
    '- owner: 그 일을 챙길 임원 (서기=clerk 기본, 재정·회비=treasurer, 회의록 정리=minutes, 노회장 결정·대외=president, 사무실 서류=staff).\n' +
    '- dept_kind·dept_name: 실제로 일을 맡은 부서 (예: 상비부 정치부, 시찰 북부시찰, 기관 총신대). contact_name 은 노회 자료의 조직에서 그 부서의 부장·시찰장 이름(없으면 빈 칸).\n' +
    '- due_date: 회의록이나 노회규칙에 기한이 있으면 YYYY-MM-DD, 없으면 빈 칸. quote: 근거가 된 회의록 구절(60자 안).\n' +
    '- title 은 「정치부 — ○○교회 위임 청원 허락 통보」처럼 짧고 구체적으로.\n\n' +
    '# 회의록 ' + minutes.id + ': ' + minutes.title + ' (회의 ' + (minutes.meeting_date || '?') + ')\n' + String(minutes.text || '').slice(0, 90000);
  const res = await deps.claudeCall(deps.key, {
    model: model, max_tokens: 32000, system: system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: effort, format: { type: 'json_schema', schema: TASK_SCHEMA } }
  }, null);
  const j = parseJson(res, '회의록 ' + minutes.id + ' 할 일 뽑기');
  return { usage: usageOf(res), tasks: arr(j.tasks).map(function (t) {
    return { owner: t.owner, dept_kind: t.dept_kind, dept_name: t.dept_name, title: t.title,
      detail: [t.detail, t.quote ? '근거: 「' + t.quote + '」' : ''].filter(Boolean).join('\n'),
      due_date: t.due_date, contact_name: t.contact_name, source: minutes.title, source_ref: 'minutes:' + minutes.id };
  }) };
}

async function writeReport(deps, b, officer, system, model, effort) {
  const duty = dutyOf(officer);
  const who = officer.name + ' ' + (officer.title || DUTY_NAME[duty]) + (officer.church ? ' (' + officer.church + ')' : '');
  const res = await deps.claudeCall(deps.key, {
    model: model, max_tokens: 24000,
    system: system.concat([{ type: 'text', text: taskContext(b) }]),
    messages: [{ role: 'user', content: '오늘(' + b.today + ') ' + who + '께 드릴 업무 보고서를 써 주세요.\n\n' + DUTY_GUIDE[duty] }],
    output_config: { effort: effort, format: { type: 'json_schema', schema: REPORT_SCHEMA } }
  }, null);
  const j = parseJson(res, who + ' 보고서');
  const u = usageOf(res);
  /* 할 일 번호는 목록에 있는 것만 남긴다 */
  const ids = {};
  arr(b.tasks).forEach(function (t) { ids[t.id] = true; });
  j.todos = arr(j.todos).map(function (t) { return Object.assign({}, t, { task_id: ids[t.task_id] ? t.task_id : 0 }); });
  return { row: { user_id: officer.id, report_date: b.today, name: officer.name, role: officer.role, title: officer.title || DUTY_NAME[duty],
    duty: duty, headline: String(j.headline || '').slice(0, 500), content: j, model: res.model || model,
    input_tokens: u.input, output_tokens: u.output }, usage: u };
}

/* 한꺼번에 n 개씩 */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/* deps: { claudeCall, key(API 열쇠), model, effort }
 * opts: { trigger: 'cron'|'manual', only: 회원 id (그 분 것만 다시), by: 실행한 분 이름 }
 * log(text): 진행 상황 */
export async function runReports(env, deps, opts, log) {
  opts = opts || {}; log = log || function () {};
  if (!env.REPORT_KEY) throw new Error('창구에 보고서 열쇠(REPORT_KEY)가 없습니다.');
  const started = new Date().toISOString();
  const model = deps.model, effort = deps.effort || 'medium';
  const errors = [];
  let usage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  function add(u) { Object.keys(usage).forEach(function (k) { usage[k] += u[k] || 0; }); }

  log('노회 자료를 받는 중');
  let b = await rpc(env, 'ai_report_bundle', { p_key: env.REPORT_KEY });
  const system = [{ type: 'text', text: COMMON_RULES + '\n\n' + stableContext(b), cache_control: { type: 'ephemeral' } }];

  /* 1) 새 회의록 → 할 일 */
  const done = arr(b.state && b.state.minutes_done).map(Number);
  const since = new Date(Date.parse(b.today + 'T00:00:00Z') - 120 * 864e5).toISOString().slice(0, 10);
  const fresh = opts.only ? [] : arr(b.minutes).filter(function (m) { return done.indexOf(Number(m.id)) === -1 && String(m.meeting_date || m.created_at || '') >= since && m.text; });
  let newTasks = 0;
  for (const m of fresh) {
    log('회의록에서 할 일을 뽑는 중: ' + m.title);
    try {
      const x = await extractTasks(deps, b, m, system, model, effort);
      add(x.usage);
      const r = await rpc(env, 'ai_report_save', { p_key: env.REPORT_KEY, p_data: { tasks: x.tasks, minutes_done: [m.id] } });
      newTasks += arr(r.tasks).length;
    } catch (e) { errors.push(String(e.message || e)); }
  }
  if (fresh.length) b = await rpc(env, 'ai_report_bundle', { p_key: env.REPORT_KEY });

  /* 2) 임원마다 보고서 — 첫 번째가 캐시를 만들고 나머지는 여럿이 함께.
   *    예약 실행은 15분 안에 끝나야 하므로(Cloudflare 한도) 다 쓴 보고서는 그때그때 저장하고,
   *    시한(deadline)이 지나면 남은 분은 시작하지 않고 기록에 남긴다. */
  let officers = arr(b.officers);
  if (opts.only) officers = officers.filter(function (o) { return o.id === opts.only; });
  const deadline = opts.deadline || (Date.parse(started) + 25 * 60 * 1000);
  const base = { trigger: opts.trigger || 'manual', by: opts.by || null, started_at: started, date: b.today, model: model, officers: officers.length, new_tasks: newTasks };
  await rpc(env, 'ai_report_save', { p_key: env.REPORT_KEY, p_data: { run: Object.assign({ running: true }, base) } }).catch(function () {});
  let saved = 0, skipped = 0;
  async function one(o) {
    if (Date.now() > deadline) { skipped++; return; }
    log((o.title || DUTY_NAME[dutyOf(o)]) + ' ' + o.name + ' 보고서를 쓰는 중');
    try {
      const x = await writeReport(deps, b, o, system, model, effort);
      add(x.usage);
      await rpc(env, 'ai_report_save', { p_key: env.REPORT_KEY, p_data: { reports: [x.row] } });
      saved++;
    } catch (e) { errors.push(o.name + ': ' + String(e.message || e)); }
  }
  if (officers.length) await one(officers[0]);
  await pool(officers.slice(1), deps.parallel || 6, one);
  if (skipped) errors.push('시간이 모자라 ' + skipped + '분의 보고서는 만들지 못했습니다 (다음 실행 때 다시 만듭니다).');

  const run = Object.assign({}, base, { finished_at: new Date().toISOString(), reports: saved, usage: usage, errors: errors.slice(0, 20) });
  log('저장하는 중');
  await rpc(env, 'ai_report_save', { p_key: env.REPORT_KEY, p_data: { run: run } });
  return run;
}

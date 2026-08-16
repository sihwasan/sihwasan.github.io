/* 시화산노회 관리자 알림 봇 (텔레그램)
 *
 * 노회장·서기·간사가 함께 있는 텔레그램 방에 상주하면서
 *
 *   · 서류 신청이 들어오면 바로 알립니다.
 *   · 증명서를 발급하면 노회장께 알립니다.
 *   · 노회장·서기가 바뀌면 인수인계 절차를 안내합니다.
 *   · 새 임원이 방에 들어오면 맞이하고, 임기를 마치신 분께 퇴장을 권합니다.
 *
 * 실행:  node bot.js      (또는 "알림봇 시작.bat" 을 두 번 누르기)
 * 끄기:  창에서 Ctrl+C
 *
 * 처음 한 번은 config.json 을 만들어 주셔야 합니다. (README.md 참고)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CFG_PATH = path.join(__dirname, 'config.json');
if (!fs.existsSync(CFG_PATH)) {
  console.error('');
  console.error('  config.json 이 없습니다.');
  console.error('  config.sample.json 을 config.json 으로 복사한 뒤');
  console.error('  봇 토큰과 방 번호를 적어 주세요. (README.md 에 설명이 있습니다)');
  console.error('');
  process.exit(1);
}
const CFG = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));

const API = 'https://api.telegram.org/bot' + CFG.botToken;
const STATE_PATH = path.join(__dirname, 'state.json');
const POLL_MS = (CFG.pollSeconds || 30) * 1000;

let state = { offset: 0, chatId: CFG.chatId || null };
try { state = Object.assign(state, JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))); } catch (e) {}
function saveState() {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); } catch (e) {}
}

function log(msg) {
  console.log('[' + new Date().toLocaleTimeString('ko-KR') + '] ' + msg);
}

/* ---------------- 텔레그램 ---------------- */
async function tg(method, body) {
  const res = await fetch(API + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const j = await res.json();
  if (!j.ok) throw new Error(method + ': ' + (j.description || '실패'));
  return j.result;
}

async function say(text, chatId) {
  const id = chatId || state.chatId;
  if (!id) { log('보낼 방이 아직 정해지지 않았습니다. 방에서 /등록 이라고 적어 주세요.'); return; }
  return tg('sendMessage', {
    chat_id: id,
    text: text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true }
  });
}

/* ---------------- 노회 서버(Supabase) ---------------- */
async function sb(pathQuery, opts) {
  const res = await fetch(CFG.supabaseUrl + '/rest/v1/' + pathQuery, Object.assign({
    headers: {
      apikey: CFG.supabaseServiceKey,
      Authorization: 'Bearer ' + CFG.supabaseServiceKey,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }
  }, opts || {}));
  if (!res.ok) throw new Error('노회 서버: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

async function officers() {
  const rows = await sb('profiles?role=in.(president,clerk,staff)&suspended=is.false' +
    '&select=role,name,church&order=role');
  const label = { president: '노회장', clerk: '서기', staff: '간사' };
  const order = { president: 1, clerk: 2, staff: 3 };
  return (rows || []).sort((a, b) => (order[a.role] || 9) - (order[b.role] || 9))
    .map(r => `· ${label[r.role] || r.role} ${r.name || '(이름 없음)'}` +
      (r.church ? ` (${r.church})` : ''));
}

/* ---------------- 안내문 ---------------- */
const HANDOVER = [
  '<b>임원 인수인계 안내</b>',
  '',
  '임원이 바뀌면 아래 순서로 정리해 주시기 바랍니다.',
  '',
  '<b>1. 홈페이지 권한</b>',
  '   전임 노회장께서 <b>내 정보 → 차기 노회장에게 권한 넘기기</b>로',
  '   직접 넘겨주셔야 합니다. 넘기시는 즉시 전임자는 정회원이 됩니다.',
  '   서기·간사는 노회장이 <b>회원 관리</b>에서 지정합니다.',
  '',
  '<b>2. 직인·도장</b>',
  '   홈페이지 설정 → 직인·도장에서 새 임원의 도장으로 바꿔 주세요.',
  '',
  '<b>3. 서류 발급 대장</b>',
  '   임원방 → 서류 발급에서 미처리 신청이 남아 있는지 확인해 주세요.',
  '',
  '<b>4. 이 텔레그램 방</b>',
  '   새 임원을 초대하시고, 임기를 마치신 분은 인수인계가 끝나는 대로',
  '   방에서 나가 주시기 바랍니다.'
].join('\n');

/* ---------------- 알림 보내기 ---------------- */
async function flushOutbox() {
  let rows;
  try {
    rows = await sb('telegram_outbox?sent_at=is.null&order=id.asc&limit=20&select=*');
  } catch (e) {
    log('알림함을 읽지 못했습니다: ' + e.message);
    return;
  }
  if (!rows || !rows.length) return;

  for (const r of rows) {
    let text = '<b>' + esc(r.title) + '</b>';
    if (r.body) text += '\n\n' + esc(r.body);
    if (r.kind === '임원교체') text += '\n\n' + HANDOVER;

    try {
      await say(text);
      await sb('telegram_outbox?id=eq.' + r.id, {
        method: 'PATCH',
        body: JSON.stringify({ sent_at: new Date().toISOString() })
      });
      log('알림 보냄: ' + r.title);
    } catch (e) {
      log('알림 실패(' + r.id + '): ' + e.message);
      return;   /* 방이 아직 없거나 문제가 있으면 다음 차례에 다시 시도 */
    }
  }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------------- 방에서 오는 말 듣기 ---------------- */
async function pollUpdates() {
  let updates;
  try {
    updates = await tg('getUpdates', {
      offset: state.offset + 1,
      timeout: 25,
      allowed_updates: ['message', 'my_chat_member']
    });
  } catch (e) {
    log('업데이트를 받지 못했습니다: ' + e.message);
    return;
  }

  for (const u of (updates || [])) {
    state.offset = u.update_id;
    try { await handle(u); } catch (e) { log('처리 실패: ' + e.message); }
  }
  if (updates && updates.length) saveState();
}

async function handle(u) {
  /* 봇이 방에 들어갔을 때 그 방을 알림 받을 방으로 기억한다 */
  if (u.my_chat_member) {
    const st = u.my_chat_member.new_chat_member;
    if (st && (st.status === 'member' || st.status === 'administrator')) {
      state.chatId = u.my_chat_member.chat.id;
      saveState();
      log('알림 방으로 등록되었습니다: ' + state.chatId);
      await say([
        '<b>시화산노회 관리자 알림 봇입니다.</b>',
        '',
        '이 방에서 아래 소식을 바로 알려 드립니다.',
        '· 서류 신청이 들어왔을 때',
        '· 증명서를 발급했을 때',
        '· 노회장·서기가 바뀌었을 때',
        '',
        '도움말은 <code>/도움말</code> 이라고 적어 주세요.'
      ].join('\n'));
    }
    return;
  }

  const m = u.message;
  if (!m) return;

  /* 새로 들어오신 분 맞이하기 */
  if (m.new_chat_members && m.new_chat_members.length) {
    const names = m.new_chat_members
      .filter(x => !x.is_bot)
      .map(x => esc(x.first_name || x.username || '새 회원'));
    if (!names.length) return;

    let list = [];
    try { list = await officers(); } catch (e) {}

    await say([
      '<b>' + names.join(', ') + ' 님, 환영합니다.</b>',
      '',
      '이 방은 시화산노회 <b>노회장·서기·간사</b>가 함께 쓰는 관리자 방입니다.',
      list.length ? '\n<b>현재 임원</b>\n' + list.join('\n') : '',
      '',
      '<b>임기를 마치신 분께 부탁드립니다.</b>',
      '인수인계가 끝나셨으면 이 방에서 나가 주시기 바랍니다.',
      '관리자 방은 현직 임원만 있어야 서류·회원 정보가 안전하게 지켜집니다.',
      '',
      '인수인계 절차는 <code>/인수인계</code> 라고 적으시면 안내해 드립니다.'
    ].filter(Boolean).join('\n'), m.chat.id);
    return;
  }

  /* 나가신 분 */
  if (m.left_chat_member && !m.left_chat_member.is_bot) {
    await say('<b>' + esc(m.left_chat_member.first_name || '') + '</b> 님이 방을 나가셨습니다. ' +
      '그동안 노회를 섬겨 주셔서 감사합니다.', m.chat.id);
    return;
  }

  const text = (m.text || '').trim();
  if (!text) return;

  if (/^\/(등록|start|시작)/.test(text)) {
    state.chatId = m.chat.id;
    saveState();
    await say('이 방을 알림 방으로 정했습니다. 앞으로 이곳으로 알려 드리겠습니다.', m.chat.id);
    return;
  }

  if (/^\/(도움말|help)/.test(text)) {
    await say([
      '<b>쓸 수 있는 말</b>',
      '',
      '<code>/임원</code> — 현재 노회장·서기·간사를 알려 드립니다.',
      '<code>/인수인계</code> — 임원이 바뀔 때 할 일을 안내해 드립니다.',
      '<code>/신청</code> — 아직 처리하지 않은 서류 신청을 알려 드립니다.',
      '<code>/등록</code> — 이 방을 알림 받을 방으로 정합니다.'
    ].join('\n'), m.chat.id);
    return;
  }

  if (/^\/(임원|officers)/.test(text)) {
    try {
      const list = await officers();
      await say(list.length
        ? '<b>현재 임원</b>\n' + list.join('\n')
        : '임원 정보를 찾지 못했습니다.', m.chat.id);
    } catch (e) {
      await say('임원 정보를 불러오지 못했습니다: ' + esc(e.message), m.chat.id);
    }
    return;
  }

  if (/^\/(인수인계|handover)/.test(text)) {
    await say(HANDOVER, m.chat.id);
    return;
  }

  if (/^\/(신청|requests)/.test(text)) {
    try {
      const rows = await sb('doc_requests?status=eq.신청&order=id.desc&limit=10&select=*');
      if (!rows || !rows.length) {
        await say('처리를 기다리는 서류 신청이 없습니다.', m.chat.id);
        return;
      }
      await say('<b>처리를 기다리는 서류 신청 ' + rows.length + '건</b>\n\n' +
        rows.map(r => `· ${esc(r.name)} (${esc(r.church || '-')}) — ${esc(r.doc_type)}` +
          ` / ${esc(r.purpose || '-')} ${r.copies}부`).join('\n'), m.chat.id);
    } catch (e) {
      await say('신청 내역을 불러오지 못했습니다: ' + esc(e.message), m.chat.id);
    }
    return;
  }
}

/* ---------------- 시작 ---------------- */
(async function main() {
  let me;
  try {
    me = await tg('getMe');
  } catch (e) {
    console.error('');
    console.error('  봇 토큰이 올바르지 않은 것 같습니다: ' + e.message);
    console.error('  config.json 의 botToken 을 다시 확인해 주세요.');
    console.error('');
    process.exit(1);
  }

  console.log('');
  console.log('  시화산노회 관리자 알림 봇이 켜졌습니다.');
  console.log('  봇 이름  @' + me.username);
  console.log('  알림 방  ' + (state.chatId || '아직 없음 (방에서 /등록 이라고 적어 주세요)'));
  console.log('');
  console.log('  이 창을 열어 두셔야 알림이 갑니다. 끄시려면 Ctrl+C.');
  console.log('');

  /* 방에서 오는 말을 계속 듣는다 */
  (async function listen() {
    for (;;) {
      await pollUpdates();
    }
  })().catch(e => log('듣기 중단: ' + e.message));

  /* 보낼 알림이 있는지 주기적으로 살핀다 */
  for (;;) {
    await flushOutbox();
    await new Promise(r => setTimeout(r, POLL_MS));
  }
})();

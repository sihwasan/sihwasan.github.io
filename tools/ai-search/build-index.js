/* 시화산노회 자료 검색 - 색인 만들기
 *
 * 홈페이지에 들어 있는 총회 자료(헌법·규정·회의결의·보고서)와
 * 노회 자료(회칙·조직)를 읽어 검색용 조각으로 나누어 저장한다.
 *
 *   node build-index.js
 *
 * 자료를 새로 받아 오거나 회칙을 고친 뒤에 다시 실행하면 된다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ASM = path.join(ROOT, 'data', 'assembly');
const OUT = path.join(__dirname, 'index.json');

const CHUNK_MAX = 1400;   /* 조각 하나의 최대 길이(글자) */

/* ---------- 도우미 ---------- */

function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* 긴 글을 문단 단위로 잘라 조각으로 만든다 */
function splitText(text, maxLen) {
  const out = [];
  const paras = text.split(/\n{2,}/);
  let buf = '';
  for (const p of paras) {
    const piece = p.trim();
    if (!piece) continue;
    if (buf && (buf.length + piece.length + 2) > maxLen) {
      out.push(buf);
      buf = '';
    }
    if (piece.length > maxLen) {
      if (buf) { out.push(buf); buf = ''; }
      /* 너무 긴 문단은 문장 단위로 다시 나눈다 */
      let s = '';
      for (const sent of piece.split(/(?<=[.。?!])\s+/)) {
        if (s && (s.length + sent.length + 1) > maxLen) { out.push(s); s = ''; }
        s = s ? (s + ' ' + sent) : sent;
      }
      if (s) out.push(s);
    } else {
      buf = buf ? (buf + '\n\n' + piece) : piece;
    }
  }
  if (buf) out.push(buf);
  return out;
}

const chunks = [];
let seq = 0;

function add(src, title, url, text) {
  const clean = stripHtml(text);
  if (!clean || clean.length < 12) return;
  for (const piece of splitText(clean, CHUNK_MAX)) {
    chunks.push({ id: ++seq, src, title, url, text: piece });
  }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

/* ---------- 1. 총회 헌법 ---------- */
function loadConstitution() {
  const idx = readJson(path.join(ASM, 'constitution-index.json'));
  if (!idx) return;
  for (const b of (idx.books || [])) {
    const doc = readJson(path.join(ASM, `constitution-${b.n}.json`));
    if (!doc) continue;
    for (const s of (doc.secs || [])) {
      add('총회 헌법 > ' + doc.title,
          s.t || doc.title,
          `assembly-constitution.html#b${b.n}`,
          (s.t ? s.t + '\n' : '') + s.c);
    }
  }
}

/* ---------- 2. 총회 규정 ---------- */
function loadRules() {
  const idx = readJson(path.join(ASM, 'rules-index.json'));
  if (!idx) return;
  for (const c of (idx.cats || [])) {
    const doc = readJson(path.join(ASM, `rules-${c.n}.json`));
    if (!doc) continue;
    for (const s of (doc.secs || [])) {
      add('총회 규정 > ' + doc.title,
          s.t || doc.title,
          `assembly-rules.html#b${c.n}`,
          (s.t ? s.t + '\n' : '') + s.c);
    }
  }
}

/* ---------- 3. 총회 회의결의 ---------- */
function loadResolutions() {
  const idx = readJson(path.join(ASM, 'resolutions-index.json'));
  if (!idx) return;
  for (const r of (idx.list || [])) {
    const doc = readJson(path.join(ASM, `resolution-${r.s}.json`));
    if (!doc) continue;
    const head = `제${r.s}회 총회 (${r.year}년) 총회장 ${r.chairman || '-'} 장소 ${r.loc || '-'}`;
    add('총회 회의결의',
        `제${r.s}회 총회 (${r.year}년)`,
        `assembly-resolution.html#s${r.s}`,
        head + '\n' + (doc.cont || ''));
  }
}

/* ---------- 4. 총회 보고서 (제목만) ---------- */
function loadReports() {
  const doc = readJson(path.join(ASM, 'reports.json'));
  if (!doc) return;
  for (const s of (doc.sessions || [])) {
    const names = [];
    const walk = (n, depth) => {
      if (n.t) names.push('  '.repeat(depth) + n.t);
      (n.k || []).forEach(k => walk(k, depth + 1));
    };
    (s.groups || []).forEach(g => walk(g, 0));
    add('총회 보고서',
        `제${s.s}회 총회 보고서 목록`,
        `assembly-report.html#s${s.s}`,
        `제${s.s}회 총회에 제출된 보고서 목록입니다.\n` + names.join('\n'));
  }
}

/* ---------- 5. 노회 회칙 ---------- */
function loadPresbyteryRules() {
  const p = path.join(ROOT, 'rules-presbytery.html');
  if (!fs.existsSync(p)) return;
  const html = fs.readFileSync(p, 'utf8');
  /* 본문(page-body) 안쪽만 사용한다 */
  const m = html.match(/<div class="page-body[\s\S]*?<\/div>\s*<script/i);
  const body = m ? m[0] : html;
  /* 조문(제1조 …) 단위로 나눈다. 줄바꿈이 없어도 조문 앞에서 끊는다. */
  const text = stripHtml(body);
  const re = /제\s?\d+\s?조\s*(?:\([^)]{1,40}\))?/g;
  const marks = [];
  let hit;
  while ((hit = re.exec(text)) !== null) marks.push({ at: hit.index, head: hit[0].trim() });

  if (marks.length > 3) {
    /* 첫 조문 앞의 머리말 */
    const intro = text.slice(0, marks[0].at).trim();
    if (intro) add('시화산노회 회칙', '노회 회칙 머리말', 'rules-presbytery.html', intro);

    /* 어느 장(章)에 속한 조문인지 함께 적어 두면 찾기 쉽다 */
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].at;
      const end = (i + 1 < marks.length) ? marks[i + 1].at : text.length;
      const seg = text.slice(start, end).trim();
      if (seg.length < 10) continue;
      const before = text.slice(0, start);
      const ch = before.match(/제\s?\d+\s?장[^\n제]{0,30}/g);
      const chapter = ch && ch.length ? ch[ch.length - 1].trim() : '';
      add('시화산노회 회칙',
          (chapter ? chapter + ' ' : '') + marks[i].head,
          'rules-presbytery.html', seg);
    }
  } else {
    add('시화산노회 회칙', '노회 회칙', 'rules-presbytery.html', text);
  }
}

/* ---------- 6. 노회 기본 자료 (임원·시찰회·상비부·총대) ---------- */
function loadPresbyteryData() {
  const p = path.join(ROOT, 'js', 'data.js');
  if (!fs.existsSync(p)) return;
  const src = fs.readFileSync(p, 'utf8');
  let D;
  try {
    /* data.js 는 var SHSData = {...}; 형태다 */
    D = new Function(src + '; return typeof SHSData !== "undefined" ? SHSData : null;')();
  } catch (e) { D = null; }
  if (!D) return;

  if (D.officers) {
    add('시화산노회 조직', '노회 임원', 'organization.html#officers',
      '시화산노회 임원 명단\n' +
      D.officers.map(o => `${o.role}: ${o.name} ${o.position || ''} (${o.church || ''})`).join('\n'));
  }
  if (D.sichals) {
    add('시화산노회 조직', '시찰회', 'organization.html#sichal',
      D.sichals.map(s =>
        `${s.name} — 관할 ${s.area || ''} / 시찰장 ${s.head || ''} / 서기 ${s.clerk || ''} / 회계 ${s.treasurer || ''}\n` +
        `소속 교회: ${(s.churches || []).join(', ')}`).join('\n\n'));
  }
  if (D.committees) {
    add('시화산노회 조직', '상비부', 'organization.html#committees',
      D.committees.map(c =>
        `${c.name} — ${c.duty || ''}\n부장 ${c.head || ''} / 서기 ${c.clerk || ''} / 회계 ${c.treasurer || ''}\n` +
        `1년조 ${c.y1 || ''}\n2년조 ${c.y2 || ''}\n3년조 ${c.y3 || ''}`).join('\n\n'));
  }
  if (D.delegates) {
    const g = D.delegates;
    const line = (label, v) => {
      if (!v) return '';
      const list = Array.isArray(v) ? v : [v];
      return label + ': ' + list.map(x =>
        typeof x === 'string' ? x : `${x.name || ''} (${x.church || ''})`).join(', ') + '\n';
    };
    add('시화산노회 조직', '총회 총대', 'organization.html#delegates',
      '총회 총대 명단\n' +
      (Array.isArray(g)
        ? g.map(d => `${d.kind || ''} ${d.name} (${d.church || ''}) ${d.title || ''}`).join('\n')
        : line('목사 정총대', g.pastorMain) + line('목사 부총대', g.pastorSub) +
          line('장로 정총대', g.elderMain) + line('장로 부총대', g.elderSub)));
  }
}

/* ---------- 실행 ---------- */
loadConstitution();
loadRules();
loadResolutions();
loadReports();
loadPresbyteryRules();
loadPresbyteryData();

const bySrc = {};
chunks.forEach(c => { bySrc[c.src] = (bySrc[c.src] || 0) + 1; });

fs.writeFileSync(OUT, JSON.stringify({
  built: new Date().toISOString().slice(0, 10),
  count: chunks.length,
  chunks
}), 'utf8');

console.log('색인을 만들었습니다: ' + OUT);
console.log('조각 ' + chunks.length + '개, ' +
  Math.round(fs.statSync(OUT).size / 1024) + 'KB');
console.log('');
Object.keys(bySrc).sort().forEach(k => console.log('  ' + k + ': ' + bySrc[k]));

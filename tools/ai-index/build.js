/* 시화산노회 AI 자료 검색 — 총회 자료 색인 만들기
 *
 * 홈페이지에 실려 있는 총회 자료(헌법·규정·회의결의·보고서 목록)를
 * 조문·결의 항목 단위로 잘라 `data/ai/index.json` 에 담는다.
 * 검색 창구(cloudflare/ai)가 이 파일을 홈페이지에서 읽어 질문과 가까운
 * 조각을 찾아 Claude 에게 넘긴다.
 *
 *   node tools/ai-index/build.js
 *
 * 노회 자료(회원·교회·회칙·회의록·일정·시찰 자료)는 색인하지 않는다.
 * 그런 자료는 늘 바뀌므로 창구가 그때그때 Supabase 에서 읽는다(질문한 분의
 * 열람 권한 그대로).
 *
 * 조각마다 붙는 주소(url)는 뷰어가 알아듣는 깊은 주소다:
 *   assembly-constitution.html#b5-s1-a35   헌법 5권 → 2번째 장 → 제35조
 *   assembly-rules.html#b2-s3-a7           규정 2분류 → 4번째 규정 → 제7조
 *   assembly-resolution.html#s110-i3       제110회 결의 → 4번째 ■ 항목
 *   assembly-report.html#s110              제110회 보고서 목록
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ASM = path.join(ROOT, 'data', 'assembly');
const OUT_DIR = path.join(ROOT, 'data', 'ai');
const OUT = path.join(OUT_DIR, 'index.json');

const CHUNK_MAX = 1200;   /* 조각 하나의 최대 길이(글자) */

/* ---------- 도우미 ---------- */
function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t\r]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/* 긴 글을 줄 단위로 모아 조각으로 만든다 */
function splitText(text, maxLen) {
  const out = [];
  let buf = '';
  for (const line of text.split('\n')) {
    const piece = line.trim();
    if (!piece) continue;
    if (buf && (buf.length + piece.length + 1) > maxLen) { out.push(buf); buf = ''; }
    if (piece.length > maxLen) {
      if (buf) { out.push(buf); buf = ''; }
      let s = '';
      for (const sent of piece.split(/(?<=[.。?!])\s+/)) {
        if (s && (s.length + sent.length + 1) > maxLen) { out.push(s); s = ''; }
        s = s ? (s + ' ' + sent) : sent;
      }
      if (s) out.push(s);
    } else {
      buf = buf ? (buf + '\n' + piece) : piece;
    }
  }
  if (buf) out.push(buf);
  return out;
}

const chunks = [];
let seq = 0;
const stats = {};

/* src: 자료 갈래, title: 조각 제목(인용할 때 그대로 쓴다), url: 깊은 주소, text: 본문 */
function add(src, title, url, text, label) {
  const clean = stripHtml(text);
  if (!clean || clean.length < 12) return;
  const pieces = splitText(clean, CHUNK_MAX);
  pieces.forEach(function (piece, i) {
    chunks.push({
      id: ++seq,
      src: src,
      title: title + (pieces.length > 1 ? ' (' + (i + 1) + '/' + pieces.length + ')' : ''),
      label: label || title,
      url: url,
      text: piece
    });
  });
  stats[src] = (stats[src] || 0) + pieces.length;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

/* 본문을 조문(<H5>제N조…</H5> 또는 <div class="tit_dept_2">제N조(…)</div>) 단위로 가른다.
 * 돌려주는 것: [{no, head, html}] — 조문이 없으면 [] */
function splitArticles(html) {
  const re = /<H5[^>]*>\s*(제\s*(\d+)\s*조[^<]*)<\/H5>|<div class="tit_dept_2"[^>]*>\s*(제\s*(\d+)\s*조[^<]*)<\/div>/gi;
  const marks = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    marks.push({ at: m.index, end: m.index + m[0].length, head: (m[1] || m[3]).replace(/\s+/g, ' ').trim(), no: parseInt(m[2] || m[4], 10) });
  }
  if (marks.length < 2) return [];
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const body = html.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].at : html.length);
    out.push({ no: marks[i].no, head: marks[i].head, html: body, intro: i === 0 ? html.slice(0, marks[0].at) : '' });
  }
  return out;
}

/* ---------- 1. 총회 헌법 ---------- */
function loadConstitution() {
  const idx = readJson(path.join(ASM, 'constitution-index.json'));
  if (!idx) return;
  for (const b of (idx.books || [])) {
    const doc = readJson(path.join(ASM, 'constitution-' + b.n + '.json'));
    if (!doc) continue;
    const src = '총회 헌법 > ' + doc.title;
    (doc.secs || []).forEach(function (s, si) {
      const chapter = (s.t || '').trim();
      const arts = splitArticles(s.c || '');
      if (!arts.length) {
        add(src, doc.title + (chapter ? ' ' + chapter : ''),
            'assembly-constitution.html#b' + b.n + '-s' + si,
            (chapter ? chapter + '\n' : '') + s.c);
        return;
      }
      if (arts[0].intro && stripHtml(arts[0].intro).length > 12) {
        add(src, doc.title + ' ' + chapter + ' 머리말',
            'assembly-constitution.html#b' + b.n + '-s' + si, chapter + '\n' + arts[0].intro);
      }
      arts.forEach(function (a) {
        /* 인용 제목: "권징조례 제35조" / "정치 제10장 제3조 노회의 조직" */
        const label = doc.title + ' ' + (doc.title === '정치' && chapter ? chapter.replace(/\s+/g, ' ').split(' ').slice(0, 2).join(' ') + ' ' : '') + a.head;
        add(src, label,
            'assembly-constitution.html#b' + b.n + '-s' + si + '-a' + a.no,
            a.head + '\n' + a.html, label);
      });
    });
  }
}

/* ---------- 2. 총회 규정 ---------- */
function loadRules() {
  const idx = readJson(path.join(ASM, 'rules-index.json'));
  if (!idx) return;
  for (const c of (idx.cats || [])) {
    const doc = readJson(path.join(ASM, 'rules-' + c.n + '.json'));
    if (!doc) continue;
    const src = '총회 규정 > ' + doc.title;
    (doc.secs || []).forEach(function (s, si) {
      const name = (s.t || doc.title).trim();
      const arts = splitArticles(s.c || '');
      if (!arts.length) {
        add(src, name, 'assembly-rules.html#b' + c.n + '-s' + si, name + '\n' + s.c);
        return;
      }
      if (arts[0].intro && stripHtml(arts[0].intro).length > 12) {
        add(src, name + ' 머리말', 'assembly-rules.html#b' + c.n + '-s' + si, name + '\n' + arts[0].intro);
      }
      arts.forEach(function (a) {
        const label = name + ' ' + a.head;
        add(src, label, 'assembly-rules.html#b' + c.n + '-s' + si + '-a' + a.no, a.head + '\n' + a.html, label);
      });
    });
  }
}

/* ---------- 3. 총회 회의결의 ---------- */
function loadResolutions() {
  const idx = readJson(path.join(ASM, 'resolutions-index.json'));
  if (!idx) return;
  for (const r of (idx.list || [])) {
    const doc = readJson(path.join(ASM, 'resolution-' + r.s + '.json'));
    if (!doc) continue;
    const src = '총회 회의결의';
    const sess = '제' + r.s + '회 총회(' + r.year + '년)';
    const text = stripHtml(doc.cont || '');
    const parts = text.split(/\n(?=■)/);
    if (parts.length < 3) {
      /* ■ 표시가 없는 옛 회기: 문단 단위로 */
      add(src, sess + ' 결의', 'assembly-resolution.html#s' + r.s,
          sess + ' 총회장 ' + (r.chairman || '-') + ' 장소 ' + (r.loc || '-') + '\n' + text, sess + ' 결의');
      continue;
    }
    add(src, sess + ' 개요', 'assembly-resolution.html#s' + r.s,
        sess + ' 총회장 ' + (r.chairman || '-') + ' 장소 ' + (r.loc || '-') + '\n' + parts[0], sess + ' 개요');
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      const head = p.split('\n')[0].replace(/^■\s*/, '').trim().slice(0, 60);
      const label = sess + ' 「' + head + '」';
      add(src, label, 'assembly-resolution.html#s' + r.s + '-i' + (i - 1), sess + '\n' + p, label);
    }
  }
}

/* ---------- 4. 총회 보고서 (제목과 파일 주소) ---------- */
function loadReports() {
  const doc = readJson(path.join(ASM, 'reports.json'));
  if (!doc) return;
  for (const s of (doc.sessions || [])) {
    const lines = [];
    const walk = function (n, depth) {
      if (n.t) lines.push('  '.repeat(depth) + n.t + (n.u ? ' [PDF]' : ''));
      (n.k || []).forEach(function (k) { walk(k, depth + 1); });
    };
    (s.groups || []).forEach(function (g) { walk(g, 0); });
    add('총회 보고서', '제' + s.s + '회 총회 보고서 목록', 'assembly-report.html#s' + s.s,
        '제' + s.s + '회 총회에 제출된 보고서 목록 (파일은 총회 원본으로 연결)\n' + lines.join('\n'));
  }
}

/* ---------- 5. 총회 보고서 본문 (tools/assembly-report 가 PDF 에서 뽑은 글) ----------
 * report-<회기>.json 의 보고서 하나하나를 조각으로. 인용 제목은 「제111회 총회 보고서 「총회임원회」」,
 * 주소는 assembly-report.html#s111-r12 (보고서 화면이 그 보고서 본문을 연다). */
function loadReportTexts() {
  const files = fs.readdirSync(ASM).filter(function (f) { return /^report-\d+\.json$/.test(f); })
    .sort(function (a, b) { return parseInt(b.match(/\d+/)[0], 10) - parseInt(a.match(/\d+/)[0], 10); });
  for (const f of files) {
    const doc = readJson(path.join(ASM, f));
    if (!doc || !doc.entries) continue;
    const s = doc.s;
    const sess = '제' + s + '회 총회 보고서';
    const trail = [];   /* 갈래 > 항목 > 소항목 — 조각 제목에 상위 갈래를 붙인다 */
    for (const e of doc.entries) {
      trail[e.lv] = e.t; trail.length = e.lv + 1;
      if (!e.text || e.text.length < 40) continue;
      const where = trail.filter(Boolean).join(' > ');
      const label = sess + ' 「' + e.t + '」';
      add('총회 보고서 > 제' + s + '회', sess + ' · ' + where + (e.p1 > e.p0 ? ' (' + e.p0 + '~' + e.p1 + '쪽)' : ''),
          'assembly-report.html#s' + s + '-r' + e.i, where + '\n' + e.text, label);
    }
  }
}

/* ---------- 실행 ---------- */
loadConstitution();
loadRules();
loadResolutions();
loadReports();
loadReportTexts();

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  built: new Date().toISOString().slice(0, 10),
  count: chunks.length,
  chunks: chunks
}), 'utf8');

console.log('색인을 만들었습니다: ' + OUT);
console.log('조각 ' + chunks.length + '개, ' + Math.round(fs.statSync(OUT).size / 1024) + 'KB');
Object.keys(stats).sort().forEach(function (k) { console.log('  ' + k + ': ' + stats[k]); });

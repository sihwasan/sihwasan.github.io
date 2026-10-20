# -*- coding: utf-8 -*-
"""총회 보고서 PDF → 보고서별 글(JSON) 변환

총회가 펴낸 「제N회 총회 보고서」 PDF(한글 글자가 들어 있는 것) 한 권을 받아
목차(차례)대로 보고서 하나하나의 글을 뽑아 data/assembly/report-<N>.json 에 담고,
data/assembly/reports.json 의 회기 목록에도 그 회기를 넣는다.
홈페이지(assembly-report.html)가 이 파일로 본문 보기·검색을 하고,
tools/ai-index/build.js 가 AI 검색 색인에 본문을 넣는다.

    python tools/assembly-report/pdf2json.py "<PDF 파일>" <회기> <연도>
    예)  python tools/assembly-report/pdf2json.py "C:\\...\\제111회 총회보고서.pdf" 111 2026

필요한 것: pip install pdfplumber
쪽마다 글을 뽑는 데 몇 분 걸리므로, 뽑은 글은 tools/assembly-report/cache/pages-<N>.json 에 두고
다시 돌릴 때는 그 파일을 쓴다 (PDF 가 바뀌었으면 cache 파일을 지운다).
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
ASM = os.path.join(ROOT, 'data', 'assembly')
CACHE = os.path.join(HERE, 'cache')

ROMAN = {'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4, 'Ⅴ': 5, 'Ⅵ': 6, 'Ⅶ': 7, 'Ⅷ': 8, 'Ⅸ': 9, 'Ⅹ': 10,
         'I': 1, 'V': 5, 'X': 10}
ROMAN_OUT = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ']


def roman_value(s):
    """Ⅰ·Ⅱ·…·Ⅹ 와 ASCII X·I 가 섞인 로마 숫자 → 정수 (더하기만, 이 보고서의 1~12 범위)."""
    total = 0
    for ch in s:
        if ch not in ROMAN:
            return 0
        total += ROMAN[ch]
    return total


def norm(s):
    return re.sub(r'[\s.·\-()（）]', '', s or '')


# ---------- 1. 쪽마다 글 뽑기 (cache) ----------
def extract_pages(pdf_path, session):
    if not os.path.isdir(CACHE):
        os.makedirs(CACHE)
    cache = os.path.join(CACHE, 'pages-%s.json' % session)
    if os.path.exists(cache):
        with io.open(cache, encoding='utf-8') as f:
            return json.load(f)
    import pdfplumber
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        n = len(pdf.pages)
        for i, page in enumerate(pdf.pages):
            try:
                t = page.extract_text() or ''
            except Exception as e:  # 한 쪽이 깨져도 나머지는 계속
                t = ''
                sys.stderr.write('page %d: %s\n' % (i + 1, e))
            pages.append(t)
            if (i + 1) % 100 == 0:
                sys.stderr.write('  %d / %d 쪽\n' % (i + 1, n))
    with io.open(cache, 'w', encoding='utf-8') as f:
        json.dump(pages, f, ensure_ascii=False)
    return pages


# ---------- 2. 차례 읽기 ----------
TOC_PART = re.compile(r'^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩXIV]+)\.\s*(.+?)\s+(\d+)$')
TOC_ITEM = re.compile(r'^(\d+)\.\s*(.+?)\s+(\d+)$')
TOC_SUB = re.compile(r'^(\S.*?)\s+(\d+)$')


def find_toc_pages(pages):
    """「차 례」가 머리글에 있는 쪽들 (보통 5~7쪽)."""
    out = []
    for i, t in enumerate(pages[:20]):
        first = (t.split('\n') or [''])[0]
        if re.match(r'^(차\s*례❙\d+|\d+❙제\d+회 총회 보고서)$', first) and (out or first.startswith('차')):
            # 「차 례❙N」 로 시작하거나, 차례가 이어지는 짝수 쪽
            if first.startswith('차') or (out and i == out[-1] + 1):
                out.append(i)
    return out


def parse_toc(pages):
    entries = []
    for pi in find_toc_pages(pages):
        for line in pages[pi].split('\n')[1:]:
            line = line.strip()
            if not line:
                continue
            m = TOC_PART.match(line)
            if m and roman_value(m.group(1)):
                entries.append({'lv': 0, 'no': ROMAN_OUT[roman_value(m.group(1))], 't': m.group(2).strip(), 'p0': int(m.group(3))})
                continue
            m = TOC_ITEM.match(line)
            if m:
                entries.append({'lv': 1, 'no': m.group(1), 't': m.group(2).strip(), 'p0': int(m.group(3))})
                continue
            m = TOC_SUB.match(line)
            if m:
                entries.append({'lv': 2, 'no': '', 't': m.group(1).strip(), 'p0': int(m.group(2))})
    return entries


# ---------- 3. 쪽 글 다듬기 ----------
HEAD_EVEN = re.compile(r'^\d+❙제\d+회 총회 보고서$')
HEAD_ODD = re.compile(r'^.+❙\d+$')


def page_lines(text):
    """머리글(쪽 번호 띠)을 뗀 줄들."""
    lines = text.split('\n')
    if lines and (HEAD_EVEN.match(lines[0].strip()) or HEAD_ODD.match(lines[0].strip())):
        lines = lines[1:]
    return [l.rstrip() for l in lines]


def is_cover(text):
    return 'THE GENERAL ASSEMBLY OF PRESBYTERIAN CHURCH IN KOREA' in text


def heading_at(lines, title):
    """쪽 안에서 이 보고서의 제목 줄이 몇 번째 줄인지 (없으면 -1)."""
    want = norm(re.sub(r'\s*보고$', '', title))
    if len(want) < 3:
        return -1
    for i, l in enumerate(lines):
        ln = norm(re.sub(r'^\d+\s*', '', l))
        if not ln:
            continue
        if ln == want or ln == want + '보고' or (len(ln) >= 4 and (ln in want or want in ln) and abs(len(ln) - len(want)) <= 4):
            return i
    return -1


# ---------- 4. 보고서별로 나누기 ----------
def split_entries(pages, entries, session):
    n_pages = len(pages)
    # 노회 상황 보고처럼 차례에는 한 줄인데 안에 보고가 여럿인 부(部)는 번호 붙은 제목 줄로 나눈다
    expanded = []
    for i, e in enumerate(entries):
        expanded.append(e)
        nxt = entries[i + 1]['p0'] if i + 1 < len(entries) else n_pages + 1
        if e['lv'] == 0 and nxt - e['p0'] > 20:
            has_children = i + 1 < len(entries) and entries[i + 1]['lv'] > 0 and entries[i + 1]['p0'] < nxt
            if not has_children:
                for p in range(e['p0'], nxt):
                    for l in page_lines(pages[p - 1]):
                        m = re.match(r'^(\d+)\.\s*(\S+노회)\s*$', l.strip())
                        if m:
                            expanded.append({'lv': 1, 'no': m.group(1), 't': m.group(2), 'p0': p, 'auto': True})
    entries = expanded

    # 규칙: 보고서의 시작 쪽에서 제목 줄 앞의 글은 앞 보고서 것이고, 다음 보고서가 같은 쪽에서 시작하면
    #       그 제목 줄부터는 다음 보고서 것이다. 그래서 한 줄이 두 보고서에 들어가지 않는다.
    out = []
    for i, e in enumerate(entries):
        p0 = e['p0']
        nxt = entries[i + 1] if i + 1 < len(entries) else None
        if nxt is None:
            p1 = n_pages
        elif nxt['p0'] == p0:
            p1 = p0
        else:
            p1 = nxt['p0'] - 1
        texts = []
        for p in range(p0, p1 + 1):
            if p < 1 or p > n_pages:
                continue
            raw = pages[p - 1]
            if e['lv'] == 0 and p == p0 and is_cover(raw):
                continue
            ls = page_lines(raw)
            if p == p0 and i > 0:
                h = heading_at(ls, e['t'])
                if h > 0:
                    ls = ls[h:]          # 내 제목 줄부터 (앞은 앞 보고서가 이미 가져갔다)
            if p == p1 and nxt is not None and nxt['p0'] == p1:
                h2 = heading_at(ls[1:], nxt['t'])
                if h2 >= 0:
                    ls = ls[:h2 + 1]     # 다음 보고서 제목 줄 앞까지
            texts.extend(ls)
        # 다음 보고서가 다음 쪽 중간에서 시작하면 그 쪽의 앞부분은 내 것
        if nxt is not None and nxt['p0'] == p1 + 1 and p1 + 1 <= n_pages:
            nl = page_lines(pages[p1])
            h3 = heading_at(nl, nxt['t'])
            if h3 > 0:
                texts.extend(nl[:h3])
        body = '\n'.join(l for l in texts if l.strip())
        out.append({'i': len(out) + 1, 'lv': e['lv'], 'no': e['no'], 't': e['t'], 'p0': p0, 'p1': p1, 'text': body})
    return out


# ---------- 5. 회기 목록(reports.json) 갱신 ----------
def update_reports_json(session, year, entries, pdf_name):
    path = os.path.join(ASM, 'reports.json')
    with io.open(path, encoding='utf-8') as f:
        doc = json.load(f)
    groups = []
    cur_g = None
    cur_i = None
    for e in entries:
        node = {'t': (e['no'] + '. ' if e['no'] and e['lv'] else '') + e['t']}
        if len(e['text']) > 40:
            node['x'] = e['i']
        if e['lv'] == 0:
            cur_g = {'t': e['no'] + '. ' + e['t'], 'k': []}
            if 'x' in node:
                cur_g['x'] = node['x']
            groups.append(cur_g)
            cur_i = None
        elif e['lv'] == 1:
            if cur_g is None:
                cur_g = {'t': '보고서', 'k': []}
                groups.append(cur_g)
            cur_i = node
            cur_g['k'].append(node)
        else:
            if cur_i is None:
                cur_g['k'].append(node)
            else:
                cur_i.setdefault('k', []).append(node)
    sess = {'s': session, 'year': year, 'text': 'report-%d.json' % session, 'groups': groups,
            'note': '본문은 「%s」(총회 기획행정국 발행)에서 글자만 뽑은 것입니다. 표·그림은 원본 PDF 를 보십시오.' % pdf_name}
    doc['sessions'] = [s for s in doc.get('sessions', []) if s.get('s') != session]
    doc['sessions'].insert(0, sess)
    doc['sessions'].sort(key=lambda s: -int(s['s']))
    with io.open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    return len(groups)


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    pdf_path, session, year = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    pages = extract_pages(pdf_path, session)
    print('쪽 %d' % len(pages))
    toc = parse_toc(pages)
    print('차례 항목 %d개' % len(toc))
    entries = split_entries(pages, toc, session)
    total = sum(len(e['text']) for e in entries)
    empty = [e for e in entries if len(e['text']) < 40]
    print('보고서 %d개, 글자 %s자, 빈 항목 %d개' % (len(entries), format(total, ','), len(empty)))
    for e in empty[:20]:
        print('  (빈) %s %s %s p%d-%d' % (e['lv'], e['no'], e['t'], e['p0'], e['p1']))
    out = {
        's': session, 'year': year, 'title': '제%d회 총회 보고서' % session,
        'src': os.path.basename(pdf_path), 'pages': len(pages),
        'built': __import__('datetime').date.today().isoformat(),
        'entries': entries
    }
    out_path = os.path.join(ASM, 'report-%d.json' % session)
    with io.open(out_path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False)
    print('저장: %s (%d KB)' % (out_path, os.path.getsize(out_path) // 1024))
    g = update_reports_json(session, year, entries, os.path.basename(pdf_path))
    print('reports.json 에 제%d회 등록 (큰 갈래 %d개)' % (session, g))


if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
"""총회전자자료실(gapck.org)의 회기별 보고서 PDF 들을 받아 글(JSON)로 바꾼다 — 제104~110회

data/assembly/reports.json 에 적힌 PDF 주소(총회 S3)를 하나씩 받아(임시 폴더에 보관) 글자를 뽑고,
제111회와 같은 모양의 data/assembly/report-<N>.json 을 만든다. reports.json 의 그 항목에는
본문 번호(x)를 붙인다 (PDF 주소 u 는 그대로 둔다 — 화면에서 「원본 PDF」로 보인다).

    python tools/assembly-report/fetch_gapck.py <받아 둘 폴더> [회기 ...]
    예)  python tools/assembly-report/fetch_gapck.py "%TEMP%\gapck-pdf" 110 109

회기를 안 적으면 PDF 주소가 있는 모든 회기를 한다. 이미 받은 파일은 다시 받지 않는다.
진행 상황은 <받아 둘 폴더>/fetch.log 에 남는다.
"""
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
ASM = os.path.join(ROOT, 'data', 'assembly')
HEAD_RE = re.compile(r'^(\d+❙.+|.+❙\d+)$')


def log(fp, msg):
    line = time.strftime('%H:%M:%S ') + msg
    print(line)
    fp.write(line + '\n')
    fp.flush()


def encoded(u):
    p = urllib.parse.urlsplit(u)
    return urllib.parse.urlunsplit((p.scheme, p.netloc, urllib.parse.quote(p.path), p.query, ''))


def download(u, dest, fp):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return True
    for attempt in range(3):
        try:
            req = urllib.request.Request(encoded(u), headers={'User-Agent': 'Mozilla/5.0 (sihwasan.org report indexer)'})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if not data.startswith(b'%PDF'):
                log(fp, '  PDF 가 아님: ' + u)
                return False
            with open(dest + '.part', 'wb') as f:
                f.write(data)
            os.replace(dest + '.part', dest)
            return True
        except Exception as e:
            log(fp, '  받기 실패(%d/3) %s: %s' % (attempt + 1, u, e))
            time.sleep(2 + attempt * 3)
    return False


def extract(path):
    import pdfplumber
    lines = []
    n = 0
    with pdfplumber.open(path) as pdf:
        n = len(pdf.pages)
        for page in pdf.pages:
            try:
                t = page.extract_text() or ''
            except Exception:
                t = ''
            ls = t.split('\n')
            if ls and HEAD_RE.match(ls[0].strip()):
                ls = ls[1:]
            lines.extend(l.rstrip() for l in ls if l.strip())
    return n, '\n'.join(lines)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    store = sys.argv[1]
    only = [int(a) for a in sys.argv[2:]]
    if not os.path.isdir(store):
        os.makedirs(store)
    fp = io.open(os.path.join(store, 'fetch.log'), 'a', encoding='utf-8')

    with io.open(os.path.join(ASM, 'reports.json'), encoding='utf-8') as f:
        doc = json.load(f)

    for sess in doc['sessions']:
        s = int(sess['s'])
        if only and s not in only:
            continue
        if sess.get('text') and not sess.get('groups_have_u_pending', True) and False:
            continue
        nodes = []

        def walk(n, lv):
            nodes.append((n, lv))
            for k in n.get('k', []):
                walk(k, lv + 1)
        for g in sess.get('groups', []):
            walk(g, 0)
        if not any(n.get('u') for n, _ in nodes):
            log(fp, '제%d회: PDF 주소가 없어 건너뜀' % s)
            continue
        log(fp, '제%d회: 항목 %d개 시작' % (s, len(nodes)))
        sdir = os.path.join(store, str(s))
        if not os.path.isdir(sdir):
            os.makedirs(sdir)
        entries = []
        total_pages = 0
        ok = fail = 0
        for idx, (n, lv) in enumerate(nodes):
            e = {'i': len(entries) + 1, 'lv': lv, 'no': '', 't': n['t'], 'p0': 1, 'p1': 1, 'text': ''}
            if n.get('u'):
                dest = os.path.join(sdir, '%03d.pdf' % (idx + 1))
                if download(n['u'], dest, fp):
                    try:
                        pages, text = extract(dest)
                        e['p1'] = pages
                        e['text'] = text
                        e['u'] = n['u']
                        total_pages += pages
                        ok += 1
                        log(fp, '  [%d/%d] %s — %d쪽 %s자' % (idx + 1, len(nodes), n['t'], pages, format(len(text), ',')))
                    except Exception as ex:
                        fail += 1
                        log(fp, '  [%d/%d] %s — 글 뽑기 실패: %s' % (idx + 1, len(nodes), n['t'], ex))
                else:
                    fail += 1
            entries.append(e)
            if len(e['text']) > 40:
                n['x'] = e['i']
            elif 'x' in n:
                del n['x']
        out = {'s': s, 'year': sess.get('year') or (s + 1915), 'title': '제%d회 총회 보고서' % s,
               'src': 'gapck.org 총회전자자료실 보고서 PDF (%d개)' % ok, 'pages': total_pages,
               'built': time.strftime('%Y-%m-%d'), 'entries': entries}
        with io.open(os.path.join(ASM, 'report-%d.json' % s), 'w', encoding='utf-8', newline='\n') as f:
            json.dump(out, f, ensure_ascii=False)
        sess['text'] = 'report-%d.json' % s
        sess['year'] = out['year']
        sess['note'] = '본문은 총회전자자료실(gapck.org)의 보고서 PDF 에서 글자만 뽑은 것입니다. 표·그림은 원본 PDF 를 보십시오.'
        with io.open(os.path.join(ASM, 'reports.json'), 'w', encoding='utf-8', newline='\n') as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
        log(fp, '제%d회 끝: 성공 %d, 실패 %d, 쪽 %d, 글자 %s' % (s, ok, fail, total_pages, format(sum(len(e['text']) for e in entries), ',')))
    log(fp, '모두 끝')


if __name__ == '__main__':
    main()

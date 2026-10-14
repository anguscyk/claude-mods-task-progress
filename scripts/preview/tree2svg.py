"""把 render-scenarios.ts 輸出的 @@<名稱>@@<JSON> 行轉成終端機風格的 SVG 示意圖。

用法：python3 -I tree2svg.py <trees.txt> <output.svg>
"""

import json, sys, unicodedata
from xml.sax.saxutils import escape

trees = {}
for line in open(sys.argv[1], encoding='utf-8'):
    _, name, body = line.rstrip('\n').split('@@', 2)
    trees[name] = json.loads(body)

def text_of(node):
    out = []
    for c in node.get('children', []) or []:
        out.append(c if isinstance(c, str) else text_of(c))
    return ''.join(out)

def lines(node):
    """回傳 [[(text, style), ...], ...]，style: green/yellow/red/dim/button/None"""
    t = node.get('type'); props = node.get('props') or {}
    if t == 'Text':
        s = text_of(node)
        if s == '': return []
        style = props.get('color') or ('dim' if props.get('dimColor') else None)
        return [[(s, style)]]
    if t == 'Button':
        return [[(f"[ {props.get('label', '')} ]", 'button')]]
    if t == 'Box':
        kids = [lines(c) for c in node.get('children', []) or [] if not isinstance(c, str)]
        if props.get('flexDirection') == 'column':
            return [l for k in kids for l in k]
        row = [seg for k in kids for l in k for seg in l]
        return [row] if row else []
    return []

def cells(ch):
    return 2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1

COLORS = {None: '#d4d4d4', 'dim': '#7f848e', 'green': '#73c991', 'yellow': '#e5c07b', 'red': '#e06c75', 'button': '#61afef'}
CW, LH, PAD = 8.4, 20, 16
panels = [
    ('有任務清單（手動展開）', 'tasks-expanded'),
    ('沒有任務清單：步驟列表執行中（預設收合）', 'steps-collapsed-running'),
    ('步驟列表手動展開', 'steps-expanded'),
    ('一輪結束後自動收合', 'steps-after-turn'),
]
out_rows = []  # (kind, payload)
for title, key in panels:
    out_rows.append(('title', title))
    for l in lines(trees[key]):
        out_rows.append(('line', l))
    out_rows.append(('gap', None))
out_rows.pop()

maxcells = 0
for kind, p in out_rows:
    if kind == 'line':
        maxcells = max(maxcells, sum(cells(ch) for s, _ in p for ch in s))
    elif kind == 'title':
        maxcells = max(maxcells, sum(cells(ch) for ch in p) + 2)
W = int(PAD * 2 + maxcells * CW + 8)
y = PAD + 14
body = []
for kind, p in out_rows:
    if kind == 'title':
        body.append(f'<text x="{PAD}" y="{y}" class="t">{escape(p)}</text>')
        y += LH
    elif kind == 'gap':
        y += LH // 2
    else:
        col = 0
        for s, style in p:
            xs = []
            for ch in s:
                xs.append(f'{PAD + col * CW:.1f}')
                col += cells(ch)
            if s.strip() == '': continue
            weight = ' font-weight="bold"' if style == 'button' else ''
            body.append(f'<text x="{" ".join(xs)}" y="{y}" fill="{COLORS.get(style, COLORS[None])}"{weight}>{escape(s)}</text>')
        y += LH
H = y + PAD - LH + 6
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="task-progress 畫面示意">
<style>text{{font-family:Menlo,Monaco,Consolas,"Noto Sans Mono CJK TC","PingFang TC",monospace;font-size:14px;white-space:pre}} .t{{fill:#abb2bf;font-size:12px}}</style>
<rect width="100%" height="100%" rx="8" fill="#1e1f22"/>
{chr(10).join(body)}
</svg>
'''
open(sys.argv[2], 'w', encoding='utf-8').write(svg)
for kind, p in out_rows:
    if kind == 'line': print(''.join(s for s, _ in p))
    elif kind == 'title': print('#', p)

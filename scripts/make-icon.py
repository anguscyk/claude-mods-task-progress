"""產生 marketplace 圖示 .claude-plugin/icon.png（1024×1024 方形 PNG，不需任何外部套件）。

圖案：深色圓角方塊上，一條完成 60% 的綠色進度條，下方 5 個步驟點（4 個完成、1 個進行中）。
用法：python3 -I scripts/make-icon.py
"""

import os
import struct
import zlib

SIZE = 1024
SS = 3  # 每個像素 3×3 取樣做反鋸齒

BG = (30, 31, 34)
GREEN = (115, 201, 145)
TRACK = (62, 66, 74)
RING = (115, 201, 145)


def in_round_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def shape_color(x, y):
    """回傳該點的顏色；None 表示透明（圓角方塊外）。後畫的圖形覆蓋先畫的。"""
    if not in_round_rect(x, y, 0, 0, SIZE, SIZE, 200):
        return None
    color = BG
    # 進度條：軌道與 60% 已完成
    bx0, bx1, by0, by1 = 152, 872, 340, 470
    if in_round_rect(x, y, bx0, by0, bx1, by1, 65):
        color = TRACK
        if x <= bx0 + (bx1 - bx0) * 0.6:
            color = GREEN
    # 5 個步驟點：4 個實心、最後 1 個空心圓環
    for i in range(5):
        cx, cy, r = 222 + i * 145, 680, 52
        d2 = (x - cx) ** 2 + (y - cy) ** 2
        if i < 4 and d2 <= r * r:
            color = GREEN
        elif i == 4 and (r - 16) ** 2 <= d2 <= r * r:
            color = RING
    return color


def render():
    rows = []
    step = 1 / SS
    for py in range(SIZE):
        row = bytearray([0])  # PNG 每列前置的 filter byte
        for px in range(SIZE):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    c = shape_color(px + (sx + 0.5) * step, py + (sy + 0.5) * step)
                    if c is not None:
                        r += c[0]; g += c[1]; b += c[2]; a += 1
            if a:
                row += bytes((r // a, g // a, b // a, 255 * a // (SS * SS)))
            else:
                row += b'\x00\x00\x00\x00'
        rows.append(bytes(row))
    return b''.join(rows)


def png(raw):
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


if __name__ == '__main__':
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.claude-plugin', 'icon.png')
    with open(out, 'wb') as f:
        f.write(png(render()))
    print('已產生', os.path.normpath(out))

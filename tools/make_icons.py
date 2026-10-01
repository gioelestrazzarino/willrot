#!/usr/bin/env python3
"""Render the Willrot app icon set (pure stdlib, no PIL).

Concept: dark rounded square, one centered vertical tally bar with rounded
caps, split flat ember (top) / ash (bottom). Run: python3 tools/make_icons.py
"""
import os, struct, zlib

BG = (0x12, 0x11, 0x10)
EMBER = (0xE2, 0x50, 0x1C)
ASH = (0x7A, 0x32, 0x28)
OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'icons')
SS = 4  # supersampling per axis


def write_png(path, w, h, rows):
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def in_round_rect(x, y, r):
    # unit square [0,1], corner radius r
    cx = min(max(x, r), 1 - r)
    cy = min(max(y, r), 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def bar_color(x, y, half_w, y0, y1):
    # capsule centered at x=0.5 from y0..y1
    r = half_w
    sy = min(max(y, y0 + r), y1 - r)
    if (x - 0.5) ** 2 + (y - sy) ** 2 <= r * r:
        return EMBER if y < (y0 + y1) / 2 else ASH
    return None


def render(size, rounded, name, bar_scale=1.0):
    # thicker bar at tiny sizes so it stays legible
    half_w = (0.11 if size <= 48 else 0.085) * bar_scale
    span = 0.31 * bar_scale
    y0, y1 = 0.5 - span, 0.5 + span
    corner = 0.225
    rows = []
    n = SS * SS
    for py in range(size):
        row = []
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) / size
                    y = (py + (sy + 0.5) / SS) / size
                    if rounded and not in_round_rect(x, y, corner):
                        continue
                    c = bar_color(x, y, half_w, y0, y1) or BG
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
            a = acc[3] // n
            if acc[3]:
                k = acc[3] / 255
                row += [round(acc[0] / k), round(acc[1] / k), round(acc[2] / k), a]
            else:
                row += [0, 0, 0, 0]
        rows.append(row)
    write_png(os.path.join(OUT, name), size, size, rows)
    print('wrote', name)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for s in (512, 192, 144, 96, 48, 32, 16):
        render(s, True, f'icon-{s}.png')
    # maskable + iOS: full-bleed square (the OS applies its own mask)
    render(512, False, 'maskable-512.png', bar_scale=0.85)
    render(192, False, 'maskable-192.png', bar_scale=0.85)
    render(180, False, 'apple-touch-icon.png')

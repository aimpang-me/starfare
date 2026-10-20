"""Silhouette sheet for the variety blockouts: each model large, then at 40 px and 15 px in greyscale (the map's dock
size), so the pass/fail test in the plan can be judged by eye.  python -I sheet.py RENDER_DIR OUT.png"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ORDER = ["station-orbital-depot", "station-lunar-data-center", "station-mars-base", "station-ceres-port",
         "station-titan-dock", "dock-ring", "dock-tether", "dock-spar", "ship-taxi", "ship-shuttle", "ship-liner"]
src, out = sys.argv[1], sys.argv[2]
names = [n for n in ORDER if os.path.exists(os.path.join(src, n + ".png"))]
T, COLS, BG = 300, 4, (8, 10, 14)
rows = (len(names) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * T, rows * (T + 70) + 40), BG)
d = ImageDraw.Draw(sheet)
try:
    f = ImageFont.truetype("DejaVuSans.ttf", 13)
except OSError:
    f = ImageFont.load_default()
d.text((12, 12), "Starfare variety blockouts, grey, for the silhouette test. Small squares: 40 px and 15 px in greyscale.", fill=(200, 205, 215), font=f)
for i, n in enumerate(names):
    im = Image.open(os.path.join(src, n + ".png")).convert("RGBA")
    x, y = (i % COLS) * T, 40 + (i // COLS) * (T + 70)
    big = im.resize((T - 20, T - 20), Image.LANCZOS)
    sheet.paste(big, (x + 10, y), big)
    for k, px in enumerate((40, 15)):
        s = im.convert("LA").resize((px, px), Image.LANCZOS).convert("RGBA")
        bx = x + 12 + k * 52
        d.rectangle((bx - 2, y + T - 4, bx + 42, y + T + 40), fill=(20, 24, 32))
        sheet.paste(s, (bx + (40 - px) // 2, y + T + (40 - px) // 2 - 2), s)
    d.text((x + 120, y + T + 10), n, fill=(220, 225, 235), font=f)
sheet.save(out)

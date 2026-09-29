"""Tile screenshots into one labelled contact sheet per device (and one overall), downscaled for quick review.
   python3 contact-sheet.py <dir>   → <dir>/sheet.png and <dir>/sheet@<device>.png"""
import pathlib, sys
from PIL import Image, ImageDraw

d = pathlib.Path(sys.argv[1])
shots = sorted(p for p in d.glob("*@*.png") if not p.name.startswith("sheet"))
if not shots:
    sys.exit("no screenshots")
W, LABEL, COLS = 300, 22, 6

def sheet(files, out):
    thumbs = []
    for p in files:
        im = Image.open(p).convert("RGB")
        h = round(im.height * W / im.width)
        thumbs.append((p.stem, im.resize((W, h))))
    H = max(t.height for _, t in thumbs) + LABEL
    cols = min(COLS, len(thumbs))
    rows = (len(thumbs) + cols - 1) // cols
    canvas = Image.new("RGB", (cols * (W + 8), rows * (H + 8)), "white")
    draw = ImageDraw.Draw(canvas)
    for i, (name, t) in enumerate(thumbs):
        x, y = (i % cols) * (W + 8), (i // cols) * (H + 8)
        draw.text((x + 4, y + 4), name, fill="black")
        canvas.paste(t, (x, y + LABEL))
    canvas.save(out)
    print(out)

sheet(shots, d / "sheet.png")
for device in sorted({p.stem.split("@", 1)[1] for p in shots}):
    sheet([p for p in shots if p.stem.endswith("@" + device)], d / f"sheet@{device}.png")

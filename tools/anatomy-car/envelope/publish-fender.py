"""Publish actual inspected CarScope captures; requires Pillow."""
from pathlib import Path
from PIL import Image
import argparse

ROOT = Path(__file__).resolve().parents[3]
DEST = ROOT / "docs/visuals/p2-a3-1-2/images"
NAMES = [
    "fender-before-front-3q.png", "fender-after-front-3q.png",
    "fender-before-side.png", "fender-after-side.png",
    "fender-after-front.png", "fender-after-top.png",
    "fender-after-glb.png", "fender-after-wireframe.png",
]
CROP = (550, 650, 1600, 1550)  # same 4x SVG camera and pixel rectangle
parser = argparse.ArgumentParser()
parser.add_argument("capture_dir", type=Path)
args = parser.parse_args()
source = args.capture_dir.resolve()
required = [source / name for name in NAMES] + [source / f"fender-{n}-x4.png" for n in ("before", "after")]
missing = [str(p) for p in required if not p.is_file()]
if missing:
    raise SystemExit("Missing real captures: " + ", ".join(missing))
for path in required:
    with Image.open(path) as opened:
        if opened.format != "PNG":
            raise SystemExit(f"Not PNG: {path.name}")
        opened.verify()
DEST.mkdir(parents=True, exist_ok=True)
for name in NAMES:
    with Image.open(source / name) as opened:
        opened.convert("RGB").save(DEST / name, format="PNG", optimize=True)
for name in ("before", "after"):
    with Image.open(source / f"fender-{name}-x4.png") as opened:
        if opened.width < CROP[2] or opened.height < CROP[3]:
            raise SystemExit(f"4x capture too small: {name}")
        opened.convert("RGB").crop(CROP).save(DEST / f"fender-{name}-detail.png", format="PNG", optimize=True)
total = 0
for file in sorted(DEST.glob("*.png")):
    with Image.open(file) as opened:
        size = opened.size
        opened.verify()
    total += file.stat().st_size
    print(f"{file.name}: {size[0]}x{size[1]}, {file.stat().st_size} bytes")
print(f"total: {total} bytes")

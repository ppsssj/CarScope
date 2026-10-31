"""Publish inspected, real Anatomy/Three.js captures. Requires Pillow.

Run compare.mjs and check-visuals.mjs first. Never synthesizes a missing view.
"""
from pathlib import Path
from PIL import Image
import argparse

ROOT = Path(__file__).resolve().parents[3]
DEST = ROOT / "docs/visuals/p2-a3-1/images"
SOURCES = {
    "sedan-front-3q.png": "sedan-card.png",
    "suv-front-3q.png": "suv-card.png",
    "suv-front.png": "glb-front.png",
    "suv-side.png": "glb-left.png",
    "suv-rear.png": "glb-rear.png",
    "suv-top.png": "glb-top.png",
    "suv-doors-open.png": "svg-all-open-light-x1.png",
    "suv-glb-front-3q.png": "glb-front-three-quarter.png",
    "suv-glb-side.png": "glb-left.png",
    "suv-glb-doors-open.png": "glb-four-open.png",
}

parser = argparse.ArgumentParser()
parser.add_argument("capture_dir", type=Path)
args = parser.parse_args()
source = args.capture_dir.resolve()
required = [source / name for name in [*SOURCES.values(), "svg-closed-light-x4.png"]]
missing = [str(p) for p in required if not p.is_file()]
if missing:
    raise SystemExit("Missing real captures: " + ", ".join(missing))

DEST.mkdir(parents=True, exist_ok=True)
total = 0
for target, origin in SOURCES.items():
    with Image.open(source / origin) as opened:
        opened.verify()
    with Image.open(source / origin) as opened:
        image = opened.convert("RGB")
        image.save(DEST / target, format="PNG", optimize=True)
    with Image.open(DEST / target) as check:
        check.verify()
    size = (DEST / target).stat().st_size
    total += size
    print(f"{target}: {image.width}x{image.height}, {size} bytes, source={origin}")

# A 4x pixel-scale crop of the hood on the real SVG screenshot. The crop keeps
# the front fascia, wheel, and windshield edge so the context remains visible.
with Image.open(source / "svg-closed-light-x4.png") as opened:
    opened.verify()
with Image.open(source / "svg-closed-light-x4.png") as opened:
    image = opened.convert("RGB").crop((560, 740, 1650, 1520))
    image.save(DEST / "suv-hood-detail.png", format="PNG", optimize=True)
with Image.open(DEST / "suv-hood-detail.png") as check:
    check.verify()
size = (DEST / "suv-hood-detail.png").stat().st_size
total += size
print(f"suv-hood-detail.png: {image.width}x{image.height}, {size} bytes, source=svg-closed-light-x4.png crop")
print(f"total: {total} bytes")

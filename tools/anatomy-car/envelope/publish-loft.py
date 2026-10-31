"""Publish inspected real before/after SVG and GLB captures. Requires Pillow."""
from pathlib import Path
from PIL import Image
import argparse

ROOT=Path(__file__).resolve().parents[3]
DEST=ROOT/"docs/visuals/p2-a3-1-1/images"
NAMES=["hood-before-front-3q.png","hood-after-front-3q.png",
       "hood-before-side.png","hood-after-side.png","hood-after-glb.png","hood-after-wireframe.png"]
parser=argparse.ArgumentParser()
parser.add_argument("capture_dir",type=Path)
args=parser.parse_args()
source=args.capture_dir.resolve()
required=[source/name for name in [*NAMES,"hood-before-x4.png","hood-after-x4.png"]]
missing=[str(p) for p in required if not p.is_file()]
if missing: raise SystemExit("Missing real captures: "+", ".join(missing))
DEST.mkdir(parents=True,exist_ok=True)
for name in NAMES:
    with Image.open(source/name) as opened: opened.verify()
    with Image.open(source/name) as opened: opened.convert("RGB").save(DEST/name,format="PNG",optimize=True)
for label in ["before","after"]:
    with Image.open(source/f"hood-{label}-x4.png") as opened: opened.verify()
    with Image.open(source/f"hood-{label}-x4.png") as opened:
        opened.convert("RGB").crop((560,740,1650,1520)).save(DEST/f"hood-{label}-detail.png",format="PNG",optimize=True)
total=0
for file in sorted(DEST.glob("*.png")):
    with Image.open(file) as opened:
        size=opened.size
        opened.verify()
    total+=file.stat().st_size
    print(f"{file.name}: {size[0]}x{size[1]}, {file.stat().st_size} bytes")
print(f"total: {total} bytes")

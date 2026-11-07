"""P12-B: prints sha256 and a 64-bit difference hash per image, for the dataset manifest's leakage check.

python scripts/fingerprint_images.py <image> [<image> ...]   (needs Pillow)
"""
import hashlib
import json
import sys

from PIL import Image, ImageOps


def dhash(path):
    with Image.open(path) as image:
        small = ImageOps.exif_transpose(image).convert("L").resize((9, 8), Image.Resampling.BILINEAR)
    pixels = list(small.getdata())
    bits = 0
    for row in range(8):
        for column in range(8):
            bits = (bits << 1) | int(pixels[row * 9 + column] > pixels[row * 9 + column + 1])
    return f"{bits:016x}"


def main(paths):
    for path in paths:
        with open(path, "rb") as file:
            sha256 = hashlib.sha256(file.read()).hexdigest()
        print(json.dumps({"file": path, "sha256": sha256, "dhash": dhash(path)}))


if __name__ == "__main__":
    main(sys.argv[1:])

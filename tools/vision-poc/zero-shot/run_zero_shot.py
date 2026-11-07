"""P12-D: runs a pretrained text-prompt detector on the photos of a manifest. No training. Local only; weights and images stay outside Git.

python zero-shot/run_zero_shot.py --model owlv2 --manifest m.json --images <folder> --out results.json
Prompts are fixed in zero_shot_prompts.json before any result is seen. They must not be changed to fit these photos.
"""
import argparse
import json
import statistics
import time
from pathlib import Path

import psutil
import torch
import transformers
from PIL import Image, ImageOps
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

MODELS = {
    "owlv2": {"repo": "google/owlv2-base-patch16-ensemble", "revision": "cfd3195b", "kind": "owl"},
    "grounding-dino-tiny": {"repo": "IDEA-Research/grounding-dino-tiny", "revision": "a2bb814d", "kind": "gdino"},
    "omdet-turbo": {"repo": "omlab/omdet-turbo-swin-tiny-hf", "revision": "7fe93cec", "kind": "omdet"},
}
# Far below any operating point, so thresholds are applied later without running again.
RAW_THRESHOLD = 0.02


def detect(kind, model, processor, image, labels):
    size = [(image.height, image.width)]
    if kind == "gdino":
        text = " ".join(f"{label}." for label in labels)
        inputs = processor(images=image, text=text, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
        result = processor.post_process_grounded_object_detection(outputs, inputs.input_ids, threshold=RAW_THRESHOLD, text_threshold=RAW_THRESHOLD, target_sizes=size)[0]
        names = result.get("text_labels", result["labels"])
    elif kind == "omdet":
        inputs = processor(images=image, text=labels, task=f"Detect {', '.join(labels)}.", return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
        result = processor.post_process_grounded_object_detection(outputs, text_labels=[labels], target_sizes=size, threshold=RAW_THRESHOLD, nms_threshold=0.5)[0]
        names = result.get("text_labels", result["labels"])
    else:
        inputs = processor(text=[labels], images=image, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
        result = processor.post_process_grounded_object_detection(outputs, target_sizes=size, threshold=RAW_THRESHOLD, text_labels=[labels])[0]
        names = result.get("text_labels", result["labels"])
    rows = []
    for name, score, box in zip(names, result["scores"].tolist(), result["boxes"].tolist()):
        x0, y0, x1, y1 = box
        rows.append({"label": str(name), "score": score, "box": [x0 / image.width, y0 / image.height, (x1 - x0) / image.width, (y1 - y0) / image.height]})
    rows.sort(key=lambda row: -row["score"])
    return rows[:150]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, choices=MODELS)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--images", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    spec = MODELS[args.model]
    prompts = json.loads((Path(__file__).parent / "zero_shot_prompts.json").read_text(encoding="utf8"))
    images = json.loads(Path(args.manifest).read_text(encoding="utf-8-sig"))["images"]
    process = psutil.Process()
    rss_before = process.memory_info().rss
    started = time.perf_counter()
    processor = AutoProcessor.from_pretrained(spec["repo"], revision=spec["revision"])
    model = AutoModelForZeroShotObjectDetection.from_pretrained(spec["repo"], revision=spec["revision"]).eval()
    load_ms = (time.perf_counter() - started) * 1000
    results, times = {}, {mode: [] for mode in prompts["modes"]}
    peak = process.memory_info().rss
    for image_row in images:
        with Image.open(Path(args.images) / image_row["file"]) as raw:
            image = ImageOps.exif_transpose(raw).convert("RGB")
        entry = {"width": image.width, "height": image.height, "modes": {}}
        for mode, labels in prompts["modes"].items():
            begun = time.perf_counter()
            rows = detect(spec["kind"], model, processor, image, labels)
            elapsed = (time.perf_counter() - begun) * 1000
            times[mode].append(elapsed)
            entry["modes"][mode] = {"ms": round(elapsed), "predictions": rows}
            peak = max(peak, process.memory_info().rss)
        results[image_row["id"]] = entry
        print(image_row["id"], {m: entry["modes"][m]["ms"] for m in entry["modes"]}, flush=True)
    parameters = sum(p.numel() for p in model.parameters())
    output = {
        "model": args.model, "repo": spec["repo"], "revision": spec["revision"], "device": "cpu", "threads": torch.get_num_threads(),
        "versions": {"torch": torch.__version__, "transformers": transformers.__version__},
        "prompts": prompts["modes"], "rawThreshold": RAW_THRESHOLD, "loadMs": round(load_ms), "parameters": parameters, "rssBeforeBytes": rss_before, "rssPeakBytes": peak,
        "medianMs": {mode: round(statistics.median(values)) for mode, values in times.items()}, "results": results,
    }
    Path(args.out).write_text(json.dumps(output), encoding="utf8")
    print(json.dumps({key: output[key] for key in ("model", "loadMs", "parameters", "rssPeakBytes", "medianMs")}))


if __name__ == "__main__":
    main()

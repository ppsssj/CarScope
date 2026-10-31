// P2-A7 comparison: the generated Anatomy SVG against the GLB rendered by Three.js (GPU depth buffer)
// with the orthographic camera that reproduces the SVG projection. Part-ID images are compared
// pixel by pixel, so occlusion, orientation and part placement are checked by an independent renderer.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

THREE.ColorManagement.enabled = false; // ID colours must reach the framebuffer unchanged
const base = new URLSearchParams(location.search).get("dir") ?? "./external/ioniq5-svg/";
const SCALE = 2; // comparison raster: 1280 x 660 for the 640 x 330 view
const out = document.getElementById("out");
const result = { done: false };
window.__cmp = result;
const fetchText = async (f) => { const r = await fetch(base + f); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.text(); };

async function main() {
  const cam = JSON.parse(await fetchText("camera.json"));
  const [svgText, idText] = await Promise.all([fetchText("ioniq5.svg"), fetchText("ioniq5-ids.svg")]);
  const W = cam.view.width * SCALE, H = cam.view.height * SCALE;
  const idOf = (r) => (r % 5 === 0 && r > 0 ? r / 5 - 1 : -1);

  // --- SVG parse + first paint timing (median of 15 insertions) ---
  const host = document.getElementById("svg");
  const times = [];
  for (let i = 0; i < 15; i++) {
    const holder = document.createElement("div");
    const t0 = performance.now();
    holder.innerHTML = svgText;
    host.appendChild(holder);
    holder.firstElementChild.getBBox();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    times.push(performance.now() - t0);
    if (i < 14) holder.remove();
  }
  times.sort((a, b) => a - b);
  const svgEl = host.querySelector("svg");

  // --- Three.js: shaded view and ID pass with the reproduced camera ---
  const t = cam.three;
  const camera = new THREE.OrthographicCamera(-t.halfWidth, t.halfWidth, t.halfHeight, -t.halfHeight, 0.1, 100);
  camera.position.set(...t.target.map((v, i) => v + t.direction[i] * t.distance));
  camera.up.set(...t.up);
  camera.lookAt(...t.target);
  camera.updateMatrixWorld();
  const gltf = await new GLTFLoader().loadAsync(`./external/ioniq5.glb`);
  const shaded = new THREE.WebGLRenderer({ antialias: true });
  shaded.setSize(960, 495); shaded.setClearColor(0xffffff);
  document.getElementById("gl").appendChild(shaded.domElement);
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(shaded).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-3, 6, -4); scene.add(sun);
  scene.add(gltf.scene);
  shaded.render(scene, camera);

  const colorOf = new Map(cam.idColors.map((p) => [p.source, p.color]));
  const idScene = new THREE.Scene();
  const idRoot = gltf.scene.clone(true);
  idRoot.traverse((o) => {
    if (!o.isMesh) return;
    let n = o; while (n && !colorOf.has(n.name)) n = n.parent;
    o.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(colorOf.get(n?.name) ?? "#000000"), side: THREE.DoubleSide });
  });
  idScene.add(idRoot);
  const ids = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  ids.outputColorSpace = THREE.LinearSRGBColorSpace;
  ids.setPixelRatio(1); ids.setSize(W, H); ids.setClearColor(0x000000);
  const target = new THREE.WebGLRenderTarget(W, H);
  ids.setRenderTarget(target); ids.render(idScene, camera);
  const glPix = new Uint8Array(W * H * 4);
  ids.readRenderTargetPixels(target, 0, 0, W, H, glPix);
  const glId = new Int16Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) glId[y * W + x] = idOf(glPix[((H - 1 - y) * W + x) * 4]); // GL rows are bottom-up

  // --- SVG ID raster ---
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([idText], { type: "image/svg+xml" }));
  await img.decode();
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, W, H);
  const svgPix = ctx.getImageData(0, 0, W, H).data;
  const svgId = new Int16Array(W * H);
  for (let i = 0; i < W * H; i++) svgId[i] = svgPix[i * 4 + 3] < 128 ? -1 : idOf(svgPix[i * 4]);

  // --- metrics ---
  let inter = 0, union = 0, both = 0, same = 0, undecoded = 0;
  const parts = cam.idColors.map((p) => ({ id: p.id, gl: 0, svg: 0, both: 0 }));
  const confusion = new Map();
  for (let i = 0; i < W * H; i++) {
    const a = svgId[i], b = glId[i];
    if (a >= 0 || b >= 0) union++;
    if (a >= 0 && b >= 0) {
      inter++; both++;
      if (a === b) { same++; parts[a].both++; } else { const k = `${cam.idColors[a]?.id ?? a}<-${cam.idColors[b]?.id ?? b}`; confusion.set(k, (confusion.get(k) ?? 0) + 1); }
    }
    if (a >= 0) { if (parts[a]) parts[a].svg++; else undecoded++; }
    if (b >= 0) { if (parts[b]) parts[b].gl++; else undecoded++; }
  }
  const iou = (p) => (p.gl + p.svg - p.both ? p.both / (p.gl + p.svg - p.both) : null);
  const key = ["body", "glass", "hood", "tailgate", "door-front-left", "door-rear-left", "wheel-front-left", "wheel-rear-left", "mirror-side-left-0"];
  // Hit test: for each visible part, a pixel well inside its GL region, then elementFromPoint on the SVG.
  const rect = svgEl.getBoundingClientRect();
  const picks = [];
  for (const p of parts.filter((q) => key.includes(q.id) && q.gl)) {
    const pi = parts.indexOf(p);
    let best = -1, score = -1;
    for (let y = 6; y < H - 6; y += 3) for (let x = 6; x < W - 6; x += 3) {
      if (glId[y * W + x] !== pi) continue;
      let s = 0; for (let dy = -6; dy <= 6; dy += 3) for (let dx = -6; dx <= 6; dx += 3) s += glId[(y + dy) * W + x + dx] === pi;
      if (s > score) { score = s; best = y * W + x; }
    }
    const x = best % W, y = (best / W) | 0;
    const el = document.elementFromPoint(rect.left + (x / W) * rect.width, rect.top + (y / H) * rect.height);
    picks.push({ expected: p.id, picked: el?.closest("[data-part]")?.dataset.part ?? null });
  }
  Object.assign(result, {
    done: true,
    size: { W, H },
    silhouetteIoU: inter / union,
    partAgreement: same / both,
    undecoded,
    keyParts: key.map((id) => { const p = parts.find((q) => q.id === id); return { id, iou: p ? iou(p) : null, glPixels: p?.gl ?? 0, svgPixels: p?.svg ?? 0 }; }),
    topConfusions: [...confusion].sort((a, b) => b[1] - a[1]).slice(0, 8),
    picks,
    svg: { bytes: svgText.length, elements: svgEl.querySelectorAll("*").length, insertToPaintMsMedian: times[7], insertToPaintMsMax: times.at(-1) },
  });
  out.textContent = JSON.stringify(result, null, 1);
}
main().catch((e) => { result.done = true; result.error = String(e?.stack ?? e); out.textContent = result.error; });

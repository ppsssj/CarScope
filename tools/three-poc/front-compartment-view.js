// P3-A2.1: front compartment shell in the hood PoC. The shell is built in the page from the layout
// (front-compartment.mjs, no model-derived file), added as its own group next to the GLB scene, and
// never parented to the hood: the hood's pivot and its 0-degree identity are untouched.
import * as THREE from "three";
import { buildFrontCompartment } from "./ioniq5-asset/front-compartment.mjs";
import { staticScene } from "./ioniq5-asset/collision.mjs";
import { bodyRegion } from "./ioniq5-asset/hood.mjs";

// CarScope cm -> glTF m: (x, y, z) -> (x, z, -y) / 100, a proper rotation (winding is kept).
function toGltfPositions(T) {
  const out = new Float32Array(T.length);
  for (let i = 0; i < T.length; i += 3) { out[i] = T[i] / 100; out[i + 1] = T[i + 2] / 100; out[i + 2] = -T[i + 1] / 100; }
  return out;
}

const PLASTIC = { trim: 0x2b2e33, doorInner: 0x4b5058 };

/**
 * @param {{ scene: THREE.Scene, bodyMaterial: THREE.Material, others: {name,triangles}[], camera: THREE.Camera, dom: HTMLElement, log: Function }} ctx
 */
export function attachFrontCompartment({ scene, bodyMaterial, others, camera, dom, log }) {
  const t0 = performance.now();
  const shell = buildFrontCompartment();
  const buildMs = performance.now() - t0;
  const group = new THREE.Group();
  group.name = "__p3a21_front_compartment";
  group.visible = false;
  const zonesGroup = new THREE.Group();
  zonesGroup.name = "__p3a21_reserved_zones";
  zonesGroup.visible = false;
  const meshes = [];
  for (const p of shell.panels) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(toGltfPositions(p.triangles), 3));
    geo.computeVertexNormals();
    const palette = p.palettes[0];
    const mat = palette === "paint" && bodyMaterial ? bodyMaterial.clone() : new THREE.MeshStandardMaterial({ color: PLASTIC[palette] ?? 0x3a3e44, roughness: 0.85, metalness: 0 });
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = p.id;
    mesh.userData = { synthetic: true, shellPart: true, meta: p.meta, label: p.label };
    group.add(mesh);
    meshes.push(mesh);
  }
  for (const z of shell.zones) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(toGltfPositions(z.triangles), 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: z.meta.kind === "frunk" ? 0xf59e0b : 0x14b8a6, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: z.meta.kind === "frunk" ? 0xb45309 : 0x0f766e })));
    mesh.name = z.id;
    mesh.userData = { synthetic: true, zone: true, meta: z.meta, box: z.box };
    zonesGroup.add(mesh);
  }
  scene.add(group, zonesGroup);

  // Collision scene: source meshes first (same item ids as the P3-A1 scene, so its seam baseline applies), then the shell.
  let checkScene = null;
  const sceneWithShell = () => (checkScene ??= staticScene([...others, ...shell.panels.map((p) => ({ name: p.id, triangles: p.triangles }))], { region: bodyRegion }));

  let selected = null;
  const info = dom.querySelector("#shellInfo");
  function select(id) {
    if (selected) selected.material.emissive?.setHex(0x000000);
    selected = meshes.find((m) => m.name === id) ?? null;
    dom.querySelector("#shellPart").value = selected ? id : "";
    if (!selected) { info.style.display = "none"; return null; }
    selected.material.emissive?.setHex(0x1d4ed8);
    const m = selected.userData.meta;
    info.style.display = "block";
    info.textContent = `${m.id}\n${selected.userData.label}\ngeometry: ${m.geometryConfidence}\nposition: ${m.positionConfidence}${m.boundary ? `\nboundary: ${m.boundary}` : ""}\nsynthetic: ${m.isSynthetic}\nvisibility: ${m.visibility}\nfuture: ${m.futureInteraction}\n${m.note}\nsource:\n${m.source.map((s) => "· " + s).join("\n")}`;
    log("shell-select", { id });
    return m;
  }
  const ray = new THREE.Raycaster();
  function pick(clientX, clientY, canvas) {
    if (!group.visible) return null;
    const rect = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    return select(hit ? hit.object.name : null);
  }
  function setOpacity(a) {
    for (const m of meshes) { m.material.transparent = a < 1; m.material.opacity = a; m.material.depthWrite = a >= 1; m.material.needsUpdate = true; }
  }
  const tag = dom.querySelector("#shellTag");
  function setVisible(on) { group.visible = on; tag.style.display = on ? "block" : "none"; if (!on) select(null); }
  dom.querySelector("#shellPart").innerHTML = `<option value="">select a shell part…</option>` + shell.panels.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
  log("shell-built", { panels: shell.panels.length, triangles: shell.panels.reduce((a, p) => a + p.triangles.length / 9, 0), zones: shell.zones.length, buildMs: +buildMs.toFixed(2) });
  return { shell, group, zonesGroup, meshes, select, pick, setOpacity, setVisible, sceneWithShell, buildMs };
}

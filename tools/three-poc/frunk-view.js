// Debug-only P3-A2.2. Browser and report use the same cm geometry; source GLB is untouched.
import * as THREE from 'three';
import { buildFrunk, frunkPose, frunkTransition } from './ioniq5-asset/frunk.mjs';
import { staticScene, meshClearance } from './ioniq5-asset/collision.mjs';
import { rotatePoints } from './ioniq5-asset/hood.mjs';

export function attachFrunk({ scene, shell, others, hood, camera, canvas, dom, hoodState, log }) {
  const f = buildFrunk(shell), group = new THREE.Group(), $ = (id) => dom.getElementById(id);
  group.name = '__p3a22_frunk'; group.visible = false; scene.add(group);
  const toGltf = (T) => { const a = new Float32Array(T.length); for (let i = 0; i < T.length; i += 3) { a[i] = T[i]/100; a[i+1] = T[i+2]/100; a[i+2] = -T[i+1]/100; } return a; };
  const meshes = f.parts.map((p) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(toGltf(p.triangles), 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: p.id === 'frunk-lever' ? 0x65717c : p.moving ? 0x292e34 : 0x48515a, roughness: 0.88 }));
    m.name = p.id; m.userData = { synthetic: true, frunkPart: true, meta: p.meta }; group.add(m); return m;
  });
  // The moving rigid assembly has its own world pivot, independent of the hood and shell.
  const pivot = new THREE.Group(); pivot.position.set(f.axis.point[0]/100, f.axis.point[2]/100, -f.axis.point[1]/100); group.add(pivot);
  for (let i = 0; i < meshes.length; i++) if (f.parts[i].moving) { pivot.add(meshes[i]); meshes[i].position.copy(pivot.position).negate(); }
  let angle = 0, selected = null, tween = null;
  const fixedScene = staticScene([...others, ...shell.panels, ...f.parts.filter((p) => !p.moving)]);
  function select(id) {
    selected = id;
    for (const m of meshes) m.material.emissive.setHex(m.name === id ? 0x1d4ed8 : 0);
    $('frunkPart').value = id ?? '';
    const p = f.parts.find((p) => p.id === id);
    $('frunkInfo').textContent = p ? `${p.label}\nESTIMATED_GEOMETRY · hinge UNVERIFIED\nCalculated cavity: ${f.cavityLitres.toFixed(1)} L (not VDA verified)\n${p.meta.note}\nSources:\n${p.meta.source.join('\n')}` : '';
    return p?.meta ?? null;
  }
  function setAngle(deg, fromAnimation = false) {
    if (!fromAnimation && tween) { cancelAnimationFrame(tween.frame); tween.done({ accepted: false, reason: 'superseded' }); tween = null; }
    if (deg > 0 && !['A', 'C'].includes(hoodState().axis?.id)) {
      $('frunkMessage').textContent = 'Frunk opening is validated only with hood axis A or C';
      return { accepted: false, reason: 'UNVALIDATED_HOOD_AXIS' };
    }
    const transition = frunkTransition({ hood: hoodState().angle, cover: angle }, { cover: deg });
    $('frunkMessage').textContent = transition.reason;
    if (!transition.accepted) { $('frunkAngle').value = angle; return transition; }
    angle = deg; pivot.rotation.z = deg * Math.PI / 180;
    $('frunkAngle').value = angle; $('frunkAngleOut').textContent = angle.toFixed(1) + '°';
    return transition;
  }
  function check() {
    const h = hoodState(), hs = staticScene([{ name: 'hood', triangles: rotatePoints(hood, h.axis, h.angle) }]);
    const rows = frunkPose(f, angle).filter((p) => p.moving).map((p) => {
      const a = meshClearance(p.triangles, fixedScene, { cutoff: 5 }), b = meshClearance(p.triangles, hs, { cutoff: 5 });
      const bounded = (c) => c.minDistanceCm !== null && c.minDistanceCm <= 5 ? c.minDistanceCm : '>=5';
      return { id: p.id, fixedCrossings: a.intersectingPairs, hoodCrossings: b.intersectingPairs, fixedMinCm: bounded(a), hoodMinCm: bounded(b) };
    });
    $('frunkMessage').textContent = `${rows.some((r) => r.fixedCrossings || r.hoodCrossings) ? 'FAIL' : 'PASS'} · exact triangles at this pose · SIMULATION_ONLY`;
    return { angle, hood: h.angle, axis: h.axis.id, rows };
  }
  function animateTo(target, duration = 900) {
    const tr = frunkTransition({ hood: hoodState().angle, cover: angle }, { cover: target });
    if (!tr.accepted) { $('frunkMessage').textContent = tr.reason; return Promise.resolve(tr); }
    if (tween) { cancelAnimationFrame(tween.frame); tween.done({ accepted: false, reason: 'superseded' }); }
    return new Promise((done) => {
      const start = angle, t0 = performance.now(); tween = { done, frame: null };
      const step = (now) => { const t = Math.max(0, Math.min(1, (now-t0)/duration)), e = t*t*(3-2*t); const result = setAngle(start+(target-start)*e, true);
        if (!result.accepted || t === 1) { tween = null; done(result); check(); } else tween.frame = requestAnimationFrame(step); };
      tween.frame = requestAnimationFrame(step);
    });
  }
  function setVisible(on) { group.visible = on; $('frunk').checked = on; if (!on) select(null); }
  const ray = new THREE.Raycaster();
  function pick(x, y) {
    if (!group.visible) return false;
    const rect = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1, -(y-rect.top)/rect.height*2+1), camera);
    // Include source and shell as occluders: a hidden cover cannot be clicked through the hood.
    const hit = ray.intersectObjects(scene.children, true).find((h) => { let n = h.object; while (n) { if (!n.visible) return false; n = n.parent; } return !h.object.isLine && !h.object.isLineSegments; });
    if (!hit?.object.userData.frunkPart) return false;
    select(hit.object.name);
    if (hit.object.name !== 'frunk-tub') animateTo(angle > 0 ? 0 : 60);
    return true;
  }
  $('frunkPart').innerHTML = '<option value="">Select frunk part…</option>' + f.parts.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  $('frunk').onchange = (e) => setVisible(e.target.checked);
  $('frunkAngle').oninput = (e) => { setAngle(Number(e.target.value)); check(); };
  $('frunkOpen').onclick = () => animateTo(60); $('frunkClose').onclick = () => animateTo(0);
  $('frunkPart').onchange = (e) => select(e.target.value || null);
  function compareWithNode(deg) {
    const tr = setAngle(deg); if (!tr.accepted) return tr;
    group.updateMatrixWorld(true); const ref = frunkPose(f, deg); let maxDelta = 0;
    for (let j = 0; j < meshes.length; j++) { const mesh = meshes[j], pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld), car = [v.x*100, -v.z*100, v.y*100]; for (let k = 0; k < 3; k++) maxDelta = Math.max(maxDelta, Math.abs(car[k]-ref[j].triangles[3*i+k])); }
    }
    return { deg, maxVertexDeltaCm: maxDelta };
  }
  log('frunk-built', { parts: meshes.length, cavityLitres: f.cavityLitres });
  return { f, group, meshes, pivot, get angle() { return angle; }, setAngle, setVisible, select, pick, check, animateTo, compareWithNode };
}

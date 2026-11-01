// Fit a component's bounding sphere inside the usable part of the full-screen perspective view.
// The panel changes available pixels, not the camera's full viewport aspect/FOV.
export function componentDistance(size, fovDeg, width, height, panel) {
  const vertical = Math.tan(fovDeg * Math.PI / 360);
  const halfVertical = Math.atan(vertical * (height - panel.bottom) / height);
  const halfHorizontal = Math.atan(vertical * (width - panel.side) / height);
  return Math.max(0.85, Math.hypot(...size) / 2 / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.35);
}

/** Fit all eight AABB corners for an oblique overview, using the same usable viewport as close-ups. */
export function boxDistance(size, direction, fovDeg, width, height, panel) {
  const norm = a => { const n = Math.hypot(...a); return a.map(v => v / n); };
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const d = norm(direction), right = norm([d[2], 0, -d[0]]);
  const up = [d[1] * right[2], d[2] * right[0] - d[0] * right[2], -d[1] * right[0]];
  const tan = Math.tan(fovDeg * Math.PI / 360), horizontal = tan * (width - panel.side) / height, vertical = tan * (height - panel.bottom) / height;
  let distance = 1.3;
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const p = size.map((v, i) => v / 2 * [x, y, z][i]);
    distance = Math.max(distance, dot(p, d) + Math.abs(dot(p, right)) / horizontal,
      dot(p, d) + Math.abs(dot(p, up)) / vertical);
  }
  return distance * 1.18;
}

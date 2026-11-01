// Fit a component's bounding sphere inside the usable part of the full-screen perspective view.
// The panel changes available pixels, not the camera's full viewport aspect/FOV.
export function componentDistance(size, fovDeg, width, height, panel) {
  const vertical = Math.tan(fovDeg * Math.PI / 360);
  const halfVertical = Math.atan(vertical * (height - panel.bottom) / height);
  const halfHorizontal = Math.atan(vertical * (width - panel.side) / height);
  return Math.max(0.85, Math.hypot(...size) / 2 / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.35);
}

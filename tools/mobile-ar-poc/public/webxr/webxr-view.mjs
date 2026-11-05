// P9-XR-B: Three.js rendering for the marker and aiming reticle. It holds no session rules.
// Local +Y is the surface normal from the hit pose, and the origin is the point the user chose (meters).
const MARKER_COLOR = 0x18a0fb; // Same blue as the existing 2D marker (marker.mjs).
const OUTLINE_COLOR = 0xffffff;
const RETICLE_EDGE_COLOR = 0x14202e;

export function buildMarkerGroup(THREE) {
  const blue = new THREE.MeshBasicMaterial({ color: MARKER_COLOR, side: THREE.DoubleSide, transparent: true });
  const white = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.DoubleSide, transparent: true });
  const group = new THREE.Group();
  const flat = (geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
  };
  flat(new THREE.RingGeometry(0.03, 0.038, 48), blue);
  flat(new THREE.RingGeometry(0.038, 0.043, 48), white);
  flat(new THREE.CircleGeometry(0.006, 24), blue);
  const headHeight = 0.045, tipGap = 0.02, shaftEnd = 0.15, shaftStart = tipGap + headHeight - 0.002;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.024, headHeight, 24), blue);
  head.rotation.x = Math.PI; // Cone tip points to the surface.
  head.position.y = tipGap + headHeight / 2;
  group.add(head);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, shaftEnd - shaftStart, 16), blue);
  shaft.position.y = (shaftStart + shaftEnd) / 2;
  group.add(shaft);
  group.userData.materials = [blue, white];
  return group;
}

export function buildReticle(THREE) {
  const white = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.DoubleSide });
  const dark = new THREE.MeshBasicMaterial({ color: RETICLE_EDGE_COLOR, side: THREE.DoubleSide }); // Keeps it visible on bright surfaces.
  const group = new THREE.Group();
  for (const [geometry, material] of [
    [new THREE.RingGeometry(0.02, 0.026, 40), white],
    [new THREE.RingGeometry(0.026, 0.029, 40), dark],
    [new THREE.CircleGeometry(0.004, 16), white],
  ]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
  }
  return group;
}

function place(object, matrix) {
  object.visible = Boolean(matrix);
  if (matrix) {
    object.matrix.fromArray(matrix);
    object.matrixWorldNeedsUpdate = true;
  }
}

export function createWebXrView(THREE) {
  let renderer = null, scene = null, camera = null, marker = null, reticle = null, frameCallback = null;
  return {
    async attach(session) {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local');
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera();
      marker = buildMarkerGroup(THREE);
      reticle = buildReticle(THREE);
      for (const object of [marker, reticle]) {
        object.matrixAutoUpdate = false;
        object.visible = false;
        scene.add(object);
      }
      await renderer.xr.setSession(session);
      return renderer.xr.getReferenceSpace();
    },
    startLoop(callback) {
      frameCallback = callback;
      renderer.setAnimationLoop((time, frame) => frameCallback?.(time, frame));
    },
    setReticle(matrix) { place(reticle, matrix); },
    setMarker(matrix, { dim = false } = {}) {
      place(marker, matrix);
      for (const material of marker.userData.materials) material.opacity = dim ? 0.45 : 1;
    },
    render() { renderer.render(scene, camera); },
    dispose() {
      const finishing = renderer, built = scene;
      frameCallback = null;
      if (!finishing) return;
      finishing.setAnimationLoop(null);
      // Three's own session-end listener runs after this one and still uses the renderer.
      setTimeout(() => {
        built.traverse(object => object.geometry?.dispose());
        built.traverse(object => object.material?.dispose());
        finishing.dispose();
        finishing.forceContextLoss();
      }, 0);
    },
  };
}

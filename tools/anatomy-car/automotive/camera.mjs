// Camera: the left side and the front face the viewer, so FRONT_LEFT (the door the Pleos SDK reads)
// is the nearest door. The fit includes both doors fully open so every pose fits the same view box.
import { HALF, GH, BELT, FRONT_DOOR, REAR_DOOR, X_REAR, X_FRONT } from "./dims.mjs";

export const VIEW = { width: 640, height: 330, azimuth: 56, elevation: 28, pad: 18 };

export function camera(k) {
  const reach = (door) => {
    const t = (door.open * Math.PI) / 180;
    const length = door.hinge - door.rear;
    return [door.hinge - length * Math.cos(t), HALF + length * Math.sin(t)];
  };
  const [fx, fy] = reach(FRONT_DOOR);
  const [rx, ry] = reach(REAR_DOOR);
  return k.fitProjection(
    [
      ...k.boxCorners({ x: X_REAR, y: -HALF, w: X_FRONT - X_REAR, d: 2 * HALF, r: 0 }, 0, BELT),
      ...k.boxCorners({ x: GH.cTop, y: -GH.roofHalf, w: GH.aTop - GH.cTop, d: 2 * GH.roofHalf, r: 0 }, BELT, GH.ridgeFront[1] + 6),
      [fx, fy, 0], [fx, fy, 142], [rx, ry, 0], [rx, ry, 142],
    ],
    VIEW.width, VIEW.height, { pad: VIEW.pad, azimuth: VIEW.azimuth, elevation: VIEW.elevation },
  );
}

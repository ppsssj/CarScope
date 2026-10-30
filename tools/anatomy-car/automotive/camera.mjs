// Physical view: front-left. Anatomy uses its own screen basis; adapt only emitted screen X to
// match a right-handed 3D camera. World geometry, facing, shading and painter order stay intact.
import { HALF, GH, BELT, FRONT_DOOR, REAR_DOOR, X_REAR, X_FRONT } from "./dims.mjs";

export const VIEW = { width: 640, height: 330, azimuth: 56, elevation: 28, pad: 18 };

export const svgScreenPoint = ([x, y]) => [VIEW.width - x, y];
const tenth = (x) => String(Math.round(x * 10) / 10);
export function svgScreenPath(d) {
  if (/[^MLZ\d. ,\-]/.test(d)) throw new Error("Unsupported Anatomy path in screen-basis adapter");
  return d.replace(/([ML])(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)/g,
    (_, command, x, y) => `${command}${tenth(VIEW.width - Number(x))} ${y}`);
}
// Apply exactly once, to drawing markup only: never to the surrounding card text or state inset.
export function svgScreenMarkup(markup) {
  return markup.replace(/\bd="([^"]*)"/g, (_, d) => `d="${svgScreenPath(d)}"`)
    .replace(/\bcx="([^"]*)"/g, (_, x) => `cx="${tenth(VIEW.width - Number(x))}"`);
}

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

// AR-01: the user's own "this is the spot" mark on the camera view. It is a 2D point in the video frame
// (0..1 of width/height), mapped through the same contain rectangle as the candidate boxes. It is NOT anchored
// in 3D: when the phone moves, the mark stays where the user tapped on screen, not on the part.
import { containRect } from './detector.mjs';

/** Tap (stage px) -> normalized video point, or null when the tap is on the letterbox outside the video. */
export function tapToVideoPoint(tapX, tapY, videoWidth, videoHeight, stageWidth, stageHeight) {
  if (!videoWidth || !videoHeight || !stageWidth || !stageHeight) return null;
  const r = containRect(videoWidth, videoHeight, stageWidth, stageHeight);
  const x = (tapX - r.x) / r.width, y = (tapY - r.y) / r.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/** Normalized video point -> overlay px for the current stage size (re-projected on resize). */
export function videoPointToStage(point, videoWidth, videoHeight, stageWidth, stageHeight) {
  const r = containRect(videoWidth, videoHeight, stageWidth, stageHeight);
  return { x: r.x + point.x * r.width, y: r.y + point.y * r.height };
}

/** Ring, arrow and label at the marked point. `scale` is devicePixelRatio. */
export function drawMarker(ctx, p, scale) {
  const r = 26 * scale;
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 4 * scale;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(p.x, p.y, r + 3 * scale, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#18a0fb';
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#18a0fb';
  ctx.beginPath(); ctx.arc(p.x, p.y, 4 * scale, 0, Math.PI * 2); ctx.fill();
  // Arrow from above (or below when the mark is near the top edge) pointing at the ring.
  const up = p.y > 90 * scale, dir = up ? -1 : 1, tip = p.y + dir * (r + 8 * scale), tail = tip + dir * 34 * scale;
  ctx.lineWidth = 5 * scale; ctx.strokeStyle = '#18a0fb';
  ctx.beginPath(); ctx.moveTo(p.x, tail); ctx.lineTo(p.x, tip); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(p.x - 9 * scale, tip + dir * 10 * scale); ctx.lineTo(p.x, tip); ctx.lineTo(p.x + 9 * scale, tip + dir * 10 * scale); ctx.stroke();
  const text = '내가 지정한 위치';
  ctx.font = `bold ${14 * scale}px system-ui`;
  const w = ctx.measureText(text).width + 14 * scale, h = 24 * scale;
  const lx = Math.min(Math.max(p.x - w / 2, 4 * scale), ctx.canvas.width - w - 4 * scale), ly = up ? tail - h - 4 * scale : tail + 4 * scale;
  ctx.fillStyle = '#18a0fb'; ctx.fillRect(lx, ly, w, h);
  ctx.fillStyle = '#ffffff'; ctx.fillText(text, lx + 7 * scale, ly + 17 * scale);
  ctx.restore();
}

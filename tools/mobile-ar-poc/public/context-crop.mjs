// P13-A: cut out a found part together with the area around it, so marks, hoses and stains beside it stay in view.
// No AI is called here. The geometry is pure and runs in Node; cropWithContext adds the browser decoding and drawing.
// Boxes are the detection contract's: [left, top, width, height] as fractions of the (orientation-corrected) picture, origin top left.

/**
 * Starting values, not tuned ones. 40% per side is the P13-A brief's first guess. No evaluation has picked it,
 * so a part profile may ask for more (a small cap needs more surroundings than a tank), never silently for less.
 */
export const CROP_DEFAULTS = Object.freeze({
  margin: 0.4, // of the box's own width (left and right) and height (top and bottom)
  minSidePx: 320, // a crop side never smaller than this, unless the picture itself is smaller
  minShortSideFraction: 0.3, // nor smaller than this share of the picture's short side
  maxOutputSide: 1024, // the image sent out is scaled down to this, never up
  jpegQuality: 0.9,
});
export const MAX_IMAGE_SIDE = 20000;
const EPS = 1e-6;
const fail = code => { throw Object.assign(new Error(code), { code }); };

/** The box as given, checked: four finite numbers, a positive area, inside the picture (tiny rounding allowed and trimmed). */
export function validateBox(box) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) fail('CROP_BOX_INVALID');
  const [left, top, width, height] = box;
  if (width <= 0 || height <= 0 || left < -EPS || top < -EPS || left + width > 1 + EPS || top + height > 1 + EPS) fail('CROP_BOX_INVALID');
  const l = Math.max(0, left), t = Math.max(0, top);
  return [l, t, Math.min(width, 1 - l), Math.min(height, 1 - t)];
}

function validateOptions(options) {
  const o = { ...CROP_DEFAULTS, ...options };
  if (!(Number.isFinite(o.margin) && o.margin >= 0 && o.margin <= 5)) fail('CROP_OPTIONS_INVALID');
  if (!(Number.isFinite(o.minSidePx) && o.minSidePx >= 1)) fail('CROP_OPTIONS_INVALID');
  if (!(Number.isFinite(o.minShortSideFraction) && o.minShortSideFraction >= 0 && o.minShortSideFraction <= 1)) fail('CROP_OPTIONS_INVALID');
  if (!(Number.isInteger(o.maxOutputSide) && o.maxOutputSide >= 64)) fail('CROP_OPTIONS_INVALID');
  return o;
}

/**
 * Where to cut, in source pixels, and how the result relates to the original. Pure.
 * The crop is centred on the box, grown by the margin, raised to the minimum size, then slid (not shrunk) back inside the
 * picture, so a part at an edge keeps as much surroundings as the picture has. Only a picture smaller than the crop limits it.
 * @returns {{ source, rect, sourceRect, targetBox, targetInCrop, output, scale, margin, shifted, limitedByImage }}
 */
export function contextCropPlan(image, box, options = {}) {
  const W = image?.width, H = image?.height;
  if (!(Number.isInteger(W) && Number.isInteger(H) && W >= 1 && H >= 1 && W <= MAX_IMAGE_SIDE && H <= MAX_IMAGE_SIDE)) fail('CROP_IMAGE_INVALID');
  const o = validateOptions(options);
  const [l, t, w, h] = validateBox(box);
  const bx = l * W, by = t * H, bw = Math.max(w * W, 1), bh = Math.max(h * H, 1);
  const minSide = Math.max(o.minSidePx, o.minShortSideFraction * Math.min(W, H));
  const wanted = { width: Math.max(bw * (1 + 2 * o.margin), minSide), height: Math.max(bh * (1 + 2 * o.margin), minSide) };
  const cw = Math.min(W, wanted.width), ch = Math.min(H, wanted.height);
  const cx = bx + bw / 2, cy = by + bh / 2;
  const x0 = Math.min(Math.max(0, cx - cw / 2), W - cw), y0 = Math.min(Math.max(0, cy - ch / 2), H - ch);
  // Whole pixels, rounded outwards so the box is never cut by rounding.
  const x = Math.max(0, Math.floor(x0 + EPS)), y = Math.max(0, Math.floor(y0 + EPS));
  const right = Math.min(W, Math.ceil(x0 + cw - EPS)), bottom = Math.min(H, Math.ceil(y0 + ch - EPS));
  const rect = Object.freeze({ x, y, width: right - x, height: bottom - y });
  const scale = Math.min(1, o.maxOutputSide / Math.max(rect.width, rect.height));
  const output = Object.freeze({ width: Math.max(1, Math.round(rect.width * scale)), height: Math.max(1, Math.round(rect.height * scale)) });
  const fraction = (value, total) => Number((value / total).toFixed(6));
  return Object.freeze({
    source: Object.freeze({ width: W, height: H }),
    rect,
    sourceRect: Object.freeze([fraction(x, W), fraction(y, H), fraction(rect.width, W), fraction(rect.height, H)]),
    targetBox: Object.freeze([l, t, w, h]),
    // Where the part sits inside the crop, as fractions of the crop. The analysis is told this, not left to guess.
    targetInCrop: Object.freeze([fraction(bx - x, rect.width), fraction(by - y, rect.height), fraction(Math.min(bw, rect.width), rect.width), fraction(Math.min(bh, rect.height), rect.height)]),
    output, scale,
    margin: o.margin,
    shifted: Math.abs(x0 - (cx - cw / 2)) > EPS || Math.abs(y0 - (cy - ch / 2)) > EPS,
    limitedByImage: cw < wanted.width - EPS || ch < wanted.height - EPS,
  });
}

/** Maps a point given as fractions of the crop back to fractions of the original picture. Keeps the two related. */
export function cropPointToSource(plan, [u, v]) {
  return [(plan.rect.x + u * plan.rect.width) / plan.source.width, (plan.rect.y + v * plan.rect.height) / plan.source.height];
}

/** A square box of `size` (fraction of the short side) centred on a tapped point, kept inside the picture. For a region a person marks. */
export function boxAroundPoint(image, [u, v], size = 0.18) {
  const W = image?.width, H = image?.height;
  if (!(Number.isFinite(W) && Number.isFinite(H) && W > 0 && H > 0)) fail('CROP_IMAGE_INVALID');
  if (![u, v].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) fail('CROP_POINT_INVALID');
  const side = size * Math.min(W, H), bw = Math.min(side, W), bh = Math.min(side, H);
  const x = Math.min(Math.max(0, u * W - bw / 2), W - bw), y = Math.min(Math.max(0, v * H - bh / 2), H - bh);
  return [x / W, y / H, bw / W, bh / H];
}

/**
 * Browser only. Decodes `image` with its EXIF orientation applied (the same way the detection step decoded it, so the box means the
 * same place), cuts the planned rectangle at full resolution, and encodes a JPEG without the original's metadata.
 * A Blob is decoded here and its bitmap closed before returning; a bitmap or canvas passed in stays the caller's.
 */
export async function cropWithContext(image, box, options = {}) {
  let bitmap = image, owned = false;
  if (typeof Blob !== 'undefined' && image instanceof Blob) {
    try { bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' }); } catch { fail('CROP_IMAGE_UNREADABLE'); }
    owned = true;
  }
  try {
    const plan = contextCropPlan({ width: bitmap.width, height: bitmap.height }, box, options);
    const canvas = document.createElement('canvas');
    canvas.width = plan.output.width; canvas.height = plan.output.height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, plan.rect.x, plan.rect.y, plan.rect.width, plan.rect.height, 0, 0, canvas.width, canvas.height);
    let blob = null;
    if (options.encode !== false) {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', options.jpegQuality ?? CROP_DEFAULTS.jpegQuality));
      if (!blob) fail('CROP_ENCODE_FAILED');
    }
    return { plan, canvas, blob };
  } finally { if (owned) bitmap.close(); }
}

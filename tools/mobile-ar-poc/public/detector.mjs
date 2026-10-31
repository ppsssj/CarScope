// Experimental blue connected-component proposal. No semantic recognition or probability.
export function detectCandidates({ data, width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > 320 * 320 || data.length !== width * height * 4) {
    throw new Error('Expected an RGBA frame no larger than 320×320');
  }
  const pixels = width * height;
  const mask = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const [r, g, b, a] = data.subarray(i * 4, i * 4 + 4);
    if (a > 127 && b > 75 && b > r * 1.4 && b > g * 1.12 && Math.max(r, g, b) - Math.min(r, g, b) > 45) mask[i] = 1;
  }
  const queue = new Int32Array(pixels);
  const candidates = [];
  for (let seed = 0; seed < pixels; seed++) {
    if (!mask[seed]) continue;
    let head = 0, tail = 1, count = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    queue[0] = seed;
    mask[seed] = 0;
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      count++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const neighbors = [];
      if (x > 0) neighbors.push(index - 1);
      if (x + 1 < width) neighbors.push(index + 1);
      if (y > 0) neighbors.push(index - width);
      if (y + 1 < height) neighbors.push(index + width);
      for (const next of neighbors) if (mask[next]) { mask[next] = 0; queue[tail++] = next; }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const area = count / pixels, aspect = w / h, fill = count / (w * h);
    if (area >= 0.0015 && area <= 0.12 && aspect >= 0.45 && aspect <= 2.2 && fill >= 0.35) {
      candidates.push({ x: minX / width, y: minY / height, width: w / width, height: h / height,
        source: 'blue-component-heuristic', verified: false, pixels: count });
    }
  }
  return candidates.sort((a, b) => b.pixels - a.pixels).slice(0, 3);
}

// Contain mapping: source and overlay share one aspect-ratio stage; no crop or mirror.
export function containRect(sourceWidth, sourceHeight, viewWidth, viewHeight) {
  const scale = Math.min(viewWidth / sourceWidth, viewHeight / sourceHeight);
  const width = sourceWidth * scale, height = sourceHeight * scale;
  return { x: (viewWidth - width) / 2, y: (viewHeight - height) / 2, width, height };
}

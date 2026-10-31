import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { detectCandidates, containRect } from '../public/detector.mjs';
import { handoffURL, parseHandoff, HANDOFF, isLoopbackHost } from '../public/handoff.mjs';
import { CameraSession, cameraError } from '../public/camera.mjs';
import { createHandler } from '../server.mjs';

function image(width = 160, height = 120, boxes = []) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const { x, y, w, h, color = [20, 70, 200, 255] } of boxes) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) data.set(color, (yy * width + xx) * 4);
  }
  return { data, width, height };
}

test('handoff accepts a single versioned task; rejects extras, duplicates, unknown tasks', () => {
  assert.deepEqual(parseHandoff(''), { valid: true, source: 'direct' });
  assert.equal(parseHandoff(HANDOFF).valid, true);
  for (const hash of ['#v=2&task=washer-fluid', '#v=1&task=brake', '#v=1&task=washer-fluid&vin=x', '#v=1&v=1&task=washer-fluid', '#task=washer-fluid', '#v=1&task=washer-fluid&task=washer-fluid']) assert.equal(parseHandoff(hash).valid, false);
  assert.equal(handoffURL('https://poc.example:4174/'), `https://poc.example:4174/${HANDOFF}`);
  for (const input of ['http://example.com', 'javascript:alert(1)', 'https://u:p@example.com', 'https://example.com/?vin=x', 'https://example.com/#x', 'https://example.com/path']) assert.throws(() => handoffURL(input));
});

test('loopback rule shared by the staging build and the inspection UI', () => {
  for (const host of ['localhost', 'test.localhost', '127.0.0.1', '127.1.2.3', '[::1]']) assert.equal(isLoopbackHost(host), true, host);
  for (const host of ['poc.example', 'carscope-qr-ar-staging.vercel.app', '10.0.0.5', 'localhost.example', '127.example']) assert.equal(isLoopbackHost(host), false, host);
});

test('synthetic RGBA: localized blue component yields only an unverified proposal', () => {
  const boxes = detectCandidates(image(160, 120, [{ x: 30, y: 40, w: 20, h: 15 }]));
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].x, 30 / 160);
  assert.equal(boxes[0].y, 40 / 120);
  assert.equal(boxes[0].width, 20 / 160);
  assert.equal(boxes[0].verified, false);
  assert.equal('confidence' in boxes[0], false);
});

test('empty, red, low-saturation, transparent, noise, blue background and thin regions rejected', () => {
  const rejected = [image(), image(160, 120, [{ x: 0, y: 0, w: 160, h: 120 }]),
    ...[[200, 20, 20, 255], [100, 110, 120, 255], [20, 70, 200, 0]].map(color => image(160, 120, [{ x: 20, y: 20, w: 20, h: 20, color }])),
    image(160, 120, [{ x: 20, y: 20, w: 1, h: 1 }]), image(160, 120, [{ x: 20, y: 20, w: 40, h: 3 }])];
  rejected.forEach(frame => assert.deepEqual(detectCandidates(frame), []));
  assert.throws(() => detectCandidates({ width: 500, height: 500, data: [] }));
});

test('known false positive: an ordinary blue square is also a candidate, never semantic identity', () => {
  assert.equal(detectCandidates(image(160, 120, [{ x: 20, y: 20, w: 25, h: 25 }])).length, 1);
});

test('disconnected objects stay separate; cap at three; edge boxes stay normalized', () => {
  const boxes = detectCandidates(image(160, 120, [0, 35, 70, 105].map(x => ({ x, y: 0, w: 12, h: 12 }))));
  assert.equal(boxes.length, 3);
  assert.equal(boxes[0].x, 0);
  boxes.forEach(box => { assert.ok(box.x + box.width <= 1); assert.ok(box.y + box.height <= 1); });
});

test('contain mapping preserves landscape/portrait position and letterboxing', () => {
  assert.deepEqual(containRect(1920, 1080, 400, 300), { x: 0, y: 37.5, width: 400, height: 225 });
  assert.deepEqual(containRect(1080, 1920, 300, 400), { x: 37.5, y: 0, width: 225, height: 400 });
});

function mockStream() {
  const track = { stops: 0, stop() { this.stops++; }, addEventListener(type, handler) { this.ended = handler; } };
  return { track, getTracks: () => [track] };
}
test('camera asks for rear-facing video only; stop cleans up and disconnects video', async () => {
  const stream = mockStream(); let constraints;
  const video = { play: async () => {} };
  const camera = new CameraSession(video, { getUserMedia: async input => { constraints = input; return stream; } });
  assert.equal(await camera.start(), true);
  assert.equal(constraints.audio, false);
  assert.equal(constraints.video.facingMode.ideal, 'environment');
  camera.stop(); assert.equal(stream.track.stops, 1); assert.equal(video.srcObject, null);
});
test('late permission resolution after stop cannot restart camera', async () => {
  let resolve;
  const stream = mockStream(), video = { play: async () => assert.fail('late stream played') };
  const camera = new CameraSession(video, { getUserMedia: () => new Promise(r => { resolve = r; }) });
  const start = camera.start(); camera.stop(); resolve(stream);
  assert.equal(await start, false); assert.equal(stream.track.stops, 1); assert.equal(video.srcObject, null);
});
test('play failure and externally ended track clean up; denial remains an error', async () => {
  const stream = mockStream();
  const camera = new CameraSession({ play: async () => { throw new Error('play failed'); } }, { getUserMedia: async () => stream });
  await assert.rejects(camera.start(), /play failed/); assert.equal(stream.track.stops, 1);
  let ended = false;
  const second = mockStream();
  const camera2 = new CameraSession({ play: async () => {} }, { getUserMedia: async () => second }, () => { ended = true; });
  await camera2.start(); second.track.ended(); assert.equal(ended, true); assert.equal(camera2.video.srcObject, null);
  const denied = new CameraSession({}, { getUserMedia: async () => { throw { name: 'NotAllowedError' }; } });
  await assert.rejects(denied.start()); assert.match(cameraError({ name: 'NotAllowedError' }), /거부/);
});

test('independent QR encoder output decodes to exact task contract', async () => {
  const target = handoffURL('https://poc.example/');
  const png = PNG.sync.read(await QRCode.toBuffer(target, { width: 480, margin: 4 }));
  assert.equal(jsQR(new Uint8ClampedArray(png.data), png.width, png.height).data, target);
});

test('HTTP allowlist, methods, QR configuration and security headers', async t => {
  const server = http.createServer(createHandler('https://poc.example/'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const root = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(root);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /실물 식별 정확도 미검증/);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(home.headers.get('cache-control'), 'no-store');
  const config = await (await fetch(`${root}/handoff.json`)).json();
  assert.equal(config.url, handoffURL('https://poc.example/'));
  const qr = await fetch(`${root}/qr.svg`); assert.match(await qr.text(), /<svg/);
  for (const path of ['/server.mjs', '/package.json', '/.env', '/%2e%2e/server.mjs']) assert.equal((await fetch(root + path)).status, 404);
  assert.equal((await fetch(root, { method: 'POST' })).status, 405);
  assert.equal(await (await fetch(root, { method: 'HEAD' })).text(), '');
});

test('no configured phone origin means no fabricated QR target', async t => {
  const server = http.createServer(createHandler());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const root = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(root + '/handoff.json')).json(), { configured: false, url: null });
  assert.equal((await fetch(root + '/qr.svg')).status, 404);
});

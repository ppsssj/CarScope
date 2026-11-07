// P12-A: the guide data, what may be shown, and where it is served. No DOM. Screens are in part-guide-browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHandler } from '../server.mjs';
import { MOBILE_ASSETS, MOBILE_MODULES } from '../public-modules.mjs';
import { PUBLIC_FILES } from '../staging/build.mjs';
import { guideForTask, guideProblems, imageProblems, IMAGE_KIND, LICENSE, PART_GUIDES, usableImage } from '../public/part-guides.mjs';
import { INSPECTION_PARTS, partById } from '../../three-poc/inspection-parts.mjs';

const photo = (patch = {}) => ({ file: 'photo.webp', kind: IMAGE_KIND.PHOTO, alt: 'x', caption: 'x', imageSource: 'owner, written permission 2026', licenseStatus: LICENSE.PERMISSION_GRANTED, vehicle: { make: 'M', model: 'N', year: 2024 }, ...patch });

test('a guide hangs off the registry: its part exists, its task is that part\'s task, and nothing is duplicated', () => {
  for (const [key, guide] of Object.entries(PART_GUIDES)) {
    assert.equal(key, guide.partId);
    const part = partById(guide.partId);
    assert.ok(part, guide.partId);
    assert.equal(guide.taskId, part.taskId);
    assert.deepEqual(guideProblems(guide), [], guide.partId);
    assert.equal(guideForTask(guide.taskId), guide);
  }
  assert.equal(guideForTask('tire.front-left'), null, 'no entry means the text-only help stays');
});

test('support is recorded for all 19 parts: washer only for now, and any addition has to come here', () => {
  assert.equal(INSPECTION_PARTS.length, 19);
  assert.deepEqual(Object.keys(PART_GUIDES), ['washer-fluid-cap']);
});

test('no real photo is claimed: the washer guide says photos are needed and holds only its own drawings', () => {
  const guide = PART_GUIDES['washer-fluid-cap'];
  assert.equal(guide.photoStatus, 'PHOTO_NEEDED');
  for (const image of [guide.overviewImage, guide.detailImage]) {
    assert.equal(image.kind, IMAGE_KIND.SCHEMATIC);
    assert.equal(image.licenseStatus, LICENSE.CARSCOPE_ORIGINAL);
    assert.equal(image.vehicle, undefined, 'a drawing names no vehicle');
    assert.ok(usableImage(image));
  }
  assert.equal(guide.vehicleApplicability.scope, 'ANY_VEHICLE');
  assert.match(guide.vehicleApplicability.text, /특정 차종의 위치를 보여 주지 않아요/);
  assert.match(guide.manualReference.applicability, /참고 자료/, 'the IONIQ 5 manual is not presented as this car\'s');
  assert.doesNotMatch(JSON.stringify([guide.title, guide.role, guide.area, guide.identifyingFeatures, guide.overviewImage, guide.detailImage]), /IONIQ|Hyundai|현대|아이오닉|42dot/i, 'no vehicle named outside the labelled reference');
});

test('a photo with no vehicle, no source, an unverified licence or a remote address cannot be shown', () => {
  assert.deepEqual(imageProblems(photo()), []);
  for (const [patch, problem] of [
    [{ vehicle: null }, 'VEHICLE'], [{ vehicle: { make: 'M', model: 'N' } }, 'VEHICLE'],
    [{ imageSource: '' }, 'SOURCE'], [{ licenseStatus: LICENSE.UNVERIFIED }, 'LICENSE'], [{ licenseStatus: undefined }, 'LICENSE'],
    [{ licenseStatus: LICENSE.CARSCOPE_ORIGINAL }, 'PHOTO_LICENSE'], [{ alt: '' }, 'ALT'], [{ caption: '' }, 'CAPTION'],
    [{ file: 'https://example.com/a.jpg' }, 'FILE_NOT_LOCAL'], [{ file: '../a.png' }, 'FILE_NOT_LOCAL'], [{ file: 'a.exe' }, 'FILE_NOT_LOCAL'],
  ]) {
    assert.ok(imageProblems(photo(patch)).includes(problem), JSON.stringify(patch));
    assert.equal(usableImage(photo(patch)), null, JSON.stringify(patch));
  }
  assert.ok(imageProblems({ ...photo(), kind: IMAGE_KIND.SCHEMATIC }).includes('SCHEMATIC_HAS_VEHICLE'), 'a drawing cannot pass as a given car');
  assert.equal(usableImage(null), null);
});

test('an incomplete guide is reported, and a guide without images is still valid', () => {
  const washer = PART_GUIDES['washer-fluid-cap'];
  assert.deepEqual(guideProblems({ ...washer, overviewImage: null, detailImage: null }), []);
  for (const [patch, problem] of [[{ safetyNotes: [] }, 'SAFETY'], [{ identifyingFeatures: [] }, 'FEATURES'], [{ vehicleApplicability: null }, 'APPLICABILITY'], [{ photoStatus: '' }, 'PHOTOSTATUS'], [{ manualReference: { label: 'x', url: 'http://x', applicability: 'y' } }, 'MANUAL']]) {
    assert.ok(guideProblems({ ...washer, ...patch }).includes(problem), problem);
  }
  assert.ok(guideProblems({ ...washer, overviewImage: photo({ licenseStatus: LICENSE.UNVERIFIED }) }).some(p => p.startsWith('overviewImage')));
});

test('the words keep the existing rules: colour alone does not decide, and uncertainty means hands off', () => {
  const { identifyingFeatures, safetyNotes } = PART_GUIDES['washer-fluid-cap'];
  assert.match(identifyingFeatures.join(' '), /앞유리·분사 모양/);
  assert.match(identifyingFeatures.join(' '), /색만 보고 고르지 마세요/);
  assert.match(identifyingFeatures.join(' '), /냉각수·브레이크액/);
  assert.match(safetyNotes.join(' '), /주황색 고전압 케이블/);
  assert.match(safetyNotes.join(' '), /캡을 열거나 액체를 넣지 마세요/);
  assert.doesNotMatch([...identifyingFeatures, ...safetyNotes].join(' '), /자동으로|인식했|정확도|AI/);
});

test('every picture named is listed, and every listed picture is a plain local drawing', async () => {
  const named = Object.values(PART_GUIDES).flatMap(g => [g.overviewImage?.file, g.detailImage?.file]).filter(Boolean);
  assert.deepEqual([...named].sort(), [...MOBILE_ASSETS].sort());
  for (const name of MOBILE_ASSETS) {
    assert.ok(PUBLIC_FILES.includes(name), name);
    const svg = await readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(svg, /<script|<image|<foreignObject|<use|href=|on[a-z]+=|url\(/i, name);
    assert.ok(svg.length < 8192, `${name} stays light on a slow network`);
  }
});

test('the guide modules touch no storage, network, camera, AR, detection, QR or result code', async () => {
  for (const name of ['part-guides.mjs', 'part-guide.mjs']) {
    assert.ok(MOBILE_MODULES.includes(name), name);
    const text = await readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|cookie|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|getUserMedia|requestSession|navigator\.xr|detector|SyncClient|MobileSync|dispatch\(|location\.(assign|replace|href|hash)|replaceState/, name);
    assert.deepEqual([...text.matchAll(/from '([^']+)'/g)].map(m => m[1]), name === 'part-guide.mjs' ? ['./part-guides.mjs'] : []);
  }
  const ui = await readFile(new URL('../public/part-guide.mjs', import.meta.url), 'utf8');
  assert.match(ui, /history\.pushState\(\{ carscopePartGuideZoom: true \}, ''\)/, 'pushState takes no URL');
});

test('the local server serves listed pictures as images under the page CSP, and nothing else by that name', async () => {
  const server = http.createServer(createHandler());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(`${root}/`), csp = home.headers.get('content-security-policy');
    for (const name of MOBILE_ASSETS) {
      const r = await fetch(`${root}/${name}`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /^image\/svg\+xml/);
      assert.equal(r.headers.get('content-security-policy'), csp);
      await r.arrayBuffer();
    }
    assert.equal((await fetch(`${root}/guide-other.svg`)).status, 404);
    assert.match(csp, /img-src 'self' blob:/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

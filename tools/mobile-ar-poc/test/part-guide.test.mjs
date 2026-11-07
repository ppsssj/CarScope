// P12-A: the guide data, what may be shown, and where it is served. No DOM. Screens are in part-guide-browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHandler } from '../server.mjs';
import { MOBILE_ASSETS, MOBILE_MODULES, MOBILE_PAGES } from '../public-modules.mjs';
import { PUBLIC_FILES } from '../staging/build.mjs';
import { guideForTask, guideProblems, imageProblems, IMAGE_KIND, infoGuides, LICENSE, PART_GUIDES, usableImage } from '../public/part-guides.mjs';
import { inspectionTask, taskLinks } from '../public/inspection-tasks.mjs';
import { getChecklistProfile } from '../public/checklist-profiles.mjs';
import { taskCopy } from '../public/inspection-copy.mjs';
import { guideZones, renderGuideArt } from '../build-guide-art.mjs';
import { INSPECTION_PARTS, partById } from '../../three-poc/inspection-parts.mjs';

const art = renderGuideArt();

const photo = (patch = {}) => ({ file: 'photo.webp', kind: IMAGE_KIND.PHOTO, alt: 'x', caption: 'x', imageSource: 'owner, written permission 2026', licenseStatus: LICENSE.PERMISSION_GRANTED, vehicle: { make: 'M', model: 'N', year: 2024 }, ...patch });

test('all 19 registry parts have a guide, tied to the registry by id and task, and no id or task is made up', () => {
  assert.equal(INSPECTION_PARTS.length, 19);
  assert.deepEqual(Object.keys(PART_GUIDES).sort(), INSPECTION_PARTS.map(part => part.id).sort());
  for (const [key, guide] of Object.entries(PART_GUIDES)) {
    assert.equal(key, guide.partId);
    const part = partById(guide.partId);
    assert.equal(guide.taskId, part.taskId, guide.partId);
    assert.deepEqual(guideProblems(guide), [], guide.partId);
    assert.equal(guide.photoStatus, 'SCHEMATIC_ONLY', guide.partId);
    if (guide.taskId) assert.equal(guideForTask(guide.taskId), guide);
  }
  assert.equal(guideForTask(null), null, 'a part with no task is not found by accident');
  assert.equal(guideForTask(undefined), null);
});

test('17 parts connect to an inspection task and 2 are information only, with no task made for them', () => {
  const withTask = Object.values(PART_GUIDES).filter(guide => guide.taskId);
  assert.equal(withTask.length, 17);
  assert.deepEqual(infoGuides().map(guide => guide.partId).sort(), ['ev-battery.pack', 'ev-charge.flap']);
  assert.deepEqual(infoGuides().map(guide => guide.taskId), [null, null]);
  for (const guide of withTask) assert.ok(inspectionTask(guide.taskId), guide.taskId);
  assert.deepEqual(withTask.map(guide => guide.taskId).sort(), taskLinks().map(task => task.id).sort(), 'exactly the tasks the phone offers');
  for (const guide of infoGuides()) assert.equal(inspectionTask(guide.partId), undefined, 'no task appeared for it');
});

test('titles follow the registry names, and every related link leads to an information part', () => {
  for (const guide of Object.values(PART_GUIDES)) {
    if (guide.partId !== 'washer-fluid-cap') assert.equal(guide.title, partById(guide.partId).label, guide.partId);
    for (const id of guide.relatedInfo ?? []) assert.ok(infoGuides().some(info => info.partId === id), id);
  }
});

test('drawings are the final form: nothing in the guide words mentions a photo, in any of the 19', () => {
  for (const guide of Object.values(PART_GUIDES)) {
    const { overviewImage: o, detailImage: d } = guide;
    assert.doesNotMatch([guide.title, guide.role, guide.area, ...guide.identifyingFeatures, ...guide.safetyNotes, guide.vehicleApplicability.text, o.alt, o.caption, d.alt, d.caption, guide.manualReference?.applicability ?? ''].join(' '), /사진/, guide.partId);
  }
});

test('the source and licence of every drawing stay in the data, off the screen', () => {
  for (const image of Object.values(PART_GUIDES).flatMap(guide => [guide.overviewImage, guide.detailImage])) {
    assert.ok(image.imageSource, image.file);
    assert.equal(image.licenseStatus, LICENSE.CARSCOPE_ORIGINAL, image.file);
    assert.deepEqual(imageProblems(image), [], image.file);
  }
});

test('no real photo is claimed, and each drawing and its words are its own', () => {
  const images = Object.values(PART_GUIDES).flatMap(guide => [guide.overviewImage, guide.detailImage]);
  assert.equal(images.length, 38);
  for (const image of images) {
    assert.equal(image.kind, IMAGE_KIND.SCHEMATIC, image.file);
    assert.equal(image.licenseStatus, LICENSE.CARSCOPE_ORIGINAL, image.file);
    assert.equal(image.vehicle, undefined, 'a drawing names no vehicle');
    assert.ok(usableImage(image), image.file);
  }
  for (const key of ['file', 'alt']) assert.equal(new Set(images.map(image => image[key])).size, 38, key);
  for (const image of images) assert.doesNotMatch(image.alt, / {2}/, image.file);
});

test('every guide words its vehicle limits, and a vehicle is named only on the labelled manual link', () => {
  for (const guide of Object.values(PART_GUIDES)) {
    assert.ok(['ANY_VEHICLE', 'REFERENCE_LAYOUT_EXAMPLE'].includes(guide.vehicleApplicability.scope), guide.partId);
    assert.match(guide.vehicleApplicability.text, /내 차/, guide.partId);
    if (guide.manualReference) assert.match(guide.manualReference.applicability, /참고 자료/, guide.partId);
    assert.doesNotMatch(JSON.stringify([guide.title, guide.role, guide.area, guide.identifyingFeatures, guide.safetyNotes, guide.vehicleApplicability, guide.overviewImage, guide.detailImage]), /IONIQ|Hyundai|현대|아이오닉|42dot/i, guide.partId);
  }
});

test('left and right stay apart and are named from the seat, in words and in pictures', () => {
  for (const [left, right] of [['tire.front-left', 'tire.front-right'], ['tire.rear-left', 'tire.rear-right'], ['wiper.front.left', 'wiper.front.right'], ['light-low-beam-left-0', 'light-low-beam-right-0'], ['light-high-beam-left-0', 'light-high-beam-right-0']]) {
    const L = PART_GUIDES[left], R = PART_GUIDES[right];
    assert.match(L.title + L.area, /왼쪽/, left); assert.doesNotMatch(L.title + L.area, /오른쪽/, left);
    assert.match(R.title + R.area, /오른쪽/, right); assert.doesNotMatch(R.title + R.area, /왼쪽/, right);
    assert.match(L.overviewImage.alt, /왼쪽/); assert.match(R.overviewImage.alt, /오른쪽/);
    assert.match(L.identifyingFeatures[0], /앉아 앞을 볼 때/);
    for (const part of ['overviewImage', 'detailImage']) assert.notEqual(art.get(L[part].file), art.get(R[part].file), L[part].file);
  }
  // Seen from above with the nose up, the vehicle's left is on the left of the picture.
  const xOf = (file, fill) => [...art.get(file).matchAll(new RegExp(`<rect x="(\\d+)"[^>]*fill="${fill}"`, 'g'))].map(m => Number(m[1]));
  for (const [id, onLeft] of [['tire.front-left', true], ['tire.rear-left', true], ['tire.front-right', false], ['tire.rear-right', false]]) {
    const [x] = xOf(PART_GUIDES[id].overviewImage.file, '#3ec6e0');
    assert.equal(x < 200, onLeft, id);
  }
  assert.ok(art.get(PART_GUIDES['light-low-beam-left-0'].overviewImage.file).includes('cx="152" cy="72" rx="16" ry="9" fill="#3ec6e0"'));
  assert.ok(art.get(PART_GUIDES['light-low-beam-right-0'].overviewImage.file).includes('cx="248" cy="72" rx="16" ry="9" fill="#3ec6e0"'));
});

test('bonnet zones agree with the registry and the recorded layout, and each part has its own', () => {
  const zones = guideZones();
  assert.equal(new Set(Object.values(zones).map(String)).size, 6, 'six parts, six zones');
  const SIDE = { 좌측: col => col <= 1, 우측: col => col >= 2 }, ROW = { 앞쪽: 0, 중간: 1, 뒤쪽: 2 };
  for (const part of INSPECTION_PARTS.filter(p => p.location)) {
    const [col, row] = zones[part.id];
    const side = /차량 (좌측|우측)/.exec(part.location)[1], depth = /(앞쪽|중간|뒤쪽)/.exec(part.location)[1];
    assert.ok(SIDE[side](col), part.id); assert.equal(row, ROW[depth], part.id);
    assert.match(PART_GUIDES[part.id].area, side === '좌측' ? /왼쪽/ : /오른쪽/, part.id);
  }
  assert.ok(zones['washer-fluid-cap'][0] === 3 && zones['washer-fluid-cap'][1] === 2, 'docs/p3-a2-3: y -52..-44 is the vehicle right, outer and rear');
  for (const id of Object.keys(zones)) assert.equal(PART_GUIDES[id].vehicleApplicability.scope, 'REFERENCE_LAYOUT_EXAMPLE', 'an example, never a position');
  assert.match(art.get(PART_GUIDES['washer-fluid-cap'].overviewImage.file), /참고 배치 예시/);
});

test('estimated and marker parts are not presented as real shapes, and special cases say what varies', () => {
  for (const part of INSPECTION_PARTS.filter(p => ['ESTIMATED', 'GLB_MARKER', 'NONE'].includes(p.geometrySource))) {
    const guide = PART_GUIDES[part.id];
    assert.match(guide.overviewImage.caption + guide.detailImage.caption + guide.detailImage.alt, /차마다|예시|형상이 아닙|구조가 아닙|눈으로|않아요|위치가 아닙/, part.id);
  }
  for (const id of ['light-low-beam-left-0', 'light-low-beam-right-0', 'light-high-beam-left-0', 'light-high-beam-right-0']) {
    assert.match(PART_GUIDES[id].identifyingFeatures.join(' '), /한 램프에 함께/, id);
    assert.match(PART_GUIDES[id].overviewImage.alt, /내부 배치는 표시하지 않습니다/, id);
  }
  const lcw = PART_GUIDES['lcw-coolant-reservoir'];
  assert.match(lcw.role, /없는 차도 있어요/);
  assert.match(lcw.identifyingFeatures.join(' '), /LCW/);
  assert.match(art.get(lcw.overviewImage.file), /stroke-dasharray="7 5"/, 'no geometry in the registry, so it is dashed');
  assert.equal(partById('lcw-coolant-reservoir').geometrySource, 'NONE');
});

test('no guide invites opening, touching or going under: the risky parts say the opposite', () => {
  // An invitation to do it, not a sentence forbidding it ("캡을 열어 확인하지 마세요").
  const INVITE = /(열어 (확인|보|봐)|만져 (보|봐)|분해해|빼 (보|봐)|눌러 (보|봐)|보충해 주세요|들어가 (보|봐))(?!하지 마)/;
  for (const guide of Object.values(PART_GUIDES)) assert.doesNotMatch([guide.role, ...guide.identifyingFeatures, ...guide.safetyNotes].join(' ').replace('보닛을 열어 주세요', ''), INVITE, guide.partId);
  const words = id => PART_GUIDES[id].safetyNotes.join(' ');
  assert.match(words('ev-battery.pack'), /차 아래로 들어가거나/);
  assert.match(words('ev-battery.pack'), /만지거나 열거나 분해하지 마세요/);
  assert.match(words('ev-battery.pack'), /물러나/);
  for (const id of ['coolant-reservoir', 'lcw-coolant-reservoir', 'battery-12v', 'fuse-box']) assert.match(words(id), /부품을 만지거나 캡·덮개를 열지 마세요/, id);
  assert.match(words('brake-fluid-reservoir'), /캡을 열거나 직접 보충하거나 분해하지 마세요/);
  assert.match(words('ev-charge.port'), /단자 안을 만지거나/);
  assert.match(words('ev-charge.flap'), /억지로 열거나/);
});

test('inspection parts carry the very safety words of their inspection', () => {
  for (const guide of Object.values(PART_GUIDES).filter(g => g.taskId && g.taskId !== 'washer-fluid')) {
    const copy = taskCopy(getChecklistProfile(guide.taskId));
    for (const point of copy.points) assert.ok(guide.safetyNotes.includes(point), `${guide.partId}: ${point}`);
    if (copy.stop) assert.ok(guide.safetyNotes.includes(copy.stop), guide.partId);
  }
});

test('committed drawings are exactly what the generator makes', async () => {
  assert.equal(art.size, 38);
  for (const [name, svg] of art) {
    const file = (await readFile(new URL(`../public/${name}`, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
    assert.equal(file, svg, `${name}: run npm run build:guide-art`);
  }
  assert.equal(new Set(art.values()).size, 38, 'no two drawings are the same');
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
  const IMPORTS = { 'part-guides.mjs': ['./inspection-copy.mjs'], 'part-guide.mjs': ['./part-guides.mjs'], 'part-info-entry.mjs': ['./part-guide.mjs', './part-guides.mjs'] };
  for (const name of Object.keys(IMPORTS)) {
    assert.ok(MOBILE_MODULES.includes(name), name);
    const text = await readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|cookie|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|getUserMedia|requestSession|navigator\.xr|detector|SyncClient|MobileSync|dispatch\(|location\.(assign|replace)|location\.(href|hash)\s*=[^=]|replaceState/, name);
    assert.deepEqual([...text.matchAll(/from '([^']+)'/g)].map(m => m[1]), IMPORTS[name]);
  }
  const ui = await readFile(new URL('../public/part-guide.mjs', import.meta.url), 'utf8');
  assert.match(ui, /history\.pushState\(\{ carscopePartGuideZoom: true \}, ''\)/, 'pushState takes no URL');
});

test('the information page is listed, read-only by construction, and offers only parts with no inspection', async () => {
  assert.ok(PUBLIC_FILES.includes('part-info.html'));
  assert.deepEqual(MOBILE_PAGES, ['part-info.html']);
  const html = await readFile(new URL('../public/part-info.html', import.meta.url), 'utf8'), entry = await readFile(new URL('../public/part-info-entry.mjs', import.meta.url), 'utf8');
  assert.match(html, /src="\.\/part-info-entry\.mjs"/);
  assert.doesNotMatch(html + entry, /<style|style=|onclick|data-webxr|takeMobileHandoff|invite/i);
  assert.match(entry, /infoGuides\(\)\.find/);
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
    const info = await fetch(`${root}/part-info.html`);
    assert.match(info.headers.get('content-type'), /^text\/html/);
    assert.equal(info.headers.get('content-security-policy'), csp);
    await info.arrayBuffer();
    assert.match(csp, /img-src 'self' blob:/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

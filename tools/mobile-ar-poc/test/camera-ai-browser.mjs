// P21: camera AI assist in the real React bundle over the real local QR v2 relay. Synthetic camera stream,
// fixture detector and MOCK vision only: no Roboflow or OpenAI call is made, and nothing here is a LIVE result.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { startMobileDevServer } from "../../inspection-sync-poc/src/mobile-dev-server.mjs";
import { LocalTestSessionCreationAuthorizer } from "../../inspection-sync-poc/src/creation-authorizer.mjs";
import { ReceiverClient } from "../../inspection-sync-poc/bin/receiver.mjs";
import { createMockVisionProvider, mockAnswer } from "../../vision-poc/src/mock-vision-provider.mjs";
import { getChecklistProfile } from "../public/checklist-profiles.mjs";

const output = process.env.POC_EVIDENCE_DIR ?? process.env.SYNC_EVIDENCE_DIR;
if (!output || !path.isAbsolute(output) || !(process.platform === "win32"
  ? path.resolve(output).toLowerCase().startsWith("c:\\carscope-external\\")
  : path.resolve(output).startsWith(path.resolve(process.env.RUNNER_TEMP ?? os.tmpdir()) + path.sep)))
  throw Error("Set external POC_EVIDENCE_DIR under C:/CarScope-External");
await mkdir(output, { recursive: true });
const report = { scope: "LOCAL_SYNTHETIC_CAMERA_FIXTURE_DETECTOR_MOCK_VISION", realPhone: "NOT_RUN", realRoboflow: "NOT_RUN", realOpenAI: "NOT_RUN", checks: [], errors: [], accessibility: [] };
const pass = (name) => { report.checks.push(name); console.log("PASS:", name); };

// The synthetic scene (640x480): a red "cap" and a blue "tank" at known places.
const RED = [400, 100, 80, 80], BLUE = [100, 300, 80, 80];
const frac = ([x, y, w, h]) => [x / 640, y / 480, w / 640, h / 480];
const pred = ([x, y, w, h], score = 0.8, className = "Windshield Wiper Fluid") => ({ className, score, x: x + w / 2, y: y + h / 2, width: w, height: h });

// Fixture detector: answers in the uploaded picture's own pixels (the route checks the aspect), can be held.
const detector = { predictions: [], calls: 0, held: null, id: "mock",
  async detect({ image }) {
    this.calls++;
    if (this.held) await this.held;
    return { imageWidth: 640, imageHeight: 480, predictions: this.predictions };
  } };
const vision = createMockVisionProvider();
let lastCrop = null;
vision.scenario = (input) => { lastCrop = { image: Buffer.from(input.image), targetInCrop: input.targetInCrop, regionSource: input.regionSource }; return mockAnswer(input.partId, "suspected"); };
let now = Date.now();
const service = await startMobileDevServer({ now: () => now, authorizer: new LocalTestSessionCreationAuthorizer(),
  partDetection: { provider: detector }, partAnalysis: { provider: vision } });
// A QR v2 service with no AI at all (the main service's case).
const plain = await startMobileDevServer({ now: () => now, authorizer: new LocalTestSessionCreationAuthorizer() });

const browser = await chromium.launch({ channel: process.env.POC_BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : "chrome"), headless: true });
report.browser = browser.version();
let context, page, detectRequests = 0, analyzeRequests = 0;
async function open(base, taskId, { camera = "normal", touch = false, width = 390 } = {}) {
  await context?.close();
  context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce", hasTouch: touch });
  await context.addInitScript(({ camera, RED, BLUE }) => {
    window.cameraRequests = 0; window.fixtureStreams = [];
    const f = document.createElement("canvas"); f.width = 640; f.height = 480;
    const c = f.getContext("2d");
    const paint = () => { c.fillStyle = "#394e43"; c.fillRect(0, 0, 640, 480); c.fillStyle = "#d0302a"; c.fillRect(...RED); c.fillStyle = "#1f5fd0"; c.fillRect(...BLUE); };
    paint();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: camera === "unsupported" ? undefined : { getUserMedia: async () => {
      window.cameraRequests++;
      if (camera === "denied") throw new DOMException("denied", "NotAllowedError");
      const s = f.captureStream(10); window.fixtureStreams.push(s); setInterval(paint, 100); return s; } } });
  }, { camera, RED, BLUE });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (e) => { if (e.type() === "error" && !/net::ERR|Failed to load resource/.test(e.text())) report.errors.push(e.text()); });
  page.on("request", (r) => { if (r.url().includes("/v1/part-detections/")) detectRequests++; if (r.url().includes("/v1/part-analyses/")) analyzeRequests++; });
  let receiver = null;
  if (base) {
    now += 61000;
    receiver = new ReceiverClient({ baseUrl: base.url });
    const session = await receiver.create(taskId);
    await page.goto(base.url + "/" + session.fragment);
    await page.getByText("차량과 연결됐어요", { exact: true }).waitFor();
  } else await page.goto(service.url + "/#v=1&task=" + taskId);
  await page.waitForFunction(() => document.body.dataset.ready === "true");
  return receiver;
}
const button = (name) => page.getByRole("button", { name, exact: true });
const phase = () => page.locator(".cb-cai").getAttribute("data-ai-phase");
const waitPhase = (p) => page.locator(`.cb-cai[data-ai-phase="${p}"]`).waitFor();
async function toLocate() {
  for (const box of await page.locator(".cb-safety input[type=checkbox]").all()) await box.check();
  await button("카메라 보조로 시작").click();
}
async function cameraOn() {
  await button("카메라 켜기").click();
  await waitPhase("CAMERA_READY");
}
async function consent({ detect = true, analyze = true } = {}) {
  if (detect) await page.getByRole("checkbox", { name: /Roboflow 부품 탐지 서비스로 보내는 데 동의해요/ }).check();
  if (analyze) await page.getByRole("checkbox", { name: /외관 분석으로 보내는 데 동의해요/ }).first().check();
}
async function capture(shot) {
  await shot();
  await button("AI로 부품 찾기").click();
}
/** Screen point of an image fraction on the still: from the element's live layout, like a finger would hit it. */
async function at(u, v) {
  const b = await page.locator(".cb-cai .cb-region-surface").boundingBox();
  return { x: b.x + u * b.width, y: b.y + v * b.height };
}
async function mouseDrag(from, to) {
  const a = await at(...from), b = await at(...to);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
}
async function touchDrag(from, to) {
  const a = await at(...from), b = await at(...to);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x, y: a.y }] });
  for (let i = 1; i <= 5; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + (b.x - a.x) * i / 5, y: a.y + (b.y - a.y) * i / 5 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
/** The colour at the target's centre inside the crop the server received: proves screen → source → crop. */
async function cropCentreColour() {
  assert.ok(lastCrop, "no crop reached the analysis provider");
  const [l, t, w, h] = lastCrop.targetInCrop;
  return page.evaluate(async ({ b64, u, v }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/jpeg" }));
    const c = document.createElement("canvas"); c.width = bitmap.width; c.height = bitmap.height;
    const x = c.getContext("2d"); x.drawImage(bitmap, 0, 0);
    const d = x.getImageData(Math.round(u * bitmap.width), Math.round(v * bitmap.height), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, { b64: lastCrop.image.toString("base64"), u: l + w / 2, v: t + h / 2 });
}
const isRed = ([r, g, b]) => r > 150 && g < 90 && b < 90;
const isBlue = ([r, g, b]) => b > 150 && r < 90;
async function axe(name) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  report.accessibility.push({ name, violations: r.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })) });
  assert.deepEqual(r.violations.map((v) => v.id), [], name);
}
const shot = (name) => page.screenshot({ path: path.join(output, name + ".png") });
const counts = () => ({ d: detectRequests, a: analyzeRequests, calls: vision.calls.length });

try {
  // 1. Main journey: allow → capture → candidates → choose another → confirm → automatic analysis → result → manual check → confirm → send.
  detector.predictions = [pred(RED, 0.9), pred(BLUE, 0.6)];
  let receiver = await open(service, "washer-fluid");
  await toLocate();
  await page.getByText("AI 사진 보조 · 실험", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => cameraRequests), 0, "camera only on an explicit tap");
  await cameraOn();
  await page.waitForTimeout(1500);
  assert.equal(detectRequests, 0, "a live picture alone sends nothing: no per-frame calls");
  await shot("p21-01-ready");
  await capture(async () => consent());
  await waitPhase("CANDIDATE_FOUND");
  assert.equal(detectRequests, 1);
  assert.equal(analyzeRequests, 0, "nothing analysed before the person confirms");
  assert.match(await page.locator("h1").innerText(), /워셔액 주입구 후보를 찾았어요/);
  // Candidate overlay sits where the fixture put the part, in % of the still.
  const sel = await page.locator('.cb-region-candidate[data-selected="true"]').evaluate((e) => [e.style.left, e.style.top, e.style.width, e.style.height].map(parseFloat));
  frac(RED).forEach((f, i) => assert.ok(Math.abs(sel[i] / 100 - f) < 0.003, `candidate box ${i}`));
  await axe("candidates");
  await shot("p21-02-candidates");
  await button("다른 후보 선택").click();
  await button("다른 후보 선택").click();
  assert.equal(analyzeRequests, 0);
  const confirm = button("이 부품이 맞아요");
  await confirm.evaluate((b) => { b.click(); b.click(); });
  await waitPhase("RESULT");
  assert.equal(analyzeRequests, 1, "exactly one analysis per confirmation, even on a double tap");
  assert.equal(lastCrop.regionSource, "AI_CANDIDATE");
  assert.ok(isRed(await cropCentreColour()), "the confirmed candidate is what was cropped");
  const resultText = await page.locator(".cb-cai .cb-ai-result").innerText();
  assert.match(resultText, /로컬 시험용 MOCK/);
  assert.match(resultText, /참고 정보/);
  assert.match(resultText, /먼저 살펴볼 점/);
  assert.match(resultText, /근거/);
  await axe("result");
  await shot("p21-03-result");
  await page.screenshot({ path: path.join(output, "p21-03-result-full.png"), fullPage: false });
  await button("직접 점검 계속하기").click();
  await page.locator("body[data-step=check]").waitFor();
  assert.equal(await page.locator(".cb-observation input:checked").count(), 0, "AI never ticks the checklist");
  for (const box of await page.locator(".cb-observation input[type=checkbox]").all()) await box.check();
  await button("관찰 결과 선택하기").click();
  await button("보충이 필요해요").click();
  await button("선택한 결과 확인하기").click();
  await button("직접 확인한 결과로 확정").click();
  await page.locator("body[data-step=done]").waitFor();
  await button("차량으로 결과 보내기").click();
  await page.locator('[data-sync-state="SENT"]').waitFor();
  const view = await receiver.view();
  await receiver.accept(view.resultDigest);
  await page.locator('[data-sync-state="ACCEPTED"]').waitFor();
  assert.equal(view.result.status, "NEEDS_REFILL");
  pass("camera → one frame → fixture candidates at the right place → choose → confirm (double tap) → exactly one automatic MOCK analysis of the right crop → result → manual check → confirm → QR v2 send and vehicle accept");

  // 2. Consent gates: nothing is captured or sent without both agreements; a new capture asks again.
  await open(service, "washer-fluid");
  await toLocate(); await cameraOn();
  const d2 = detectRequests;
  const primary = button("AI로 부품 찾기");
  assert.equal(await primary.getAttribute("aria-disabled"), "true");
  await consent({ analyze: false });
  assert.equal(await primary.getAttribute("aria-disabled"), "true", "detector consent alone is not enough");
  await page.getByRole("checkbox", { name: /Roboflow/ }).uncheck();
  await consent({ detect: false });
  assert.equal(await primary.getAttribute("aria-disabled"), "true", "analysis consent alone is not enough");
  await primary.click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  assert.equal(detectRequests, d2, "no upload without both consents");
  await consent({ analyze: false });
  await primary.click();
  await waitPhase("CANDIDATE_FOUND");
  await button("다시 찾기").click();
  await waitPhase("CAMERA_READY");
  assert.equal(await page.getByRole("checkbox", { name: /Roboflow/ }).isChecked(), false);
  assert.equal(await page.getByRole("checkbox", { name: /외관 분석으로 보내는 데 동의해요/ }).first().isChecked(), false);
  pass("both consents are required before a capture; neither alone sends anything; a new capture asks for both again");

  // 3. No candidates → drag on the same photo (mouse, reverse direction) → confirm → one analysis of that region.
  detector.predictions = [];
  await open(service, "washer-fluid");
  await toLocate(); await cameraOn();
  await capture(async () => consent());
  await waitPhase("NONE_FOUND");
  const before3 = counts();
  await button("직접 위치 지정하기").click();
  await waitPhase("MANUAL_REGION");
  assert.equal(await button("이 영역이 맞아요").getAttribute("aria-disabled"), "true");
  const [bx, by, bw, bh] = frac(BLUE);
  await mouseDrag([bx + bw + 0.02, by + bh + 0.02], [bx - 0.02, by - 0.02]); // bottom-right → top-left
  await page.getByText(/선택한 영역 · 가로/).waitFor();
  const region = await page.locator(".cb-cai .cb-region-box").evaluate((e) => [e.style.left, e.style.top, e.style.width, e.style.height].map((v) => parseFloat(v) / 100));
  [bx - 0.02, by - 0.02, bw + 0.04, bh + 0.04].forEach((f, i) => assert.ok(Math.abs(region[i] - f) < 0.01, `reverse drag box ${i}: ${region[i]} vs ${f}`));
  assert.equal(analyzeRequests, before3.a, "dragging alone sends nothing");
  await axe("manual-region");
  await shot("p21-04-manual-region");
  await button("이 영역이 맞아요").click();
  await waitPhase("RESULT");
  assert.equal(analyzeRequests, before3.a + 1);
  assert.equal(lastCrop.regionSource, "MANUAL");
  assert.ok(isBlue(await cropCentreColour()), "screen → source → crop lands on the dragged part");
  pass("zero candidates: mouse drag in reverse on the same photo, exact box, confirmation, exactly one analysis of that region (MANUAL)");

  // 4. Wrong candidate → the person drags instead; tiny box refused; re-select; out-of-bounds clamps; a large part.
  detector.predictions = [pred(BLUE, 0.9)]; // the detector marks the wrong thing
  await open(service, "washer-fluid");
  await toLocate(); await cameraOn();
  await capture(async () => consent());
  await waitPhase("CANDIDATE_FOUND");
  await button("직접 위치 지정하기").click();
  await mouseDrag([0.5, 0.5], [0.505, 0.505]);
  await page.getByRole("alert").filter({ hasText: "영역이 너무 작아요" }).waitFor();
  assert.equal(await button("이 영역이 맞아요").getAttribute("aria-disabled"), "true", "a too-small box cannot be confirmed");
  await mouseDrag([0.6, 0.6], [1.3, 1.4]); // past the right and bottom edges of the picture
  let box = await page.locator(".cb-cai .cb-region-box").evaluate((e) => [e.style.left, e.style.top, e.style.width, e.style.height].map((v) => parseFloat(v) / 100));
  assert.ok(Math.abs(box[0] + box[2] - 1) < 1e-3 && Math.abs(box[1] + box[3] - 1) < 1e-3, "clamped to the picture");
  await button("다시 선택").click();
  assert.equal(await page.locator(".cb-cai .cb-region-box").count(), 0);
  await mouseDrag([0.03, 0.04], [0.97, 0.96]); // a large part, nearly the whole frame
  box = await page.locator(".cb-cai .cb-region-box").evaluate((e) => [e.style.width, e.style.height].map((v) => parseFloat(v) / 100));
  assert.ok(box[0] > 0.9 && box[1] > 0.9);
  const before4 = analyzeRequests;
  await button("이 영역이 맞아요").click();
  await waitPhase("RESULT");
  assert.equal(analyzeRequests, before4 + 1);
  const [tl, tt, tw, th] = lastCrop.targetInCrop;
  assert.ok(tw > 0.9 && th > 0.9 && tl < 0.05 && tt < 0.05, "a whole-frame region crops (almost) the whole frame");
  pass("wrong candidate → manual drag; too-small box refused; out-of-bounds drag clamped; re-select; large-part box analysed once");

  // 5. Touch drag on a part with no detector (12V: mark plan, no detector consent, no detection request).
  await open(service, "battery-12v", { touch: true });
  await toLocate();
  assert.equal(await page.getByRole("checkbox", { name: /Roboflow/ }).count(), 0, "no detector consent for a part with no detector class");
  await cameraOn();
  await consent({ detect: false });
  const d5 = detectRequests;
  await button("사진 찍고 영역 지정하기").click();
  await waitPhase("MANUAL_REGION");
  assert.equal(detectRequests, d5, "a mark-only part never calls the detector");
  await touchDrag([bx, by], [bx + bw, by + bh]);
  await page.getByText(/선택한 영역 · 가로/).waitFor();
  const a5 = analyzeRequests;
  await button("이 영역이 맞아요").click();
  await waitPhase("RESULT");
  assert.equal(analyzeRequests, a5 + 1);
  assert.ok(isBlue(await cropCentreColour()));
  pass("12V (no detector class): no detector consent or call; touch drag (Pointer Events) region → one analysis of the right crop");

  // 6. Keyboard region alternative.
  detector.predictions = [];
  await open(service, "fuse-box");
  await toLocate(); await cameraOn();
  await capture(async () => consent());
  await waitPhase("NONE_FOUND");
  await button("직접 위치 지정하기").click();
  await page.locator(".cb-cai .cb-region-surface").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  const kb = await page.locator(".cb-cai .cb-region-box").evaluate((e) => [e.style.left, e.style.top, e.style.width, e.style.height].map((v) => +(parseFloat(v) / 100).toFixed(3)));
  assert.deepEqual(kb, [0.32, 0.3, 0.4, 0.42]);
  await button("이 영역이 맞아요").click();
  await waitPhase("RESULT");
  pass("keyboard alternative: Enter makes a region, arrows move, Shift+arrows resize, then the same confirmation and analysis");

  // 7. Cancel during analysis: the late answer is never shown; retry needs a new consent.
  detector.predictions = [pred(RED, 0.9)];
  await open(service, "washer-fluid");
  await toLocate(); await cameraOn();
  await capture(async () => consent());
  await waitPhase("CANDIDATE_FOUND");
  vision.mode = "hold";
  const a7 = vision.calls.length;
  await button("이 부품이 맞아요").click();
  await waitPhase("ANALYZING");
  await shot("p21-05-analyzing");
  await button("분석 취소").click();
  await waitPhase("CANCELLED");
  vision.release(); vision.mode = "answer";
  await page.waitForTimeout(800);
  assert.equal(await phase(), "CANCELLED");
  assert.equal(await page.locator(".cb-cai .cb-ai-result").count(), 0, "a cancelled request's result is never shown");
  assert.equal(vision.calls.length, a7 + 1);
  assert.equal(await button("다시 분석").getAttribute("aria-disabled"), "true", "retry needs a fresh consent");
  await page.getByRole("checkbox", { name: /다시 .* 외관 분석으로 보내는 데 동의해요/ }).check();
  await button("다시 분석").click();
  await waitPhase("RESULT");
  assert.equal(vision.calls.length, a7 + 2);
  pass("cancel during analysis: late answer dropped; no automatic retry; retry needs a new consent and makes one request");

  // 8. A new capture while the old detection is still on its way: the old answer never lands on the new photo.
  let releaseOld;
  detector.held = new Promise((r) => (releaseOld = r));
  detector.predictions = [pred(BLUE, 0.9), pred(RED, 0.5)];
  await open(service, "washer-fluid");
  await toLocate(); await cameraOn();
  await capture(async () => consent());
  await waitPhase("DETECTING");
  await button("취소").click();
  await waitPhase("CANCELLED");
  await button("다시 촬영하기").click();
  await waitPhase("CAMERA_READY");
  detector.held = null;
  await page.route("**/v1/part-detections/**", async (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ candidates: [{ box: frac(RED), score: 0.95 }], detection: null }) }));
  await capture(async () => consent());
  await waitPhase("CANDIDATE_FOUND");
  releaseOld();
  await page.waitForTimeout(800);
  assert.equal(await page.locator(".cb-region-candidate").count(), 1, "only the new photo's candidate");
  await page.unroute("**/v1/part-detections/**");
  pass("a new capture while an older detection is pending: the older answer never replaces the new candidates");

  // 9. Errors: budget 429, invalid schema, too large, detector unavailable — each shown, none retried.
  for (const [name, route, text] of [
    ["budget", (r) => r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "VISION_BUDGET_EXHAUSTED" } }) }), "AI 사용 한도에 도달했어요"],
    ["schema", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { partId: "washer-fluid-cap", assessment: "safe" } }) }), "약속된 형식과 맞지 않아"],
    ["too-large", (r) => r.fulfill({ status: 413, contentType: "application/json", body: "{}" }), "사진이 너무 커서"],
  ]) {
    await open(service, "washer-fluid");
    await toLocate(); await cameraOn();
    await capture(async () => consent());
    await waitPhase("CANDIDATE_FOUND");
    let hits = 0;
    await page.route("**/v1/part-analyses/**", (r) => { hits++; return route(r); });
    await button("이 부품이 맞아요").click();
    await waitPhase("ERROR");
    await page.getByRole("alert").filter({ hasText: text }).waitFor();
    await page.waitForTimeout(500);
    assert.equal(hits, 1, name + ": no automatic retry");
    assert.equal(await page.locator(".cb-cai .cb-ai-result").count(), 0);
    if (name === "budget") await shot("p21-06-budget");
  }
  await open(service, "washer-fluid");
  await toLocate(); await cameraOn();
  await page.route("**/v1/part-detections/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await capture(async () => consent());
  await waitPhase("ERROR");
  await button("직접 점검 계속하기").click();
  await page.locator("body[data-step=check]").waitFor();
  pass("budget 429, invalid result schema, 413 and detector failure are shown once, never retried, and manual inspection continues");

  // 10. Leaving the page mid-analysis cancels; the camera stops.
  detector.predictions = [pred(RED, 0.9)];
  await open(service, "washer-fluid");
  await toLocate(); await cameraOn();
  await capture(async () => consent());
  await waitPhase("CANDIDATE_FOUND");
  vision.mode = "hold";
  await button("이 부품이 맞아요").click();
  await waitPhase("ANALYZING");
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await waitPhase("CANCELLED");
  vision.release(); vision.mode = "answer";
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".cb-cai .cb-ai-result").count(), 0);
  assert.ok(await page.evaluate(() => fixtureStreams.every((s) => s.getTracks().every((t) => t.readyState === "ended"))));
  // Exit dialog mid-detection also cancels.
  await open(service, "washer-fluid");
  await toLocate(); await cameraOn();
  let releaseExit;
  detector.held = new Promise((r) => (releaseExit = r));
  await capture(async () => consent());
  await waitPhase("DETECTING");
  await button("점검 나가기").click();
  await waitPhase("CANCELLED");
  detector.held = null;
  releaseExit();
  await page.waitForTimeout(300);
  assert.equal(await phase(), "CANCELLED");
  pass("leaving the page or opening the exit dialog mid-request cancels it, shows no result and stops the camera");

  // 11. Camera denied / unsupported with AI offered: camera-less actions only, nothing sent.
  for (const camera of ["denied", "unsupported"]) {
    await open(service, "washer-fluid", { camera });
    await toLocate();
    await button("카메라 켜기").click();
    await button("카메라 없이 계속하기").waitFor();
    assert.equal(await button("AI로 부품 찾기").count(), 0);
    const d = detectRequests;
    await button("카메라 없이 계속하기").click();
    await page.locator("body[data-step=check]").waitFor();
    assert.equal(detectRequests, d);
  }
  pass("camera denied or unsupported: no capture button, nothing sent, manual inspection continues");

  // 12. Not connected (QR v1 / direct) and an AI-less QR v2 service: no camera AI, the existing screen.
  await open(null, "washer-fluid");
  await toLocate();
  assert.equal(await page.getByText("AI 사진 보조 · 실험", { exact: true }).count(), 0);
  await button("카메라 켜기").click();
  await button("위치 확인 후 관찰하기").waitFor();
  assert.equal(await button("AI로 부품 찾기").count(), 0);
  await open(plain, "washer-fluid");
  await toLocate();
  assert.equal(await page.getByText("AI 사진 보조 · 실험", { exact: true }).count(), 0);
  await page.getByText("이 연결에서는 AI 사진 보조를 쓸 수 없어요", { exact: false }).waitFor();
  await open(service, "tire.front-left");
  await toLocate();
  assert.equal(await page.getByText("AI 사진 보조 · 실험", { exact: true }).count(), 0, "DRAFT exterior stays off without operator approval");
  pass("QR v1/direct, an AI-less QR v2 service and DRAFT exterior parts get no camera AI and keep the existing flow");

  // 13. Existing checklist answers survive an AI round trip.
  detector.predictions = [];
  await open(service, "coolant-reservoir");
  await toLocate(); await cameraOn();
  await button("직접 점검 계속하기").click();
  await page.locator("body[data-step=check]").waitFor();
  const first = getChecklistProfile("coolant-reservoir").answers.NOT_FOUND;
  await button(first).click();
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await page.locator("body[data-step=locate]").waitFor();
  await cameraOn();
  await capture(async () => consent());
  await waitPhase("NONE_FOUND");
  await button("직접 위치 지정하기").click();
  await mouseDrag([0.1, 0.1], [0.5, 0.5]);
  await button("이 영역이 맞아요").click();
  await waitPhase("RESULT");
  await button("직접 점검 계속하기").click();
  await page.locator("body[data-step=check]").waitFor();
  assert.equal(await button(first).getAttribute("aria-pressed"), "true", "the earlier answer is unchanged");
  pass("an existing checklist answer survives a full AI round trip; AI writes nothing into the inspection");

  // 14. 200% text on the result screen: no overflow, CTA not hiding content.
  detector.predictions = [pred(RED, 0.9)];
  await open(service, "washer-fluid", { width: 320 });
  await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%"));
  await toLocate(); await cameraOn();
  await capture(async () => consent());
  await waitPhase("CANDIDATE_FOUND");
  await button("이 부품이 맞아요").click();
  await waitPhase("RESULT");
  const overflow = await page.evaluate(() => ({ ok: document.documentElement.scrollWidth <= innerWidth,
    wide: [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 6).map((e) => `${e.tagName}.${e.className}:${Math.round(e.getBoundingClientRect().right)}`) }));
  assert.ok(overflow.ok, "horizontal overflow: " + overflow.wide.join(" | "));
  assert.equal(await page.locator(".cb-dock").getAttribute("data-layout"), "inline");
  await shot("p21-07-result-320-text200");
  pass("320px at 200% text: result screen without horizontal overflow, CTA inline");

  assert.deepEqual(report.errors, []);
  pass("no runtime, React or CSP console errors");
} finally {
  await writeFile(path.join(output, "camera-ai-browser-report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  await service.stop();
  await plain.stop();
}

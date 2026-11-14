// Real bundled React + real local sync HTTP. Synthetic photos/camera and MOCK AI only.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { createHandler } from "../server.mjs";
import { taskLinks } from "../public/inspection-tasks.mjs";
import { getChecklistProfile } from "../public/checklist-profiles.mjs";
import { startMobileDevServer } from "../../inspection-sync-poc/src/mobile-dev-server.mjs";
import { LocalTestSessionCreationAuthorizer } from "../../inspection-sync-poc/src/creation-authorizer.mjs";
import { ReceiverClient } from "../../inspection-sync-poc/bin/receiver.mjs";
import { createMockVisionProvider } from "../../vision-poc/src/mock-vision-provider.mjs";
const output = process.env.POC_EVIDENCE_DIR ?? process.env.SYNC_EVIDENCE_DIR;
if (
  !output ||
  !path.isAbsolute(output) ||
  !(process.platform === "win32"
    ? path.resolve(output).toLowerCase().startsWith("c:\\carscope-external\\")
    : path
        .resolve(output)
        .startsWith(
          path.resolve(process.env.RUNNER_TEMP ?? os.tmpdir()) + path.sep,
        ))
)
  throw Error("Set external POC_EVIDENCE_DIR under C:/CarScope-External");
await mkdir(output, { recursive: true });
const report = {
  scope: "LOCAL_SYNTHETIC_REACT_BROWSER",
  realPhone: "NOT_RUN",
  realProvider: "NOT_RUN",
  androidRuntime: "NOT_RUN",
  checks: [],
  errors: [],
  accessibility: [],
};
const pass = (name) => {
  report.checks.push(name);
  console.log("PASS:", name);
};
const staticServer = http.createServer(createHandler("https://poc.example/"));
await new Promise((r) => staticServer.listen(0, "127.0.0.1", r));
const staticUrl = `http://127.0.0.1:${staticServer.address().port}`;
let now = Date.now();
const provider = createMockVisionProvider();
const service = await startMobileDevServer({
  now: () => now,
  authorizer: new LocalTestSessionCreationAuthorizer(),
  partDetection: {
    provider: {
      id: "mock",
      detect: async () => ({
        imageWidth: 640,
        imageHeight: 480,
        predictions: [
          {
            className: "Windshield Wiper Fluid",
            score: 0.8,
            x: 320,
            y: 240,
            width: 100,
            height: 100,
          },
        ],
      }),
    },
  },
  partAnalysis: { provider },
});
const browser = await chromium.launch({
  channel:
    process.env.POC_BROWSER_CHANNEL ??
    (process.platform === "win32" ? "msedge" : "chrome"),
  headless: true,
});
report.browser = browser.version();
let context, page;
let submissions = 0,
  claims = 0;
const urls = [];
async function open(
  url,
  { camera = "normal", width = 390, startupFailure = false } = {},
) {
  await context?.close();
  context = await browser.newContext({
    viewport: { width, height: 844 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ({ camera }) => {
      window.fixtureStreams = [];
      window.cameraRequests = 0;
      const fixture = document.createElement("canvas");
      fixture.width = 640;
      fixture.height = 480;
      const c = fixture.getContext("2d");
      c.fillStyle = "#394e43";
      c.fillRect(0, 0, 640, 480);
      c.fillStyle = "#1488cb";
      c.fillRect(220, 150, 200, 180);
      const media = {
        getUserMedia: async () => {
          window.cameraRequests++;
          if (camera === "denied")
            throw new DOMException("denied", "NotAllowedError");
          const stream = fixture.captureStream(10);
          window.fixtureStreams.push(stream);
          setInterval(() => {
            c.fillStyle = "#394e43";
            c.fillRect(0, 0, 640, 480);
            c.fillStyle = "#1488cb";
            c.fillRect(220, 150, 200, 180);
          }, 100);
          if (camera === "delayed")
            await new Promise((r) => (window.releaseCamera = r));
          return stream;
        },
      };
      Object.defineProperty(navigator, "mediaDevices", {
        value: camera === "unsupported" ? undefined : media,
        configurable: true,
      });
    },
    { camera },
  );
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (e) => {
    if (
      e.type() === "error" &&
      !/net::ERR|Failed to load resource/.test(e.text())
    )
      report.errors.push(e.text());
  });
  page.on("request", (r) => {
    urls.push(r.url());
    if (r.url().endsWith("/v1/submissions")) submissions++;
    if (r.url().endsWith("/v1/claim")) claims++;
  });
  if (startupFailure)
    await page.route("**/react-assets/*.js", (r) => r.abort());
  await page.goto(url);
  await page.locator("h1").waitFor();
  if (!startupFailure)
    await page.waitForFunction(() => document.body.dataset.ready === "true");
}
const button = (label) =>
  page.getByRole("button", {
    name: label,
    exact: true,
  });
const step = () => page.locator("body").getAttribute("data-step");
const noOverflow = async () =>
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
const cameraEnded = async () =>
  assert.ok(
    await page.evaluate(() =>
      fixtureStreams.every((s) =>
        s.getTracks().every((t) => t.readyState === "ended"),
      ),
    ),
  );
async function safety() {
  for (const c of await page.locator(".cb-safety input[type=checkbox]").all())
    await c.check();
}
async function complete(taskId = "washer-fluid", { mixed = false } = {}) {
  await safety();
  await button("직접 점검 시작").click();
  if (taskId === "washer-fluid") {
    for (const c of await page
      .locator(".cb-observation input[type=checkbox]")
      .all())
      await c.check();
    await button("관찰 결과 선택하기").click();
    await button("보충이 필요해요").click();
    await button("선택한 결과 확인하기").click();
  } else {
    const profile = getChecklistProfile(taskId);
    for (let i = 0; i < profile.checks.length; i++) {
      await button(
        i === 0 && mixed
          ? "이상 징후 발견"
          : i === 1 && mixed
            ? "확인할 수 없음"
            : "발견하지 못함",
      ).click();
      await button(
        i < profile.checks.length - 1 ? "다음 관찰" : "전체 응답 확인하기",
      ).click();
    }
  }
  await button("직접 확인한 결과로 확정").click();
  await page.locator("body[data-step=done]").waitFor();
}
async function pair(taskId = "washer-fluid") {
  now += 61000;
  const receiver = new ReceiverClient({ baseUrl: service.url });
  const session = await receiver.create(taskId);
  const before = claims;
  await open(service.url + "/" + session.fragment);
  await page.getByText("차량과 연결됐어요", { exact: true }).waitFor();
  assert.equal(claims - before, 1);
  assert.equal(new URL(page.url()).hash, "");
  return { receiver, session };
}
async function syncState(value) {
  await page.locator(`[data-sync-state="${value}"]`).waitFor();
}
// P20: the first screen as a user sees it, plus the whole page drawn by
// growing the viewport (Playwright fullPage stitching paints fixed/sticky
// bars in the middle of the image, which is not what a user sees).
async function capture(name) {
  await page.screenshot({ path: path.join(output, name + ".png") });
  const size = page.viewportSize();
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await page.setViewportSize({ width: size.width, height });
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(output, name + "-full.png") });
  await page.setViewportSize(size);
  await page.waitForTimeout(120);
}
async function axe(name) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  report.accessibility.push({
    name,
    violations: result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
  });
  assert.deepEqual(
    result.violations.map((v) => v.id),
    [],
    name,
  );
}
// P20: one fill primary per screen, labels never truncated, and the fixed
// bottom CTA never hides content (it turns inline when text is large).
async function onePrimary(name) {
  assert.equal(
    await page
      .locator('.cb-dock .astryx-button[data-variant="primary"]')
      .count(),
    1,
    name + " has exactly one primary action",
  );
}
async function scaleText(scale) {
  // CSP blocks inline <style>; the CSSOM is how a user setting would apply.
  await page.evaluate(
    (s) =>
      document.documentElement.style.setProperty("font-size", `${s * 100}%`),
    scale,
  );
  await page.waitForTimeout(150);
}
async function dockFits(name) {
  await noOverflow();
  const cut = await page.$$eval(".cb-app .astryx-button", (els) =>
    els
      .flatMap((b) => [b, ...b.querySelectorAll("*")])
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
      .map((e) => e.textContent.trim()),
  );
  assert.deepEqual(cut, [], name + " labels truncated");
  const dock = await page.locator(".cb-dock").evaluate((d) => ({
    layout: d.dataset.layout,
    height: d.getBoundingClientRect().height,
  }));
  if (dock.layout === "fixed") {
    assert.ok(dock.height <= innerHeightOf(page) * 0.3 + 1, name + " dock share");
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const [mainBottom, dockTop] = await page.evaluate(() => [
      document.querySelector(".cb-main").getBoundingClientRect().bottom,
      document.querySelector(".cb-dock").getBoundingClientRect().top,
    ]);
    assert.ok(mainBottom <= dockTop + 1, name + " content hidden by fixed CTA");
    await page.evaluate(() => scrollTo(0, 0));
  }
  return dock.layout;
}
const innerHeightOf = (p) => p.viewportSize().height;
async function tabTo(match, limit = 80) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    const hit = await page.evaluate((m) => {
      const e = document.activeElement;
      const name = (e?.getAttribute("aria-label") ?? e?.textContent ?? "").trim();
      return m.startsWith(".")
        ? !!e?.matches(m)
        : name === m;
    }, match);
    if (hit) return;
  }
  throw Error("keyboard could not reach " + match);
}
try {
  await open(staticUrl);
  assert.equal(await page.locator(".cb-part").count(), 17);
  await noOverflow();
  await axe("catalog");
  // Force lazy illustrations into the screenshot and check every asset decoded.
  for (const img of await page.locator(".cb-part-art img").all())
    await img.scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollTo(0, 0));
  await capture("after-catalog");
  assert.ok(
    await page
      .locator(".cb-part-art img")
      .evaluateAll((images) =>
        images.every((i) => i.complete && i.naturalWidth > 0),
      ),
  );
  await button("타이어").click();
  assert.equal(await page.locator(".cb-part").count(), 4);
  pass(
    "17-task catalog, category navigation, all schematic assets, no-login entry and accessibility",
  );
  await open(staticUrl + "/#v=2&task=washer-fluid&invite=bad");
  await page.getByText("이 QR로는").waitFor();
  assert.equal(new URL(page.url()).hash, "");
  assert.equal(await button("직접 점검 시작").count(), 0);
  pass("invalid QR stripped and inspection blocked");
  const claimBeforeInfo = claims;
  await open(service.url + "/part-info.html#ev-battery.pack");
  assert.match(await page.locator("h1").innerText(), /배터리/);
  assert.equal(await button("직접 점검 시작").count(), 0);
  await button("그림 크게 보기").click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await noOverflow();
  await axe("read-only-part-guide");
  await open(service.url + "/part-info.html#v=2&task=washer-fluid&invite=bad");
  assert.equal(new URL(page.url()).hash, "");
  assert.equal(claims, claimBeforeInfo);
  pass(
    "read-only info parts use React, enlarged diagrams close with Escape, and QR cannot create an inspection on info pages",
  );
  for (const task of taskLinks()) {
    await open(staticUrl + "/" + task.href);
    assert.equal(
      await button("직접 점검 시작").getAttribute("aria-disabled"),
      "true",
    );
    if (task.id === "washer-fluid") await capture("after-intro");
    await complete(task.id, { mixed: task.id === "brake-fluid" });
    assert.equal(await button("차량으로 결과 보내기").count(), 0);
    await noOverflow();
  }
  pass(
    "all 17 local tasks preserve safety gates, full observation, explicit confirmation and local-only completion",
  );
  await capture("after-completed");
  await axe("completion");
  await open(staticUrl + "/#task=tire.front-left");
  await safety();
  await button("직접 점검 시작").click();
  assert.equal(await button("다음 관찰").getAttribute("aria-disabled"), "true");
  await button("이상 징후 발견").click();
  await button("다음 관찰").click();
  await button("확인할 수 없음").click();
  await button("다음 관찰").click();
  await button("발견하지 못함").click();
  await button("전체 응답 확인하기").click();
  await button("갈라짐이나 손상 수정").click();
  await button("발견하지 못함").click();
  await button("다음 관찰").click();
  assert.equal(await step(), "review");
  await capture("after-review");
  await axe("review");
  pass(
    "unanswered question cannot advance; review edits return to review without silently filling other responses",
  );
  for (const camera of ["normal", "denied", "unsupported", "delayed"]) {
    await open(staticUrl + "/#v=1&task=washer-fluid", { camera });
    await safety();
    await button("카메라 보조로 시작").click();
    assert.equal(await page.evaluate(() => cameraRequests), 0);
    await button("카메라 켜기").click();
    if (camera === "normal") {
      await page
        .getByText("부품을 화면 가운데에 맞춰 주세요.", { exact: false })
        .waitFor();
      await button("가운데에 표시").click();
      await page.getByText("색 후보 1곳", { exact: false }).waitFor();
      assert.ok(
        await page.locator(".cb-camera-overlay").evaluate((c) =>
          c
            .getContext("2d")
            .getImageData(0, 0, c.width, c.height)
            .data.some((v, i) => i % 4 === 3 && v > 0),
        ),
      );
      await capture("after-camera");
    }
    if (camera === "denied")
      await page
        .getByText("카메라 권한이 거부되었거나 브라우저에서 차단했습니다.")
        .waitFor();
    if (camera === "unsupported")
      await page
        .getByText("이 브라우저에서는 카메라를 쓸 수 없어요.", { exact: false })
        .waitFor();
    await button("카메라 없이 계속하기").click();
    if (camera === "delayed") await page.evaluate(() => window.releaseCamera());
    await cameraEnded();
    assert.equal(await step(), "check");
  }
  pass(
    "explicit camera activation, grant/denial/unsupported recovery, pending-permission exit and stream cleanup",
  );
  await open(staticUrl + "/#task=ev-charge.port");
  await safety();
  await button("카메라 보조로 시작").click();
  await button("카메라 켜기").click();
  await page
    .getByText("부품을 화면 가운데에 맞춰 주세요.", { exact: false })
    .waitFor();
  await button("점검 나가기").click();
  await page.getByRole("dialog").waitFor();
  await cameraEnded();
  await button("점검 계속하기").click();
  await button("카메라 없이 계속하기").click();
  await button("접근과 관찰 중단").click();
  assert.equal(await button("카메라 켜기").count(), 0);
  assert.equal(await button("다음 관찰").getAttribute("aria-disabled"), "true");
  pass(
    "exit dialog stops camera; charging safety and observation stop preserve explicit unanswered items",
  );
  for (const width of [320, 768]) {
    await open(staticUrl + "/#task=brake-fluid", { width });
    await safety();
    await button("직접 점검 시작").click();
    await noOverflow();
    await axe("observation-" + width);
    await capture("after-observation-" + width);
  }
  pass(
    "320px phone and 768px tablet observation, responsive layout, WCAG automated checks",
  );
  let paired = await pair();
  const before = submissions;
  await complete();
  assert.equal(submissions, before);
  const send = button("차량으로 결과 보내기");
  await send.evaluate((b) => {
    b.click();
    b.click();
  });
  await syncState("SENT");
  assert.equal(submissions - before, 1);
  // Server receipt is not vehicle receipt.
  assert.deepEqual(
    await page
      .locator(".cb-timeline li")
      .evaluateAll((l) => l.map((e) => e.dataset.tone)),
    ["done", "done", "done", "active"],
  );
  assert.equal((await paired.receiver.view()).sessionState, "RESULT_SUBMITTED");
  await capture("after-server-receipt");
  const view = await paired.receiver.view();
  await paired.receiver.accept(view.resultDigest);
  await syncState("ACCEPTED");
  assert.equal(
    await page.locator(".cb-timeline li").nth(3).getAttribute("data-tone"),
    "done",
  );
  await onePrimary("vehicle receipt");
  await capture("after-vehicle-receipt");
  await axe("vehicle-receipt");
  const invite = paired.session.fragment.split("invite=")[1];
  assert.ok(!(await page.content()).includes(invite));
  assert.ok(urls.every((u) => !u.includes(invite)));
  assert.deepEqual(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
    [0, 0],
  );
  pass(
    "QR v2 scrub, no credential storage/DOM/request URL leak, explicit submit, double-click guard, exact receiver digest acceptance",
  );
  paired = await pair("tire.rear-right");
  await complete("tire.rear-right");
  await context.setOffline(true);
  await button("차량으로 결과 보내기").click();
  await syncState("FAILED_NETWORK");
  assert.deepEqual(
    await page
      .locator(".cb-timeline li")
      .evaluateAll((l) => l.map((e) => e.dataset.tone)),
    ["done", "error", "waiting", "waiting"],
  );
  await capture("after-network-error");
  await context.setOffline(false);
  await button("같은 결과 다시 보내기").click();
  await syncState("SENT");
  assert.equal((await paired.receiver.view()).result.taskId, "tire.rear-right");
  pass(
    "offline send remains failure; same-record retry uses correct task and server receipt",
  );
  paired = await pair();
  await complete();
  const bodies = [];
  let lose = true;
  await page.route("**/v1/submissions", async (r) => {
    bodies.push(r.request().postData());
    if (lose) {
      lose = false;
      await r.fetch();
      await r.abort();
    } else await r.continue();
  });
  await button("차량으로 결과 보내기").click();
  await syncState("SENT");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  pass(
    "lost committed submit response safely retries identical DTO with idempotent receipt",
  );
  paired = await pair();
  await complete();
  await paired.receiver.cancel();
  await syncState("CANCELLED");
  assert.equal(
    await button("차량으로 결과 보내기").getAttribute("aria-disabled"),
    "true",
  );
  pass("vehicle cancellation stops submission");
  paired = await pair();
  now = paired.session.expiresAt + 1;
  await complete();
  await syncState("REJECTED_EXPIRED");
  pass("session expiration is recoverable only with a new QR");
  // Real relay and MOCK providers. No external processing or real photo.
  paired = await pair();
  await safety();
  await button("카메라 보조로 시작").click();
  await page.getByText("사진으로 한 번 더 살펴보기", { exact: true }).waitFor();
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 480;
    const x = c.getContext("2d");
    x.fillStyle = "#2456aa";
    x.fillRect(0, 0, 640, 480);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator("input[type=file]").setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await page.locator(".cb-photo-canvas").first().waitFor();
  assert.equal(
    await button("AI 위치 후보 찾기").getAttribute("aria-disabled"),
    "true",
  );
  await page
    .getByRole("checkbox", { name: "이 사진의 외부 위치 분석에 동의합니다" })
    .check();
  await button("AI 위치 후보 찾기").click();
  await button("후보 1 선택").waitFor();
  await button("후보 1 선택").click();
  await page
    .getByRole("checkbox", { name: "잘라낸 사진의 외부 AI 분석에 동의합니다" })
    .waitFor();
  assert.equal(
    await button("사진 상태 분석").getAttribute("aria-disabled"),
    "true",
  );
  await page
    .getByRole("checkbox", { name: "잘라낸 사진의 외부 AI 분석에 동의합니다" })
    .check();
  await button("사진 상태 분석").click();
  await page.locator(".cb-ai-result").waitFor();
  await page
    .getByRole("checkbox", {
      name: "AI의 한계를 이해했고, 실제 부품을 직접 확인하겠습니다",
    })
    .check();
  await capture("after-ai-result");
  assert.equal(await step(), "locate");
  assert.ok(
    await page
      .locator(".cb-ai-result")
      .innerText()
      .then((t) => t.includes("로컬 시험용 MOCK")),
  );
  await axe("AI-result");
  // P20: with the camera off, the locate step continues via the manual path.
  await button("카메라 없이 계속하기").click();
  assert.equal(
    await page.locator(".cb-observation input:checked").count(),
    0,
  );
  pass(
    "MOCK detector→candidate→context crop→separate consent→validated MOCK AI result→human acknowledgement; no automatic checklist or submission",
  );
  paired = await pair("battery-12v");
  await safety();
  await button("카메라 보조로 시작").click();
  await page.getByText("사진으로 한 번 더 살펴보기", { exact: true }).waitFor();
  assert.equal(await button("AI 위치 후보 찾기").count(), 0);
  await page.locator("input[type=file]").setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await page.locator(".cb-photo-canvas").first().focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("checkbox", { name: "잘라낸 사진의 외부 AI 분석에 동의합니다" })
    .check();
  await page.route("**/v1/part-analyses/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { partId: "washer-fluid-cap", assessment: "safe" },
      }),
    }),
  );
  await button("사진 상태 분석").click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator(".cb-ai-result").count(), 0);
  assert.equal(
    await page
      .getByRole("checkbox", {
        name: "잘라낸 사진의 외부 AI 분석에 동의합니다",
      })
      .isChecked(),
    false,
  );
  pass(
    "manual-only 12V region with keyboard; malformed/wrong-part AI response rejected, consent reset and manual recovery retained",
  );
  for (const taskId of [
    "washer-fluid",
    "coolant-reservoir",
    "lcw-coolant-reservoir",
    "brake-fluid",
    "battery-12v",
    "fuse-box",
  ]) {
    await pair(taskId);
    await safety();
    await button("카메라 보조로 시작").click();
    await page.locator("input[type=file]").waitFor();
    await page.locator("input[type=file]").setInputFiles({
      name: "synthetic.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await page.locator(".cb-photo-canvas").first().focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("checkbox", {
        name: "잘라낸 사진의 외부 AI 분석에 동의합니다",
      })
      .check();
    await button("사진 상태 분석").click();
    await page.locator(".cb-ai-result").waitFor();
    assert.match(
      await page.locator(".cb-ai-result").innerText(),
      /로컬 시험용 MOCK/,
    );
    // New file must revoke both consents and the old AI result.
    await page.locator("input[type=file]").setInputFiles({
      name: "new-synthetic.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await page.locator(".cb-photo-canvas").first().waitFor();
    assert.equal(await page.locator(".cb-ai-result").count(), 0);
    const consent = page.getByRole("checkbox", {
      name: "이 사진의 외부 위치 분석에 동의합니다",
    });
    if (await consent.count()) assert.equal(await consent.isChecked(), false);
  }
  pass(
    "all six bonnet AI profiles use the real relay with MOCK analysis; replacing a photo clears findings and per-photo consents",
  );
  await pair("tire.front-left");
  await safety();
  await button("카메라 보조로 시작").click();
  assert.equal(await page.locator("input[type=file]").count(), 0);
  pass("exterior DRAFT analysis stays unavailable without operator approval");
  await open(staticUrl, { startupFailure: true });
  await page.getByRole("link", { name: "다시 시도", exact: true }).waitFor();
  assert.equal(await button("직접 점검 시작").count(), 0);
  pass(
    "failed initial JS download leaves an explicit network/retry fallback, never a fabricated inspection success",
  );
  // ── P20 차보담 integration ──
  await open(staticUrl);
  assert.match(await page.title(), /차보담/);
  assert.doesNotMatch(await page.locator("body").innerText(), /CarScope/);
  assert.deepEqual(
    (
      await page
        .locator(".cb-part:has(.cb-tag-ai)")
        .evaluateAll((a) => a.map((e) => e.getAttribute("href")))
    ).sort(),
    [
      "#task=battery-12v",
      "#task=brake-fluid",
      "#task=coolant-reservoir",
      "#task=fuse-box",
      "#task=lcw-coolant-reservoir",
      "#v=1&task=washer-fluid",
    ],
  );
  for (const row of await page.locator(".cb-part-text").all()) {
    // Name, location and method are three separate, non-empty lines.
    const lines = (await row.innerText()).split("\n").filter((l) => l.trim());
    assert.ok(lines.length >= 3, lines.join(" | "));
    assert.ok(lines.some((l) => /눈으로/.test(l)), lines.join(" | "));
  }
  pass(
    "차보담 brand on every visible catalog string; 17 rows show location and method; AI tag only on the six evaluated bonnet parts",
  );
  for (const scale of [1.3, 2]) {
    const tag = "text" + Math.round(scale * 100);
    await open(staticUrl + "/#v=1&task=washer-fluid");
    await scaleText(scale);
    await onePrimary("intro");
    const introLayout = await dockFits("intro " + tag);
    await capture("p20-intro-" + tag);
    await safety();
    await button("카메라 보조로 시작").click();
    await onePrimary("locate");
    await dockFits("locate " + tag);
    await capture("p20-locate-" + tag);
    await button("카메라 없이 계속하기").click();
    await dockFits("observation " + tag);
    await axe("observation-" + tag);
    await open(staticUrl + "/#task=brake-fluid", { width: 320 });
    await scaleText(scale);
    await complete("brake-fluid");
    await onePrimary("done 320 " + tag);
    await dockFits("done 320 " + tag);
    // The skip link stays fully off-screen until focused, and a sticky bar
    // never covers more than 12% of the screen.
    assert.ok(
      (await page.locator(".cb-skip").boundingBox()).y +
        (await page.locator(".cb-skip").boundingBox()).height <=
        0,
      "skip link hidden " + tag,
    );
    const bar = await page.locator(".cb-taskbar").evaluate((b) => ({
      layout: b.dataset.layout,
      share: b.getBoundingClientRect().height / innerHeight,
    }));
    assert.ok(bar.layout === "static" || bar.share <= 0.12, JSON.stringify(bar));
    await capture("p20-done-320-" + tag);
    if (scale === 2) assert.equal(introLayout, "inline");
    else assert.equal(introLayout, "fixed");
  }
  pass(
    "130% and 200% text: no truncation or overflow; the fixed CTA never hides content and becomes inline at 200%; 320px journey completes at both sizes",
  );
  await open(staticUrl + "/#task=brake-fluid");
  await tabTo(".cb-safety input[type=checkbox]");
  await page.keyboard.press("Space");
  await tabTo("직접 점검 시작");
  await page.keyboard.press("Enter");
  await page.locator("body[data-step=check]").waitFor();
  const brakeChecks = getChecklistProfile("brake-fluid").checks.length;
  for (let i = 0; i < brakeChecks; i++) {
    await tabTo("발견하지 못함");
    await page.keyboard.press("Space");
    await tabTo(i < brakeChecks - 1 ? "다음 관찰" : "전체 응답 확인하기");
    await page.keyboard.press("Enter");
  }
  await page.locator("body[data-step=review]").waitFor();
  await tabTo("직접 확인한 결과로 확정");
  await page.keyboard.press("Enter");
  await page.locator("body[data-step=done]").waitFor();
  pass("keyboard-only journey in tab order: safety, start, every answer, review and confirmation");
  await open(staticUrl + "/#v=1&task=washer-fluid");
  await axe("intro");
  await safety();
  await button("카메라 보조로 시작").click();
  await button("카메라 켜기").click();
  await page.getByText("부품을 화면 가운데에 맞춰 주세요.", { exact: false }).waitFor();
  await page.locator(".cb-camera-overlay").focus();
  await page.keyboard.press("Enter");
  await page.getByText("직접 표시 1곳", { exact: false }).waitFor();
  assert.match(await page.locator("h1").innerText(), /직접 확인/);
  await axe("camera-live");
  await capture("p20-camera-marked");
  await open(staticUrl + "/#task=ev-charge.port", { width: 768 });
  await capture("p20-intro-768");
  await axe("intro-768");
  await open(staticUrl, { width: 768 });
  await capture("p20-catalog-768");
  await open(staticUrl + "/#v=2&task=washer-fluid&invite=bad");
  await axe("invalid-qr");
  pass("keyboard marking on the live camera; axe on intro, live camera, tablet and invalid QR");
  assert.deepEqual(report.errors, []);
  pass("no runtime, React or CSP console errors across the new flows");
} finally {
  await writeFile(
    path.join(output, "react-browser-report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await service.stop();
  await new Promise((r) => staticServer.close(r));
}

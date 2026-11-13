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
    name: label === "점검 나가기" ? "← 점검 나가기" : label,
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
  for (const c of await page.locator(".safety-card input[type=checkbox]").all())
    await c.check();
}
async function complete(taskId = "washer-fluid", { mixed = false } = {}) {
  await safety();
  await button("직접 점검 시작").click();
  if (taskId === "washer-fluid") {
    for (const c of await page
      .locator(".observation-card input[type=checkbox]")
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
async function capture(name) {
  await page.screenshot({
    path: path.join(output, name + ".png"),
    fullPage: true,
  });
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
try {
  await open(staticUrl);
  assert.equal(await page.locator(".part-card").count(), 17);
  await noOverflow();
  await axe("catalog");
  // Force lazy illustrations into the screenshot and check every asset decoded.
  for (const img of await page.locator(".part-art img").all())
    await img.scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollTo(0, 0));
  await capture("after-catalog");
  assert.ok(
    await page
      .locator(".part-art img")
      .evaluateAll((images) =>
        images.every((i) => i.complete && i.naturalWidth > 0),
      ),
  );
  await button("타이어").click();
  assert.equal(await page.locator(".part-card").count(), 4);
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
        .getByText("선택한 부품을 화면 가운데 맞추세요.", { exact: false })
        .waitFor();
      await button("가운데 위치 직접 지정").click();
      await page.getByText("파란색 후보 1개", { exact: false }).waitFor();
      assert.ok(
        await page.locator(".camera-overlay").evaluate((c) =>
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
        .getByText("이 환경은 카메라를 지원하지 않습니다.", { exact: false })
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
    .getByText("선택한 부품을 화면 가운데 맞추세요.", { exact: false })
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
  assert.equal((await paired.receiver.view()).sessionState, "RESULT_SUBMITTED");
  await capture("after-server-receipt");
  const view = await paired.receiver.view();
  await paired.receiver.accept(view.resultDigest);
  await syncState("ACCEPTED");
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
  await page.getByText("사진으로 관찰 돕기", { exact: true }).waitFor();
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
  await page.locator(".photo-canvas").first().waitFor();
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
  await page.locator(".ai-result").waitFor();
  await page
    .getByRole("checkbox", {
      name: "AI의 한계를 이해했고, 실제 부품을 직접 확인하겠습니다",
    })
    .check();
  await capture("after-ai-result");
  assert.equal(await step(), "locate");
  assert.ok(
    await page
      .locator(".ai-result")
      .innerText()
      .then((t) => t.includes("로컬 시험용 MOCK")),
  );
  await axe("AI-result");
  await button("위치 확인 후 관찰하기").click();
  assert.equal(
    await page.locator(".observation-card input:checked").count(),
    0,
  );
  pass(
    "MOCK detector→candidate→context crop→separate consent→validated MOCK AI result→human acknowledgement; no automatic checklist or submission",
  );
  paired = await pair("battery-12v");
  await safety();
  await button("카메라 보조로 시작").click();
  await page.getByText("사진으로 관찰 돕기", { exact: true }).waitFor();
  assert.equal(await button("AI 위치 후보 찾기").count(), 0);
  await page.locator("input[type=file]").setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await page.locator(".photo-canvas").first().focus();
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
  assert.equal(await page.locator(".ai-result").count(), 0);
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
    await page.locator(".photo-canvas").first().focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("checkbox", {
        name: "잘라낸 사진의 외부 AI 분석에 동의합니다",
      })
      .check();
    await button("사진 상태 분석").click();
    await page.locator(".ai-result").waitFor();
    assert.match(
      await page.locator(".ai-result").innerText(),
      /로컬 시험용 MOCK/,
    );
    // New file must revoke both consents and the old AI result.
    await page.locator("input[type=file]").setInputFiles({
      name: "new-synthetic.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await page.locator(".photo-canvas").first().waitFor();
    assert.equal(await page.locator(".ai-result").count(), 0);
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

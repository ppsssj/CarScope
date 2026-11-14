// P19 design lab browser check: every MOCK camera state at phone widths,
// axe WCAG A/AA, one-primary rule, touch targets, text scaling, isolation
// from real camera/network. Screenshots go OUTSIDE Git (TOSS_LAB_OUTPUT).
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { startTossLab } from "../toss-lab-server.mjs";

const output =
  process.env.TOSS_LAB_OUTPUT ??
  path.resolve("C:/CarScope-External/p19-toss-lab");
await mkdir(output, { recursive: true });
const STATES = ["idle", "requesting", "live", "marked", "denied", "unsupported"];
const report = { startedAt: new Date().toISOString(), checks: [], axe: [] };
const ok = (name, detail = "") => report.checks.push({ name, result: "PASS", detail });

const lab = await startTossLab({ port: 0 });
const browser = await chromium.launch({
  channel:
    process.env.POC_BROWSER_CHANNEL ??
    (process.platform === "win32" ? "msedge" : "chrome"),
  headless: true,
});
report.browser = browser.version();

async function open(state, { width = 390, height = 844, fontScale = 1 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
    hasTouch: true,
    isMobile: true,
    locale: "ko-KR",
  });
  const page = await context.newPage();
  const foreign = [],
    errors = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(lab.url)) foreign.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript(() => {
    // Any real camera call is a failure of the lab's MOCK contract.
    window.__getUserMediaCalls = 0;
    if (navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = () => {
        window.__getUserMediaCalls++;
        return Promise.reject(new Error("LAB_MUST_NOT_OPEN_CAMERA"));
      };
  });
  await page.goto(`${lab.url}/toss-lab/#${state}`);
  if (fontScale !== 1)
    await page.addStyleTag({
      content: `html{font-size:${fontScale * 100}% !important}`,
    }).catch(async () => {
      // CSP blocks inline <style>; set through CSSOM instead.
      await page.evaluate(
        (s) => document.documentElement.style.setProperty("font-size", `${s * 100}%`),
        fontScale,
      );
    });
  await page.locator(`body[data-lab-state="${state}"]`).waitFor();
  return { context, page, foreign, errors };
}

async function shot(page, name, fullPage = false) {
  if (!fullPage)
    return page.screenshot({ path: path.join(output, name + ".png") });
  // Grow the viewport instead of Playwright fullPage stitching, so the fixed
  // bottom CTA is drawn where a user sees it: at the bottom of the screen.
  const before = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: before.width, height });
  await page.screenshot({ path: path.join(output, name + ".png") });
  await page.setViewportSize(before);
}

try {
  for (const state of STATES) {
    const { context, page, foreign, errors } = await open(state);
    await shot(page, `p19-${state}-390`);
    await shot(page, `p19-${state}-390-full`, true);
    // MOCK label always visible in the first screen.
    await assert.doesNotReject(() =>
      page.getByText("모의 데이터", { exact: true }).waitFor({ timeout: 2000 }),
    );
    // Exactly one primary action.
    assert.equal(
      await page.locator('.astryx-button[data-variant="primary"]').count(),
      1,
      state + " primary count",
    );
    // Primary CTA geometry: ≥56px tall, fully inside the viewport.
    const box = await page
      .locator('.tl-cta .astryx-button[data-variant="primary"]')
      .boundingBox();
    assert.ok(box.height >= 55.5, `${state} CTA height ${box.height}`);
    assert.ok(box.y + box.height <= 844, `${state} CTA visible`);
    // Every interactive target ≥ 44×44 CSS px.
    const small = await page.$$eval(
      "button, a[href], [role=button]",
      (els) =>
        els
          .filter((e) => e.offsetParent !== null || e.closest(".tl-cta"))
          .map((e) => {
            const r = e.getBoundingClientRect();
            return { t: e.textContent.trim().slice(0, 20), w: r.width, h: r.height };
          })
          .filter((r) => r.w < 44 || r.h < 44),
    );
    assert.deepEqual(small, [], state + " touch targets");
    // Computed primary colour is the CarScope action token, not Toss blue.
    const bg = await page
      .locator('.tl-cta .astryx-button[data-variant="primary"]')
      .evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.equal(bg, "rgb(28, 95, 212)", state + " primary colour");
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    report.axe.push({
      state,
      violations: axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    });
    assert.deepEqual(axe.violations.map((v) => v.id), [], state + " axe");
    assert.deepEqual(foreign, [], state + " no foreign requests");
    assert.deepEqual(errors, [], state + " no runtime errors");
    assert.equal(await page.evaluate(() => window.__getUserMediaCalls), 0);
    ok(`state ${state}`, "mock label, one primary, ≥56px CTA, ≥44px targets, colour, axe, no network/camera");
    await context.close();
  }

  // Interaction: idle → requesting (loading) → live → tap mark → clear → stop.
  {
    const { context, page, errors } = await open("idle");
    await page.getByRole("button", { name: "카메라 켜기" }).click();
    await page.locator('body[data-lab-state="requesting"]').waitFor();
    assert.equal(
      await page.locator('.tl-cta [data-variant="primary"]').getAttribute("aria-busy"),
      "true",
    );
    assert.equal(
      await page
        .locator('.tl-cta [data-variant="primary"]')
        .evaluate((e) => getComputedStyle(e).opacity),
      "1",
      "loading CTA keeps its fill",
    );
    await page.locator('body[data-lab-state="live"]').waitFor({ timeout: 4000 });
    const f = await page.locator(".tl-finder").boundingBox();
    await page.mouse.click(f.x + f.width * 0.64, f.y + f.height * 0.41);
    await page.locator('body[data-lab-state="marked"]').waitFor();
    const m = await page.locator(".tl-mark").boundingBox();
    assert.ok(Math.abs(m.x + m.width / 2 - (f.x + f.width * 0.64)) < 2, "marker x follows tap");
    assert.ok(Math.abs(m.y + m.height / 2 - (f.y + f.height * 0.41)) < 2, "marker y follows tap");
    await shot(page, "p19-flow-marked-by-tap");
    await page.getByRole("button", { name: "표시 지우기" }).click();
    await page.locator('body[data-lab-state="live"]').waitFor();
    assert.equal(await page.locator(".tl-mark").count(), 0);
    // Keyboard: Enter on the finder places a centre mark.
    await page.locator(".tl-finder-tap").focus();
    await page.keyboard.press("Enter");
    await page.locator('body[data-lab-state="marked"]').waitFor();
    await page.getByRole("button", { name: "위치 확인 후 관찰하기" }).click();
    await page.getByText("실험 화면이라 다음 단계로 넘어가지 않아요", { exact: false }).waitFor();
    await shot(page, "p19-flow-toast");
    await page.getByRole("button", { name: "카메라 끄기" }).click();
    await page.locator('body[data-lab-state="idle"]').waitFor();
    assert.deepEqual(errors, []);
    ok("flow", "start→loading→live→tap mark→clear→keyboard mark→toast→stop");
    await context.close();
  }

  // Narrow phone and 200% text: no horizontal overflow, CTA still reachable.
  for (const [width, scale, name] of [
    [320, 1, "p19-live-320"],
    [390, 1.3, "p19-live-390-text130"],
    [390, 2, "p19-denied-390-text200"],
  ]) {
    const state = name.includes("denied") ? "denied" : "live";
    const { context, page } = await open(state, { width, fontScale: scale });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 0, `${name} horizontal overflow ${overflow}`);
    const titlePx = await page
      .locator(".tl-title")
      .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    assert.ok(Math.abs(titlePx - 24 * scale) < 0.6, `${name} title scales (${titlePx})`);
    // No CTA label is cut by an ellipsis at any text size.
    const cut = await page.$$eval(".tl-cta .astryx-button", (els) =>
      els
        .flatMap((b) => [b, ...b.querySelectorAll("*")])
        .filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
        .map((e) => e.textContent.trim()),
    );
    assert.deepEqual(cut, [], name + " CTA labels truncated");
    await shot(page, name);
    await shot(page, name + "-full", true);
    ok(name, `no overflow, title ${titlePx}px`);
    await context.close();
  }
} finally {
  await browser.close();
  await lab.stop();
  report.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(output, "toss-lab-browser-report.json"),
    JSON.stringify(report, null, 2),
  );
}
console.log(
  report.checks.map((c) => `${c.result} ${c.name} — ${c.detail}`).join("\n"),
);
console.log(`Screenshots: ${output}`);

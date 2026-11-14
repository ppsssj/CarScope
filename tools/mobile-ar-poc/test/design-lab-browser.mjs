import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { startDesignLab } from "../design-lab-server.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { taskLinks } from "../public/inspection-tasks.mjs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
const output = process.env.POC_EVIDENCE_DIR;
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
  throw Error("Set external POC_EVIDENCE_DIR");
const dir = path.join(output, process.env.LAB_ITERATION ?? "lab-final");
await mkdir(dir, { recursive: true });
const lab = await startDesignLab({ port: 0 });
const browser = await chromium.launch(
  process.platform === "win32" ? { channel: "msedge" } : {},
);
const report = {
  type: "SYNTHETIC_DESIGN_LAB",
  url: lab.url,
  started: new Date().toISOString(),
  screens: [],
  checks: [],
  errors: [],
  accessibility: [],
  touch: [],
};
try {
  for (const [label, viewport] of [
    ["mobile", { width: 390, height: 844 }],
    ["small", { width: 320, height: 780 }],
    ["tablet", { width: 834, height: 1112 }],
  ]) {
    for (const concept of ["scope", "atlas", "logbook"]) {
      const context = await browser.newContext({
        viewport,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const requests = [];
      page.on("pageerror", (e) =>
        report.errors.push(`${concept}/${label}: ${e.message}`),
      );
      page.on("console", (m) => {
        if (m.type() === "error")
          report.errors.push(`${concept}/${label}: ${m.text()}`);
      });
      page.on("request", (r) => requests.push(r.url()));
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => {
          throw Error("Real camera must not be requested");
        };
        window.fetch = () => {
          throw Error("Lab must not fetch");
        };
      });
      await page.goto(
        `${lab.url}/design-lab/${concept}#synthetic-secret-must-be-discarded`,
      );
      await page.locator("h1").waitFor();
      assert.equal(new URL(page.url()).hash, "");
      const capture = async (stage) => {
        await page.evaluate(() => scrollTo(0, 0));
        await page.waitForTimeout(80);
        const file = `${concept}-${label}-${stage}.png`;
        await page.screenshot({ path: path.join(dir, file), fullPage: true });
        report.screens.push(file);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `${concept}/${label}/${stage} horizontal overflow`,
        );
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        report.accessibility.push({
          concept,
          viewport: label,
          stage,
          violations: axe.violations,
        });
        assert.equal(
          axe.violations.length,
          0,
          JSON.stringify(
            axe.violations.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => n.target),
            })),
          ),
        );
        const tiny = await page
          .locator("button,a,summary,select,input")
          .evaluateAll((nodes) =>
            nodes
              .filter((n) => {
                const r = n.getBoundingClientRect(),
                  s = getComputedStyle(n);
                return (
                  r.width > 0 &&
                  r.height > 0 &&
                  s.visibility !== "hidden" &&
                  r.height < 43 &&
                  n.getAttribute("type") !== "checkbox"
                );
              })
              .map((n) => ({
                tag: n.tagName,
                text: n.textContent?.slice(0, 50),
                height: n.getBoundingClientRect().height,
              })),
          );
        report.touch.push({ concept, viewport: label, stage, tiny });
        assert.equal(tiny.length, 0, JSON.stringify(tiny));
      };
      await capture("01-explore");
      // Every real task is selectable in each concept; no fake subset catalogue.
      if (concept === "logbook") {
        assert.equal(await page.locator(".plan-title").count(), 17);
        for (const task of taskLinks()) {
          await page
            .locator(".plan-title[data-task=" + JSON.stringify(task.id) + "]")
            .click();
        }
      } else {
        await page.locator(".task-index summary").click();
        assert.equal(await page.locator(".index-rows button").count(), 17);
        for (const task of taskLinks())
          await page
            .locator(
              ".index-rows button[data-task=" + JSON.stringify(task.id) + "]",
            )
            .click();
      }
      if (concept === "logbook")
        await page.locator(".plan-title").filter({ hasText: "워셔액" }).click();
      else
        await page
          .locator(".index-rows button")
          .filter({ hasText: "워셔액" })
          .click();
      if (concept === "atlas") {
        await page.getByLabel("구조 펼치기", { exact: true }).fill("60");
        await page.getByLabel("시점 돌리기", { exact: true }).fill("12");
        await page
          .getByRole("button", { name: "다음 부품", exact: true })
          .click();
        await page
          .getByRole("button", { name: "이전 부품", exact: true })
          .click();
      }
      await page
        .getByRole("button", {
          name:
            concept === "scope"
              ? "이 부품 점검 준비"
              : concept === "atlas"
                ? "이 부품을 알아보고 시작"
                : "선택한 점검 준비",
          exact: true,
        })
        .click();
      assert.equal(
        await page
          .getByRole("button", { name: "준비 완료 · 점검으로", exact: true })
          .isDisabled(),
        true,
      );
      await capture("02-prepare");
      await page
        .getByRole("checkbox", {
          name: "위 안전 조건을 모두 확인했습니다",
          exact: true,
        })
        .check();
      await page
        .getByRole("button", { name: "준비 완료 · 점검으로", exact: true })
        .click();
      await page
        .getByRole("button", { name: "모의 장면 켜기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "격자 켜기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "위치 직접 표시", exact: true })
        .click();
      await capture("03-camera");
      await page
        .getByRole("button", { name: "권한 거부 재현", exact: true })
        .click();
      await page
        .getByText("카메라 권한 거부를 재현했습니다.", { exact: false })
        .waitFor();
      await page
        .getByRole("button", { name: "모의 촬영", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("button", { name: "사용자 보고 확정", exact: true })
          .isDisabled(),
        true,
      );
      await page
        .getByLabel("모의 AI 시나리오", { exact: true })
        .selectOption("failure");
      await page
        .getByRole("checkbox", {
          name: "사진 분석 동의 절차를 모의 체험합니다",
          exact: true,
        })
        .check();
      await page
        .getByRole("button", { name: "모의 AI 분석", exact: true })
        .click();
      await page.getByRole("alert").waitFor();
      assert.equal(
        await page.locator(".report-answers [aria-pressed=true]").count(),
        0,
      );
      await page
        .getByLabel("모의 AI 시나리오", { exact: true })
        .selectOption("uncertain");
      await page
        .getByRole("checkbox", {
          name: "사진 분석 동의 절차를 모의 체험합니다",
          exact: true,
        })
        .check();
      await page
        .getByRole("button", { name: "모의 AI 분석", exact: true })
        .click();
      await page
        .getByText("이 장면만으로는 판단하기 어려워요.", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator(".report-answers [aria-pressed=true]").count(),
        0,
      );
      if (concept === "atlas")
        await page
          .getByRole("button", { name: "사진 밖의 것", exact: true })
          .click();
      await capture("04-analysis");
      for (const field of await page.locator(".human-report fieldset").all())
        await field
          .getByRole("button", { name: "확인 불가", exact: true })
          .click();
      await page
        .getByRole("checkbox", {
          name: "AI의 한계를 이해했고, 직접 본 응답을 확인합니다",
          exact: true,
        })
        .check();
      await page
        .getByRole("button", { name: "사용자 보고 확정", exact: true })
        .click();
      await page
        .getByRole("button", { name: "모의 전송 시작", exact: true })
        .click();
      await page
        .getByRole("button", { name: "네트워크 실패 재현", exact: true })
        .click();
      await page
        .getByRole("button", { name: "같은 모의 보고 재시도", exact: true })
        .click();
      await page
        .getByRole("button", { name: "모의 서버 접수 진행", exact: true })
        .click();
      await capture("05-server");
      await page
        .getByRole("button", { name: "모의 차량 수신 진행", exact: true })
        .click();
      await capture("06-vehicle");
      await page
        .getByRole("button", { name: "다른 점검 탐색", exact: true })
        .click();
      await page
        .getByRole("button", {
          name:
            concept === "scope"
              ? "이 부품 점검 준비"
              : concept === "atlas"
                ? "이 부품을 알아보고 시작"
                : "선택한 점검 준비",
          exact: true,
        })
        .click();
      await page
        .getByRole("checkbox", {
          name: "위 안전 조건을 모두 확인했습니다",
          exact: true,
        })
        .check();
      await page
        .getByRole("button", { name: "준비 완료 · 점검으로", exact: true })
        .click();
      await page
        .getByRole("button", { name: "수동으로 계속", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("button", { name: "모의 AI 분석", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page.evaluate(() => localStorage.length + sessionStorage.length),
        0,
      );
      assert.ok(requests.every((u) => u.startsWith(lab.url + "/")));
      assert.ok(
        requests.every((u) => !u.includes("/v1/") && !u.includes("/api/")),
      );
      await page.keyboard.press("Tab");
      assert.notEqual(
        await page.evaluate(() => document.activeElement?.tagName),
        "BODY",
      );
      report.checks.push(
        `${concept}/${label}: 17 tasks, safety, simulated camera, denied/manual recovery, AI failure/uncertain, direct report, duplicate-safe retry, separate receipts, no API/storage/media`,
      );
      await context.close();
    }
  }
  for (const denied of [
    "/design-lab/nope",
    "/src/design-lab/main.tsx",
    "/v1/sessions",
    "/react-assets/not-in-manifest.png",
  ])
    assert.equal((await fetch(lab.url + denied)).status, 404);
  assert.equal(
    (await fetch(lab.url + "/design-lab/?token=synthetic")).status,
    400,
  );
  const headers = (await fetch(lab.url + "/design-lab/")).headers;
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.match(headers.get("permissions-policy"), /camera=\(\)/);
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  report.result = "PASS";
} catch (e) {
  report.result = "FAIL";
  report.failure = e.stack;
  throw e;
} finally {
  await writeFile(
    path.join(dir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await lab.stop();
}
console.log(
  JSON.stringify({
    result: report.result,
    screens: report.screens.length,
    journeys: report.checks.length,
    evidence: dir,
  }),
);

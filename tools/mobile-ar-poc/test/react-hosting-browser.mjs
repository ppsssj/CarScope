// Checks Vite/HMR and the actual copied staging directory in a real browser.
// Staging is hosted over loopback HTTP here; deployed HTTPS is NOT_RUN.
import { createServer as createVite } from "vite";
import { chromium } from "playwright";
import { buildStaging, PUBLIC_FILES } from "../staging/build.mjs";
import { reactAssets } from "../react-build.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
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
const staging = path.join(output, "static-staging");
await mkdir(staging, { recursive: true });
await buildStaging({
  origin: "https://synthetic-staging.example/",
  outputDirectory: staging,
  revision: "SYNTHETIC_LOCAL_ONLY",
});
const allowed = new Set([
  ...PUBLIC_FILES,
  ...(await reactAssets()),
  "handoff.json",
  "qr.svg",
  "build-info.json",
]);
const headers = Object.fromEntries(
  JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ).headers[0].headers.map((h) => [h.key, h.value]),
);
const server = http.createServer(async (req, res) => {
  const name =
    new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  if (!allowed.has(name)) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const type = name.endsWith(".html")
      ? "text/html"
      : name.endsWith(".css")
        ? "text/css"
        : name.endsWith(".svg")
          ? "image/svg+xml"
          : name.endsWith(".js") || name.endsWith(".mjs")
            ? "text/javascript"
            : "application/json";
    res.writeHead(200, { ...headers, "Content-Type": type });
    res.end(await readFile(path.join(staging, name)));
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const vite = await createVite({ server: { port: 0, host: "127.0.0.1" } });
await vite.listen();
const browser = await chromium.launch({
  channel:
    process.env.POC_BROWSER_CHANNEL ??
    (process.platform === "win32" ? "msedge" : "chrome"),
  headless: true,
});
const checks = [],
  errors = [];
try {
  for (const [name, origin] of [
    ["VITE_DEV", `http://127.0.0.1:${vite.httpServer.address().port}`],
    ["STATIC_STAGING", `http://127.0.0.1:${server.address().port}`],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (e) => {
      if (e.type() === "error") errors.push(e.text());
    });
    await page.goto(origin + "/#v=1&task=washer-fluid");
    await page.waitForFunction(() => document.body.dataset.ready === "true");
    await page.locator(".cb-safety input").check();
    await page
      .getByRole("button", { name: "직접 점검 시작", exact: true })
      .click();
    for (const c of await page.locator(".cb-observation input").all())
      await c.check();
    for (const label of [
      "관찰 결과 선택하기",
      "보충이 필요해요",
      "선택한 결과 확인하기",
      "직접 확인한 결과로 확정",
    ])
      await page.getByRole("button", { name: label, exact: true }).click();
    await page.locator("body[data-step=done]").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "차량으로 결과 보내기", exact: true })
        .count(),
      0,
    );
    assert.ok(
      await page
        .locator(".cb-guide img")
        .first()
        .evaluate((i) => i.complete && i.naturalWidth > 0),
    );
    checks.push(
      `${name}: React load, local illustrations, full manual completion and no sync`,
    );
    await page.screenshot({
      path: path.join(output, `after-${name.toLowerCase()}.png`),
      fullPage: true,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        scope: "LOOPBACK_BUILD_HOSTING_ONLY",
        deployedHttps: "NOT_RUN",
        checks,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await writeFile(
    path.join(output, "hosting-browser-report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
  await vite.close();
  await new Promise((r) => server.close(r));
}

// Synthetic files, actual browser decoding, unchanged product CSP + nosniff.
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { readReactAsset } from "../react-build.mjs";
import { MOBILE_HEADERS } from "../../inspection-sync-poc/src/mobile-page.mjs";
import { createAssetFixture } from "./fixtures/react-assets.mjs";
const fixture = await createAssetFixture();
const html =
  '<!doctype html><html lang="en"><head><title>MIME decode fixture</title><link rel="icon" href="/react-assets/fixture.svg"><link rel="stylesheet" href="/react-assets/fixture.css"></head><body><img alt="SVG fixture" src="/react-assets/fixture.svg"><img alt="PNG fixture" src="/react-assets/fixture.png"><img alt="WebP fixture" src="/react-assets/fixture.webp"><span class="font-test">A</span><script type="module" src="/react-assets/fixture.js"></script></body></html>';
const server = http.createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, MOBILE_HEADERS);
    res.end();
    return;
  }
  if (req.url === "/") {
    res.writeHead(200, {
      ...MOBILE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
    });
    res.end(req.method === "HEAD" ? undefined : html);
    return;
  }
  const asset = await readReactAsset(req.url, fixture.root);
  res.writeHead(asset ? 200 : 404, {
    ...MOBILE_HEADERS,
    ...(asset ? { "Content-Type": asset.type } : {}),
  });
  res.end(req.method === "HEAD" ? undefined : asset?.body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  channel:
    process.env.POC_BROWSER_CHANNEL ??
    (process.platform === "win32" ? "msedge" : "chrome"),
  headless: true,
});
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  const response = await page.goto(
    `http://127.0.0.1:${server.address().port}/`,
  );
  assert.equal(response.headers()["x-content-type-options"], "nosniff");
  assert.equal(
    response.headers()["content-security-policy"],
    MOBILE_HEADERS["Content-Security-Policy"],
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.fixtureScript === "loaded",
  );
  const decoded = await page.evaluate(async () => {
    // Product CSP deliberately has no font-src. Fetch via the existing self-only
    // connect policy, then decode the bytes with FontFace; do not relax CSP to
    // turn on external CSS webfonts just for this test.
    const fontResponse=await fetch('/react-assets/fixture.woff2');
    if(fontResponse.headers.get('content-type')!=='font/woff2')throw Error('FONT_MIME');
    const face=await new FontFace('CarScopeFixture',await fontResponse.arrayBuffer()).load();
    document.fonts.add(face);
    const loaded = await document.fonts.load("16px CarScopeFixture", "A");
    return {
      images: [...document.images].map((i) => ({
        complete: i.complete,
        width: i.naturalWidth,
      })),
      css: getComputedStyle(document.body).getPropertyValue("--fixture-css"),
      fonts: loaded.map((f) => f.status),
    };
  });
  assert.deepEqual(
    decoded.images,
    Array(3).fill({ complete: true, width: 16 }),
  );
  assert.equal(decoded.css, "loaded");
  assert.deepEqual(decoded.fonts, ["loaded"]);
  assert.deepEqual(errors, []);
  const result = {
    scope: "SYNTHETIC_BROWSER_MIME_DECODE",
    status: "PASS",
    decoded,
    errors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (process.env.POC_EVIDENCE_DIR) {
    const out = path.resolve(process.env.POC_EVIDENCE_DIR);
    if (
      !path.isAbsolute(process.env.POC_EVIDENCE_DIR) ||
      out.includes(path.resolve("test"))
    )
      throw Error("External evidence path required");
    await mkdir(out, { recursive: true });
    await writeFile(
      path.join(out, "asset-browser-report.json"),
      JSON.stringify(result, null, 2),
    );
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}

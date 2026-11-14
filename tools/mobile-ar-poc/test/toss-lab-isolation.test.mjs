// P19 design lab must never reach the product: product bundle, mobile/sync
// hosts and copied staging exclude it, and the lab host refuses production.
// Requires `npm run build` (product) like the other build tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHandler } from "../server.mjs";
import { startMobileDevServer } from "../../inspection-sync-poc/src/mobile-dev-server.mjs";
import { reactAssets, readReactAsset } from "../react-build.mjs";
import { buildStaging } from "../staging/build.mjs";
import { assertLocalOnly } from "../toss-lab-server.mjs";

const LAB_MARKERS = /tl-finder|실험 도구 · 제품 화면 아님|모의 화면/;
const LAB_PATHS = ["/toss-lab/", "/toss-lab/camera", "/toss-lab.html", "/src/toss-lab/main.tsx", "/lab-icon.svg"];

test("product build, mobile/sync hosts and staging exclude the P19 lab", async () => {
  const assets = await reactAssets();
  assert.ok(assets.size > 0);
  for (const name of assets) {
    assert.ok(!name.startsWith("lab-assets/"), name);
    const a = await readReactAsset("/" + name);
    assert.doesNotMatch(a.body.toString(), LAB_MARKERS, name);
  }
  const server = http.createServer(createHandler());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const sync = await startMobileDevServer();
  try {
    for (const origin of [`http://127.0.0.1:${server.address().port}`, sync.baseURL ?? sync.url]) {
      assert.ok(origin);
      for (const p of LAB_PATHS) {
        const res = await fetch(origin + p);
        assert.equal(res.status, 404, origin + p);
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
    await sync.stop();
  }
  const out = await mkdtemp(path.join(os.tmpdir(), "carscope-p19-staging-"));
  try {
    await buildStaging({ origin: "https://synthetic-staging.example/", outputDirectory: out });
    const files = await readdir(out, { recursive: true });
    assert.ok(files.every((f) => !/toss-lab|lab-assets/.test(f)));
    for (const f of files.filter((f) => f.endsWith(".js") || f.endsWith(".html")))
      assert.doesNotMatch(await readFile(path.join(out, f), "utf8"), LAB_MARKERS, f);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("lab host refuses production-like environments", () => {
  for (const env of [{ NODE_ENV: "production" }, { RENDER: "true" }, { VERCEL: "1" }])
    assert.throws(() => assertLocalOnly(env), /TOSS_LAB_LOCAL_ONLY/);
  assert.doesNotThrow(() => assertLocalOnly({}));
});

test("product sources never import the lab", async () => {
  for (const f of ["App.tsx", "main.tsx", "Camera.tsx", "Guide.tsx", "InfoApp.tsx", "PhotoAnalysis.tsx"])
    assert.doesNotMatch(await readFile(new URL(`../src/${f}`, import.meta.url), "utf8"), /toss-lab/, f);
  const cfg = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.doesNotMatch(cfg, /toss-lab/);
});

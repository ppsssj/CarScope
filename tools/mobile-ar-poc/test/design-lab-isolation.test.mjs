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
import { startDesignLab } from "../design-lab-server.mjs";
test("product build, mobile/sync hosts and staging exclude design lab", async () => {
  const assets = await reactAssets();
  assert.ok(assets.size > 0);
  for (const name of assets) {
    const a = await readReactAsset("/" + name);
    if (name.endsWith(".js"))
      assert.doesNotMatch(
        a.body.toString(),
        /FIELD INSTRUMENT|PRODUCT EXPLORATION 018|모의 구도 조절/,
      );
  }
  const server = http.createServer(createHandler());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const sync = await startMobileDevServer();
  try {
    for (const origin of [
      `http://127.0.0.1:${server.address().port}`,
      sync.baseURL ?? sync.url,
    ]) {
      assert.ok(origin, "sync base URL is available");
      for (const p of [
        "/design-lab/",
        "/design-lab/scope",
        "/design-lab.html",
        "/src/design-lab/main.tsx",
        "/lab-icon.svg",
      ]) {
        const res = await fetch(origin + p);
        assert.equal(res.status, 404, origin + p);
        assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
    await sync.stop();
  }
  const out = await mkdtemp(path.join(os.tmpdir(), "carscope-p18-staging-"));
  try {
    await buildStaging({
      origin: "https://synthetic-staging.example/",
      outputDirectory: out,
    });
    const files = await readdir(out, { recursive: true });
    assert.ok(files.every((f) => !f.includes("design-lab")));
    for (const f of files.filter(
      (f) => f.endsWith(".js") || f.endsWith(".html"),
    ))
      assert.doesNotMatch(
        await readFile(path.join(out, f), "utf8"),
        /PRODUCT EXPLORATION 018|FIELD INSTRUMENT/,
      );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
test("design lab refuses production environments without starting a listener", async () => {
  const before = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    await assert.rejects(
      () => startDesignLab({ port: 0 }),
      /DESIGN_LAB_LOCAL_ONLY/,
    );
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
});

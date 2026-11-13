import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reactAssets, readReactAsset, readReactPage } from "../react-build.mjs";
import { buildStaging } from "../staging/build.mjs";
import { createHandler } from "../server.mjs";
import { startMobileDevServer } from "../../inspection-sync-poc/src/mobile-dev-server.mjs";
test("every manifest chunk has the right MIME and bytes on both hosts; traversal and unlisted bundles stay denied", async (t) => {
  const local = http.createServer(createHandler());
  await new Promise((r) => local.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => local.close(r)));
  const sync = await startMobileDevServer();
  t.after(() => sync.stop());
  const origins = [`http://127.0.0.1:${local.address().port}`, sync.url];
  const assets = await reactAssets();
  assert.ok(assets.size >= 3);
  for (const origin of origins) {
    const home = await fetch(origin);
    const csp = home.headers.get("content-security-policy");
    assert.match(csp, /script-src 'self'; style-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/);
    for (const file of assets) {
      const r = await fetch(origin + "/" + file);
      assert.equal(r.status, 200, file);
      assert.match(
        r.headers.get("content-type"),
        file.endsWith(".css") ? /^text\/css/ : /^text\/javascript/,
      );
      assert.equal(r.headers.get("content-security-policy"), csp);
      assert.deepEqual(
        Buffer.from(await r.arrayBuffer()),
        (await readReactAsset("/" + file)).body,
      );
    }
    for (const file of [
      "/react-assets/not-in-manifest.js",
      "/react-assets/%2e%2e/package.json",
      "/react-assets/manifest.json",
      "/.vite/manifest.json",
      "/src/main.tsx",
    ])
      assert.equal((await fetch(origin + file)).status, 404, file);
    const info = await fetch(origin + "/part-info.html");
    assert.match(await info.text(), /id="root"/);
  }
  assert.doesNotMatch(await readReactPage(), /data-sync-host/);
  assert.match(await readReactPage({ sync: true }), /data-sync-host="enabled"/);
});
test("staging uses the same React page and copies all dynamic chunks without an external CDN", async () => {
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "carscope-react-staging-"),
  );
  await buildStaging({
    origin: "https://staging.example/",
    outputDirectory,
    revision: "SYNTHETIC_LOCAL",
  });
  const html = await readFile(path.join(outputDirectory, "index.html"), "utf8");
  assert.equal(html, await readReactPage());
  assert.doesNotMatch(html, /https?:\/\/|data-sync-host/);
  assert.equal(
    await readFile(path.join(outputDirectory, "part-info.html"), "utf8"),
    html,
  );
  for (const file of await reactAssets())
    assert.deepEqual(
      await readFile(path.join(outputDirectory, file)),
      (await readReactAsset("/" + file)).body,
    );
});

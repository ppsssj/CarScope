import test from "node:test";
import assert from "node:assert/strict";
import { readReactAsset, reactAssets } from "../react-build.mjs";
import { createAssetFixture } from "./fixtures/react-assets.mjs";
import { writeFile } from "node:fs/promises";
const expected = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  woff2: "font/woff2",
};
test("all six allowed extensions retain exact bytes and media types, including currently unused binary types", async () => {
  const fixture = await createAssetFixture();
  assert.equal((await reactAssets(fixture.root)).size, 6);
  for (const [extension, type] of Object.entries(expected)) {
    const asset = await readReactAsset(
      `/react-assets/fixture.${extension}`,
      fixture.root,
    );
    assert.equal(asset.type, type, extension);
    assert.deepEqual(asset.body, fixture.files[extension]);
  }
  for (const request of [
    "/react-assets/unlisted.png",
    "/react-assets/../fixture.svg",
    "/react-assets/%2e%2e/fixture.woff2",
    "/react-assets/fixture.woff2?x=1",
    "/package.json",
  ])
    assert.equal(await readReactAsset(request, fixture.root), null, request);
});
test("a malicious or unsupported manifest entry is refused, never used to infer a filesystem path", async () => {
  const fixture = await createAssetFixture();
  for (const file of [
    "../secret.png",
    "react-assets/../secret.png",
    "react-assets/fixture.html",
    "react-assets/nested/fixture.png",
  ]) {
    await writeFile(
      new URL(".vite/manifest.json", fixture.root),
      JSON.stringify({ bad: { file } }),
    );
    await assert.rejects(reactAssets(fixture.root), /INVALID_REACT_MANIFEST/);
  }
});

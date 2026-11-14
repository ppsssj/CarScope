// P21 deployment readiness: the Vision experiment entry (render-vision-experiment.mjs) serves its page through
// serveMobilePage with tls, detection and analysis on. This checks, without PostgreSQL or any provider, that a
// built React bundle is what that entry serves, with the host markers the camera AI reads, and that the bundle
// carries the P21 flow. Requires `npm run build` like the other build tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serveMobilePage } from "../../inspection-sync-poc/src/mobile-page.mjs";

function fakeRes() {
  return { status: 0, headers: {}, body: null,
    writeHead(s, h) { this.status = s; this.headers = h; },
    end(b) { this.body = b === undefined ? null : Buffer.from(b); } };
}
async function get(url, options) {
  const res = fakeRes();
  await serveMobilePage({ method: "GET", url }, res, options);
  return res;
}

test("the Vision entry's page is the React bundle with detection and analysis markers and the P21 camera flow", async () => {
  const vision = { tls: true, partDetection: true, partAnalysis: "openai", partAnalysisDraft: false };
  const page = await get("/", vision);
  assert.equal(page.status, 200);
  const html = page.body.toString();
  assert.match(html, /data-part-detection="enabled"/);
  assert.match(html, /data-part-analysis="enabled" data-part-analysis-service="openai"/);
  assert.doesNotMatch(html, /data-part-analysis-draft/, "DRAFT profiles stay off unless separately approved");
  assert.match(page.headers["Content-Security-Policy"], /connect-src 'self'/);
  assert.match(page.headers["Permissions-Policy"], /camera=\(self\)/);
  assert.match(page.headers["Strict-Transport-Security"], /max-age/);
  const scripts = [...html.matchAll(/src="\/(react-assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  assert.ok(scripts.length, "a built React entry script is referenced");
  let bundle = "";
  for (const s of scripts) {
    const asset = await get("/" + s, vision);
    assert.equal(asset.status, 200, s);
    bundle += asset.body.toString();
  }
  for (const marker of ["AI로 부품 찾기", "이 부품이 맞아요", "이 영역이 맞아요", "external-vision-v1", "external-ai-v1"])
    assert.ok(bundle.includes(marker), "bundle carries " + marker);
});

test("a host without AI serves the same bundle with no AI markers (the main service's case)", async () => {
  const html = (await get("/", { tls: true })).body.toString();
  assert.doesNotMatch(html, /data-part-detection|data-part-analysis/);
});

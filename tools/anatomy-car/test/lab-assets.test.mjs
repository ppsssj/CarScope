import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareLabHtml } from "../../three-poc/lab-assets.mjs";

test("Lab import-map CSP is identical for LF and Windows CRLF input", () => {
  const source = '<script type="importmap">\n{"imports":{"three":"./three.js"}}\n</script>\n';
  const lf = prepareLabHtml(source), crlf = prepareLabHtml(source.replace(/\n/g, "\r\n"));
  assert.deepEqual(crlf, lf);
  const script = '\n{"imports":{"three":"./three.js"}}\n';
  assert.ok(lf.csp.includes(createHash("sha256").update(script).digest("base64")));
  assert.ok(!lf.csp.includes("'unsafe-eval'"));
});
test("Lab refuses a missing or duplicate import map", () => {
  assert.throws(() => prepareLabHtml("<html></html>"), /exactly one/);
  const map = '<script type="importmap">{}</script>';
  assert.throws(() => prepareLabHtml(map + map), /exactly one/);
});

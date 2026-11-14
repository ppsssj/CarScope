import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
const source = new URL("../src/design-lab/model.ts", import.meta.url);
const js = stripTypeScriptTypes(await readFile(source, "utf8")).replace(
  /(['"])(\.\.\/\.\.\/public\/[^'"]+)\1/g,
  (_, q, p) => JSON.stringify(new URL(p, source).href),
);
const { reduce, initial, tasks, canConfirm } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
const events = (s, ...ev) =>
  ev.reduce(
    (a, type) => reduce(a, typeof type === "string" ? { type } : type),
    s,
  );
const analysis = () =>
  events(initial, "PREPARE", { type: "SAFETY", value: true }, "START", {
    type: "CAPTURE",
    value: true,
  });
test("lab preserves all 17 real task labels, safety and observation checks", () => {
  assert.equal(tasks.length, 17);
  assert.equal(new Set(tasks.map((t) => t.id)).size, 17);
  for (const task of tasks) {
    assert.ok(task.safety.every(Boolean));
    assert.equal(task.checks.length, 3);
    assert.ok(task.checks.every(Boolean));
  }
});
test("lab cannot bypass preparation, direct confirmation or separate receipts", () => {
  assert.equal(reduce(initial, { type: "START" }), initial);
  assert.equal(reduce(initial, { type: "SEND" }), initial);
  let s = analysis();
  assert.equal(reduce(s, { type: "CONFIRM" }), s);
  assert.equal(reduce(s, { type: "ANALYZE" }), s);
  s = events(s, { type: "CONSENT", value: true }, "ANALYZE", "AI_DONE");
  assert.equal(s.ai, "result");
  assert.deepEqual(s.answers, {});
  assert.equal(s.confirmed, false);
  s = events(
    s,
    ...[0, 1, 2].map((i) => ({
      type: "ANSWER",
      id: String(i),
      value: "UNABLE",
    })),
    { type: "ACK", value: true },
  );
  assert.equal(canConfirm(s), true);
  s = events(s, "CONFIRM");
  assert.equal(s.delivery, "idle");
  assert.equal(reduce(s, { type: "VEHICLE" }), s);
  s = events(s, "SEND");
  assert.equal(reduce(s, { type: "SEND" }), s);
  s = events(s, "SERVER");
  assert.equal(s.delivery, "server");
  s = events(s, "VEHICLE");
  assert.equal(s.delivery, "vehicle");
});
test("lab manual recovery, failed AI and retry never fabricate success", () => {
  let s = events(
    initial,
    "PREPARE",
    { type: "SAFETY", value: true },
    "START",
    { type: "CAMERA", value: "denied" },
    { type: "CAPTURE", value: false },
  );
  assert.equal(s.camera, "off");
  assert.equal(s.captured, false);
  assert.equal(
    events(s, { type: "CONSENT", value: true }, "ANALYZE").ai,
    "idle",
  );
  s = events(
    analysis(),
    { type: "SCENARIO", value: "failure" },
    { type: "CONSENT", value: true },
    "ANALYZE",
    "AI_DONE",
  );
  assert.equal(s.ai, "failed");
  assert.equal(s.confirmed, false);
  assert.deepEqual(s.answers, {});
  s = events(
    s,
    ...[0, 1, 2].map((i) => ({
      type: "ANSWER",
      id: String(i),
      value: "UNABLE",
    })),
    { type: "ACK", value: true },
    "CONFIRM",
    "SEND",
    "NETWORK_FAIL",
  );
  assert.equal(s.delivery, "failed");
  s = events(s, "SEND");
  assert.equal(s.delivery, "sending");
  assert.equal(s.events.length, 2);
  assert.equal(reduce(s, { type: "SELECT", id: "invalid" }), s);
  s = reduce(s, { type: "SELECT", id: "brake-fluid" });
  assert.equal(s.confirmed, false);
  assert.equal(s.safe, false);
  assert.deepEqual(s.answers, {});
});

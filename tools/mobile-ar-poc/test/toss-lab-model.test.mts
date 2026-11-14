// P19 design lab: pure model guards. Run with
//   npm run test:toss-lab:model   (node --experimental-strip-types)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAMERA_STATES,
  COPY,
  INITIAL,
  MOCK,
  MOCK_MARK,
  STATUS,
  primaryAction,
  reduce,
  stateFromHash,
} from "../src/toss-lab/model.ts";

test("permission flow: idle → requesting → live | denied, denied can retry", () => {
  let s = reduce(INITIAL, { type: "START" });
  assert.equal(s.camera, "requesting");
  assert.equal(reduce(s, { type: "GRANTED" }).camera, "live");
  const denied = reduce(s, { type: "DENIED" });
  assert.equal(denied.camera, "denied");
  assert.equal(reduce(denied, { type: "START" }).camera, "requesting");
  // GRANTED/DENIED outside a request are ignored.
  assert.equal(reduce(INITIAL, { type: "GRANTED" }), INITIAL);
  assert.equal(reduce(INITIAL, { type: "DENIED" }), INITIAL);
});

test("a marker exists only on a live picture and only inside it", () => {
  for (const camera of ["idle", "requesting", "denied", "unsupported"] as const)
    assert.equal(
      reduce({ camera, mark: null }, { type: "MARK", point: { x: 0.5, y: 0.5 } })
        .mark,
      null,
      camera,
    );
  const live = { camera: "live" as const, mark: null };
  const marked = reduce(live, { type: "MARK", point: { x: 0.2, y: 0.8 } });
  assert.deepEqual(marked, { camera: "marked", mark: { x: 0.2, y: 0.8 } });
  for (const point of [
    { x: -0.01, y: 0.5 },
    { x: 0.5, y: 1.01 },
    { x: Number.NaN, y: 0.5 },
  ])
    assert.equal(reduce(live, { type: "MARK", point }), live);
  assert.deepEqual(reduce(marked, { type: "CLEAR_MARK" }), live);
  assert.deepEqual(reduce(marked, { type: "STOP" }), INITIAL);
});

test("hash jumps are allow-listed; marked opens with the mock marker", () => {
  assert.equal(stateFromHash("#live"), "live");
  assert.equal(stateFromHash("#__proto__"), "idle");
  assert.equal(stateFromHash(""), "idle");
  assert.deepEqual(reduce(INITIAL, { type: "JUMP", state: "marked" }).mark, MOCK_MARK);
  assert.equal(reduce(INITIAL, { type: "JUMP", state: "live" }).mark, null);
});

test("every state has copy, status and exactly one primary action", () => {
  for (const s of CAMERA_STATES) {
    assert.ok(COPY[s].title && COPY[s].body && STATUS[s], s);
    const p = primaryAction(s);
    assert.ok(p.label.length > 0, s);
    assert.equal(p.loading, s === "requesting");
  }
  // Blocked camera never offers a camera action as primary.
  assert.equal(primaryAction("denied").intent, "manual");
  assert.equal(primaryAction("unsupported").intent, "manual");
});

test("copy uses 해요체 and avoids 취소/됩니다 phrasing", () => {
  const all = CAMERA_STATES.flatMap((s) => [COPY[s].title, COPY[s].body, STATUS[s]]);
  for (const line of all) {
    assert.doesNotMatch(line, /취소|됩니다|습니다|하십시오/, line);
    assert.match(line, /요[.]?$|요\.$|[요]$/, line);
  }
});

test("mock data is labelled MOCK and the candidate never claims identification", () => {
  assert.equal(MOCK.source, "MOCK");
  assert.match(STATUS.live, /정확하지 않아요/);
  assert.match(STATUS.marked, /자동 인식 결과가 아니에요/);
  const c = MOCK.candidate;
  assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.width <= 1 && c.y + c.height <= 1);
  assert.ok(
    MOCK_MARK.x >= c.x && MOCK_MARK.x <= c.x + c.width &&
      MOCK_MARK.y >= c.y && MOCK_MARK.y <= c.y + c.height,
    "mock marker sits on the drawn cap",
  );
});

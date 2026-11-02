import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition, STATES as S, EVENTS as E, hoodTarget, cameraGoal, areaOf } from '../inspection-flow.mjs';
import { buildEvBatteryPack, EV_BATTERY_ID } from '../../ioniq5-asset/ev-battery.mjs';
import { componentStatus, componentStatusHtml } from '../component-status.mjs';
import { componentFixture } from './component-status-fixture.mjs';

const event = (type, id) => ({ type, id });
const start = () => transition(initialState(), event(E.START));
const select = () => transition(start(), event(E.SELECT_AREA, 'ev-battery'));
test('EV uses merged pack identity with no hood opening, duplicate or late callback transition', () => {
  const st = select(), model = buildEvBatteryPack();
  assert.equal(st.name, S.EV_BATTERY_PREVIEW); assert.equal(st.component, EV_BATTERY_ID);
  assert.equal(model.parts[0].meta.inspectionTarget, st.component);
  assert.equal(areaOf(st).components[0].id, EV_BATTERY_ID);
  assert.equal(hoodTarget(st), 0); assert.equal(cameraGoal(st), EV_BATTERY_ID);
  for (const e of [event(E.SELECT_AREA, 'ev-battery'), event(E.SELECT_COMPONENT, 'battery-12v'), event(E.HOOD_OPENED), event(E.HOOD_CLOSED), event(E.REQUEST_HANDOFF)]) assert.equal(transition(st, e), st);
});
test('EV Back, summary, exit and re-entry share the product lifecycle without a hood close race', () => {
  assert.deepEqual(transition(select(), event(E.BACK)), start());
  assert.deepEqual(transition(select(), event(E.EXIT)), initialState());
  const summary = transition(select(), event(E.SHOW_SUMMARY));
  assert.equal(summary.name, S.INSPECTION_SUMMARY); assert.equal(summary.area, null); assert.equal(summary.component, null);
  assert.equal(transition(summary, event(E.SELECT_AREA, 'ev-battery')).name, S.EV_BATTERY_PREVIEW);
  const opening = transition(start(), event(E.SELECT_AREA, 'hood'));
  assert.equal(transition(opening, event(E.SELECT_AREA, 'ev-battery')), opening);
});
test('EV panel projects only the two raw SDK reports, independent of geometry and USER_REPORTED', () => {
  componentStatus.invalidate(); componentStatus.accept(componentFixture());
  const html = componentStatusHtml(EV_BATTERY_ID);
  assert.match(html, /ev-battery.soc/); assert.match(html, /ev-battery.charge-switch/);
  assert.match(html, /단위\/범위 미검증/); assert.match(html, /충전 진행 여부 아님/);
  assert.match(html, /USER_REPORTED/); assert.match(html, /형상 정확도/);
  assert.doesNotMatch(html, /safety\.washer|safety\.brake|battery-12v|%/);
  componentStatus.invalidate(); assert.equal(componentStatus.forPart(EV_BATTERY_ID).every(r => r.value === null && r.source === null), true);
});

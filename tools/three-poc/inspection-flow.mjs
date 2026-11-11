// P3-A4: vehicle inspection flow as a pure state machine. No DOM or three.js here, so the same
// transitions run in the page and under node --test. The page reacts to the state it enters
// (hood target angle, camera goal, highlight, panel) and reports animation ends back as events,
// so a cancelled or repeated input can never leave the hood and the UI in different states.

import { TIRES } from './inspection-tires.mjs';
import { WIPER_PARTS, LIGHT_PARTS } from './visibility-parts.mjs';
import {targetForPart} from './mobile-result-contract.mjs';
import {isRecordId} from './inspection-history-contract.mjs';
import {partListItem,partsInArea} from './inspection-parts.mjs';

export const STATES = Object.freeze({
  IDLE: 'IDLE',
  INSPECTION_OVERVIEW: 'INSPECTION_OVERVIEW',
  INSPECTION_SUMMARY: 'INSPECTION_SUMMARY',
  HOOD_OPENING: 'HOOD_OPENING',
  HOOD_CLOSING: 'HOOD_CLOSING',
  COMPONENT_SELECTION: 'COMPONENT_SELECTION',
  WASHER_SELECTED: 'WASHER_SELECTED',
  COMPONENT_PREVIEW: 'COMPONENT_PREVIEW',
  MOBILE_HANDOFF_READY: 'MOBILE_HANDOFF_READY',
  TIRE_SELECTION: 'TIRE_SELECTION', TIRE_PREVIEW: 'TIRE_PREVIEW', TIRE_SUMMARY: 'TIRE_SUMMARY',
  EV_BATTERY_PREVIEW: 'EV_BATTERY_PREVIEW',
  CHARGE_PORT_PREVIEW: 'CHARGE_PORT_PREVIEW',
  VISIBILITY_PREVIEW: 'VISIBILITY_PREVIEW',
  PART_RESULT: 'PART_RESULT',
  HISTORY_LIST: 'HISTORY_LIST', HISTORY_DETAIL: 'HISTORY_DETAIL',
});

export const EVENTS = Object.freeze({
  SHOW_SUMMARY: 'SHOW_SUMMARY', SHOW_TIRE_SUMMARY: 'SHOW_TIRE_SUMMARY', START: 'START', SELECT_AREA: 'SELECT_AREA', HOOD_OPENED: 'HOOD_OPENED', HOOD_CLOSED: 'HOOD_CLOSED',
  SELECT_COMPONENT: 'SELECT_COMPONENT', SELECT_TIRE: 'SELECT_TIRE', REQUEST_HANDOFF: 'REQUEST_HANDOFF', BACK: 'BACK', EXIT: 'EXIT',
  SELECT_CHARGE_PART: 'SELECT_CHARGE_PART',
  SELECT_VISIBILITY_PART: 'SELECT_VISIBILITY_PART',
  OPEN_RESULT: 'OPEN_RESULT',
  OPEN_HISTORY: 'OPEN_HISTORY', OPEN_HISTORY_DETAIL: 'OPEN_HISTORY_DETAIL',
});

// Geometry navigation keeps its existing availability policy. Planned entries may open a
// separate result detail without claiming geometry. IDs match SERVICE_EVIDENCE/visibility parts.
export const INSPECTION_AREAS = Object.freeze([
  {
    id: 'hood', label: '보닛 · 전방 수납부', status: 'available',
    components: partsInArea('hood').map(partListItem),
  },
  { id: 'tires', label: '타이어 · 네 바퀴', status: 'available', components: TIRES },
  { id: 'ev-battery', label: 'EV 배터리 · 하부 보기', status: 'available', components: partsInArea('ev-battery').map(partListItem) },
  { id: 'ev-charge', label: 'EV 충전구', status: 'available', components: partsInArea('ev-charge').map(partListItem) },
  { id: 'wipers', label: '전면 와이퍼', status: 'available', components: partsInArea('wipers').map(partListItem) },
  { id: 'lights', label: '전조등', status: 'available', components: partsInArea('lights').map(partListItem) },
]);

export const HOOD_OPEN_DEG = 60; // axis A: P3-A1 simulation found no new mesh interference over 0–60°

const S = STATES, E = EVENTS;
const available = (list, id) => list.find((x) => x.id === id && x.status === 'available');

export const initialState = () => ({ name: S.IDLE, area: null, component: null, afterClose: null });
export const isHistoryState = (state) => state.name === S.HISTORY_LIST || state.name === S.HISTORY_DETAIL;

// P10 PR #2: the part result and the whole summary are opened from many screens, so Back returns to the screen they
// were opened from (`back`), not to a fixed parent. Opening and closing animations are not screens: they return to the
// overview. The chain is capped so moving between the summary and results many times cannot grow without bound.
export const BACK_DEPTH = 4;
const overviewScreen = () => ({ name: S.INSPECTION_OVERVIEW, area: null, component: null, afterClose: null });
export function returnPoint(state, depth = 1) {
  if (state.name === S.HOOD_CLOSING && state.resume) return returnPoint(state.resume, depth);
  if ([S.IDLE, S.HOOD_OPENING, S.HOOD_CLOSING].includes(state.name) || isHistoryState(state)) return overviewScreen();
  const { back, resume, ...screen } = state;
  return back && depth < BACK_DEPTH ? { ...screen, back: returnPoint(back, depth + 1) } : screen;
}
/** Back from a screen that remembers where it was opened. The hood closes first when the target has it closed. */
function goBack(state) {
  const target = state.back ?? overviewScreen();
  if (hoodTarget(state) > 0 && hoodTarget(target) === 0) return { name: S.HOOD_CLOSING, area: state.area, component: null, afterClose: target.name, resume: target };
  return target;
}

// Past records are a read-only overlay: area/component (and so hood and camera) stay as they were,
// and leaving restores the exact screen. Nothing here touches the session or its selections.
function historyTransition(state, event) {
  const base = { area: state.area, component: state.component, afterClose: null };
  const closeHood = (afterClose) => ({ ...base, name: S.HOOD_CLOSING, component: null, afterClose });
  const hoodOpen = hoodTarget(state) > 0;
  switch (event.type) {
    case E.OPEN_HISTORY_DETAIL:
      return state.name === S.HISTORY_LIST && isRecordId(event.recordId) ? { ...state, name: S.HISTORY_DETAIL, recordId: event.recordId } : state;
    case E.BACK:
      if (state.name === S.HISTORY_DETAIL) return { ...state, name: S.HISTORY_LIST, recordId: null };
      return { ...base, name: state.historyReturn, ...(state.back ? { back: state.back } : {}) };
    case E.OPEN_RESULT: {
      const target = targetForPart(event.id);
      return target ? { name: S.PART_RESULT, component: target.partId, area: target.area, afterClose: null } : state;
    }
    case E.SHOW_SUMMARY:
      return hoodOpen ? closeHood(S.INSPECTION_SUMMARY) : { name: S.INSPECTION_SUMMARY, area: null, component: null, afterClose: null };
    case E.EXIT:
      return hoodOpen ? closeHood(S.IDLE) : initialState();
    default:
      return state;
  }
}

/**
 * Next state for `event`, or the same object when the event does not apply (duplicate clicks,
 * late animation callbacks, unavailable parts). `ctx.handoffConfigured` gates the QR step.
 */
export function transition(state, event, ctx = {}) {
  const { type } = event;
  // `back` and `resume` belong to one screen only; every other move starts without them.
  const to = (name, patch = {}) => { const { back, resume, ...rest } = state; return { ...rest, name, ...patch }; };
  const close = (afterClose, resume) => to(S.HOOD_CLOSING, { component: null, afterClose, ...(resume ? { resume } : {}) });
  const select = () => {
    const c = areaOf(state).components.find(c => c.id === event.id && ['available', 'preview'].includes(c.status));
    if (!c || c.id === state.component) return state;
    return to(c.status === 'preview' ? S.COMPONENT_PREVIEW : S.WASHER_SELECTED, { component: c.id });
  };
  const selectTire = () => TIRES.some(t => t.id === event.id) && state.component !== event.id
    ? to(S.TIRE_PREVIEW, { area: 'tires', component: event.id }) : state;
  if (isHistoryState(state)) return historyTransition(state, event);
  // History keeps the screen's `back`, so returning from History still knows where that screen came from.
  if (type === E.OPEN_HISTORY) return [S.INSPECTION_OVERVIEW, S.INSPECTION_SUMMARY, S.PART_RESULT].includes(state.name)
    ? { ...to(S.HISTORY_LIST, { historyReturn: state.name, recordId: null }), ...(state.back ? { back: state.back } : {}) } : state;
  if(type===E.OPEN_RESULT&&![S.IDLE,S.HOOD_CLOSING].includes(state.name)){
    const target=targetForPart(event.id);if(!target)return state;
    if(state.name===S.PART_RESULT&&state.component===target.partId)return state;
    // Moving between results replaces the result screen, so Back still leads to where results were first opened.
    return {name:S.PART_RESULT,area:target.area,component:target.partId,afterClose:null,back:state.name===S.PART_RESULT?state.back:returnPoint(state)};
  }
  if (type === E.SHOW_SUMMARY && state.name !== S.IDLE) {
    if (state.name === S.INSPECTION_SUMMARY || (state.name === S.HOOD_CLOSING && [S.IDLE, S.INSPECTION_SUMMARY].includes(state.afterClose))) return state;
    const summary = { name: S.INSPECTION_SUMMARY, area: null, component: null, afterClose: null, back: returnPoint(state) };
    return hoodTarget(state) > 0 || state.name === S.HOOD_CLOSING ? close(S.INSPECTION_SUMMARY, summary) : summary;
  }
  switch (state.name) {
    case S.PART_RESULT:
      if(type===E.SELECT_TIRE&&state.area==='tires'&&TIRES.some(t=>t.id===event.id))return to(S.TIRE_PREVIEW,{component:event.id});
      if(type===E.EXIT)return state.area==='hood'?close(S.IDLE):initialState();
      if(type===E.BACK)return goBack(state);
      return state;
    case S.IDLE:
      return type === E.START ? to(S.INSPECTION_OVERVIEW) : state;
    case S.INSPECTION_OVERVIEW:
    case S.INSPECTION_SUMMARY:
      if (type === E.SELECT_TIRE) return selectTire();
      if (type === E.SELECT_AREA && event.id === 'tires') return to(S.TIRE_SELECTION, { area: 'tires' });
      if (type === E.SELECT_AREA && event.id === 'ev-battery') return to(S.EV_BATTERY_PREVIEW, { area: 'ev-battery', component: 'ev-battery.pack' });
      if (type === E.SELECT_AREA && event.id === 'ev-charge') return ctx.chargePortAvailable === true ? to(S.CHARGE_PORT_PREVIEW, { area: 'ev-charge', component: ['ev-charge.port', 'ev-charge.flap'].includes(event.partId) ? event.partId : 'ev-charge.flap' }) : state;
      if (type === E.SELECT_AREA && ['wipers','lights'].includes(event.id)) {
        const ids=event.id==='wipers'?WIPER_PARTS:LIGHT_PARTS.map(p=>p.id);
        return ctx[event.id+'Available']===true?to(S.VISIBILITY_PREVIEW,{area:event.id,component:ids.includes(event.partId)?event.partId:ids[0]}):state;
      }
      if (type === E.SELECT_AREA && available(INSPECTION_AREAS, event.id)) return to(S.HOOD_OPENING, { area: event.id });
      if (type === E.BACK && state.name === S.INSPECTION_SUMMARY) return goBack(state);
      if (type === E.BACK || type === E.EXIT) return initialState();
      return state;
    case S.EV_BATTERY_PREVIEW:
      if (type === E.BACK) return to(S.INSPECTION_OVERVIEW, { area: null, component: null });
      if (type === E.EXIT) return initialState();
      return state;
    case S.CHARGE_PORT_PREVIEW:
      if (type === E.SELECT_CHARGE_PART && ['ev-charge.port', 'ev-charge.flap'].includes(event.id)) return event.id === state.component ? state : to(S.CHARGE_PORT_PREVIEW, { component: event.id });
      if (type === E.BACK) return to(S.INSPECTION_OVERVIEW, { area: null, component: null });
      if (type === E.EXIT) return initialState();
      return state;
    case S.VISIBILITY_PREVIEW:
      if(type===E.SELECT_VISIBILITY_PART&&areaOf(state).components.some(c=>c.id===event.id))return event.id===state.component?state:to(S.VISIBILITY_PREVIEW,{component:event.id});
      if(type===E.BACK)return to(S.INSPECTION_OVERVIEW,{area:null,component:null});
      if(type===E.EXIT)return initialState();return state;
    case S.TIRE_SELECTION:
    case S.TIRE_SUMMARY:
    case S.TIRE_PREVIEW:
      if (type === E.SELECT_TIRE) return selectTire();
      if (type === E.SHOW_TIRE_SUMMARY) return state.name === S.TIRE_SUMMARY ? state : to(S.TIRE_SUMMARY, { component: null });
      if (type === E.EXIT) return initialState();
      if (type === E.BACK) return [S.TIRE_PREVIEW, S.TIRE_SUMMARY].includes(state.name)
        ? to(S.TIRE_SELECTION, { component: null }) : to(S.INSPECTION_OVERVIEW, { area: null, component: null });
      return state;
    case S.HOOD_OPENING:
      if (type === E.HOOD_OPENED) return to(S.COMPONENT_SELECTION);
      if (type === E.BACK) return close(S.INSPECTION_OVERVIEW);
      if (type === E.EXIT) return close(S.IDLE);
      return state;
    case S.HOOD_CLOSING:
      if (type === E.HOOD_CLOSED) return state.resume ?? to(state.afterClose, { afterClose: null, area: [S.IDLE, S.INSPECTION_SUMMARY].includes(state.afterClose) ? null : state.area });
      if (type === E.SELECT_AREA && event.id === 'hood') return to(S.HOOD_OPENING, { area: event.id, afterClose: null });
      if (type === E.EXIT) return to(S.HOOD_CLOSING, { afterClose: S.IDLE });
      return state;
    case S.COMPONENT_SELECTION:
      if (type === E.SELECT_COMPONENT) return select();
      if (type === E.BACK) return close(S.INSPECTION_OVERVIEW);
      if (type === E.EXIT) return close(S.IDLE);
      return state;
    case S.WASHER_SELECTED:
      if (type === E.SELECT_COMPONENT) return select();
      if (type === E.REQUEST_HANDOFF && ctx.handoffConfigured) return to(S.MOBILE_HANDOFF_READY);
      if (type === E.BACK) return to(S.COMPONENT_SELECTION, { component: null });
      if (type === E.EXIT) return close(S.IDLE);
      return state;
    case S.COMPONENT_PREVIEW:
      if (type === E.SELECT_COMPONENT) return select();
      if (type === E.BACK) return to(S.COMPONENT_SELECTION, { component: null });
      if (type === E.EXIT) return close(S.IDLE);
      return state;
    case S.MOBILE_HANDOFF_READY:
      if (type === E.BACK) return to(S.WASHER_SELECTED);
      if (type === E.EXIT) return close(S.IDLE);
      return state;
    default:
      return state;
  }
}

export const areaOf = (state) => INSPECTION_AREAS.find((a) => a.id === state.area) ?? INSPECTION_AREAS[0];

/** Hood angle the page animates toward while in `state`. */
export function hoodTarget(state) {
  if(state.name===S.PART_RESULT||isHistoryState(state))return state.area==='hood'?HOOD_OPEN_DEG:0;
  return [S.HOOD_OPENING, S.COMPONENT_SELECTION, S.WASHER_SELECTED, S.COMPONENT_PREVIEW, S.MOBILE_HANDOFF_READY].includes(state.name) ? HOOD_OPEN_DEG : 0;
}

/** Named camera goal for `state`: home orbit, overview, engine bay, or the selected part on any screen. */
export function cameraGoal(state) {
  switch (state.name) {
    case S.PART_RESULT:return state.component==='lcw-coolant-reservoir'?'bay':state.component;
    case S.HISTORY_LIST: case S.HISTORY_DETAIL:return !state.component?'overview':state.component==='lcw-coolant-reservoir'?'bay':state.component;
    case S.IDLE: return 'home';
    case S.INSPECTION_SUMMARY: case S.INSPECTION_OVERVIEW: return 'overview';
    case S.TIRE_SUMMARY: case S.TIRE_SELECTION: return 'tires';
    case S.TIRE_PREVIEW: return state.component;
    case S.EV_BATTERY_PREVIEW: return 'ev-battery.pack';
    case S.CHARGE_PORT_PREVIEW: return state.component;
    case S.VISIBILITY_PREVIEW: return state.component;
    case S.HOOD_CLOSING: return state.afterClose === S.IDLE ? 'home' : 'overview';
    case S.HOOD_OPENING: case S.COMPONENT_SELECTION: return 'bay';
    default: return state.component;
  }
}

// P3-A4: vehicle inspection flow as a pure state machine. No DOM or three.js here, so the same
// transitions run in the page and under node --test. The page reacts to the state it enters
// (hood target angle, camera goal, highlight, panel) and reports animation ends back as events,
// so a cancelled or repeated input can never leave the hood and the UI in different states.

import { TIRES } from './inspection-tires.mjs';

export const STATES = Object.freeze({
  IDLE: 'IDLE',
  INSPECTION_OVERVIEW: 'INSPECTION_OVERVIEW',
  HOOD_OPENING: 'HOOD_OPENING',
  HOOD_CLOSING: 'HOOD_CLOSING',
  COMPONENT_SELECTION: 'COMPONENT_SELECTION',
  WASHER_SELECTED: 'WASHER_SELECTED',
  COMPONENT_PREVIEW: 'COMPONENT_PREVIEW',
  MOBILE_HANDOFF_READY: 'MOBILE_HANDOFF_READY',
  TIRE_SELECTION: 'TIRE_SELECTION', TIRE_PREVIEW: 'TIRE_PREVIEW', TIRE_SUMMARY: 'TIRE_SUMMARY',
});

export const EVENTS = Object.freeze({
  SHOW_TIRE_SUMMARY: 'SHOW_TIRE_SUMMARY', START: 'START', SELECT_AREA: 'SELECT_AREA', HOOD_OPENED: 'HOOD_OPENED', HOOD_CLOSED: 'HOOD_CLOSED',
  SELECT_COMPONENT: 'SELECT_COMPONENT', SELECT_TIRE: 'SELECT_TIRE', REQUEST_HANDOFF: 'REQUEST_HANDOFF', BACK: 'BACK', EXIT: 'EXIT',
});

// Inspection areas. Only `available` entries can be selected; `planned` ones are listed as not yet
// implemented. Component ids match tools/ioniq5-asset/service-components.mjs SERVICE_EVIDENCE.
export const INSPECTION_AREAS = Object.freeze([
  {
    id: 'hood', label: '보닛 · 전방 수납부', status: 'available',
    components: [
      { id: 'washer-fluid-cap', label: '워셔액', status: 'available' },
      { id: 'coolant-reservoir', label: '냉각수 리저버', status: 'preview', location: '모델 전방 구획의 차량 우측 중간' },
      { id: 'lcw-coolant-reservoir', label: '저전도 냉각수', status: 'planned' },
      { id: 'brake-fluid-reservoir', label: '브레이크액 리저버', status: 'preview', location: '모델 전방 구획의 차량 좌측 뒤쪽' },
      { id: 'battery-12v', label: '12V 보조 배터리', status: 'preview', location: '모델 전방 구획의 차량 좌측 앞쪽' },
      { id: 'fuse-box', label: '퓨즈박스', status: 'preview', location: '모델 전방 구획의 차량 좌측 중간' },
    ],
  },
  { id: 'tires', label: '타이어 · 네 바퀴', status: 'available', components: TIRES },
]);

export const HOOD_OPEN_DEG = 60; // axis A: P3-A1 simulation found no new mesh interference over 0–60°

const S = STATES, E = EVENTS;
const available = (list, id) => list.find((x) => x.id === id && x.status === 'available');

export const initialState = () => ({ name: S.IDLE, area: null, component: null, afterClose: null });

/**
 * Next state for `event`, or the same object when the event does not apply (duplicate clicks,
 * late animation callbacks, unavailable parts). `ctx.handoffConfigured` gates the QR step.
 */
export function transition(state, event, ctx = {}) {
  const { type } = event;
  const to = (name, patch = {}) => ({ ...state, name, ...patch });
  const close = (afterClose) => to(S.HOOD_CLOSING, { component: null, afterClose });
  const select = () => {
    const c = areaOf(state).components.find(c => c.id === event.id && ['available', 'preview'].includes(c.status));
    if (!c || c.id === state.component) return state;
    return to(c.status === 'preview' ? S.COMPONENT_PREVIEW : S.WASHER_SELECTED, { component: c.id });
  };
  const selectTire = () => TIRES.some(t => t.id === event.id) && state.component !== event.id
    ? to(S.TIRE_PREVIEW, { area: 'tires', component: event.id }) : state;
  switch (state.name) {
    case S.IDLE:
      return type === E.START ? to(S.INSPECTION_OVERVIEW) : state;
    case S.INSPECTION_OVERVIEW:
      if (type === E.SELECT_TIRE) return selectTire();
      if (type === E.SELECT_AREA && event.id === 'tires') return to(S.TIRE_SELECTION, { area: 'tires' });
      if (type === E.SELECT_AREA && available(INSPECTION_AREAS, event.id)) return to(S.HOOD_OPENING, { area: event.id });
      if (type === E.BACK || type === E.EXIT) return to(S.IDLE, { area: null });
      return state;
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
      if (type === E.HOOD_CLOSED) return to(state.afterClose, { afterClose: null, area: state.afterClose === S.IDLE ? null : state.area });
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
  return [S.HOOD_OPENING, S.COMPONENT_SELECTION, S.WASHER_SELECTED, S.COMPONENT_PREVIEW, S.MOBILE_HANDOFF_READY].includes(state.name) ? HOOD_OPEN_DEG : 0;
}

/** Named camera goal for `state`: home orbit, overview, engine bay or washer close-up. */
export function cameraGoal(state) {
  switch (state.name) {
    case S.IDLE: return 'home';
    case S.INSPECTION_OVERVIEW: return 'overview';
    case S.TIRE_SUMMARY: case S.TIRE_SELECTION: return 'tires';
    case S.TIRE_PREVIEW: return state.component;
    case S.HOOD_CLOSING: return state.afterClose === S.IDLE ? 'home' : 'overview';
    case S.HOOD_OPENING: case S.COMPONENT_SELECTION: return 'bay';
    case S.COMPONENT_PREVIEW: return state.component;
    default: return 'washer';
  }
}

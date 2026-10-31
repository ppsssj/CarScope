// P3-A4: vehicle inspection flow as a pure state machine. No DOM or three.js here, so the same
// transitions run in the page and under node --test. The page reacts to the state it enters
// (hood target angle, camera goal, highlight, panel) and reports animation ends back as events,
// so a cancelled or repeated input can never leave the hood and the UI in different states.

export const STATES = Object.freeze({
  IDLE: 'IDLE',
  INSPECTION_OVERVIEW: 'INSPECTION_OVERVIEW',
  HOOD_OPENING: 'HOOD_OPENING',
  HOOD_CLOSING: 'HOOD_CLOSING',
  COMPONENT_SELECTION: 'COMPONENT_SELECTION',
  WASHER_SELECTED: 'WASHER_SELECTED',
  MOBILE_HANDOFF_READY: 'MOBILE_HANDOFF_READY',
});

export const EVENTS = Object.freeze({
  START: 'START', SELECT_AREA: 'SELECT_AREA', HOOD_OPENED: 'HOOD_OPENED', HOOD_CLOSED: 'HOOD_CLOSED',
  SELECT_COMPONENT: 'SELECT_COMPONENT', REQUEST_HANDOFF: 'REQUEST_HANDOFF', BACK: 'BACK', EXIT: 'EXIT',
});

// Inspection areas. Only `available` entries can be selected; `planned` ones are listed as not yet
// implemented. Component ids match tools/ioniq5-asset/service-components.mjs SERVICE_EVIDENCE.
export const INSPECTION_AREAS = Object.freeze([
  {
    id: 'hood', label: '보닛 · 전방 수납부', status: 'available',
    components: [
      { id: 'washer-fluid-cap', label: '워셔액', status: 'available' },
      { id: 'coolant-reservoir', label: '냉각수', status: 'planned' },
      { id: 'lcw-coolant-reservoir', label: '저전도 냉각수', status: 'planned' },
      { id: 'brake-fluid-reservoir', label: '브레이크액', status: 'planned' },
      { id: 'battery-12v', label: '12V 배터리', status: 'planned' },
      { id: 'fuse-box', label: '퓨즈박스', status: 'planned' },
    ],
  },
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
  switch (state.name) {
    case S.IDLE:
      return type === E.START ? to(S.INSPECTION_OVERVIEW) : state;
    case S.INSPECTION_OVERVIEW:
      if (type === E.SELECT_AREA && available(INSPECTION_AREAS, event.id)) return to(S.HOOD_OPENING, { area: event.id });
      if (type === E.BACK || type === E.EXIT) return to(S.IDLE, { area: null });
      return state;
    case S.HOOD_OPENING:
      if (type === E.HOOD_OPENED) return to(S.COMPONENT_SELECTION);
      if (type === E.BACK) return close(S.INSPECTION_OVERVIEW);
      if (type === E.EXIT) return close(S.IDLE);
      return state;
    case S.HOOD_CLOSING:
      if (type === E.HOOD_CLOSED) return to(state.afterClose, { afterClose: null, area: state.afterClose === S.IDLE ? null : state.area });
      if (type === E.SELECT_AREA && available(INSPECTION_AREAS, event.id)) return to(S.HOOD_OPENING, { area: event.id, afterClose: null });
      if (type === E.EXIT) return to(S.HOOD_CLOSING, { afterClose: S.IDLE });
      return state;
    case S.COMPONENT_SELECTION:
      if (type === E.SELECT_COMPONENT && event.id === 'washer-fluid-cap' && available(areaOf(state).components, event.id)) return to(S.WASHER_SELECTED, { component: event.id });
      if (type === E.BACK) return close(S.INSPECTION_OVERVIEW);
      if (type === E.EXIT) return close(S.IDLE);
      return state;
    case S.WASHER_SELECTED:
      if (type === E.REQUEST_HANDOFF && ctx.handoffConfigured) return to(S.MOBILE_HANDOFF_READY);
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
  return [S.HOOD_OPENING, S.COMPONENT_SELECTION, S.WASHER_SELECTED, S.MOBILE_HANDOFF_READY].includes(state.name) ? HOOD_OPEN_DEG : 0;
}

/** Named camera goal for `state`: home orbit, overview, engine bay or washer close-up. */
export function cameraGoal(state) {
  switch (state.name) {
    case S.IDLE: return 'home';
    case S.INSPECTION_OVERVIEW: return 'overview';
    case S.HOOD_CLOSING: return state.afterClose === S.IDLE ? 'home' : 'overview';
    case S.HOOD_OPENING: case S.COMPONENT_SELECTION: return 'bay';
    default: return 'washer';
  }
}

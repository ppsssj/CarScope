// AR-01: washer-fluid self-inspection steps as a pure state machine (no DOM, no camera), shared by the page and tests.
// intro -> locate (camera aid, optional) -> check (user checklist) -> result (user choice) -> confirm -> done.
// Events that do not apply return the same state object, so double taps and late callbacks cannot skip a step.
// "확인할 수 없음" (CANNOT_CONFIRM) from locate/check jumps to the confirm step with UNSURE: a user who could not find
// the filler or see the level reports that honestly instead of ticking items they did not check.
import { startInspection, noteAids, completeInspection, STATUSES } from './inspection-result.mjs';

export const STEPS = Object.freeze(['intro', 'locate', 'check', 'result', 'confirm', 'done']);
export const CHECK_ITEMS = Object.freeze([
  { id: 'parked', label: '안전한 곳에 정차하고 전원을 끈 뒤, 설명서에 따라 보닛을 열었습니다.' },
  { id: 'located', label: '차량 설명서로 워셔액 주입구를 확인했습니다. 캡의 앞유리·분사 모양 표시를 직접 봤습니다.' },
  { id: 'observed', label: '워셔액 상태(양)를 눈으로 직접 확인했습니다.' },
]);

const noChecks = () => Object.freeze(Object.fromEntries(CHECK_ITEMS.map((c) => [c.id, false])));
export const initialState = () => Object.freeze({ step: 'intro', mode: null, checks: noChecks(), choice: null, record: null, unsureFrom: null });
export const allChecked = (state) => CHECK_ITEMS.every((c) => state.checks[c.id]);

/**
 * @param state current state
 * @param event { type, ... }
 * @param ctx { now, newId } injected clock and id source (tests)
 */
export function reduce(state, event, ctx = {}) {
  const to = (patch) => Object.freeze({ ...state, ...patch });
  switch (event.type) {
    case 'START': // camera: true when the camera aid is used, false for the manual path
      if (state.step !== 'intro') return state;
      return to({ step: event.camera ? 'locate' : 'check', mode: event.camera ? 'camera' : 'manual', checks: noChecks(), choice: null, record: startInspection(ctx) });
    case 'NOTE_AIDS':
      if (!state.record || state.step === 'done') return state;
      return to({ record: noteAids(state.record, event) });
    case 'TO_CHECK': // from the camera step, with or without a marker; also the "continue without camera" path
      if (state.step !== 'locate') return state;
      return to({ step: 'check', mode: event.manual ? 'manual' : state.mode });
    case 'TOGGLE': {
      if (state.step !== 'check' || !(event.id in state.checks)) return state;
      return to({ checks: Object.freeze({ ...state.checks, [event.id]: event.value ?? !state.checks[event.id] }) });
    }
    case 'CANNOT_CONFIRM': // never touches the checklist; OK/NEEDS_REFILL still require every item via TO_RESULT
      if (state.step !== 'locate' && state.step !== 'check') return state;
      return to({ step: 'confirm', choice: 'UNSURE', unsureFrom: state.step });
    case 'TO_RESULT':
      if (state.step !== 'check' || !allChecked(state)) return state;
      return to({ step: 'result' });
    case 'SELECT':
      if (state.step !== 'result' || !STATUSES.includes(event.status)) return state;
      return to({ choice: event.status });
    case 'TO_CONFIRM':
      if (state.step !== 'result' || !state.choice) return state;
      return to({ step: 'confirm', unsureFrom: null });
    case 'CONFIRM': // the only place a completed record is created; a second CONFIRM finds step 'done' and is ignored
      if (state.step !== 'confirm' || !state.choice) return state;
      return to({ step: 'done', record: completeInspection(state.record, state.choice, ctx) });
    case 'BACK':
      switch (state.step) {
        case 'locate': return initialState(); // leaving before any check discards the attempt
        case 'check': return state.mode === 'camera' ? to({ step: 'locate' }) : initialState();
        case 'result': return to({ step: 'check' });
        case 'confirm': return state.unsureFrom ? to({ step: state.unsureFrom, choice: null, unsureFrom: null }) : to({ step: 'result' });
        default: return state; // intro: nothing before; done: the result is final
      }
    case 'CANCEL': // abandon an unfinished attempt: no completed record exists for it
      return state.step === 'intro' || state.step === 'done' ? state : initialState();
    case 'RESTART': // new attempt after a completed one; the completed record is not modified
      return state.step === 'done' ? initialState() : state;
    default:
      return state;
  }
}

/** Progress shown in the header: 1 시작, 2 위치 찾기, 3 셀프 점검, 4 결과. */
export function progressOf(step) {
  return { intro: 1, locate: 2, check: 3, result: 4, confirm: 4, done: 4 }[step] ?? 1;
}

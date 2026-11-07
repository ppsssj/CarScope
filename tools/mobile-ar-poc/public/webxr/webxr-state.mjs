// P9-XR-B: pure state machine for the WebXR marker PoC (no DOM, no XR objects).
// The marker is the user's own placement. Nothing here identifies a part or scores accuracy.
// Events that do not apply return the same object, so double taps and late callbacks cannot skip a phase.
export const PHASES = Object.freeze(['CHECKING', 'UNSUPPORTED', 'READY', 'STARTING', 'AIMING', 'PLACING', 'PLACED', 'REPOSITIONING', 'ENDED', 'FAILED']);
const IN_SESSION = new Set(['AIMING', 'PLACING', 'PLACED', 'REPOSITIONING']);
const STARTABLE = new Set(['READY', 'ENDED', 'FAILED']);

export const initialState = () => Object.freeze({
  phase: 'CHECKING', reason: null, notice: null, capability: null, overlay: false, anchors: false,
  tracking: 'LOST', surface: false, visibility: 'visible', markerMode: null, markerVisible: false,
});

export const inSession = state => IN_SESSION.has(state.phase);
export const canPlace = state => (state.phase === 'AIMING' || state.phase === 'REPOSITIONING')
  && state.tracking === 'TRACKING' && state.surface && state.visibility === 'visible';

const sessionReset = { tracking: 'LOST', surface: false, visibility: 'visible', markerMode: null, markerVisible: false, overlay: false, anchors: false };

export function reduce(state, event) {
  const to = patch => Object.freeze({ ...state, ...patch });
  switch (event.type) {
    case 'PROBED':
      if (state.phase !== 'CHECKING') return state;
      return event.capability.canStart
        ? to({ phase: 'READY', capability: event.capability, reason: null })
        : to({ phase: 'UNSUPPORTED', capability: event.capability, reason: event.capability.reason });
    case 'START':
      if (!STARTABLE.has(state.phase) || !state.capability?.canStart) return state;
      return to({ ...sessionReset, phase: 'STARTING', reason: null, notice: null });
    case 'SESSION_STARTED':
      if (state.phase !== 'STARTING') return state;
      return to({ phase: 'AIMING', overlay: Boolean(event.overlay), anchors: Boolean(event.anchors), notice: event.anchors ? null : 'ANCHORS_UNAVAILABLE' });
    case 'START_FAILED':
      if (state.phase !== 'STARTING') return state;
      return to({ ...sessionReset, phase: 'FAILED', reason: event.reason });
    case 'FRAME': {
      if (!inSession(state)) return state;
      const surface = Boolean(event.surface), markerVisible = Boolean(event.markerVisible);
      if (state.tracking === event.tracking && state.surface === surface && state.markerVisible === markerVisible) return state;
      return to({ tracking: event.tracking, surface, markerVisible });
    }
    case 'VISIBILITY':
      if (!inSession(state) || state.visibility === event.value) return state;
      return to({ visibility: event.value });
    case 'PLACE':
      if (!canPlace(state)) return state;
      return to({ phase: 'PLACING', notice: state.anchors ? null : state.notice });
    case 'MARKER_PLACED':
      if (state.phase !== 'PLACING') return state;
      return to({ phase: 'PLACED', markerMode: event.mode, notice: event.mode === 'HIT_POSE' ? 'ANCHORS_UNAVAILABLE' : null });
    case 'PLACE_FAILED': // A marker that was being re-placed stays in place: the failed attempt must not remove it.
      if (state.phase !== 'PLACING') return state;
      return to({ phase: state.markerMode ? 'REPOSITIONING' : 'AIMING', notice: event.reason, anchors: event.anchors ?? state.anchors });
    case 'REPOSITION':
      if (state.phase !== 'PLACED') return state;
      return to({ phase: 'REPOSITIONING', notice: null });
    case 'CANCEL_REPOSITION':
      if (state.phase !== 'REPOSITIONING') return state;
      return to({ phase: 'PLACED', notice: state.markerMode === 'HIT_POSE' ? 'ANCHORS_UNAVAILABLE' : null });
    case 'REMOVE':
      if (state.phase !== 'PLACED' && state.phase !== 'REPOSITIONING') return state;
      return to({ phase: 'AIMING', markerMode: null, markerVisible: false, notice: state.anchors ? null : 'ANCHORS_UNAVAILABLE' });
    case 'MARKER_LOST': // The stored pose can no longer be trusted, so it is dropped rather than drawn in the wrong place.
      if (!state.markerMode || !inSession(state)) return state;
      return to({ phase: 'AIMING', markerMode: null, markerVisible: false, notice: event.reason });
    case 'SESSION_ENDED':
      if (!inSession(state) && state.phase !== 'STARTING') return state;
      return to({ ...sessionReset, phase: event.reason ? 'FAILED' : 'ENDED', reason: event.reason ?? null, notice: null });
    default:
      return state;
  }
}

const REASONS = Object.freeze({
  INSECURE_CONTEXT: 'HTTPS 또는 localhost에서 열어야 AR을 쓸 수 있어요.',
  NO_WEBXR_API: '이 브라우저는 WebXR을 제공하지 않아요.',
  AR_NOT_SUPPORTED: '이 기기나 브라우저는 카메라 AR을 지원하지 않아요.',
  HIT_TEST_NOT_SUPPORTED: '이 브라우저는 실제 표면 찾기를 지원하지 않아 위치를 지정할 수 없어요.',
  POLICY_BLOCKED: '이 페이지의 권한 정책이 AR 사용을 막고 있어요.',
  PROBE_FAILED: 'AR 지원 여부를 확인하지 못했어요.',
  ASSET_LOAD_FAILED: '3D 표시 모듈을 불러오지 못했어요.',
  PERMISSION_DENIED: '카메라 또는 AR 권한이 허용되지 않았어요.',
  SESSION_NOT_SUPPORTED: '이 기기에서 필요한 AR 기능으로 시작할 수 없어요.',
  SESSION_BUSY: '이미 실행 중인 AR이 있어요. 잠시 뒤 다시 시도해 주세요.',
  SESSION_ERROR: 'AR을 시작하지 못했어요.',
  SESSION_SETUP_FAILED: 'AR을 준비하다 오류가 나서 종료했어요.',
  FRAME_ERROR: 'AR 화면을 처리하다 오류가 나서 종료했어요.',
});
const NOTICES = Object.freeze({
  ANCHORS_UNAVAILABLE: '공간 앵커를 쓸 수 없어 표면 좌표로만 표시해요. 움직이면 더 어긋날 수 있어요.',
  NO_SURFACE: '표면을 놓쳤어요. 흰 원이 보일 때 다시 지정해 주세요.',
  ANCHOR_FAILED: '공간 앵커를 만들지 못했어요. 다시 지정해 주세요.',
  REFERENCE_RESET: '기기가 공간 좌표를 다시 잡아 표시를 지웠어요. 위치를 다시 지정해 주세요.',
});
export const reasonText = code => REASONS[code] ?? REASONS.SESSION_ERROR;
export const noticeText = code => (code ? NOTICES[code] ?? null : null);

const NOT_RECOGNIZED = '부품을 인식한 결과가 아니에요.', MARKER_GOES = '체크리스트로 가면 표시는 사라져요.';
/** Status for the AR overlay. It describes tracking only and never claims the part was recognized. */
export function statusCopy(state) {
  if (state.visibility !== 'visible') return { tone: 'warn', title: 'AR 일시 중지', hint: '화면으로 돌아오면 추적 상태를 다시 확인해 주세요.' };
  if (state.tracking === 'LOST') return { tone: 'warn', title: '추적 끊김', hint: '지금 표시를 믿지 마세요. 밝은 곳에서 휴대폰을 천천히 움직여 주세요.' };
  if (state.tracking === 'LIMITED') return { tone: 'warn', title: '추적 불안정', hint: '위치 이동을 추적하지 못해요. 표시를 믿지 말고 천천히 움직여 주세요.' };
  switch (state.phase) {
    case 'AIMING':
    case 'REPOSITIONING':
      if (!state.surface) return { tone: 'muted', title: '표면 찾는 중', hint: '주입구 근처를 천천히 비춰 주세요. 표면이 잡히지 않으면 체크리스트로 돌아가 직접 확인해 주세요.' };
      return { tone: 'ok', title: '표면 찾음', hint: '흰 원을 주입구 근처에 맞추고 화면을 탭해 주세요. 부품을 인식하지 않아요.' };
    case 'PLACING':
      return { tone: 'muted', title: '표시 고정 중', hint: '잠시만 기다려 주세요.' };
    case 'PLACED':
      if (!state.markerVisible) return { tone: 'warn', title: '표시 추적 중단', hint: '표시를 가렸어요. 돌아오지 않으면 위치를 다시 지정해 주세요.' };
      // The tracker's own state, in the words of what it does: an anchor is held in space, a stored hit pose is not.
      if (state.markerMode === 'HIT_POSE') return { tone: 'warn', title: '표면에 표시됨 · 공간 고정 안 됨', hint: `움직이면 어긋날 수 있어요. ${NOT_RECOGNIZED} ${MARKER_GOES}` };
      return { tone: 'ok', title: '공간에 고정됨 · 내가 지정한 위치', hint: `휴대폰을 움직여도 화살표가 제자리에 있는지 봐 주세요. ${NOT_RECOGNIZED} ${MARKER_GOES}` };
    default:
      return { tone: 'muted', title: 'AR 준비 중', hint: '' };
  }
}

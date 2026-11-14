// One owner for the page's #toast. Every message, including none, replaces the previous one and its timer, so an
// old timer can never hide a newer message and no message stays on screen indefinitely.
export const TOAST_MS = 4000;

/** Each message states only the step that was confirmed. None of them proves a QR, a server session or a connection. */
// P10 PR #2: plain words for the driver. "차량 앱" is the Android host the page runs in (Native in the code).
export const MOBILE_REQUEST_TEXT = Object.freeze({
  SENDING: '스마트폰 점검을 요청하는 중입니다',
  ACCEPTED: '스마트폰 점검을 준비합니다 · QR이 표시되면 스캔하세요',
  ACCEPTED_ACTIVE_BINDING: '이미 진행 중인 스마트폰 점검입니다',
  BUILD_UNSUPPORTED: '이 배포용(Release) 앱에는 스마트폰 점검 연동이 없습니다',
  IN_FLIGHT: '이전 요청의 응답을 기다리는 중입니다 · 새 요청을 보내지 않았습니다',
  REJECTED: '점검 요청을 시작할 수 없습니다',
  FAILED: '차량 앱과의 연결을 확인하지 못했습니다',
  NOT_CONNECTED: '이 기기에서는 스마트폰 점검을 시작할 수 없습니다',
  // A closed channel never reconnects by itself: fail-closed, so the user has to start a new screen.
  CHANNEL_CLOSED: '차량 앱과의 연결이 종료되었습니다 · 점검 화면을 닫고 새로 열어 주세요',
});

/**
 * Connects one click to the toast. The message about an answer belongs to the screen that asked: once the user has moved
 * on, or the session has ended, it stays silent. A refusal is not lost, because the controller also keeps it as a notice.
 */
export function createMobileRequestNotifier({ request, show, screen }) {
  return async function requestFromPart(taskId) {
    const askedOn = screen();
    const answer = request(taskId);
    show(MOBILE_REQUEST_TEXT.SENDING);
    const outcome = await answer;
    if (Object.hasOwn(MOBILE_REQUEST_TEXT, outcome) && screen() === askedOn) show(MOBILE_REQUEST_TEXT[outcome]);
    return outcome;
  };
}

export function createToast(element, { ms = TOAST_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null;
  return function show(message) {
    clearTimer(timer);
    timer = null;
    element.textContent = message ?? '';
    element.classList.toggle('on', Boolean(message));
    if (message) timer = setTimer(() => { timer = null; element.classList.remove('on'); }, ms);
  };
}

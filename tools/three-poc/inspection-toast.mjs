// One owner for the page's #toast. Every message, including none, replaces the previous one and its timer, so an
// old timer can never hide a newer message and no message stays on screen indefinitely.
export const TOAST_MS = 4000;

/** Each message states only the step that was confirmed. None of them proves a QR, a server session or a connection. */
export const MOBILE_REQUEST_TEXT = Object.freeze({
  SENDING: 'Native 점검 요청 전달 중입니다',
  ACCEPTED: 'Native 수신 화면 요청이 접수됐습니다 · 세션 생성 전입니다',
  ACCEPTED_ACTIVE_BINDING: 'Native 수신 화면 요청이 접수됐습니다 · 이미 연결된 점검 요청입니다',
  IN_FLIGHT: '이전 요청의 Native 응답을 기다리는 중입니다 · 새 요청을 보내지 않았습니다',
  REJECTED: '점검 요청을 시작할 수 없습니다',
  FAILED: 'Native 연결을 확인하지 못했습니다',
  NOT_CONNECTED: 'Native 전달 경로 미완료 · 요청을 시작할 수 없습니다.',
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

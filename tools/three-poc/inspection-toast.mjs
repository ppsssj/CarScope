// One owner for the page's #toast. Every message, including none, replaces the previous one and its timer, so an
// old timer can never hide a newer message and no message stays on screen indefinitely.
export const TOAST_MS = 4000;

/** Starting a request only asks Native to show its receiver. It has created nothing and proves no connection. */
// A closed channel never reconnects by itself: fail-closed, so the user has to start a new screen.
export const mobileRequestToast = (started, connection) => started
  ? 'Native 수신 화면을 요청했습니다 · 세션 생성 전입니다'
  : connection === 'UNAVAILABLE'
    ? 'Native 연결이 종료되었습니다 · 3D 점검 화면을 닫고 새로 열어 주세요'
    : 'Native 전달 경로 미완료 · 요청을 시작할 수 없습니다.';

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

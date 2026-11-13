// Browser-only enhancement, injected by the account server. Never packaged in Android assets.
import { isEmbeddedWebView } from './lib/auth-flow.mjs';
import { createAccountSession } from './lib/account-session.mjs';
import { createVehicleRepository } from './lib/vehicle-repository.mjs';
import { createBrowserClient, loadPublicConfig } from './lib/account-runtime.mjs';
import { parseVehicleParam, withoutVehicleParam, createSelectionController, SELECTION, TERMINAL, SELECTION_CHANNEL, VEHICLES_PATH } from './lib/vehicle-selection.mjs';
import { referenceNotice } from './lib/reference-model.mjs';
import { VERIFICATION_LABEL } from './lib/account-copy.mjs';

const host = document.getElementById('accountInspection');
const requested = parseVehicleParam(location.search);
const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
let session, controller;
const messages = {
  NONE: '로그인 없이 체험 중 · 2022 IONIQ 5 참조 모델',
  CHECKING: '선택한 차량과 로그인 상태를 확인하고 있습니다.',
  INVALID: '차량 주소가 올바르지 않습니다. 내 차량에서 다시 선택해 주세요.',
  NOT_FOUND: '접근할 수 없거나 삭제된 차량입니다. 내 차량에서 다시 선택해 주세요.',
  SIGNED_OUT: '로그인이 필요합니다. 차량 선택을 해제했습니다.',
  ACCOUNT_CHANGED: '계정이 변경되어 차량 선택을 해제했습니다.',
  AUTH_UNAVAILABLE: '로그인 상태를 확인할 수 없습니다. 차량 정보를 숨겼습니다.',
  UNCONFIRMED: '차량 정보를 확인할 수 없습니다. 네트워크 연결 후 다시 확인해 주세요.',
  NOT_CONFIGURED: '로그인 연결이 설정되지 않았습니다. 차량 선택을 해제했습니다.',
};
function render(state, vehicle = null) {
  host.dataset.selection = state;
  host.replaceChildren();
  if (TERMINAL.has(state)) history.replaceState(null, '', withoutVehicleParam(location.href));
  const back = node('a', '← 내 차량'); back.href = VEHICLES_PATH;
  const text = node('p', vehicle ? `${vehicle.nickname ?? vehicle.manufacturer + ' ' + vehicle.model} · ${VERIFICATION_LABEL[vehicle.verification]}` : messages[state]);
  text.setAttribute('role', 'status');
  host.append(back, text);
  if (vehicle) {
    host.append(node('p', referenceNotice(vehicle).text), node('small', 'Google 로그인은 차량 소유 증명이 아닙니다. 현재 QR 점검 결과는 이 차량의 저장 기록에 자동 연결되지 않습니다.'));
    const logout = node('button', '로그아웃'); logout.type = 'button';
    logout.addEventListener('click', () => session.signOut()); host.insertBefore(logout, text);
  }
  if ([SELECTION.UNCONFIRMED, SELECTION.AUTH_UNAVAILABLE].includes(state)) {
    const retry = node('button', '다시 확인'); retry.type = 'button';
    retry.addEventListener('click', async () => { await session.retry(); await controller.verify(); }); host.append(retry);
  }
}

if (isEmbeddedWebView(navigator.userAgent) || globalThis.CarScopeNative) {
  // No Auth client, storage reads, login links or account network requests in an embedded vehicle app.
  host.remove();
  history.replaceState(null, '', withoutVehicleParam(location.href));
} else if (!requested.present) {
  render(SELECTION.NONE); // Trial mode never creates an Auth client.
} else if (!requested.valid) {
  render(SELECTION.INVALID);
} else {
  render(SELECTION.CHECKING);
  const config = await loadPublicConfig();
  if (!config.configured) render(SELECTION.NOT_CONFIGURED);
  else {
    const client = createBrowserClient(config);
    session = createAccountSession({ client });
    const repo = createVehicleRepository({ client, session });
    controller = createSelectionController({ id: requested.id, session, repo, onChange: render });
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(SELECTION_CHANNEL) : null;
    if (channel) channel.onmessage = event => controller.removed(event.data?.removedId);
    await session.start();
    // Reconfirm server identity and RLS visibility after returning from another tab or browser history.
    const refresh = async () => {
      if (TERMINAL.has(controller.state)) return;
      render(SELECTION.CHECKING);
      await session.retry();
      await controller.verify();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
    window.addEventListener('pagehide', () => { host.replaceChildren(); });
    window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
  }
}

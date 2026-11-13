// P15 "내 차량". Shows vehicles only for a user the Auth server confirmed, and wipes them from the DOM synchronously
// on every identity change (sign-out, account switch, session end) before anything else happens.
import { createAuthFlow, isEmbeddedWebView } from './lib/auth-flow.mjs';
import { createAccountSession, STATUS } from './lib/account-session.mjs';
import { createVehicleRepository, ensureProfile, ERRORS } from './lib/vehicle-repository.mjs';
import { createBrowserClient, googleProviderStatus, loadPublicConfig } from './lib/account-runtime.mjs';
import { CONNECTION_COPY, DATA_MESSAGES, FIELD_LABELS, VERIFICATION_LABEL, signinMessage } from './lib/account-copy.mjs';
import { inspectHref, SELECTION_CHANNEL } from './lib/vehicle-selection.mjs';
import { referenceNotice } from './lib/reference-model.mjs';

const $ = (id) => document.getElementById(id);
const status = $('status');
const say = (text, warn = false) => { status.textContent = text ?? ''; status.classList.toggle('warn', Boolean(warn)); };
const el = (tag, props = {}, ...children) => { const n = document.createElement(tag); Object.assign(n, props); n.append(...children); return n; };

const config = await loadPublicConfig();
for (const id of ['trial', 'trialTop']) { $(id).href = config.trialUrl ?? '/inspect/inspect.html'; $(id).hidden = false; }

function show(view) {
  document.body.dataset.account = view;
  for (const id of ['restoring', 'signedOut', 'unavailable', 'signedIn']) $(id).hidden = id !== view;
  $('signOut').hidden = view !== 'signedIn';
}

if (!config.configured) {
  show('signedOut');
  say(signinMessage(config.reason), true);
} else {
  const client = createBrowserClient(config);
  const session = createAccountSession({ client });
  const repo = createVehicleRepository({ client, session });
  const changes = typeof BroadcastChannel === 'function' ? new BroadcastChannel(SELECTION_CHANNEL) : null;
  const flow = createAuthFlow({ client, flowStorage: sessionStorage, origin: location.origin, userAgent: navigator.userAgent, providerStatus: () => googleProviderStatus(config) });
  const form = $('form');
  let vehicles = [];
  let editing = null; // vehicle id being edited, or null for a new vehicle
  let loadedFor = null; // `${epoch}:${userId}` whose data is on screen

  function wipe() {
    loadedFor = null;
    vehicles = [];
    editing = null;
    $('vehicles').replaceChildren();
    $('empty').hidden = true;
    form.reset(); form.hidden = true;
    $('name').textContent = ''; $('email').textContent = '';
    const avatar = $('avatar'); avatar.hidden = true; avatar.removeAttribute('src');
  }

  function renderList() {
    const list = $('vehicles');
    list.replaceChildren(...vehicles.map(vehicleCard));
    $('empty').hidden = vehicles.length > 0;
    $('add').disabled = vehicles.length >= 20;
  }

  function vehicleCard(v) {
    const title = v.nickname ?? `${v.manufacturer} ${v.model}`;
    const sub = [v.manufacturer, v.model, v.modelYear ? `${v.modelYear}년식` : null].filter(Boolean).join(' · ');
    const facts = el('dl', { className: 'facts' },
      el('dt', { textContent: CONNECTION_COPY.vehicleData }), el('dd', { textContent: CONNECTION_COPY.vehicleDataNote }),
      el('dt', { textContent: CONNECTION_COPY.inspection }), el('dd', { textContent: CONNECTION_COPY.inspectionNote }));
    const edit = el('button', { className: 'secondary', type: 'button', textContent: '수정' });
    const del = el('button', { className: 'danger', type: 'button', textContent: '삭제' });
    const start = el('a', { className: 'primary', href: inspectHref(v.id), textContent: '3D 점검 시작' });
    const card = el('li', { className: 'vehicle' },
      el('div', { className: 'title', textContent: title }), el('div', { className: 'sub', textContent: sub }),
      el('span', { className: 'tag', textContent: VERIFICATION_LABEL[v.verification] }), facts,
      el('p', { className: 'sub', textContent: referenceNotice(v).text }),
      el('p', { className: 'sub', textContent: '점검 결과는 이 차량의 저장 기록에 자동 연결되지 않습니다.' }),
      el('div', { className: 'row-actions' }, start, edit, del));
    card.dataset.vehicleId = v.id;
    edit.addEventListener('click', () => openForm(v));
    del.addEventListener('click', () => {
      if (card.querySelector('.confirm')) return;
      const yes = el('button', { className: 'danger', type: 'button', textContent: '삭제' });
      const no = el('button', { className: 'secondary', type: 'button', textContent: '취소' });
      const box = el('div', { className: 'confirm' }, el('p', { textContent: `"${title}"을(를) 삭제할까요? 되돌릴 수 없습니다.` }), el('div', { className: 'row-actions' }, yes, no));
      card.append(box);
      no.addEventListener('click', () => box.remove());
      yes.addEventListener('click', async () => {
        yes.disabled = true;
        const r = await repo.remove(v.id);
        if (r.ok || r.error === ERRORS.NOT_FOUND) { changes?.postMessage({ removedId: v.id }); vehicles = vehicles.filter((x) => x.id !== v.id); renderList(); say(r.ok ? '차량을 삭제했습니다.' : DATA_MESSAGES.NOT_FOUND, !r.ok); }
        else { yes.disabled = false; dataError(r.error); }
      });
    });
    return card;
  }

  function openForm(v = null) {
    editing = v?.id ?? null;
    form.reset();
    $('formTitle').textContent = v ? '차량 정보 수정' : '차량 추가';
    if (v) { form.manufacturer.value = v.manufacturer; form.model.value = v.model; form.model_year.value = v.modelYear ?? ''; form.nickname.value = v.nickname ?? ''; }
    clearFieldErrors();
    form.hidden = false;
    form.manufacturer.focus();
  }
  function clearFieldErrors() { for (const n of form.querySelectorAll('[data-error]')) n.textContent = ''; for (const i of form.querySelectorAll('input')) i.removeAttribute('aria-invalid'); }
  function fieldErrors(codes = []) {
    clearFieldErrors();
    for (const code of codes) {
      const [field, why] = code.split(':');
      const slot = form.querySelector(`[data-error="${field}"]`);
      if (!slot) continue;
      form[field]?.setAttribute('aria-invalid', 'true');
      slot.textContent = why === 'required' ? `${FIELD_LABELS[field]}을(를) 입력해 주세요.` : why === 'range' ? '1950년부터 올해 이후 2년까지 숫자 4자리로 입력해 주세요.' : why === 'length' ? '너무 깁니다.' : '사용할 수 없는 문자가 있습니다.';
    }
  }
  function dataError(code) {
    if (code === ERRORS.STALE_IDENTITY) return; // the identity change already cleared the screen and said why
    say(DATA_MESSAGES[code] ?? DATA_MESSAGES.SERVER, true);
  }

  async function loadVehicles() {
    const r = await repo.list();
    if (r.ok) { vehicles = r.vehicles; renderList(); } else dataError(r.error);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = { manufacturer: form.manufacturer.value, model: form.model.value, model_year: form.model_year.value, nickname: form.nickname.value };
    $('save').disabled = true;
    const r = editing ? await repo.update(editing, input) : await repo.create(input);
    $('save').disabled = false;
    if (r.ok) {
      vehicles = editing ? vehicles.map((x) => (x.id === r.vehicle.id ? r.vehicle : x)) : [r.vehicle, ...vehicles];
      say(editing ? '차량 정보를 수정했습니다.' : '차량을 등록했습니다. 소유 확인 안 됨으로 표시됩니다.');
      form.hidden = true; editing = null; renderList();
    } else if (r.error === ERRORS.INVALID_INPUT) { fieldErrors(r.fields); say(DATA_MESSAGES.INVALID_INPUT, true); }
    else dataError(r.error);
  });
  $('cancel').addEventListener('click', () => { form.hidden = true; editing = null; });
  $('add').addEventListener('click', () => openForm());
  $('retry').addEventListener('click', () => session.retry());
  $('signOut').addEventListener('click', async () => { const r = await session.signOut(); say(r.serverConfirmed ? signinMessage('USER_SIGNED_OUT') : '이 브라우저에서 로그아웃했습니다. 인증 서버 확인은 실패했습니다.'); });
  $('switchAccount').addEventListener('click', async () => {
    if (isEmbeddedWebView(navigator.userAgent)) return say(signinMessage('EMBEDDED_WEBVIEW'), true);
    await session.signOut();
    const started = await flow.beginGoogleLogin({ selectAccount: true });
    if (!started.ok) say(signinMessage(started.reason), true);
  });
  $('hyundaiNote').textContent = CONNECTION_COPY.vehicleDataNote;

  session.subscribe(async (type, s) => {
    if (type === 'clear') { wipe(); if (s.reason) say(signinMessage(s.reason), s.reason !== 'USER_SIGNED_OUT'); return; }
    if (s.status === STATUS.RESTORING) return show('restoring');
    if (s.status === STATUS.AUTH_UNAVAILABLE) return show('unavailable');
    if (s.status === STATUS.SIGNED_OUT) return show('signedOut');
    show('signedIn');
    const key = `${s.epoch}:${s.user.id}`;
    if (loadedFor === key) return;
    loadedFor = key;
    $('name').textContent = s.user.displayName ?? 'Google 계정';
    $('email').textContent = s.user.email ?? '';
    if (s.user.avatarUrl) { $('avatar').src = s.user.avatarUrl; $('avatar').hidden = false; }
    const epoch = s.epoch;
    const profile = await ensureProfile({ client, user: s.user });
    if (session.epoch !== epoch) return;
    if (!profile.ok) dataError(profile.error);
    await loadVehicles();
  });
  await session.start();
}

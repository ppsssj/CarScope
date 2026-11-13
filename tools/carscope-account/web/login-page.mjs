// P15 login page. Trial mode never depends on this page: with no configuration, an unreachable Auth server or a
// cancelled login, the "로그인 없이 체험하기" link still works.
import { createAuthFlow, isEmbeddedWebView } from './lib/auth-flow.mjs';
import { createAccountSession, STATUS } from './lib/account-session.mjs';
import { createBrowserClient, googleProviderStatus, loadPublicConfig } from './lib/account-runtime.mjs';
import { PRIVACY_POINTS, signinMessage } from './lib/account-copy.mjs';

const $ = (id) => document.getElementById(id);
const status = $('status');
const say = (text, warn = false) => { status.textContent = text ?? ''; status.classList.toggle('warn', Boolean(warn)); };

for (const point of PRIVACY_POINTS) { const li = document.createElement('li'); li.textContent = point; $('privacyList').append(li); }

// A sign-in outcome code handed over by the callback page. Codes only; anything unknown is ignored.
const params = new URLSearchParams(location.search);
const outcome = signinMessage(params.get('signin'));
if (params.has('signin')) history.replaceState(null, '', location.pathname);
if (outcome) say(outcome, params.get('signin') !== 'USER_SIGNED_OUT');

const config = await loadPublicConfig();
if (config.trialUrl) for (const id of ['trial', 'trialTop']) { $(id).href = config.trialUrl; $(id).hidden = false; }

if (!config.configured) {
  say(signinMessage(config.reason), true);
} else if (isEmbeddedWebView(navigator.userAgent)) {
  say(signinMessage('EMBEDDED_WEBVIEW'), true);
} else {
  const client = createBrowserClient(config);
  const flow = createAuthFlow({ client, flowStorage: sessionStorage, origin: location.origin, userAgent: navigator.userAgent, providerStatus: () => googleProviderStatus(config) });
  const session = createAccountSession({ client });
  const google = $('google');
  session.subscribe((_type, s) => {
    $('toVehicles').hidden = s.status !== STATUS.SIGNED_IN;
    google.disabled = s.status === STATUS.RESTORING;
    if (s.status === STATUS.SIGNED_IN && !outcome) say(`${s.user.displayName ?? s.user.email ?? 'Google 계정'}(으)로 로그인되어 있습니다.`);
  });
  google.addEventListener('click', async () => {
    google.disabled = true;
    say('Google 로그인으로 이동합니다.');
    const started = await flow.beginGoogleLogin();
    // On success supabase-js has already started navigating to Supabase Auth.
    if (!started.ok) { say(signinMessage(started.reason), true); google.disabled = false; }
  });
  await session.start();
  google.disabled = false;
}

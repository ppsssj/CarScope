// P15 OAuth callback. Reads the URL once, removes code / nonce / error from the address bar and history immediately,
// then lets auth-flow decide. Success goes to My Vehicles; any failure goes back to the login page with a reason code.
import { createAuthFlow } from './lib/auth-flow.mjs';
import { createBrowserClient, loadPublicConfig } from './lib/account-runtime.mjs';

const href = location.href;
history.replaceState(null, '', location.pathname);

const back = (reason) => location.replace(`/account/?signin=${encodeURIComponent(reason)}`);
const config = await loadPublicConfig();
if (!config.configured) {
  back(config.reason);
} else {
  const client = createBrowserClient(config);
  const flow = createAuthFlow({ client, flowStorage: sessionStorage, origin: location.origin, userAgent: navigator.userAgent });
  const result = await flow.completeCallback(href);
  if (result.ok) location.replace('/account/vehicles.html');
  else back(result.reason);
}

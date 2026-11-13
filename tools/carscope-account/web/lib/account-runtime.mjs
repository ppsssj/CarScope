// P15: page bootstrap shared by the three account pages. Loads the public configuration, creates the one
// supabase-js client of the page (PKCE, no automatic URL handling, persisted session with automatic refresh).

import { validatePublicConfig } from './public-config.mjs';

export const AUTH_STORAGE_KEY = 'carscope-account-auth';

export async function loadPublicConfig(fetchImpl = fetch) {
  try {
    const response = await fetchImpl('/account/config.json', { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) return { configured: false, reason: 'NOT_CONFIGURED', trialUrl: null };
    return validatePublicConfig(await response.json());
  } catch {
    return { configured: false, reason: 'NOT_CONFIGURED', trialUrl: null };
  }
}

/** Options shared with the Node tests so both run the same client configuration. */
export function clientOptions(storage) {
  return {
    auth: {
      flowType: 'pkce',
      // The callback page exchanges the code itself, after checking the CarScope flow nonce.
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storageKey: AUTH_STORAGE_KEY,
      ...(storage ? { storage } : {}),
    },
  };
}

/**
 * Reads the Auth server's public settings to learn whether the Google provider is switched on, so an unconfigured
 * project shows a message instead of the Auth server's raw error page. Returns ENABLED | DISABLED | AUTH_UNAVAILABLE.
 */
export async function googleProviderStatus(config, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey }, credentials: 'omit', redirect: 'error', cache: 'no-store',
    });
    if (!response.ok) return 'AUTH_UNAVAILABLE';
    const settings = await response.json();
    return settings?.external?.google === true ? 'ENABLED' : 'DISABLED';
  } catch {
    return 'AUTH_UNAVAILABLE';
  }
}

export function createBrowserClient(config, createClient = globalThis.supabase?.createClient) {
  if (!config?.configured) throw new Error('NOT_CONFIGURED');
  if (typeof createClient !== 'function') throw new Error('SUPABASE_CLIENT_MISSING');
  return createClient(config.supabaseUrl, config.publishableKey, clientOptions());
}

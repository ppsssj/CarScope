// P15 local server for the account pages. Serves web/ under /account/, the pinned supabase-js UMD build, and
// /account/config.json built from two public values. Binds to 127.0.0.1 only. It is not a Render entrypoint.
//
// Environment (all optional; without them the pages show "login not configured" and trial mode is unaffected):
//   SUPABASE_URL              https://<project-ref>.supabase.co  (or http://127.0.0.1:54321 for a local stack)
//   SUPABASE_PUBLISHABLE_KEY  sb_publishable_...  (a legacy anon JWT is accepted; secret / service_role keys are refused)
//   CARSCOPE_TRIAL_URL        where "로그인 없이 체험하기" points, e.g. http://127.0.0.1:8095/inspect.html
//   PORT                      default 8097
// Secret keys are never read: the server does not look at SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY at all.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePublicConfig } from './web/lib/public-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, 'web');
const VENDOR = join(HERE, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export function publicConfigFromEnv(env = process.env) {
  return validatePublicConfig({ supabaseUrl: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY, trialUrl: env.CARSCOPE_TRIAL_URL });
}

export function securityHeaders(config) {
  const connect = ["'self'", ...(config.configured ? [config.supabaseUrl] : [])].join(' ');
  return {
    'content-security-policy': [
      "default-src 'none'", "script-src 'self'", "style-src 'self'", `connect-src ${connect}`,
      "img-src 'self' https://lh3.googleusercontent.com", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
    ].join('; '),
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  };
}

export function createAccountServer({ env = process.env } = {}) {
  const config = publicConfigFromEnv(env);
  const headers = securityHeaders(config);
  // Only the public fields leave the server, and only when they passed validation.
  const configBody = JSON.stringify(config.configured
    ? { supabaseUrl: config.supabaseUrl, publishableKey: config.publishableKey, trialUrl: config.trialUrl }
    : { trialUrl: config.trialUrl });

  let threeHandler;
  const server = createServer(async (req, res) => {
    const send = (code, type, body, extra = {}) => { res.writeHead(code, { ...headers, 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(body); };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'Method not allowed', { allow: 'GET, HEAD' });
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { return send(400, 'text/plain', 'Bad request'); }
    if (path.startsWith('/inspect/') || path === '/mobile-ar-poc/public/part-capabilities.mjs') {
      // The account origin trusts only reviewed runtime resources, not the Lab server's directory tree.
      // No client-selected model URL is accepted on this origin.
      const parsed = new URL(req.url, 'http://127.0.0.1');
      if (parsed.searchParams.has('model')) return send(400, 'text/plain', 'Model override unavailable');
      if (path === '/inspect/inspect.html') {
        const source = (await readFile(join(HERE, '..', 'three-poc', 'inspect.html'), 'utf8')).replace(/\r\n?/g, '\n');
        const importmap = source.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
        const hash = createHash('sha256').update(importmap).digest('base64');
        const csp = ["default-src 'none'", `script-src 'self' 'sha256-${hash}'`,
          "style-src 'self' 'unsafe-inline'", `connect-src 'self'${config.configured ? ' ' + config.supabaseUrl : ''}`,
          "img-src 'self' data: blob:", "worker-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; ');
        const html = source.replace('</head>', '<link rel="stylesheet" href="/account/inspection.css"></head>')
          .replace('<body data-state="IDLE">', '<body data-state="IDLE"><section id="accountInspection" aria-label="선택한 차량"></section>')
          .replace('</body>', '<script src="/account/vendor/supabase.js"></script><script type="module" src="/account/inspection-page.mjs"></script></body>');
        return send(200, TYPES['.html'], html, { 'content-security-policy': csp });
      }
      try {
        threeHandler ??= import('../three-poc/serve.mjs').then(m => m.createThreePocHandler({ env, publicOnly: true }));
        const handler = await threeHandler;
        for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
        res.setHeader('cache-control', 'no-store');
        if (path.startsWith('/inspect/')) req.url = req.url.slice('/inspect'.length);
        return await handler(req, res);
      } catch { return send(503, 'text/plain', 'Inspection resources unavailable'); }
    }
    if (path === '/' || path === '/account') return send(302, 'text/plain', '', { location: '/account/' });
    if (path === '/account/config.json') return send(200, 'application/json', configBody);
    if (path === '/account/vendor/supabase.js') {
      try { return send(200, TYPES['.js'], await readFile(VENDOR), { 'cache-control': 'public, max-age=3600' }); } catch { return send(503, 'text/plain', 'Vendor missing: npm ci'); }
    }
    if (!path.startsWith('/account/')) return send(404, 'text/plain', 'Not found');
    const rel = path.slice('/account/'.length) || 'index.html';
    const file = normalize(join(WEB, rel));
    const ext = file.slice(file.lastIndexOf('.'));
    if (!file.startsWith(WEB + sep) || !TYPES[ext] || rel.includes('\0')) return send(404, 'text/plain', 'Not found');
    try { return send(200, TYPES[ext], await readFile(file)); } catch { return send(404, 'text/plain', 'Not found'); }
  });
  return { server, config };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const { server, config } = createAccountServer();
  const port = Number(process.env.PORT ?? 8097);
  server.listen(port, '127.0.0.1', () => {
    // Prints the state only, never the key.
    process.stdout.write(`CarScope account pages: http://127.0.0.1:${port}/account/  login=${config.configured ? 'CONFIGURED' : config.reason}\n`);
  });
}

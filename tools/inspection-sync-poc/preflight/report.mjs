// Shared result vocabulary. A check never carries a URL, password or token: only codes and names.
export const STATUSES = Object.freeze(['PASS', 'FAIL', 'MANUAL', 'BLOCKED', 'NOT_VERIFIED', 'NOT_RUN']);

export function check(id, status, detail = '', extra = {}) {
  if (!STATUSES.includes(status)) throw new Error('INVALID_CHECK_STATUS');
  return { id, status, detail, ...extra };
}

/** Run a gate and turn an unexpected exception into FAIL by error code, never by message. */
export async function guarded(id, gate) {
  try {
    return await gate();
  } catch (error) {
    return check(id, 'FAIL', 'GATE_ERROR:' + safeCode(error));
  }
}

/** Driver and network messages can embed hosts or credentials, so only an allowlisted code leaves. */
export function safeCode(error) {
  const code = error?.code ?? error?.message;
  return typeof code === 'string' && /^[A-Z0-9_]{2,64}$/.test(code) ? code : 'UNEXPECTED';
}

export function summarize(checks) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const c of checks) counts[c.status]++;
  return { counts, failed: counts.FAIL > 0, open: counts.MANUAL + counts.BLOCKED + counts.NOT_VERIFIED + counts.NOT_RUN };
}

export function renderText(title, checks) {
  const width = Math.max(...checks.map((c) => c.id.length), 2);
  const lines = [`== ${title} ==`];
  for (const c of checks) lines.push(`${c.status.padEnd(12)} ${c.id.padEnd(width)} ${c.detail}`.trimEnd());
  const { counts, open } = summarize(checks);
  lines.push(STATUSES.map((s) => `${s}=${counts[s]}`).join(' ') + ` open=${open}`);
  return lines.join('\n');
}

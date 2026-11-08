// Experiment-only: a real database/schema probe with one deadline covering checkout and query.
// The timeout is not an UP result. A late checkout is discarded without executing SQL.
export const VISION_HEALTH_TIMEOUT_MS = 5000;
export async function probeVisionDatabase(pool, expectedSchema, timeoutMs = VISION_HEALTH_TIMEOUT_MS) {
  if (!pool?.connect || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('INVALID_HEALTH_PROBE');
  let client, released = false, expired = false, timer;
  const lost = () => {};
  const release = destroy => {
    if (!client || released) return;
    released = true;
    client.removeListener('error', lost);
    client.release(destroy || undefined);
  };
  const work = (async () => {
    try {
      client = await pool.connect();
      client.on('error', lost);
      if (expired) { release(true); return { ok:false, code:'DATABASE_TIMEOUT' }; }
      const reached = await client.query({ text:'SELECT current_schema() AS name', query_timeout:timeoutMs });
      if (expired) return { ok:false, code:'DATABASE_TIMEOUT' };
      if (expectedSchema !== null && reached.rows[0]?.name !== expectedSchema) {
        release(true); return { ok:false, code:'DATABASE_SCHEMA_MISMATCH' };
      }
      return { ok:true };
    } catch {
      release(true); return { ok:false, code:expired ? 'DATABASE_TIMEOUT' : 'DATABASE_UNAVAILABLE' };
    } finally { release(expired); }
  })();
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => {
      expired = true;
      resolve({ ok:false, code:'DATABASE_TIMEOUT' });
      release(true); // Discard the checked-out connection, including a query still awaiting a response.
    }, timeoutMs);
  });
  try { return await Promise.race([work, deadline]); }
  finally { clearTimeout(timer); }
}

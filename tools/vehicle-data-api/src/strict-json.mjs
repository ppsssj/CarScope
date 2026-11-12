// Strict JSON for provider responses: fatal UTF-8, size and depth bound, duplicate names refused (JSON.parse keeps the last one
// silently, which would let a response say two things about one field).
export function strictJson(bytes, { maxBytes, maxDepth = 12 } = {}) {
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(maxBytes) || bytes.length > maxBytes) throw new Error('INVALID_PROVIDER_JSON');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('INVALID_PROVIDER_JSON'); }
  let i = 0;
  const fail = () => { throw new Error('INVALID_PROVIDER_JSON'); };
  const space = () => { while (i < text.length && /[ \t\r\n]/.test(text[i])) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') { i += 2; continue; }
      if (c < ' ') fail();
      i++;
      if (c === '"') { try { return JSON.parse(text.slice(start, i)); } catch { fail(); } }
    }
    return fail();
  }
  function value(depth) {
    if (depth > maxDepth) fail();
    space();
    const c = text[i];
    if (c === '"') { string(); return; }
    if (c === '{' || c === '[') {
      i++; space();
      const end = c === '{' ? '}' : ']', keys = new Set();
      if (text[i] === end) { i++; return; }
      for (;;) {
        if (c === '{') {
          space(); if (text[i] !== '"') fail();
          const key = string(); if (keys.has(key)) fail(); keys.add(key);
          space(); if (text[i++] !== ':') fail();
        }
        value(depth + 1); space();
        if (text[i] === end) { i++; return; }
        if (text[i++] !== ',') fail();
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i, i + 64));
    if (!token) fail();
    i += token[0].length;
  }
  value(0); space();
  if (i !== text.length) fail();
  return JSON.parse(text);
}

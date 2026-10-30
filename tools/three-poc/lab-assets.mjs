import { createHash } from "node:crypto";

// HTML parsing normalizes CRLF/CR to LF before checking an inline script's CSP hash.
// Normalize the emitted document too, so Windows checkouts produce the same policy as Linux.
export function prepareLabHtml(source) {
  const html = source.replace(/\r\n?/g, "\n");
  const maps = [...html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)];
  if (maps.length !== 1) throw new Error("Lab requires exactly one inline import map");
  const hash = createHash("sha256").update(maps[0][1]).digest("base64");
  const csp = `default-src 'none'; script-src 'self' 'sha256-${hash}'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:`;
  return { html, csp };
}

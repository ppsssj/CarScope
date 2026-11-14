// P19 design lab host: loopback only, refuses production-like environments,
// serves exactly the lab manifest entries. Camera permission is denied by
// policy because the lab never opens a real camera.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MOBILE_HEADERS } from "../inspection-sync-poc/src/mobile-page.mjs";

export const LAB_ROOT = new URL("./build/toss-lab/", import.meta.url);
const SAFE = /^lab-assets\/[A-Za-z0-9_.-]+\.(js|css)$/;
const PAGES = new Set(["/toss-lab/", "/toss-lab/camera"]);
export const LAB_HEADERS = Object.freeze({
  ...MOBILE_HEADERS,
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
});

export async function labAssets(root = LAB_ROOT) {
  const manifest = JSON.parse(
    await readFile(new URL(".vite/manifest.json", root), "utf8"),
  );
  const names = new Set();
  for (const entry of Object.values(manifest))
    for (const name of [entry.file, ...(entry.css ?? [])]) {
      if (!SAFE.test(name) || name.includes(".."))
        throw Error("INVALID_LAB_MANIFEST");
      names.add(name);
    }
  return names;
}

// Generic lab glyph (dashed square); not a CarScope or Toss brand mark.
const LAB_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#181c21"/><rect x="8" y="8" width="16" height="16" rx="4" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="4 3"/></svg>';

export function assertLocalOnly(env = process.env) {
  if (env.NODE_ENV === "production" || env.RENDER || env.VERCEL)
    throw Error("TOSS_LAB_LOCAL_ONLY");
}

export async function startTossLab({ port = 4189 } = {}) {
  assertLocalOnly();
  const html = await readFile(new URL("toss-lab.html", LAB_ROOT));
  const assets = await labAssets();
  const server = http.createServer(async (req, res) => {
    const authority = `127.0.0.1:${server.address().port}`;
    const deny = (code) => {
      res.writeHead(code, LAB_HEADERS);
      res.end();
    };
    if (
      req.headers.host !== authority ||
      (req.headers.origin && req.headers.origin !== `http://${authority}`)
    )
      return deny(403);
    if (!["GET", "HEAD"].includes(req.method)) return deny(405);
    const u = new URL(req.url, "http://localhost");
    if (u.search) return deny(400);
    try {
      if (u.pathname === "/") {
        res.writeHead(302, { ...LAB_HEADERS, Location: "/toss-lab/" });
        return res.end();
      }
      if (PAGES.has(u.pathname)) {
        res.writeHead(200, {
          ...LAB_HEADERS,
          "Content-Type": "text/html; charset=utf-8",
        });
        return res.end(req.method === "HEAD" ? undefined : html);
      }
      if (u.pathname === "/lab-icon.svg") {
        res.writeHead(200, { ...LAB_HEADERS, "Content-Type": "image/svg+xml" });
        return res.end(req.method === "HEAD" ? undefined : LAB_ICON);
      }
      const name = u.pathname.slice(1);
      if (assets.has(name)) {
        res.writeHead(200, {
          ...LAB_HEADERS,
          "Content-Type": name.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/javascript; charset=utf-8",
        });
        return res.end(
          req.method === "HEAD"
            ? undefined
            : await readFile(new URL(name, LAB_ROOT)),
        );
      }
      return deny(404);
    } catch {
      res.writeHead(500, LAB_HEADERS);
      res.end("LAB_ASSET_UNAVAILABLE");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((r) => server.close(r)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lab = await startTossLab();
  console.log(`P19 design lab (MOCK, local only): ${lab.url}/toss-lab/`);
}

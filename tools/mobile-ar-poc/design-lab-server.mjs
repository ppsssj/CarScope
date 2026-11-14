import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readReactAsset } from "./react-build.mjs";
import { MOBILE_HEADERS } from "../inspection-sync-poc/src/mobile-page.mjs";
const labRoot = new URL("./build/design-lab/", import.meta.url);
const pages = new Set([
  "/design-lab/",
  "/design-lab/scope",
  "/design-lab/atlas",
  "/design-lab/logbook",
]);
const headers = {
  ...MOBILE_HEADERS,
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};
export async function startDesignLab({ port = 4188 } = {}) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.RENDER ||
    process.env.VERCEL
  )
    throw Error("DESIGN_LAB_LOCAL_ONLY");
  const html = await readFile(new URL("design-lab.html", labRoot));
  const server = http.createServer(async (req, res) => {
    const authority = `127.0.0.1:${server.address().port}`;
    if (
      req.headers.host !== authority ||
      (req.headers.origin && req.headers.origin !== `http://${authority}`)
    ) {
      res.writeHead(403, headers);
      res.end();
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, headers);
      res.end();
      return;
    }
    const u = new URL(req.url, "http://localhost");
    if (u.search) {
      res.writeHead(400, headers);
      res.end();
      return;
    }
    try {
      if (u.pathname === "/") {
        res.writeHead(302, { ...headers, Location: "/design-lab/" });
        res.end();
        return;
      }
      if (pages.has(u.pathname)) {
        res.writeHead(200, {
          ...headers,
          "Content-Type": "text/html; charset=utf-8",
        });
        res.end(req.method === "HEAD" ? undefined : html);
        return;
      }
      if (u.pathname === "/lab-icon.svg") {
        res.writeHead(200, { ...headers, "Content-Type": "image/svg+xml" });
        res.end(
          req.method === "HEAD"
            ? undefined
            : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path fill="#19191b" d="M0 0h40v40H0z"/><path fill="#fbb547" d="M10 10h6v16h14v6H10z"/></svg>',
        );
        return;
      }
      if (u.pathname.startsWith("/react-assets/")) {
        const asset = await readReactAsset(u.pathname, labRoot);
        if (asset) {
          res.writeHead(200, { ...headers, "Content-Type": asset.type });
          res.end(req.method === "HEAD" ? undefined : asset.body);
          return;
        }
      }
      res.writeHead(404, headers);
      res.end();
    } catch {
      res.writeHead(500, headers);
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
  const lab = await startDesignLab();
  console.log(`Local simulation only: ${lab.url}/design-lab/`);
}

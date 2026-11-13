// Manifest-only serving: never join a request path onto the filesystem.
import { readFile, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
const root = new URL("./build/react/", import.meta.url);
const safe = /^react-assets\/[A-Za-z0-9_.-]+\.(js|css|svg|png|webp|woff2)$/;
export async function reactAssets() {
  const manifest = JSON.parse(
    await readFile(new URL(".vite/manifest.json", root), "utf8"),
  );
  const names = new Set();
  for (const entry of Object.values(manifest))
    for (const name of [
      entry.file,
      ...(entry.css ?? []),
      ...(entry.assets ?? []),
    ]) {
      if (!safe.test(name) || name.includes(".."))
        throw Error("INVALID_REACT_MANIFEST");
      names.add(name);
    }
  return names;
}
export async function readReactPage({ sync = false } = {}) {
  const html = await readFile(new URL("index.html", root), "utf8");
  return sync
    ? html.replace(
        '<body data-step="intro"',
        '<body data-step="intro" data-sync-host="enabled"',
      )
    : html;
}
export async function readReactAsset(requestPath) {
  const name = requestPath.slice(1);
  if (!(await reactAssets()).has(name)) return null;
  return {
    body: await readFile(new URL(name, root)),
    type: name.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "text/javascript; charset=utf-8",
  };
}
export async function copyReactBuild(output) {
  await mkdir(path.join(output, "react-assets"), { recursive: true });
  for (const name of await reactAssets())
    await copyFile(new URL(name, root), path.join(output, name));
  await copyFile(new URL("index.html", root), path.join(output, "index.html"));
  await copyFile(new URL("index.html", root), path.join(output, "part-info.html"));
}

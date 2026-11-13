import { defineConfig } from "vite";
import { readFile, copyFile } from "node:fs/promises";
import { MOBILE_ASSETS } from "./public-modules.mjs";
const illustrations = new Set([...MOBILE_ASSETS, "favicon.svg"]);
// Keep the public domain modules as source inputs, not a second public copy.
export default defineConfig({
  publicDir: false,
  plugins: [
    {
      name: "carscope-allowlisted-illustrations",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const name = new URL(
            req.url ?? "/",
            "http://localhost",
          ).pathname.slice(1);
          if (!illustrations.has(name)) {
            next();
            return;
          }
          try {
            res.setHeader("Content-Type", "image/svg+xml");
            res.end(
              await readFile(new URL(`./public/${name}`, import.meta.url)),
            );
          } catch {
            res.statusCode = 404;
            res.end();
          }
        });
      },
      async closeBundle() {
        for (const name of illustrations)
          await copyFile(
            new URL(`./public/${name}`, import.meta.url),
            new URL(`./build/react/${name}`, import.meta.url),
          );
        await copyFile(
          new URL("./build/react/index.html", import.meta.url),
          new URL("./build/react/part-info.html", import.meta.url),
        );
      },
    },
  ],
  build: {
    outDir: "build/react",
    manifest: true,
    assetsDir: "react-assets",
    target: "es2022",
  },
  server: { host: "127.0.0.1" },
});

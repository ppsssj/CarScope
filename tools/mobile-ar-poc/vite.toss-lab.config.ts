import { defineConfig } from "vite";
// P19 design lab: separate entry and output; the product config is untouched.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "build/toss-lab",
    manifest: true,
    assetsDir: "lab-assets",
    target: "es2022",
    rolldownOptions: { input: "toss-lab.html" },
  },
  server: { host: "127.0.0.1" },
});

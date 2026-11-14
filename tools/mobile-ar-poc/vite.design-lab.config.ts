import { defineConfig } from "vite";
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "build/design-lab",
    manifest: true,
    assetsDir: "react-assets",
    target: "es2022",
    rolldownOptions: { input: "design-lab.html" },
  },
});

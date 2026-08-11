import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.APP_VERSION": JSON.stringify(process.env.APP_VERSION?.trim() || pkg.version),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: process.env.HOST?.trim() || "localhost",
    port: Number(process.env.PORT ?? 5733),
    strictPort: true,
  },
});

import { defineConfig } from "vite-plus";

const shouldLaunchElectronAfterPack = process.env.T3CODE_DESKTOP_DEV === "1";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "vp pack",
        dependsOn: ["@t3-codex/web#build"],
        cache: false,
      },
      dev: {
        command: "cross-env T3CODE_DESKTOP_DEV=1 vp pack --watch",
        cache: false,
      },
      "dev:bundle": {
        command: "vp pack --watch",
        cache: false,
      },
      "dev:electron": {
        command: "node scripts/dev-electron.mjs",
        cache: false,
      },
    },
  },
  pack: [
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/main.ts"],
      clean: true,
      ...(shouldLaunchElectronAfterPack ? { onSuccess: "node scripts/dev-electron.mjs" } : {}),
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preload.ts"],
    },
  ],
});

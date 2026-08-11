import { assert, it } from "vite-plus/test";

import { resolveElectronBinaryPath } from "./electron-launcher.mjs";

it("repairs Electron before resolving the package entrypoint", () => {
  const calls = [];
  const electronPath = resolveElectronBinaryPath({
    ensureRuntime: () => calls.push("ensure"),
    createRequire: () => (specifier) => {
      calls.push(`require:${specifier}`);
      return "/repo/node_modules/electron/dist/electron";
    },
    moduleUrl: import.meta.url,
  });

  assert.equal(electronPath, "/repo/node_modules/electron/dist/electron");
  assert.deepEqual(calls, ["ensure", "require:electron"]);
});

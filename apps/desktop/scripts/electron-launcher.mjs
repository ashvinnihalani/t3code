import * as NodeModule from "node:module";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { ensureElectronRuntime } from "./ensure-electron-runtime.mjs";

export const desktopDir = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);

export function resolveElectronBinaryPath({
  ensureRuntime = ensureElectronRuntime,
  createRequire = NodeModule.createRequire,
  moduleUrl = import.meta.url,
} = {}) {
  ensureRuntime();
  return createRequire(moduleUrl)("electron");
}

function linuxSandboxArgs(electronPath) {
  if (NodeOS.platform() !== "linux") return [];

  const sandboxPath = NodePath.join(NodePath.dirname(electronPath), "chrome-sandbox");
  try {
    const stat = NodeFS.statSync(sandboxPath);
    if (stat.uid === 0 && (stat.mode & 0o4777) === 0o4755) return [];
  } catch {
    // Local development can still run with Chromium's sandbox disabled.
  }

  console.warn("[desktop] Electron chrome-sandbox is unavailable; using --no-sandbox.");
  return ["--no-sandbox"];
}

export function resolveElectronLaunchCommand(args = []) {
  const electronPath = resolveElectronBinaryPath();
  return { electronPath, args: [...linuxSandboxArgs(electronPath), ...args] };
}

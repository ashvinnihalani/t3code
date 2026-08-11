import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";

import { desktopDir, resolveElectronLaunchCommand } from "./electron-launcher.mjs";
import { waitForResources } from "./wait-for-resources.mjs";

const developmentUrl = process.env.VITE_DEV_SERVER_URL?.trim();
if (!developmentUrl) throw new Error("VITE_DEV_SERVER_URL is required for desktop development.");

const parsedUrl = new URL(developmentUrl);
const port = Number.parseInt(parsedUrl.port, 10);
if (!Number.isInteger(port) || port < 1) {
  throw new Error(`VITE_DEV_SERVER_URL must include an explicit port: ${developmentUrl}`);
}

await waitForResources({
  baseDir: desktopDir,
  files: ["dist-electron/main.cjs", "dist-electron/preload.cjs"],
  tcpHost: parsedUrl.hostname,
  tcpPort: port,
});

const isWindows = NodeOS.platform() === "win32";
const childEnvironment = { ...process.env };
delete childEnvironment.ELECTRON_RUN_AS_NODE;

let appProcess = null;
let restartTimer = null;
let shuttingDown = false;

function startApp() {
  const command = resolveElectronLaunchCommand(["dist-electron/main.cjs"]);
  appProcess = NodeChildProcess.spawn(command.electronPath, command.args, {
    cwd: desktopDir,
    env: childEnvironment,
    stdio: "inherit",
    detached: !isWindows,
  });
  appProcess.once("exit", () => {
    appProcess = null;
  });
}

function stopApp(signal = "SIGTERM") {
  if (appProcess?.pid === undefined) return;
  if (isWindows) appProcess.kill(signal);
  else process.kill(-appProcess.pid, signal);
  appProcess = null;
}

function restartApp() {
  if (shuttingDown) return;
  if (restartTimer !== null) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    stopApp();
    startApp();
  }, 120);
}

const watcher = NodeFS.watch(`${desktopDir}/dist-electron`, (_event, filename) => {
  if (filename === "main.cjs" || filename === "preload.cjs") restartApp();
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  watcher.close();
  if (restartTimer !== null) clearTimeout(restartTimer);
  stopApp(signal);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => shutdown(signal));
}

startApp();

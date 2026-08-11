import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { resolveElectronLaunchCommand } from "./electron-launcher.mjs";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopDir = NodePath.resolve(__dirname, "..");
const mainJs = NodePath.resolve(desktopDir, "dist-electron/main.cjs");
const packagedExecutable = process.argv[2];

console.log(
  `\nLaunching ${packagedExecutable === undefined ? "Electron" : "packaged app"} smoke test...`,
);

const electronCommand =
  packagedExecutable === undefined
    ? resolveElectronLaunchCommand([mainJs])
    : { electronPath: NodePath.resolve(packagedExecutable), args: [] };
const child = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "",
    ELECTRON_ENABLE_LOGGING: "1",
  },
});

let output = "";
let didTimeOut = false;
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const timeout = setTimeout(() => {
  didTimeOut = true;
  child.kill();
}, 8_000);

child.on("exit", (code) => {
  clearTimeout(timeout);

  const fatalPatterns = [
    "Cannot find module",
    "Electron failed to install correctly",
    "MODULE_NOT_FOUND",
    "Refused to execute",
    "Uncaught Exception",
    "Uncaught Error",
    "Uncaught TypeError",
    "Uncaught ReferenceError",
  ];
  const failures = fatalPatterns.filter((pattern) => output.includes(pattern));
  if (!didTimeOut && code !== 0) {
    failures.push(`Electron exited early with code ${String(code)}`);
  }

  if (failures.length > 0) {
    console.error("\nDesktop smoke test failed:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    console.error("\nFull output:\n" + output);
    process.exit(1);
  }

  console.log("Desktop smoke test passed.");
  process.exit(0);
});

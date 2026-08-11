import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const port = Number.parseInt(process.env.PORT ?? "5733", 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`PORT must be an integer from 1 to 65535; received ${process.env.PORT}.`);
}

const host = process.env.HOST?.trim() || "127.0.0.1";
const vp = NodePath.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vp.cmd" : "vp",
);
const child = NodeChildProcess.spawn(
  vp,
  ["run", "--filter=@t3-codex/desktop", "--filter=@t3-codex/web", "--parallel", "dev"],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
      VITE_DEV_SERVER_URL: `http://${host}:${port}`,
    },
    stdio: "inherit",
  },
);

const forwardSignal = (signal) => {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
};

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => forwardSignal(signal));
}

child.once("error", (error) => {
  console.error(`Unable to start the T3 Codex development process: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

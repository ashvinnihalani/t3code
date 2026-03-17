import { spawnSync } from "node:child_process";

import {
  buildEnvironmentCaptureCommand,
  extractEnvironmentFromShellOutput,
} from "@t3tools/shared/shell";

const SHELL_ENV_CAPTURE_TIMEOUT_MS = 5_000;
const REMOTE_PATH_ENV_CACHE_TTL_MS = 15_000;

const remotePathEnvCache = new Map<
  string,
  {
    readonly value: string | null;
    readonly readAt: number;
  }
>();

export function quotePosixShell(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function buildSshShellInvocation(command: string): string {
  return `sh -lc ${quotePosixShell(command)}`;
}

export function readRemoteEnvironmentFromLoginShell(input: {
  readonly hostAlias: string;
  readonly localCwd: string;
  readonly names: ReadonlyArray<string>;
}): Partial<Record<string, string>> {
  if (input.names.length === 0) {
    return {};
  }

  const captureCommand = buildEnvironmentCaptureCommand(input.names);
  const result = spawnSync(
    "ssh",
    [
      "-T",
      input.hostAlias,
      buildSshShellInvocation(
        `shell_bin=\${SHELL:-/bin/sh}; exec "$shell_bin" -ilc ${quotePosixShell(captureCommand)}`,
      ),
    ],
    {
      cwd: input.localCwd,
      env: process.env,
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: SHELL_ENV_CAPTURE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    },
  );

  if (result.error || result.status !== 0) {
    return {};
  }

  return extractEnvironmentFromShellOutput(
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    input.names,
  );
}

export function readRemotePathEnv(input: {
  readonly hostAlias: string;
  readonly localCwd: string;
}): string | undefined {
  const cacheKey = `${input.hostAlias}\u0000${input.localCwd}`;
  const cached = remotePathEnvCache.get(cacheKey);
  if (cached && Date.now() - cached.readAt < REMOTE_PATH_ENV_CACHE_TTL_MS) {
    return cached.value ?? undefined;
  }

  const remoteEnvironment = readRemoteEnvironmentFromLoginShell({
    hostAlias: input.hostAlias,
    localCwd: input.localCwd,
    names: ["PATH"],
  });
  const pathEnv = remoteEnvironment.PATH?.trim() || null;
  remotePathEnvCache.set(cacheKey, {
    value: pathEnv,
    readAt: Date.now(),
  });
  return pathEnv ?? undefined;
}

export function buildRemoteExecCommand(input: {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly pathEnv?: string;
}): string {
  const commands: string[] = [];
  if (input.cwd) {
    commands.push(`cd ${quotePosixShell(input.cwd)}`);
  }
  if (input.pathEnv) {
    commands.push(`export PATH=${quotePosixShell(input.pathEnv)}`);
  }
  if (input.env) {
    for (const [key, value] of Object.entries(input.env)) {
      commands.push(`export ${key}=${quotePosixShell(value)}`);
    }
  }
  const commandArgs = input.args?.map(quotePosixShell).join(" ") ?? "";
  commands.push(
    commandArgs.length > 0
      ? `exec ${quotePosixShell(input.command)} ${commandArgs}`
      : `exec ${quotePosixShell(input.command)}`,
  );
  return commands.join(" && ");
}

export function buildSshExecArgs(input: {
  readonly hostAlias: string;
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly localCwd: string;
}): string[] {
  const pathEnv = readRemotePathEnv({
    hostAlias: input.hostAlias,
    localCwd: input.localCwd,
  });
  return [
    "-T",
    input.hostAlias,
    buildSshShellInvocation(
      buildRemoteExecCommand({
        command: input.command,
        ...(input.args ? { args: input.args } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.env ? { env: input.env } : {}),
        ...(pathEnv ? { pathEnv } : {}),
      }),
    ),
  ];
}

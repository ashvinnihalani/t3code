import type { DockerSandbox, ProjectRemoteTarget } from "@t3tools/contracts";

import {
  buildRemoteExecCommand,
  buildSshExecArgs,
  quotePosixShell,
  readRemotePathEnv,
} from "./sshCommand";

export const DEVCONTAINER_THREAD_ID_LABEL_KEY = "t3code.thread_id";
export const DEVCONTAINER_PROJECT_ID_LABEL_KEY = "t3code.project_id";
export const DEVCONTAINER_HOST_ALIAS_LABEL_KEY = "t3code.host_alias";

export type CommandTransportTarget =
  | {
      kind: "host";
      hostKind: "local" | "ssh";
      remote?: ProjectRemoteTarget | null;
    }
  | {
      kind: "devcontainer";
      hostKind: "local" | "ssh";
      remote?: ProjectRemoteTarget | null;
      projectWorkspaceRoot: string;
      threadIdLabel: string;
      dockerSandbox: DockerSandbox;
    };

export interface CommandTransportInvocation {
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export function hostKindForRemote(remote?: ProjectRemoteTarget | null): "local" | "ssh" {
  return remote?.kind === "ssh" ? "ssh" : "local";
}

export function threadDevcontainerIdLabel(threadId: string): string {
  return `${DEVCONTAINER_THREAD_ID_LABEL_KEY}=${threadId}`;
}

export function buildHostCommandTransportTarget(
  remote?: ProjectRemoteTarget | null,
): Extract<CommandTransportTarget, { kind: "host" }> {
  return {
    kind: "host",
    hostKind: hostKindForRemote(remote),
    ...(remote ? { remote } : {}),
  };
}

function buildDevcontainerShellCommand(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Record<string, string>;
}): string {
  const commands = [`cd ${quotePosixShell(input.cwd)}`];

  if (input.env) {
    for (const [key, value] of Object.entries(input.env)) {
      commands.push(`export ${key}=${quotePosixShell(value)}`);
    }
  }

  commands.push('export T3CODE_ORIGINAL_PATH="${T3CODE_ORIGINAL_PATH:-$PATH}"');
  commands.push('export PATH="/tmp/t3code/bin:${T3CODE_ORIGINAL_PATH}"');

  const commandArgs = input.args.map(quotePosixShell).join(" ");
  commands.push(
    commandArgs.length > 0
      ? `exec ${quotePosixShell(input.command)} ${commandArgs}`
      : `exec ${quotePosixShell(input.command)}`,
  );

  return commands.join(" && ");
}

function buildDevcontainerExecArgs(input: {
  readonly target: Extract<CommandTransportTarget, { kind: "devcontainer" }>;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}): string[] {
  const innerCommand = buildDevcontainerShellCommand({
    command: input.command,
    args: input.args,
    cwd: input.cwd ?? input.target.dockerSandbox.workspaceFolder,
    ...(input.env ? { env: input.env } : {}),
  });

  const execArgs = [
    "exec",
    "--workspace-folder",
    input.target.projectWorkspaceRoot,
    "--config",
    input.target.dockerSandbox.configSource,
    "--id-label",
    input.target.threadIdLabel,
  ];

  execArgs.push("sh", "-lc", innerCommand);
  return execArgs;
}

export function buildCommandTransportInvocation(input: {
  readonly target: CommandTransportTarget;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly localCwd: string;
  readonly parentEnv?: NodeJS.ProcessEnv;
}): CommandTransportInvocation {
  const args = [...(input.args ?? [])];
  const parentEnv = input.parentEnv ?? process.env;

  if (input.target.kind === "host") {
    if (input.target.hostKind === "ssh" && input.target.remote?.kind === "ssh") {
      return {
        command: "ssh",
        args: buildSshExecArgs({
          hostAlias: input.target.remote.hostAlias,
          command: input.command,
          args,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.env ? { env: input.env } : {}),
          localCwd: input.localCwd,
        }),
        cwd: input.localCwd,
        env: parentEnv,
      };
    }

    return {
      command: input.command,
      args,
      cwd: input.cwd ?? input.localCwd,
      env: {
        ...parentEnv,
        ...(input.env ?? {}),
      },
    };
  }

  const devcontainerArgs = buildDevcontainerExecArgs({
    target: input.target,
    command: input.command,
    args,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.env ? { env: input.env } : {}),
  });

  if (input.target.hostKind === "ssh" && input.target.remote?.kind === "ssh") {
    const pathEnv = readRemotePathEnv({
      hostAlias: input.target.remote.hostAlias,
      localCwd: input.localCwd,
    });
    return {
      command: "ssh",
      args: [
        "-T",
        input.target.remote.hostAlias,
        `sh -lc ${quotePosixShell(
          buildRemoteExecCommand({
            command: "devcontainer",
            args: devcontainerArgs,
            cwd: input.target.projectWorkspaceRoot,
            ...(pathEnv ? { pathEnv } : {}),
          }),
        )}`,
      ],
      cwd: input.localCwd,
      env: parentEnv,
    };
  }

  return {
    command: "devcontainer",
    args: devcontainerArgs,
    cwd: input.localCwd,
    env: parentEnv,
  };
}

export function buildDevcontainerUpArgs(input: {
  readonly workspaceRoot: string;
  readonly configSource: string;
  readonly idLabel: string;
  readonly overrideConfigPath?: string;
  readonly removeExistingContainer?: boolean;
}): string[] {
  const args = [
    "up",
    "--workspace-folder",
    input.workspaceRoot,
    "--config",
    input.configSource,
    "--id-label",
    input.idLabel,
    "--log-format",
    "json",
  ];

  if (input.overrideConfigPath) {
    args.push("--override-config", input.overrideConfigPath);
  }
  if (input.removeExistingContainer) {
    args.push("--remove-existing-container");
  }

  return args;
}

export function buildDevcontainerReadConfigurationArgs(input: {
  readonly workspaceRoot: string;
  readonly configSource?: string;
}): string[] {
  const args = [
    "read-configuration",
    "--workspace-folder",
    input.workspaceRoot,
    "--include-merged-configuration",
    "--log-format",
    "json",
  ];
  if (input.configSource) {
    args.push("--config", input.configSource);
  }
  return args;
}

export function buildDockerRemoveByLabelCommand(idLabel: string): string {
  return `ids="$(docker container ls -aq --filter label=${quotePosixShell(idLabel)})"; if [ -n "$ids" ]; then docker rm -f $ids; fi`;
}

export function buildProjectLabels(input: {
  readonly threadId: string;
  readonly projectId: string;
  readonly remote?: ProjectRemoteTarget | null;
}): Record<string, string> {
  return {
    [DEVCONTAINER_THREAD_ID_LABEL_KEY]: input.threadId,
    [DEVCONTAINER_PROJECT_ID_LABEL_KEY]: input.projectId,
    [DEVCONTAINER_HOST_ALIAS_LABEL_KEY]:
      input.remote?.kind === "ssh" ? input.remote.hostAlias : "local",
  };
}

export function buildStableDevcontainerName(input: {
  readonly threadId: string;
  readonly projectId: string;
}): string {
  return `t3code-${input.projectId}-${input.threadId}`.replace(/[^a-zA-Z0-9_.-]+/g, "-");
}

export function buildGitShimInstallCommand(safeDirectory: string): string {
  const shimDir = "/tmp/t3code/bin";
  const shimPath = `${shimDir}/git`;
  const script = [
    `mkdir -p ${quotePosixShell(shimDir)}`,
    `cat > ${quotePosixShell(shimPath)} <<'EOF'`,
    "#!/bin/sh",
    'set -eu',
    'actual_git="$(PATH=${T3CODE_ORIGINAL_PATH:-$PATH} command -v git 2>/dev/null || true)"',
    'if [ -z "$actual_git" ]; then',
    '  echo "git is required inside this devcontainer but was not found." >&2',
    "  exit 127",
    "fi",
    `"$actual_git" config --global --add safe.directory ${quotePosixShell(safeDirectory)} >/dev/null 2>&1 || true`,
    'exec "$actual_git" "$@"',
    "EOF",
    `chmod +x ${quotePosixShell(shimPath)}`,
  ].join("\n");

  return script;
}

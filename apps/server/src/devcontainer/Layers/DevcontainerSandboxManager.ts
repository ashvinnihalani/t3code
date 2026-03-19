import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { DockerSandbox } from "@t3tools/contracts";
import { Effect, Layer } from "effect";

import {
  buildCommandTransportInvocation,
  buildDevcontainerReadConfigurationArgs,
  buildDevcontainerUpArgs,
  buildDockerRemoveByLabelCommand,
  buildGitShimInstallCommand,
  buildHostCommandTransportTarget,
  buildProjectLabels,
  buildStableDevcontainerName,
  hostKindForRemote,
  threadDevcontainerIdLabel,
} from "../../commandTransport";
import { runProcess } from "../../processRunner";
import {
  DevcontainerSandboxError,
  DevcontainerSandboxManager,
  type DevcontainerSandboxManagerShape,
} from "../Services/DevcontainerSandboxManager";

function sandboxError(operation: string, message: string, cause?: unknown): DevcontainerSandboxError {
  return new DevcontainerSandboxError({
    operation,
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function normalizeCommandRequirementMessage(
  hostKind: "local" | "ssh",
  command: "devcontainer" | "docker",
): string {
  return hostKind === "ssh"
    ? `Docker sandbox threads require '${command}' on the selected SSH host.`
    : `Docker sandbox threads require '${command}' on the local host.`;
}

function readTrailingJsonObject(text: string): Record<string, unknown> | null {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines[index];
    if (!candidate?.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore non-JSON log lines.
    }
  }

  return null;
}

function readString(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readArray(record: Record<string, unknown> | null, key: string): string[] {
  const value = record?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function readNestedRecord(
  record: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRemoteWorkspaceFolder(payload: Record<string, unknown> | null): string | undefined {
  return (
    readString(payload, "remoteWorkspaceFolder") ??
    readString(payload, "workspaceFolder") ??
    readString(readNestedRecord(payload, "configuration"), "workspaceFolder") ??
    readString(readNestedRecord(payload, "mergedConfiguration"), "workspaceFolder")
  );
}

function normalizeProcessFailureMessage(
  hostKind: "local" | "ssh",
  operation: string,
  error: unknown,
): DevcontainerSandboxError {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("command not found: devcontainer")) {
    return sandboxError(operation, normalizeCommandRequirementMessage(hostKind, "devcontainer"), error);
  }

  if (normalized.includes("command not found: docker")) {
    return sandboxError(operation, normalizeCommandRequirementMessage(hostKind, "docker"), error);
  }

  return sandboxError(operation, message, error);
}

const makeDevcontainerSandboxManager = Effect.gen(function* () {
  const localCwd = process.cwd();

  const runOnHost = Effect.fn(function* (input: {
    readonly operation: string;
    readonly remote?: { kind: "ssh"; hostAlias: string } | null;
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly allowNonZeroExit?: boolean;
    readonly timeoutMs?: number;
    readonly maxBufferBytes?: number;
  }) {
    const target = buildHostCommandTransportTarget(input.remote);
    const invocation = buildCommandTransportInvocation({
      target,
      command: input.command,
      args: input.args,
      localCwd,
    });

    return yield* Effect.tryPromise({
      try: () =>
        runProcess(invocation.command, invocation.args, {
          cwd: invocation.cwd,
          env: invocation.env,
          timeoutMs: input.timeoutMs,
          maxBufferBytes: input.maxBufferBytes,
          allowNonZeroExit: input.allowNonZeroExit,
          outputMode: "truncate",
        }),
      catch: (cause) => normalizeProcessFailureMessage(target.hostKind, input.operation, cause),
    });
  });

  const resolveConfigSource = Effect.fn(function* (input: {
    readonly remote?: { kind: "ssh"; hostAlias: string } | null;
    readonly projectWorkspaceRoot: string;
    readonly persistedDockerSandbox?: DockerSandbox | null;
  }): Effect.Effect<string, DevcontainerSandboxError> {
    const candidates = [
      input.persistedDockerSandbox?.configSource,
      path.posix.join(input.projectWorkspaceRoot, ".devcontainer", "devcontainer.json"),
      path.posix.join(input.projectWorkspaceRoot, ".devcontainer.json"),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

    for (const candidate of candidates) {
      const result = yield* runOnHost({
        operation: "DevcontainerSandboxManager.resolveConfigSource",
        remote: input.remote,
        command: "test",
        args: ["-f", candidate],
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxBufferBytes: 4_096,
      });
      if (result.code === 0) {
        return candidate;
      }
    }

    return yield* Effect.fail(
      sandboxError(
        "DevcontainerSandboxManager.resolveConfigSource",
        "Docker sandbox mode requires a repo devcontainer definition (.devcontainer/devcontainer.json or .devcontainer.json).",
      ),
    );
  });

  const readConfiguration = Effect.fn(function* (input: {
    readonly remote?: { kind: "ssh"; hostAlias: string } | null;
    readonly projectWorkspaceRoot: string;
    readonly configSource: string;
  }) {
    const result = yield* runOnHost({
      operation: "DevcontainerSandboxManager.readConfiguration",
      remote: input.remote,
      command: "devcontainer",
      args: buildDevcontainerReadConfigurationArgs({
        workspaceRoot: input.projectWorkspaceRoot,
        configSource: input.configSource,
      }),
      timeoutMs: 30_000,
      maxBufferBytes: 2 * 1024 * 1024,
    });

    return readTrailingJsonObject(`${result.stdout}\n${result.stderr}`);
  });

  const exec: DevcontainerSandboxManagerShape["exec"] = Effect.fn(function* (input) {
    const invocation = buildCommandTransportInvocation({
      target: input.target,
      command: input.command,
      ...(input.args ? { args: input.args } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.env ? { env: input.env } : {}),
      localCwd,
    });

    return yield* Effect.tryPromise({
      try: () =>
        runProcess(invocation.command, invocation.args, {
          cwd: invocation.cwd,
          env: invocation.env,
          timeoutMs: input.timeoutMs,
          maxBufferBytes: input.maxBufferBytes,
          allowNonZeroExit: input.allowNonZeroExit,
          outputMode: "truncate",
        }),
      catch: (cause) =>
        normalizeProcessFailureMessage(input.target.hostKind, "DevcontainerSandboxManager.exec", cause),
    }).pipe(
      Effect.map((result) => ({
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
      })),
    );
  });

  const ensure: DevcontainerSandboxManagerShape["ensure"] = Effect.fn(function* (input) {
    const hostKind = hostKindForRemote(input.remote);
    const configSource = yield* resolveConfigSource({
      remote: input.remote,
      projectWorkspaceRoot: input.projectWorkspaceRoot,
      persistedDockerSandbox: input.persistedDockerSandbox,
    });
    const configuration = yield* readConfiguration({
      remote: input.remote,
      projectWorkspaceRoot: input.projectWorkspaceRoot,
      configSource,
    });
    const workspaceFolder =
      readRemoteWorkspaceFolder(configuration) ??
      input.persistedDockerSandbox?.workspaceFolder ??
      input.projectWorkspaceRoot;
    const labels = buildProjectLabels({
      threadId: input.threadId,
      projectId: input.projectId,
      remote: input.remote,
    });
    const renderedContainerName =
      input.overrides?.containerName?.trim() ||
      input.persistedDockerSandbox?.containerName ||
      buildStableDevcontainerName({
        threadId: input.threadId,
        projectId: input.projectId,
      });
    const extraRunArgs = input.overrides?.extraRunArgs ?? input.persistedDockerSandbox?.runArgs ?? [];
    const runArgs = [
      ...extraRunArgs,
      "--name",
      renderedContainerName,
      ...Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
    ];

    const overrideConfigPath = path.join(
      os.tmpdir(),
      `t3code-devcontainer-${input.projectId}-${input.threadId}-${Date.now()}.json`,
    );

    yield* Effect.tryPromise({
      try: () =>
        fs.writeFile(
          overrideConfigPath,
          JSON.stringify({
            name: renderedContainerName,
            runArgs,
          }),
          "utf8",
        ),
      catch: (cause) =>
        sandboxError(
          "DevcontainerSandboxManager.ensure.writeOverride",
          "Failed to prepare the devcontainer override configuration.",
          cause,
        ),
    });

    const upResult = yield* Effect.acquireUseRelease(
      Effect.succeed(overrideConfigPath),
      () =>
        runOnHost({
          operation: "DevcontainerSandboxManager.ensure.up",
          remote: input.remote,
          command: "devcontainer",
          args: buildDevcontainerUpArgs({
            workspaceRoot: input.projectWorkspaceRoot,
            configSource,
            idLabel: threadDevcontainerIdLabel(input.threadId),
            overrideConfigPath,
          }),
          timeoutMs: 10 * 60_000,
          maxBufferBytes: 10 * 1024 * 1024,
        }),
      () =>
        Effect.tryPromise({
          try: () => fs.rm(overrideConfigPath, { force: true }),
          catch: () => undefined,
        }).pipe(Effect.orDie),
    );

    const upPayload = readTrailingJsonObject(`${upResult.stdout}\n${upResult.stderr}`);
    const dockerSandbox: DockerSandbox = {
      hostKind,
      workspaceFolder: readRemoteWorkspaceFolder(upPayload) ?? workspaceFolder,
      containerName: renderedContainerName,
      configSource,
      runArgs,
      containerId: readString(upPayload, "containerId"),
    };

    const target = {
      kind: "devcontainer" as const,
      hostKind,
      ...(input.remote ? { remote: input.remote } : {}),
      projectWorkspaceRoot: input.projectWorkspaceRoot,
      threadIdLabel: threadDevcontainerIdLabel(input.threadId),
      dockerSandbox,
    };

    yield* exec({
      target,
      command: "sh",
      args: ["-lc", buildGitShimInstallCommand(dockerSandbox.workspaceFolder)],
      timeoutMs: 30_000,
      maxBufferBytes: 512 * 1024,
    }).pipe(
      Effect.mapError((cause) =>
        sandboxError(
          "DevcontainerSandboxManager.ensure.installGitShim",
          cause.message,
          cause,
        ),
      ),
    );

    return {
      dockerSandbox,
      target,
    };
  });

  const describe: DevcontainerSandboxManagerShape["describe"] = Effect.fn(function* (input) {
    const configSource = yield* resolveConfigSource({
      remote: input.remote,
      projectWorkspaceRoot: input.projectWorkspaceRoot,
      persistedDockerSandbox: input.persistedDockerSandbox,
    });
    const configuration = yield* readConfiguration({
      remote: input.remote,
      projectWorkspaceRoot: input.projectWorkspaceRoot,
      configSource,
    });

    return {
      hostKind: hostKindForRemote(input.remote),
      workspaceFolder:
        readRemoteWorkspaceFolder(configuration) ??
        input.persistedDockerSandbox?.workspaceFolder ??
        input.projectWorkspaceRoot,
      containerName:
        input.persistedDockerSandbox?.containerName ??
        buildStableDevcontainerName({
          threadId: input.threadId,
          projectId: "thread",
        }),
      configSource,
      runArgs: readArray(readNestedRecord(configuration, "configuration"), "runArgs"),
      containerId: input.persistedDockerSandbox?.containerId,
    } satisfies DockerSandbox;
  });

  const remove: DevcontainerSandboxManagerShape["remove"] = Effect.fn(function* (input) {
    const idLabel = threadDevcontainerIdLabel(input.threadId);
    yield* runOnHost({
      operation: "DevcontainerSandboxManager.remove",
      remote: input.remote,
      command: "sh",
      args: [
        "-lc",
        input.dockerSandbox?.containerId
          ? `docker rm -f ${input.dockerSandbox.containerId}`
          : buildDockerRemoveByLabelCommand(idLabel),
      ],
      allowNonZeroExit: true,
      timeoutMs: 60_000,
      maxBufferBytes: 256 * 1024,
    }).pipe(Effect.asVoid);
  });

  return {
    ensure,
    describe,
    exec,
    remove,
  } satisfies DevcontainerSandboxManagerShape;
});

export const DevcontainerSandboxManagerLive = Layer.effect(
  DevcontainerSandboxManager,
  makeDevcontainerSandboxManager,
);

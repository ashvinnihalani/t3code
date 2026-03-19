import type {
  DockerSandboxOverrides,
  OrchestrationProject,
  OrchestrationThread,
  ProviderSessionStartInput,
} from "@t3tools/contracts";
import { Effect } from "effect";

import {
  buildHostCommandTransportTarget,
  hostKindForRemote,
  threadDevcontainerIdLabel,
} from "./commandTransport";
import { resolveThreadWorkspaceCwd } from "./checkpointing/Utils";
import { DevcontainerSandboxManager } from "./devcontainer/Services/DevcontainerSandboxManager";

export interface ResolvedThreadExecutionTarget {
  readonly cwd: string;
  readonly executionTarget: NonNullable<ProviderSessionStartInput["executionTarget"]>;
  readonly remote: OrchestrationProject["remote"] | null;
  readonly dockerSandbox: OrchestrationThread["dockerSandbox"];
}

export const resolveThreadExecutionTarget = Effect.fn(function* (input: {
  readonly thread: OrchestrationThread;
  readonly project: OrchestrationProject;
  readonly dockerSandboxOverrides?: DockerSandboxOverrides | null;
}) {
  const remote = input.project.remote ?? null;

  if (input.thread.envMode !== "docker") {
    return {
      cwd: resolveThreadWorkspaceCwd({
        thread: input.thread,
        projects: [input.project],
      }),
      executionTarget: {
        kind: "host" as const,
        hostKind: hostKindForRemote(remote),
        ...(remote ? { remote } : {}),
      },
      remote,
      dockerSandbox: input.thread.dockerSandbox,
    } satisfies ResolvedThreadExecutionTarget;
  }

  const sandboxManager = yield* DevcontainerSandboxManager;
  const ensured = yield* sandboxManager.ensure({
    threadId: input.thread.id,
    projectId: input.project.id,
    projectWorkspaceRoot: input.project.workspaceRoot,
    ...(remote ? { remote } : {}),
    persistedDockerSandbox: input.thread.dockerSandbox,
    ...(input.dockerSandboxOverrides ? { overrides: input.dockerSandboxOverrides } : {}),
  });

  return {
    cwd: ensured.dockerSandbox.workspaceFolder,
    executionTarget: {
      kind: "devcontainer" as const,
      hostKind: ensured.target.hostKind,
      ...(remote ? { remote } : {}),
      projectWorkspaceRoot: input.project.workspaceRoot,
      threadIdLabel: threadDevcontainerIdLabel(input.thread.id),
      dockerSandbox: ensured.dockerSandbox,
    },
    remote,
    dockerSandbox: ensured.dockerSandbox,
  } satisfies ResolvedThreadExecutionTarget;
});

export function buildHostExecutionTarget(
  remote?: OrchestrationProject["remote"] | null,
): NonNullable<ProviderSessionStartInput["executionTarget"]> {
  const target = buildHostCommandTransportTarget(remote);
  return {
    kind: "host",
    hostKind: target.hostKind,
    ...(target.remote ? { remote: target.remote } : {}),
  };
}

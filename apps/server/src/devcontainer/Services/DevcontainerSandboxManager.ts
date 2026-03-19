import type {
  DockerSandbox,
  DockerSandboxOverrides,
  ProjectId,
  ProjectRemoteTarget,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Schema, ServiceMap } from "effect";

import type { CommandTransportTarget } from "../../commandTransport";

export class DevcontainerSandboxError extends Schema.TaggedErrorClass<DevcontainerSandboxError>()(
  "DevcontainerSandboxError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface DevcontainerSandboxEnsureInput {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly projectWorkspaceRoot: string;
  readonly remote?: ProjectRemoteTarget | null;
  readonly persistedDockerSandbox?: DockerSandbox | null;
  readonly overrides?: DockerSandboxOverrides | null;
}

export interface DevcontainerSandboxDescribeInput {
  readonly threadId: ThreadId;
  readonly projectWorkspaceRoot: string;
  readonly remote?: ProjectRemoteTarget | null;
  readonly persistedDockerSandbox?: DockerSandbox | null;
}

export interface DevcontainerSandboxRemoveInput {
  readonly threadId: ThreadId;
  readonly remote?: ProjectRemoteTarget | null;
  readonly dockerSandbox?: DockerSandbox | null;
}

export interface DevcontainerSandboxEnsureResult {
  readonly dockerSandbox: DockerSandbox;
  readonly target: Extract<CommandTransportTarget, { kind: "devcontainer" }>;
}

export interface DevcontainerSandboxManagerShape {
  readonly ensure: (
    input: DevcontainerSandboxEnsureInput,
  ) => Effect.Effect<DevcontainerSandboxEnsureResult, DevcontainerSandboxError>;
  readonly describe: (
    input: DevcontainerSandboxDescribeInput,
  ) => Effect.Effect<DockerSandbox | null, DevcontainerSandboxError>;
  readonly exec: (input: {
    readonly target: Extract<CommandTransportTarget, { kind: "devcontainer" }>;
    readonly command: string;
    readonly args?: ReadonlyArray<string>;
    readonly cwd?: string;
    readonly env?: Record<string, string>;
    readonly timeoutMs?: number;
    readonly maxBufferBytes?: number;
    readonly allowNonZeroExit?: boolean;
  }) => Effect.Effect<
    {
      readonly code: number | null;
      readonly stdout: string;
      readonly stderr: string;
    },
    DevcontainerSandboxError
  >;
  readonly remove: (
    input: DevcontainerSandboxRemoveInput,
  ) => Effect.Effect<void, DevcontainerSandboxError>;
}

export class DevcontainerSandboxManager extends ServiceMap.Service<
  DevcontainerSandboxManager,
  DevcontainerSandboxManagerShape
>()("t3/devcontainer/Services/DevcontainerSandboxManager") {}

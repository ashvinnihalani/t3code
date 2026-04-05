import { Schema } from "effect";
import { PositiveInt, RemoteId, TrimmedNonEmptyString } from "./baseSchemas";

/**
 * BackendKind - Discriminates local vs remote execution targets.
 */
export const BackendKind = Schema.Literals(["local", "remote"]);
export type BackendKind = typeof BackendKind.Type;

/**
 * RemoteProfile - Identity and connection details for a remote host reachable
 * via SSH.  One profile corresponds to one remote server process that
 * multiplexes many projects, threads, terminals, and provider sessions.
 */
export const RemoteProfile = Schema.Struct({
  id: RemoteId,
  sshHost: TrimmedNonEmptyString,
  sshUser: Schema.optional(TrimmedNonEmptyString),
  sshPort: Schema.optional(PositiveInt),
  displayName: TrimmedNonEmptyString,
});
export type RemoteProfile = typeof RemoteProfile.Type;

/**
 * BackendLocator - Identifies which backend (local or a specific remote) a
 * resource such as a project, thread, terminal, or provider session belongs to.
 */
export const BackendLocator = Schema.Struct({
  backend: BackendKind,
  remoteId: Schema.optional(RemoteId),
});
export type BackendLocator = typeof BackendLocator.Type;

/**
 * ProjectExecutionTarget - The canonical type for describing where a project
 * is executed.  Currently only SSH is supported as a remote transport.
 */
export const ProjectExecutionTarget = Schema.Struct({
  kind: Schema.Literal("ssh"),
  hostAlias: TrimmedNonEmptyString,
});
export type ProjectExecutionTarget = typeof ProjectExecutionTarget.Type;

/**
 * ProjectRemoteTarget - Compatibility alias for {@link ProjectExecutionTarget}.
 *
 * @deprecated Use `ProjectExecutionTarget` for new code.
 */
export const ProjectRemoteTarget = ProjectExecutionTarget;
export type ProjectRemoteTarget = ProjectExecutionTarget;

export const SshHostSummary = Schema.Struct({
  alias: TrimmedNonEmptyString,
  hostname: Schema.NullOr(TrimmedNonEmptyString),
  user: Schema.NullOr(TrimmedNonEmptyString),
  port: Schema.NullOr(PositiveInt),
  sourcePath: TrimmedNonEmptyString,
});
export type SshHostSummary = typeof SshHostSummary.Type;

export const SshHostListResult = Schema.Struct({
  hosts: Schema.Array(SshHostSummary),
});
export type SshHostListResult = typeof SshHostListResult.Type;

export const RemoteProjectValidationInput = Schema.Struct({
  remote: ProjectRemoteTarget,
  workspaceRoot: TrimmedNonEmptyString,
});
export type RemoteProjectValidationInput = typeof RemoteProjectValidationInput.Type;

export const RemoteProjectValidationResult = Schema.Struct({
  workspaceRoot: TrimmedNonEmptyString,
  directoryName: TrimmedNonEmptyString,
  hostname: Schema.NullOr(TrimmedNonEmptyString),
  gitAvailable: Schema.Boolean,
  gitRepositoryRoot: Schema.NullOr(TrimmedNonEmptyString),
  codexCliAvailable: Schema.Boolean,
  codexCliVersion: Schema.NullOr(TrimmedNonEmptyString),
});
export type RemoteProjectValidationResult = typeof RemoteProjectValidationResult.Type;

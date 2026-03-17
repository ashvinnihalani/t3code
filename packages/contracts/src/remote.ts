import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

export const ProjectRemoteTarget = Schema.Struct({
  kind: Schema.Literal("ssh"),
  hostAlias: TrimmedNonEmptyString,
});
export type ProjectRemoteTarget = typeof ProjectRemoteTarget.Type;

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

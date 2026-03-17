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

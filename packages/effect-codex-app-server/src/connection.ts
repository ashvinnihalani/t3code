import * as Schema from "effect/Schema";

const EnvironmentVariables = Schema.Record(Schema.String, Schema.String);

export const LocalAppServerConnectionSettings = Schema.Struct({
  kind: Schema.Literal("local"),
  executable: Schema.String,
  args: Schema.Array(Schema.String),
  workspace: Schema.String,
  env: EnvironmentVariables,
});
export type LocalAppServerConnectionSettings = typeof LocalAppServerConnectionSettings.Type;

export const SshAppServerConnectionSettings = Schema.Struct({
  kind: Schema.Literal("ssh"),
  host: Schema.String,
  username: Schema.String,
  port: Schema.NullOr(Schema.Int),
  identityFile: Schema.String,
  persistent: Schema.optional(Schema.Boolean),
  executable: Schema.String,
  args: Schema.Array(Schema.String),
  workspace: Schema.String,
  env: EnvironmentVariables,
});
export type SshAppServerConnectionSettings = typeof SshAppServerConnectionSettings.Type;

export const AppServerConnectionSettings = Schema.Union([
  LocalAppServerConnectionSettings,
  SshAppServerConnectionSettings,
]);
export type AppServerConnectionSettings = typeof AppServerConnectionSettings.Type;

export const AppServerConnectionProfile = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  connection: AppServerConnectionSettings,
});
export type AppServerConnectionProfile = typeof AppServerConnectionProfile.Type;

export const AppServerDesktopSettings = Schema.Struct({
  connections: Schema.Array(AppServerConnectionProfile),
});
export type AppServerDesktopSettings = typeof AppServerDesktopSettings.Type;

export const DiscoveredSshHost = Schema.Struct({
  alias: Schema.String,
  source: Schema.Literals(["ssh-config", "known-hosts"]),
});
export type DiscoveredSshHost = typeof DiscoveredSshHost.Type;

export const WORKSPACE_OPENER_IDS = ["cursor", "vscode", "zed", "file-manager"] as const;
export type WorkspaceOpenerId = (typeof WORKSPACE_OPENER_IDS)[number];

export interface WorkspaceOpener {
  readonly id: WorkspaceOpenerId;
  readonly label: string;
}

export interface WorkspaceOpenRequest {
  readonly connection: AppServerConnectionSettings;
  readonly cwd: string;
  readonly opener: WorkspaceOpenerId;
}

export interface WorkspaceOpenResult {
  readonly ok: boolean;
  readonly error?: string;
}

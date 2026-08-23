import * as NodeOS from "node:os";

import * as Schema from "effect/Schema";
import {
  AppServerConnectionProfile,
  AppServerDesktopSettings,
  type AppServerConnectionSettings,
  type LocalAppServerConnectionSettings,
  type SshAppServerConnectionSettings,
} from "effect-codex-app-server/connection";

export interface AppServerProcessConfiguration {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export class AppServerConfigurationError extends Error {
  override readonly name = "AppServerConfigurationError";
}

function parseJson(value: string | undefined, fallback: unknown, name: string): unknown {
  if (value === undefined || value.trim().length === 0) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    throw new AppServerConfigurationError(`${name} must be valid JSON.`);
  }
}

function decode<A>(schema: Schema.Codec<A>, value: unknown, label: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value);
  } catch (cause) {
    throw new AppServerConfigurationError(`${label} is invalid.`, { cause });
  }
}

function requireProfileValues(profile: AppServerConnectionProfile): AppServerConnectionProfile {
  const values = [
    [profile.id, "connection profile id"],
    [profile.name, "connection profile name"],
    [profile.connection.executable, "connection executable"],
    [profile.connection.workspace, "connection workspace"],
    ...(profile.connection.kind === "ssh" ? [[profile.connection.host, "SSH host"]] : []),
  ] as const;
  for (const [value, label] of values) {
    if (value.trim().length === 0) {
      throw new AppServerConfigurationError(`${label} must be a non-empty string.`);
    }
  }
  return profile;
}

export function defaultAppServerDesktopSettings(
  environment: NodeJS.ProcessEnv = process.env,
  defaultCwd: string = NodeOS.homedir(),
): AppServerDesktopSettings {
  const args = decode(
    Schema.Array(Schema.String),
    parseJson(environment.T3CODE_APP_SERVER_ARGS, ["app-server"], "T3CODE_APP_SERVER_ARGS"),
    "T3CODE_APP_SERVER_ARGS",
  );
  const env = decode(
    Schema.Record(Schema.String, Schema.String),
    parseJson(environment.T3CODE_APP_SERVER_ENV, {}, "T3CODE_APP_SERVER_ENV"),
    "T3CODE_APP_SERVER_ENV",
  );
  return {
    connections: [
      {
        id: "local",
        name: "Local",
        connection: {
          kind: "local",
          executable: environment.T3CODE_APP_SERVER_EXECUTABLE?.trim() || "codex",
          args: args.length > 0 ? args : ["app-server"],
          workspace: environment.T3CODE_APP_SERVER_WORKSPACE?.trim() || defaultCwd,
          env,
        },
      },
    ],
  };
}

export function parseAppServerConnectionProfile(value: unknown): AppServerConnectionProfile {
  return requireProfileValues(decode(AppServerConnectionProfile, value, "Connection profile"));
}

export function parseAppServerDesktopSettings(value: unknown): AppServerDesktopSettings {
  const settings = decode(AppServerDesktopSettings, value, "Desktop settings");
  if (settings.connections.length === 0) {
    throw new AppServerConfigurationError("Desktop settings must contain at least one connection.");
  }
  const connections = settings.connections.map(requireProfileValues);
  if (new Set(connections.map((profile) => profile.id)).size !== connections.length) {
    throw new AppServerConfigurationError("Connection profile ids must be unique.");
  }
  const local = connections.find((profile) => profile.id === "local");
  if (local?.connection.kind !== "local") {
    throw new AppServerConfigurationError(
      "Desktop settings must contain a local app-server connection named local.",
    );
  }
  return { connections };
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function commandWithEnvironment(
  executable: string,
  args: ReadonlyArray<string>,
  environment: ReadonlyArray<string>,
): string {
  const command = [shellQuote(executable), ...args.map(shellQuote)].join(" ");
  return environment.length > 0 ? `env ${environment.join(" ")} ${command}` : command;
}

function inferredPersistentCodexAppServer(connection: SshAppServerConnectionSettings): boolean {
  const executable = connection.executable.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase();
  return (
    (executable === "codex" || executable === "codex.exe") &&
    connection.args.length === 1 &&
    connection.args[0] === "app-server"
  );
}

export function buildRemoteAppServerCommand(connection: SshAppServerConnectionSettings): string {
  const environment = Object.entries(connection.env)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => shellQuote(`${name}=${value}`));
  const persistent = connection.persistent ?? inferredPersistentCodexAppServer(connection);
  if (persistent) {
    const resolveExecutable = [
      ...(environment.length > 0 ? ["env", ...environment] : []),
      "sh",
      "-c",
      shellQuote('command -v "$1"'),
      "sh",
      shellQuote(connection.executable),
    ].join(" ");
    const configuredCodexHome = connection.env.CODEX_HOME?.trim();
    const configuredHome = connection.env.HOME?.trim();
    const codexHome = configuredCodexHome
      ? shellQuote(configuredCodexHome)
      : configuredHome
        ? shellQuote(`${configuredHome}/.codex`)
        : '"$HOME/.codex"';
    const environmentPrefix = environment.length > 0 ? `env ${environment.join(" ")} ` : "";
    const daemonCommand = (args: ReadonlyArray<string>) =>
      `${environmentPrefix}"$managed_executable" ${args.map(shellQuote).join(" ")}`;
    const managedPathConflict = shellQuote(
      "Persistent remote control cannot replace an existing managed Codex binary. Remove it or select that binary explicitly.",
    );
    return [
      `cd -- ${shellQuote(connection.workspace)}`,
      `configured_executable=$(${resolveExecutable})`,
      'case "$configured_executable" in /*) ;; *) configured_executable="$(pwd -P)/$configured_executable" ;; esac',
      `codex_home=${codexHome}`,
      'managed_directory="$codex_home/packages/standalone/current"',
      'managed_executable="$managed_directory/codex"',
      'mkdir -p -- "$managed_directory"',
      `{ if [ ! -e "$managed_executable" ] && [ ! -L "$managed_executable" ]; then ln -s -- "$configured_executable" "$managed_executable"; elif ! [ "$managed_executable" -ef "$configured_executable" ]; then echo ${managedPathConflict} >&2; exit 1; fi; }`,
      `${daemonCommand(["app-server", "daemon", "enable-remote-control"])} >/dev/null`,
      `${daemonCommand(["app-server", "daemon", "start"])} >/dev/null`,
      `exec ${daemonCommand(["app-server", "proxy"])}`,
    ].join(" && ");
  }
  const launch = commandWithEnvironment(connection.executable, connection.args, environment);
  return `cd -- ${shellQuote(connection.workspace)} && exec ${launch}`;
}

function withDesktopExecutablePath(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  if (platform === "win32") return environment;
  const home = environment.HOME?.trim();
  const candidates = [
    ...(platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    "/usr/local/bin",
    ...(home ? [`${home}/.local/bin`, `${home}/bin`, `${home}/.npm-global/bin`] : []),
  ];
  const current = environment.PATH?.split(":").filter(Boolean) ?? [];
  return { ...environment, PATH: [...new Set([...current, ...candidates])].join(":") };
}

function resolveLocalConfiguration(
  connection: LocalAppServerConnectionSettings,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): AppServerProcessConfiguration {
  const configuredEnvironment = { ...environment, ...connection.env };
  return {
    executable: connection.executable,
    args: connection.args,
    cwd: connection.workspace,
    env:
      connection.env.PATH === undefined
        ? withDesktopExecutablePath(configuredEnvironment, platform)
        : configuredEnvironment,
  };
}

function resolveSshConfiguration(
  connection: SshAppServerConnectionSettings,
  environment: NodeJS.ProcessEnv,
  defaultCwd: string,
  platform: NodeJS.Platform,
): AppServerProcessConfiguration {
  const destination = connection.username
    ? `${connection.username}@${connection.host}`
    : connection.host;
  return {
    executable: platform === "win32" ? "ssh.exe" : "ssh",
    args: [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      ...(connection.identityFile ? ["-i", connection.identityFile] : []),
      ...(connection.port === null ? [] : ["-p", String(connection.port)]),
      destination,
      buildRemoteAppServerCommand(connection),
    ],
    cwd: defaultCwd,
    env: environment,
  };
}

export function resolveConfiguredAppServerProcess(
  connection: AppServerConnectionSettings,
  environment: NodeJS.ProcessEnv,
  defaultCwd: string,
  platform: NodeJS.Platform,
): AppServerProcessConfiguration {
  return connection.kind === "local"
    ? resolveLocalConfiguration(connection, environment, platform)
    : resolveSshConfiguration(connection, environment, defaultCwd, platform);
}

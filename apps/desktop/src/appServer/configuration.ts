import type {
  AppServerConnectionSettings,
  AppServerDesktopSettings,
  LocalAppServerConnectionSettings,
  SshAppServerConnectionSettings,
} from "../../../../packages/effect-codex-app-server/src/connection.ts";

export interface AppServerProcessConfiguration {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export class AppServerConfigurationError extends Error {
  override readonly name = "AppServerConfigurationError";
}

function parseStringArray(value: string | undefined, name: string): ReadonlyArray<string> {
  if (value === undefined || value.trim().length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AppServerConfigurationError(`${name} must be a JSON array of strings.`);
  }

  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new AppServerConfigurationError(`${name} must be a JSON array of strings.`);
  }
  return parsed;
}

function parseEnvironment(value: string | undefined): Readonly<Record<string, string>> {
  if (value === undefined || value.trim().length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AppServerConfigurationError(
      "T3CODE_APP_SERVER_ENV must be a JSON object with string values.",
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((entry) => typeof entry !== "string")
  ) {
    throw new AppServerConfigurationError(
      "T3CODE_APP_SERVER_ENV must be a JSON object with string values.",
    );
  }
  return parsed as Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppServerConfigurationError(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new AppServerConfigurationError(`${name} must be a string.`);
  }
  return value.trim();
}

function stringArray(value: unknown, name: string): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new AppServerConfigurationError(`${name} must be an array of strings.`);
  }
  return value;
}

function environmentRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
    throw new AppServerConfigurationError("connection.env must contain only string values.");
  }
  return value as Record<string, string>;
}

function parsePort(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new AppServerConfigurationError("connection.port must be an integer from 1 to 65535.");
  }
  return value;
}

export function defaultAppServerDesktopSettings(
  environment: NodeJS.ProcessEnv,
  defaultCwd: string,
): AppServerDesktopSettings {
  const configuredArgs = parseStringArray(
    environment.T3CODE_APP_SERVER_ARGS,
    "T3CODE_APP_SERVER_ARGS",
  );
  return {
    connection: {
      kind: "local",
      executable: environment.T3CODE_APP_SERVER_EXECUTABLE?.trim() || "codex",
      args: configuredArgs.length > 0 ? configuredArgs : ["app-server"],
      workspace: environment.T3CODE_APP_SERVER_WORKSPACE?.trim() || defaultCwd,
      env: parseEnvironment(environment.T3CODE_APP_SERVER_ENV),
    },
  };
}

export function parseAppServerDesktopSettings(value: unknown): AppServerDesktopSettings {
  if (!isRecord(value) || !isRecord(value.connection)) {
    throw new AppServerConfigurationError("Desktop settings must contain a connection object.");
  }
  const connection = value.connection;
  const common = {
    executable: requiredString(connection.executable, "connection.executable"),
    args: stringArray(connection.args, "connection.args"),
    workspace: requiredString(connection.workspace, "connection.workspace"),
    env: environmentRecord(connection.env),
  };

  if (connection.kind === "local") {
    return { connection: { kind: "local", ...common } };
  }
  if (connection.kind === "ssh") {
    return {
      connection: {
        kind: "ssh",
        ...common,
        host: requiredString(connection.host, "connection.host"),
        username: optionalString(connection.username, "connection.username"),
        port: parsePort(connection.port),
        identityFile: optionalString(connection.identityFile, "connection.identityFile"),
      },
    };
  }
  throw new AppServerConfigurationError("connection.kind must be local or ssh.");
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildRemoteAppServerCommand(connection: SshAppServerConnectionSettings): string {
  const environment = Object.entries(connection.env)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${shellQuote(`${name}=${value}`)}`);
  const command = [shellQuote(connection.executable), ...connection.args.map(shellQuote)].join(" ");
  const launch =
    environment.length > 0 ? `exec env ${environment.join(" ")} ${command}` : `exec ${command}`;
  return `cd -- ${shellQuote(connection.workspace)} && ${launch}`;
}

function resolveLocalConfiguration(
  connection: LocalAppServerConnectionSettings,
  environment: NodeJS.ProcessEnv,
): AppServerProcessConfiguration {
  return {
    executable: connection.executable,
    args: connection.args,
    cwd: connection.workspace,
    env: { ...environment, ...connection.env },
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
  settings: AppServerDesktopSettings,
  environment: NodeJS.ProcessEnv,
  defaultCwd: string,
  platform: NodeJS.Platform = process.platform,
): AppServerProcessConfiguration {
  const connection: AppServerConnectionSettings = settings.connection;
  return connection.kind === "local"
    ? resolveLocalConfiguration(connection, environment)
    : resolveSshConfiguration(connection, environment, defaultCwd, platform);
}

export function resolveAppServerProcessConfiguration(
  environment: NodeJS.ProcessEnv,
  defaultCwd: string,
): AppServerProcessConfiguration {
  return resolveConfiguredAppServerProcess(
    defaultAppServerDesktopSettings(environment, defaultCwd),
    environment,
    defaultCwd,
  );
}

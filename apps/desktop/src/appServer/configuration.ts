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
  if (value === undefined || value.trim().length === 0) {
    return [];
  }

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

function parseEnvironment(value: string | undefined): NodeJS.ProcessEnv {
  if (value === undefined || value.trim().length === 0) {
    return {};
  }

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

export function resolveAppServerProcessConfiguration(
  environment: NodeJS.ProcessEnv,
  defaultCwd: string,
): AppServerProcessConfiguration {
  const executable = environment.T3CODE_APP_SERVER_EXECUTABLE?.trim() || "codex";
  const configuredArgs = parseStringArray(
    environment.T3CODE_APP_SERVER_ARGS,
    "T3CODE_APP_SERVER_ARGS",
  );
  const args = configuredArgs.length > 0 ? configuredArgs : ["app-server"];
  const cwd = environment.T3CODE_APP_SERVER_WORKSPACE?.trim() || defaultCwd;
  const overrides = parseEnvironment(environment.T3CODE_APP_SERVER_ENV);

  return {
    executable,
    args,
    cwd,
    env: { ...environment, ...overrides },
  };
}

import * as NodeUtil from "node:util";

import type { ConfiguredHarness } from "./ConfiguredHarness.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface HarnessCommandEnvironment {
  readonly T3_APP_SERVER_EXECUTABLE?: string;
  readonly T3_APP_SERVER_ARGS_JSON?: string;
  readonly T3_APP_SERVER_CWD?: string;
  readonly T3_APP_SERVER_WORKSPACE?: string;
  readonly T3_APP_SERVER_ENV_JSON?: string;
  readonly T3_APP_SERVER_TIMEOUT_MS?: string;
  readonly T3_APP_SERVER_TRACE_OUTPUT?: string;
}

export type HarnessCommand =
  | { readonly kind: "help" }
  | {
      readonly kind: "run";
      readonly harness: ConfiguredHarness;
      readonly traceOutput?: string;
    };

const parseStringArray = (value: string | undefined, name: string): ReadonlyArray<string> => {
  if (value === undefined) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be a JSON array of strings.`);
  }
  return parsed;
};

const parseStringRecord = (
  value: string | undefined,
  name: string,
): Readonly<Record<string, string>> => {
  if (value === undefined) return {};
  const parsed: unknown = JSON.parse(value);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((item) => typeof item !== "string")
  ) {
    throw new Error(`${name} must be a JSON object with string values.`);
  }
  return parsed as Record<string, string>;
};

const parseEnvironmentEntries = (
  entries: ReadonlyArray<string>,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    entries.map((entry) => {
      const separator = entry.indexOf("=");
      if (separator <= 0) throw new Error(`Invalid --env value: ${entry}. Expected NAME=VALUE.`);
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );

const parseTimeout = (value: string | undefined): number => {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Timeout must be a positive integer, received ${value}.`);
  }
  return timeoutMs;
};

export const parseHarnessCommandLine = (
  argv: ReadonlyArray<string>,
  environment: HarnessCommandEnvironment,
  currentWorkingDirectory: string,
): HarnessCommand => {
  const forwardedArguments = argv[0] === "--" ? argv.slice(1) : argv;
  const { values } = NodeUtil.parseArgs({
    args: [...forwardedArguments],
    strict: true,
    options: {
      executable: { type: "string", short: "e" },
      arg: { type: "string", multiple: true },
      cwd: { type: "string" },
      workspace: { type: "string" },
      env: { type: "string", multiple: true },
      "timeout-ms": { type: "string" },
      "trace-output": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help === true) return { kind: "help" };

  const executable = values.executable ?? environment.T3_APP_SERVER_EXECUTABLE;
  if (executable === undefined || executable.length === 0) {
    throw new Error(
      "An app-server executable is required through --executable or T3_APP_SERVER_EXECUTABLE.",
    );
  }

  const cwd = values.cwd ?? environment.T3_APP_SERVER_CWD ?? currentWorkingDirectory;
  const args =
    values.arg ?? parseStringArray(environment.T3_APP_SERVER_ARGS_JSON, "T3_APP_SERVER_ARGS_JSON");
  const environmentFromJson = parseStringRecord(
    environment.T3_APP_SERVER_ENV_JSON,
    "T3_APP_SERVER_ENV_JSON",
  );
  const environmentFromArguments = parseEnvironmentEntries(values.env ?? []);
  const traceOutput = values["trace-output"] ?? environment.T3_APP_SERVER_TRACE_OUTPUT;

  return {
    kind: "run",
    harness: {
      executable,
      args,
      cwd,
      workspace: values.workspace ?? environment.T3_APP_SERVER_WORKSPACE ?? cwd,
      environment: { ...environmentFromJson, ...environmentFromArguments },
      timeoutMs: parseTimeout(values["timeout-ms"] ?? environment.T3_APP_SERVER_TIMEOUT_MS),
    },
    ...(traceOutput === undefined ? {} : { traceOutput }),
  };
};

export const harnessCommandHelp = `Usage: t3-app-server-conformance --executable PATH [options]

Runs the initialization, thread/start, and turn/start client scenario against a JSONL app-server.

Options:
  -e, --executable PATH   App-server executable (or T3_APP_SERVER_EXECUTABLE)
      --arg VALUE         Repeat for each executable argument
      --cwd PATH          Child-process working directory
      --workspace PATH    Workspace sent to thread/start (defaults to --cwd)
      --env NAME=VALUE    Repeat to add or override child-process environment
      --timeout-ms MS     Per-operation timeout (default: 30000)
      --trace-output PATH Write the normalized JSON-RPC trace to a file
  -h, --help              Show this help

Environment-only configuration also supports T3_APP_SERVER_ARGS_JSON and
T3_APP_SERVER_ENV_JSON for JSON arrays and objects, respectively.
`;

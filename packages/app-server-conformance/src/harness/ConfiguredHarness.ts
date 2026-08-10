import { JsonRpcDriver } from "../protocol/JsonRpcDriver.ts";
import type { TraceEntry } from "../protocol/MessageRecorder.ts";
import { validateCoreLifecycleOrder, type PartialOrderIssue } from "../compare/PartialOrder.ts";
import {
  runCoreLifecycleScenario,
  type CoreLifecycleScenarioResult,
} from "../scenario/CoreLifecycleScenario.ts";
import { spawnChildProcessJsonlTransport } from "../servers/ChildProcessJsonlTransport.ts";

export interface ConfiguredHarness {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly workspace: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface HarnessConformanceReport {
  readonly compatible: boolean;
  readonly scenario: "core-lifecycle";
  readonly traceEntries: number;
  readonly observedMethods: ReadonlyArray<string>;
  readonly schemaIssues: CoreLifecycleScenarioResult["schemaIssues"];
  readonly lifecycleIssues: ReadonlyArray<PartialOrderIssue>;
}

export interface ConfiguredHarnessResult {
  readonly report: HarnessConformanceReport;
  readonly trace: ReadonlyArray<TraceEntry>;
  readonly normalizedTrace: ReadonlyArray<TraceEntry>;
  readonly serverStderr: string;
}

export class ConfiguredHarnessError extends Error {
  override readonly name = "ConfiguredHarnessError";
  override readonly cause: unknown;
  readonly serverStderr: string;

  constructor(cause: unknown, serverStderr: string) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const diagnostics = serverStderr.length === 0 ? "" : `\nHarness stderr:\n${serverStderr}`;
    super(`Configured app-server scenario failed: ${detail}${diagnostics}`, { cause });
    this.cause = cause;
    this.serverStderr = serverStderr;
  }
}

const observedMethods = (trace: ReadonlyArray<TraceEntry>): ReadonlyArray<string> => [
  ...new Set(trace.flatMap((entry) => (entry.method === undefined ? [] : [entry.method]))),
];

export const runConfiguredHarness = async (
  harness: ConfiguredHarness,
): Promise<ConfiguredHarnessResult> => {
  const transport = spawnChildProcessJsonlTransport({
    executable: harness.executable,
    args: harness.args,
    cwd: harness.cwd,
    environment: harness.environment,
  });
  const driver = new JsonRpcDriver(transport);

  let scenario: CoreLifecycleScenarioResult;
  try {
    scenario = await runCoreLifecycleScenario({
      driver,
      workspace: harness.workspace,
      timeoutMs: harness.timeoutMs,
    });
  } catch (cause) {
    await driver.close();
    throw new ConfiguredHarnessError(cause, transport.stderr);
  }
  await driver.close();

  const lifecycleIssues = validateCoreLifecycleOrder(scenario.trace);
  return {
    report: {
      compatible: scenario.schemaIssues.length === 0 && lifecycleIssues.length === 0,
      scenario: "core-lifecycle",
      traceEntries: scenario.trace.length,
      observedMethods: observedMethods(scenario.trace),
      schemaIssues: scenario.schemaIssues,
      lifecycleIssues,
    },
    trace: scenario.trace,
    normalizedTrace: scenario.normalizedTrace,
    serverStderr: transport.stderr,
  };
};

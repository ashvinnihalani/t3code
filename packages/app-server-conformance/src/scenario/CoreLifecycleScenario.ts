import * as CodexSchema from "effect-codex-app-server/schema";
import * as Schema from "effect/Schema";

import { validateTraceSchemas, type SchemaValidationIssue } from "../compare/SchemaValidator.ts";
import { normalizeTrace } from "../normalize/TraceNormalizer.ts";
import { JsonRpcDriver } from "../protocol/JsonRpcDriver.ts";
import type { TraceEntry } from "../protocol/MessageRecorder.ts";

const decodeInitializeResponse = Schema.decodeUnknownSync(CodexSchema.V1InitializeResponse);
const decodeThreadStartResponse = Schema.decodeUnknownSync(CodexSchema.V2ThreadStartResponse);
const decodeTurnStartResponse = Schema.decodeUnknownSync(CodexSchema.V2TurnStartResponse);

export interface CoreLifecycleScenarioInput {
  readonly driver: JsonRpcDriver;
  readonly workspace: string;
  readonly timeoutMs?: number;
}

export interface CoreLifecycleScenarioResult {
  readonly trace: ReadonlyArray<TraceEntry>;
  readonly normalizedTrace: ReadonlyArray<TraceEntry>;
  readonly schemaIssues: ReadonlyArray<SchemaValidationIssue>;
}

const withTimeout = async <A>(
  promise: Promise<A>,
  timeoutMs: number,
  label: string,
): Promise<A> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

const nextNotificationWithMethod = async (
  driver: JsonRpcDriver,
  method: string,
  timeoutMs: number,
) => {
  while (true) {
    const notification = await withTimeout(driver.nextNotification(), timeoutMs, method);
    if (notification.method === method) return notification;
  }
};

export const runCoreLifecycleScenario = async ({
  driver,
  workspace,
  timeoutMs = 5_000,
}: CoreLifecycleScenarioInput): Promise<CoreLifecycleScenarioResult> => {
  const initialized = decodeInitializeResponse(
    await withTimeout(
      driver.request("initialize", {
        clientInfo: {
          name: "t3-app-server-conformance",
          title: "T3 App Server Conformance",
          version: "0.0.0",
        },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: null,
        },
      }),
      timeoutMs,
      "initialize",
    ),
  );
  await driver.notify("initialized");

  const thread = decodeThreadStartResponse(
    await withTimeout(
      driver.request("thread/start", { cwd: workspace }),
      timeoutMs,
      "thread/start",
    ),
  );
  await nextNotificationWithMethod(driver, "thread/started", timeoutMs);
  decodeTurnStartResponse(
    await withTimeout(
      driver.request("turn/start", {
        threadId: thread.thread.id,
        input: [{ type: "text", text: "Reply with a deterministic greeting." }],
      }),
      timeoutMs,
      "turn/start",
    ),
  );

  while (true) {
    const notification = await withTimeout(driver.nextNotification(), timeoutMs, "turn completion");
    if (notification.method === "turn/completed") break;
  }

  const trace = driver.trace.snapshot();
  return {
    trace,
    normalizedTrace: normalizeTrace(trace, {
      workspace,
      codexHome: initialized.codexHome,
    }),
    schemaIssues: validateTraceSchemas(trace),
  };
};

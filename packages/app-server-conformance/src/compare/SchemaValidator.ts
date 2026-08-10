import * as CodexRpc from "effect-codex-app-server/rpc";
import * as Schema from "effect/Schema";

import { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from "../protocol/JsonRpcDriver.ts";
import type { TraceDirection, TraceEntry } from "../protocol/MessageRecorder.ts";

interface PendingMethod {
  readonly method: string;
  readonly responseDirection: TraceDirection;
  readonly responseSchema: Schema.Codec<unknown, unknown> | undefined;
}

export interface SchemaValidationIssue {
  readonly sequence: number;
  readonly method?: string;
  readonly detail: string;
}

type SchemaTable = Readonly<Record<string, Schema.Codec<unknown, unknown> | undefined>>;

const clientRequestParams = CodexRpc.CLIENT_REQUEST_PARAMS as unknown as SchemaTable;
const clientRequestResponses = CodexRpc.CLIENT_REQUEST_RESPONSES as unknown as SchemaTable;
const clientNotificationParams = CodexRpc.CLIENT_NOTIFICATION_PARAMS as unknown as SchemaTable;
const serverRequestParams = CodexRpc.SERVER_REQUEST_PARAMS as unknown as SchemaTable;
const serverRequestResponses = CodexRpc.SERVER_REQUEST_RESPONSES as unknown as SchemaTable;
const serverNotificationParams = CodexRpc.SERVER_NOTIFICATION_PARAMS as unknown as SchemaTable;
const decodeJsonRpcRequest = Schema.decodeUnknownSync(JsonRpcRequest);
const decodeJsonRpcNotification = Schema.decodeUnknownSync(JsonRpcNotification);
const decodeJsonRpcResponse = Schema.decodeUnknownSync(JsonRpcResponse);
type StrictDecoder = (payload: unknown) => unknown;
const strictDecoders = new WeakMap<Schema.Codec<unknown, unknown>, StrictDecoder>();

const strictDecoder = (schema: Schema.Codec<unknown, unknown>): StrictDecoder => {
  const cached = strictDecoders.get(schema);
  if (cached) return cached;
  const decode = Schema.decodeUnknownSync(schema);
  const strict = (payload: unknown) => decode(payload, { onExcessProperty: "error" });
  strictDecoders.set(schema, strict);
  return strict;
};

const oppositeDirection = (direction: TraceDirection): TraceDirection =>
  direction === "client-to-server" ? "server-to-client" : "client-to-server";

const issue = (entry: TraceEntry, detail: string): SchemaValidationIssue => ({
  sequence: entry.sequence,
  ...(entry.method === undefined ? {} : { method: entry.method }),
  detail,
});

const validatePayload = (
  entry: TraceEntry,
  method: string,
  schema: Schema.Codec<unknown, unknown> | undefined,
  payload: unknown,
): SchemaValidationIssue | undefined => {
  if (schema === undefined) {
    return payload === undefined
      ? undefined
      : issue(entry, `${method} does not accept a payload, but one was present.`);
  }
  try {
    strictDecoder(schema)(payload);
    return undefined;
  } catch (error) {
    return issue(entry, `${method} payload failed schema validation: ${String(error)}`);
  }
};

const tableEntry = (
  table: SchemaTable,
  method: string,
): { readonly found: boolean; readonly schema: Schema.Codec<unknown, unknown> | undefined } => ({
  found: Object.hasOwn(table, method),
  schema: table[method],
});

export const validateTraceSchemas = (
  trace: ReadonlyArray<TraceEntry>,
): ReadonlyArray<SchemaValidationIssue> => {
  const issues: SchemaValidationIssue[] = [];
  const pending = new Map<string, PendingMethod>();

  for (const entry of trace) {
    if (entry.kind === "request") {
      let request: JsonRpcRequest;
      try {
        request = decodeJsonRpcRequest(entry.payload, {
          onExcessProperty: "error",
        });
      } catch (error) {
        issues.push(issue(entry, `Invalid JSON-RPC request envelope: ${String(error)}`));
        continue;
      }

      const paramsTable =
        entry.direction === "client-to-server" ? clientRequestParams : serverRequestParams;
      const responsesTable =
        entry.direction === "client-to-server" ? clientRequestResponses : serverRequestResponses;
      const params = tableEntry(paramsTable, request.method);
      if (!params.found) {
        issues.push(issue(entry, `Unknown ${entry.direction} request method: ${request.method}.`));
        continue;
      }
      const payloadIssue = validatePayload(entry, request.method, params.schema, request.params);
      if (payloadIssue) issues.push(payloadIssue);
      pending.set(String(request.id), {
        method: request.method,
        responseDirection: oppositeDirection(entry.direction),
        responseSchema: responsesTable[request.method],
      });
      continue;
    }

    if (entry.kind === "notification") {
      let notification: JsonRpcNotification;
      try {
        notification = decodeJsonRpcNotification(entry.payload, {
          onExcessProperty: "error",
        });
      } catch (error) {
        issues.push(issue(entry, `Invalid JSON-RPC notification envelope: ${String(error)}`));
        continue;
      }
      const notificationTable =
        entry.direction === "client-to-server"
          ? clientNotificationParams
          : serverNotificationParams;
      const params = tableEntry(notificationTable, notification.method);
      if (!params.found) {
        issues.push(
          issue(entry, `Unknown ${entry.direction} notification method: ${notification.method}.`),
        );
        continue;
      }
      const payloadIssue = validatePayload(
        entry,
        notification.method,
        params.schema,
        notification.params,
      );
      if (payloadIssue) issues.push(payloadIssue);
      continue;
    }

    let response: JsonRpcResponse;
    try {
      response = decodeJsonRpcResponse(entry.payload, {
        onExcessProperty: "error",
      });
    } catch (error) {
      issues.push(issue(entry, `Invalid JSON-RPC response envelope: ${String(error)}`));
      continue;
    }
    const expected = pending.get(String(response.id));
    if (!expected) {
      issues.push(issue(entry, `Response ${String(response.id)} has no matching request.`));
      continue;
    }
    pending.delete(String(response.id));
    const responseKind = "error" in response ? "error" : "response";
    if (entry.kind !== responseKind) {
      issues.push(
        issue(entry, `Response ${String(response.id)} is ${responseKind}, not ${entry.kind}.`),
      );
    }
    if (entry.direction !== expected.responseDirection) {
      issues.push(
        issue(
          entry,
          `Response ${String(response.id)} traveled ${entry.direction}; expected ${expected.responseDirection}.`,
        ),
      );
    }
    if ("error" in response) continue;
    if (!("result" in response)) {
      issues.push(issue(entry, `Successful response for ${expected.method} has no result.`));
      continue;
    }
    const payloadIssue = validatePayload(
      entry,
      expected.method,
      expected.responseSchema,
      response.result,
    );
    if (payloadIssue) issues.push(payloadIssue);
  }

  return issues;
};

import {
  type ProviderEvent,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Queue, Stream } from "effect";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { KiroAdapter, type KiroAdapterShape } from "../Services/KiroAdapter.ts";
import { KiroAcpManager, type KiroAcpStartSessionInput } from "../../kiroAcpManager.ts";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = "kiro" as const;

export interface KiroAdapterLiveOptions {
  readonly manager?: KiroAcpManager;
  readonly makeManager?: () => KiroAcpManager;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return fallback;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toTurnStatus(value: unknown): "completed" | "failed" | "cancelled" | "interrupted" {
  switch (value) {
    case "completed":
    case "failed":
    case "cancelled":
    case "interrupted":
      return value;
    default:
      return "completed";
  }
}

function toSessionError(
  threadId: string,
  cause: unknown,
): ProviderAdapterSessionNotFoundError | ProviderAdapterSessionClosedError | undefined {
  const normalized = toMessage(cause, "").toLowerCase();
  if (normalized.includes("unknown session")) {
    return new ProviderAdapterSessionNotFoundError({
      provider: PROVIDER,
      threadId,
      cause,
    });
  }
  if (normalized.includes("closed")) {
    return new ProviderAdapterSessionClosedError({
      provider: PROVIDER,
      threadId,
      cause,
    });
  }
  return undefined;
}

function toRequestError(threadId: string, method: string, cause: unknown): ProviderAdapterError {
  const sessionError = toSessionError(threadId, cause);
  if (sessionError) {
    return sessionError;
  }
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: toMessage(cause, `${method} failed`),
    cause,
  });
}

function eventRawSource(event: ProviderEvent): NonNullable<ProviderRuntimeEvent["raw"]>["source"] {
  switch (event.kind) {
    case "request":
      return "kiro.acp.request";
    case "session":
      return "kiro.acp.session";
    default:
      return "kiro.acp.notification";
  }
}

function runtimeEventBase(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): Omit<ProviderRuntimeEvent, "type" | "payload"> {
  const providerRefs =
    event.turnId || event.itemId || event.requestId
      ? {
          ...(event.turnId ? { providerTurnId: event.turnId } : {}),
          ...(event.itemId ? { providerItemId: event.itemId } : {}),
          ...(event.requestId ? { providerRequestId: event.requestId } : {}),
        }
      : undefined;

  return {
    eventId: event.id,
    provider: event.provider,
    threadId: canonicalThreadId,
    createdAt: event.createdAt,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.itemId ? { itemId: RuntimeItemId.makeUnsafe(event.itemId) } : {}),
    ...(event.requestId ? { requestId: RuntimeRequestId.makeUnsafe(event.requestId) } : {}),
    ...(providerRefs ? { providerRefs } : {}),
    raw: {
      source: eventRawSource(event),
      method: event.method,
      payload: event.payload ?? {},
    },
  };
}

function toRequestType(method: string) {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return "command_execution_approval" as const;
    case "item/fileRead/requestApproval":
      return "file_read_approval" as const;
    case "item/fileChange/requestApproval":
      return "file_change_approval" as const;
    default:
      return "unknown" as const;
  }
}

function toItemType(raw: unknown) {
  const type = (asString(raw) ?? "").toLowerCase();
  if (type.includes("command")) return "command_execution" as const;
  if (type.includes("file")) return "file_change" as const;
  if (type.includes("web")) return "web_search" as const;
  if (type.includes("dynamic")) return "dynamic_tool_call" as const;
  return "unknown" as const;
}

function mapItemLifecycle(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  lifecycle: "item.started" | "item.updated" | "item.completed",
): ProviderRuntimeEvent | undefined {
  const payload = asObject(event.payload);
  const item = asObject(payload?.item);
  if (!item) {
    return undefined;
  }

  const itemType = toItemType(item.type);
  return {
    ...runtimeEventBase(event, canonicalThreadId),
    type: lifecycle,
    payload: {
      itemType,
      ...(lifecycle === "item.started" ? { status: "inProgress" as const } : {}),
      ...(asString(item.title) ? { title: asString(item.title) } : {}),
      ...(asString(item.summary) ? { detail: asString(item.summary) } : {}),
      ...(event.payload !== undefined ? { data: event.payload } : {}),
    },
  };
}

function mapToRuntimeEvents(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): ReadonlyArray<ProviderRuntimeEvent> {
  const payload = asObject(event.payload);

  if (event.kind === "error") {
    if (!event.message) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "runtime.error",
        payload: {
          message: event.message,
          class: "provider_error",
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ];
  }

  if (event.kind === "request") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "request.opened",
        payload: {
          requestType: toRequestType(event.method),
          ...(asString(asObject(payload?.toolCall)?.title)
            ? { detail: asString(asObject(payload?.toolCall)?.title) }
            : {}),
          ...(event.payload !== undefined ? { args: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "item/requestApproval/decision") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "request.resolved",
        payload: {
          requestType: event.requestKind
            ? event.requestKind === "command"
              ? "command_execution_approval"
              : event.requestKind === "file-read"
                ? "file_read_approval"
                : "file_change_approval"
            : "unknown",
          ...(event.payload !== undefined ? { resolution: event.payload } : {}),
        },
      },
    ];
  }

  if (event.method === "session/connecting") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.state.changed",
        payload: {
          state: "starting",
          ...(event.message ? { reason: event.message } : {}),
        },
      },
    ];
  }

  if (event.method === "session/started") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.started",
        payload: {
          ...(event.message ? { message: event.message } : {}),
          ...(payload?.resume !== undefined ? { resume: payload.resume } : {}),
        },
      },
    ];
  }

  if (event.method === "session/configured") {
    const config = asObject(payload?.config) ?? payload ?? {};
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.configured",
        payload: {
          config,
        },
      },
    ];
  }

  if (event.method === "session/exited" || event.method === "session/closed") {
    const exitKind = asString(payload?.exitKind);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "session.exited",
        payload: {
          ...((asString(payload?.reason) ?? event.message)
            ? { reason: asString(payload?.reason) ?? event.message }
            : {}),
          ...(exitKind ? { exitKind: exitKind as "graceful" | "error" } : {}),
        },
      },
    ];
  }

  if (event.method === "thread/started") {
    const providerThreadId = asString(payload?.threadId);
    if (!providerThreadId) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "thread.started",
        payload: {
          providerThreadId,
        },
      },
    ];
  }

  if (event.method === "thread/metadata/updated") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "thread.metadata.updated",
        payload: {
          metadata: asObject(payload?.metadata) ?? payload ?? {},
        },
      },
    ];
  }

  if (event.method === "thread/tokenUsage/updated") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "thread.token-usage.updated",
        payload: {
          usage: payload ?? {},
        },
      },
    ];
  }

  if (event.method === "turn/started") {
    const turn = asObject(payload?.turn);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.started",
        payload: asString(turn?.model) ? { model: asString(turn?.model) } : {},
      },
    ];
  }

  if (event.method === "turn/completed") {
    const turn = asObject(payload?.turn);
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.completed",
        payload: {
          state: toTurnStatus(turn?.status),
          ...(asString(turn?.stopReason) ? { stopReason: asString(turn?.stopReason) } : {}),
          ...(asString(asObject(turn?.error)?.message)
            ? { errorMessage: asString(asObject(turn?.error)?.message) }
            : {}),
        },
      },
    ];
  }

  if (event.method === "turn/plan/updated") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "turn.plan.updated",
        payload: {
          plan: Array.isArray(payload?.plan) ? payload.plan : [],
        },
      },
    ];
  }

  if (event.method === "item/agentMessage/delta") {
    const delta = asString(payload?.delta);
    if (!delta) {
      return [];
    }
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "content.delta",
        payload: {
          streamKind: "assistant_text",
          delta,
        },
      },
    ];
  }

  if (event.method === "item/started") {
    const mapped = mapItemLifecycle(event, canonicalThreadId, "item.started");
    return mapped ? [mapped] : [];
  }

  if (event.method === "item/updated") {
    const mapped = mapItemLifecycle(event, canonicalThreadId, "item.updated");
    return mapped ? [mapped] : [];
  }

  if (event.method === "item/completed") {
    const mapped = mapItemLifecycle(event, canonicalThreadId, "item.completed");
    return mapped ? [mapped] : [];
  }

  if (event.method === "account/updated") {
    return [
      {
        ...runtimeEventBase(event, canonicalThreadId),
        type: "account.updated",
        payload: {
          account: event.payload ?? {},
        },
      },
    ];
  }

  return [];
}

const makeKiroAdapter = (options?: KiroAdapterLiveOptions) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const serverConfig = yield* Effect.service(ServerConfig);
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
            stream: "native",
          })
        : undefined);

    const manager = yield* Effect.acquireRelease(
      Effect.sync(() => options?.manager ?? options?.makeManager?.() ?? new KiroAcpManager()),
      (manager) =>
        Effect.sync(() => {
          manager.stopAll();
        }),
    );

    const startSession: KiroAdapterShape["startSession"] = (input) => {
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return Effect.fail(
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
          }),
        );
      }

      const managerInput: KiroAcpStartSessionInput = {
        threadId: input.threadId,
        runtimeMode: input.runtimeMode,
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
        ...(input.providerOptions?.kiro?.binaryPath
          ? { binaryPath: input.providerOptions.kiro.binaryPath }
          : {}),
        ...(input.providerOptions?.kiro?.remote
          ? { remote: input.providerOptions.kiro.remote }
          : {}),
      };

      return Effect.tryPromise({
        try: () => manager.startSession(managerInput),
        catch: (cause) =>
          toSessionError(input.threadId, cause) ??
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: input.threadId,
            detail: toMessage(cause, "Failed to start Kiro ACP session."),
            cause,
          }),
      });
    };

    const sendTurn: KiroAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const attachments = yield* Effect.forEach(
          input.attachments ?? [],
          (attachment) =>
            Effect.gen(function* () {
              const attachmentPath = resolveAttachmentPath({
                stateDir: serverConfig.stateDir,
                attachment,
              });
              if (!attachmentPath) {
                return yield* new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/prompt",
                  detail: `Invalid attachment id '${attachment.id}'.`,
                });
              }
              const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterRequestError({
                      provider: PROVIDER,
                      method: "session/prompt",
                      detail: toMessage(cause, "Failed to read attachment file."),
                      cause,
                    }),
                ),
              );
              return {
                mimeType: attachment.mimeType,
                data: Buffer.from(bytes).toString("base64"),
              };
            }),
          { concurrency: 1 },
        );

        return yield* Effect.tryPromise({
          try: () =>
            manager.sendTurn({
              threadId: input.threadId,
              ...(input.input !== undefined ? { input: input.input } : {}),
              ...(attachments.length > 0 ? { attachments } : {}),
              ...(input.model !== undefined ? { model: input.model } : {}),
              ...(input.interactionMode !== undefined
                ? { interactionMode: input.interactionMode }
                : {}),
            }),
          catch: (cause) => toRequestError(input.threadId, "session/prompt", cause),
        });
      });

    const interruptTurn: KiroAdapterShape["interruptTurn"] = (threadId) =>
      Effect.tryPromise({
        try: () => manager.interruptTurn(threadId),
        catch: (cause) => toRequestError(threadId, "session/cancel", cause),
      });

    const readThread: KiroAdapterShape["readThread"] = (threadId) =>
      Effect.try({
        try: () => manager.readThread(threadId),
        catch: (cause) => toRequestError(threadId, "thread/read", cause),
      });

    const rollbackThread: KiroAdapterShape["rollbackThread"] = (threadId, _numTurns) =>
      Effect.tryPromise({
        try: () => manager.rollbackThread(threadId),
        catch: (cause) => toRequestError(threadId, "thread/rollback", cause),
      });

    const respondToRequest: KiroAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.tryPromise({
        try: () => manager.respondToRequest(threadId, requestId, decision),
        catch: (cause) => toRequestError(threadId, "session/request_permission", cause),
      });

    const respondToUserInput: KiroAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      _answers,
    ) =>
      Effect.fail(
        new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "respondToUserInput",
          issue: `Kiro ACP does not support structured user-input responses (request ${requestId}) for thread '${threadId}'.`,
        }),
      );

    const stopSession: KiroAdapterShape["stopSession"] = (threadId) =>
      Effect.sync(() => {
        manager.stopSession(threadId);
      });

    const listSessions: KiroAdapterShape["listSessions"] = () =>
      Effect.sync(() => manager.listSessions());

    const hasSession: KiroAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => manager.hasSession(threadId));

    const stopAll: KiroAdapterShape["stopAll"] = () =>
      Effect.sync(() => {
        manager.stopAll();
      });

    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const listener = (event: ProviderEvent) => {
          void Effect.runPromise(
            Effect.gen(function* () {
              if (nativeEventLogger) {
                yield* nativeEventLogger.write(event, event.threadId);
              }
              const runtimeEvents = mapToRuntimeEvents(event, event.threadId);
              for (const runtimeEvent of runtimeEvents) {
                yield* Queue.offer(runtimeEventQueue, runtimeEvent);
              }
            }).pipe(Effect.ignore),
          );
        };
        manager.on("event", listener);
        return listener;
      }),
      (listener) =>
        Effect.sync(() => {
          manager.off("event", listener);
        }),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
      },
      startSession,
      sendTurn,
      interruptTurn,
      readThread,
      rollbackThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents: Stream.fromQueue(runtimeEventQueue),
    } satisfies KiroAdapterShape;
  });

export const KiroAdapterLive = Layer.effect(KiroAdapter, makeKiroAdapter());

export function makeKiroAdapterLive(options?: KiroAdapterLiveOptions) {
  return Layer.effect(KiroAdapter, makeKiroAdapter(options));
}

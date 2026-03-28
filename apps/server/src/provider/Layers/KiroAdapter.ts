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
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return fallback;
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
      Effect.sync(() => options?.manager ?? new KiroAcpManager()),
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
        ...(input.modelSelection?.model !== undefined ? { model: input.modelSelection.model } : {}),
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
                attachmentsDir: serverConfig.attachmentsDir,
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
          try: async () => {
            await manager.prepareSessionForTurn({
              threadId: input.threadId,
              ...(input.interactionMode !== undefined
                ? { interactionMode: input.interactionMode }
                : {}),
            });
            return manager.sendTurn({
              threadId: input.threadId,
              ...(input.input !== undefined ? { input: input.input } : {}),
              ...(attachments.length > 0 ? { attachments } : {}),
              ...(input.modelSelection?.model !== undefined
                ? { model: input.modelSelection.model }
                : {}),
              ...(input.interactionMode !== undefined
                ? { interactionMode: input.interactionMode }
                : {}),
            });
          },
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

    const runtimeEventQueue =
      yield* Queue.unbounded<import("@t3tools/contracts").ProviderRuntimeEvent>();
    const listener = (event: import("@t3tools/contracts").ProviderRuntimeEvent) => {
      void Effect.runPromise(
        Effect.gen(function* () {
          if (nativeEventLogger) {
            yield* nativeEventLogger.write(event, event.threadId);
          }
          yield* Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid);
        }),
      );
    };
    manager.on("event", listener);

    yield* Effect.addFinalizer(() =>
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

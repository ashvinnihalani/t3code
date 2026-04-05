/**
 * ProviderServiceLive - Cross-provider orchestration layer.
 *
 * Routes validated transport/API calls to provider adapters through
 * `ProviderAdapterRegistry` and `ProviderSessionDirectory`, and exposes a
 * unified provider event stream for subscribers.
 *
 * It does not implement provider protocol details (adapter concern).
 *
 * @module ProviderServiceLive
 */
import {
  ModelSelection,
  NonNegativeInt,
  ThreadId,
  ProviderInterruptTurnInput,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderSendTurnInput,
  ProviderSessionStartInput,
  ProviderStopSessionInput,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import { Effect, Layer, Option, PubSub, Queue, Schema, SchemaIssue, Stream } from "effect";

import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import {
  type ProviderAdapterError,
  type ProviderServiceError,
  ProviderValidationError,
} from "../Errors.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../Services/ProviderSessionDirectory.ts";
import {
  buildRemoteSessionRuntimeMetadataPatch,
  readProviderThreadIdFromResumeCursor,
} from "../remoteSessionMetadata.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { AnalyticsService } from "../../telemetry/Services/AnalyticsService.ts";

export interface ProviderServiceLiveOptions {
  readonly canonicalEventLogPath?: string;
  readonly canonicalEventLogger?: EventNdjsonLogger;
}

const ProviderRollbackConversationInput = Schema.Struct({
  threadId: ThreadId,
  numTurns: NonNegativeInt,
});

function toValidationError(
  operation: string,
  issue: string,
  cause?: unknown,
): ProviderValidationError {
  return new ProviderValidationError({
    operation,
    issue,
    ...(cause !== undefined ? { cause } : {}),
  });
}

const decodeInputOrValidationError = <S extends Schema.Top>(input: {
  readonly operation: string;
  readonly schema: S;
  readonly payload: unknown;
}) =>
  Schema.decodeUnknownEffect(input.schema)(input.payload).pipe(
    Effect.mapError(
      (schemaError) =>
        new ProviderValidationError({
          operation: input.operation,
          issue: SchemaIssue.makeFormatterDefault()(schemaError.issue),
          cause: schemaError,
        }),
    ),
  );

function toRuntimeStatus(session: ProviderSession): "starting" | "running" | "stopped" | "error" {
  switch (session.status) {
    case "connecting":
      return "starting";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    case "running":
    default:
      return "running";
  }
}

function toRuntimePayloadFromSession(
  session: ProviderSession,
  extra?: {
    readonly modelSelection?: unknown;
    readonly providerOptions?: unknown;
    readonly lastRuntimeEvent?: string;
    readonly lastRuntimeEventAt?: string;
  },
): Record<string, unknown> {
  const providerThreadId = readProviderThreadIdFromResumeCursor(session.resumeCursor);
  return {
    cwd: session.cwd ?? null,
    model: session.model ?? null,
    activeTurnId: session.activeTurnId ?? null,
    lastError: session.lastError ?? null,
    ...(providerThreadId ? { providerThreadId } : {}),
    ...(session.resumeCursor !== undefined ? { resumeAvailable: true } : {}),
    ...(extra?.modelSelection !== undefined ? { modelSelection: extra.modelSelection } : {}),
    ...(extra?.providerOptions !== undefined ? { providerOptions: extra.providerOptions } : {}),
    ...(extra?.lastRuntimeEvent !== undefined ? { lastRuntimeEvent: extra.lastRuntimeEvent } : {}),
    ...(extra?.lastRuntimeEventAt !== undefined
      ? { lastRuntimeEventAt: extra.lastRuntimeEventAt }
      : {}),
  };
}

const RESUME_FALLBACK_RECONNECT_SUMMARY =
  "Persisted provider session was unavailable; started a new provider session.";

function readResumeCursorIdentity(resumeCursor: unknown): string | undefined {
  const providerThreadId = readProviderThreadIdFromResumeCursor(resumeCursor);
  if (providerThreadId) {
    return `thread:${providerThreadId}`;
  }
  if (!resumeCursor || typeof resumeCursor !== "object" || Array.isArray(resumeCursor)) {
    return undefined;
  }
  const record = resumeCursor as Record<string, unknown>;
  const sessionId = typeof record.sessionId === "string" ? record.sessionId.trim() : "";
  if (sessionId.length > 0) {
    return `session:${sessionId}`;
  }
  const resume = typeof record.resume === "string" ? record.resume.trim() : "";
  if (resume.length > 0) {
    return `resume:${resume}`;
  }
  try {
    return JSON.stringify(resumeCursor);
  } catch {
    return undefined;
  }
}

function didResumeCursorFallback(input: {
  readonly requestedResumeCursor: unknown;
  readonly resumedResumeCursor: unknown;
}): boolean {
  const requested = readResumeCursorIdentity(input.requestedResumeCursor);
  const resumed = readResumeCursorIdentity(input.resumedResumeCursor);
  return requested !== undefined && resumed !== undefined && requested !== resumed;
}

function readPersistedModelSelection(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): ModelSelection | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const raw = "modelSelection" in runtimePayload ? runtimePayload.modelSelection : undefined;
  return Schema.is(ModelSelection)(raw) ? raw : undefined;
}

function readPersistedProviderOptions(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): Record<string, unknown> | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const raw = "providerOptions" in runtimePayload ? runtimePayload.providerOptions : undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as Record<string, unknown>;
}

function hasPersistedRemoteTarget(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): boolean {
  const providerOptions = readPersistedProviderOptions(runtimePayload);
  if (!providerOptions) {
    return false;
  }
  const codexOptions =
    "codex" in providerOptions &&
    providerOptions.codex &&
    typeof providerOptions.codex === "object" &&
    !Array.isArray(providerOptions.codex)
      ? (providerOptions.codex as Record<string, unknown>)
      : null;
  const remote = codexOptions && "remote" in codexOptions ? codexOptions.remote : null;
  return (
    remote !== null &&
    typeof remote === "object" &&
    !Array.isArray(remote) &&
    "kind" in remote &&
    remote.kind === "ssh"
  );
}

function readPersistedCwd(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): string | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const rawCwd = "cwd" in runtimePayload ? runtimePayload.cwd : undefined;
  if (typeof rawCwd !== "string") return undefined;
  const trimmed = rawCwd.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const makeProviderService = (options?: ProviderServiceLiveOptions) =>
  Effect.gen(function* () {
    const analytics = yield* Effect.service(AnalyticsService);
    const canonicalEventLogger =
      options?.canonicalEventLogger ??
      (options?.canonicalEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.canonicalEventLogPath, {
            stream: "canonical",
          })
        : undefined);

    const registry = yield* ProviderAdapterRegistry;
    const directory = yield* ProviderSessionDirectory;
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const publishRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Effect.succeed(event).pipe(
        Effect.tap((canonicalEvent) =>
          canonicalEventLogger ? canonicalEventLogger.write(canonicalEvent, null) : Effect.void,
        ),
        Effect.flatMap((canonicalEvent) => PubSub.publish(runtimeEventPubSub, canonicalEvent)),
        Effect.asVoid,
      );

    const upsertSessionBinding = (
      session: ProviderSession,
      threadId: ThreadId,
      extra?: {
        readonly modelSelection?: unknown;
        readonly providerOptions?: unknown;
        readonly runtimePayload?: Record<string, unknown>;
      },
    ) =>
      directory.upsert({
        threadId,
        provider: session.provider,
        runtimeMode: session.runtimeMode,
        status: toRuntimeStatus(session),
        ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
        runtimePayload: {
          ...toRuntimePayloadFromSession(session, extra),
          ...extra?.runtimePayload,
        },
      });

    const providers = yield* registry.listProviders();
    const adapters = yield* Effect.forEach(providers, (provider) =>
      registry.getByProvider(provider),
    );

    const processRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      publishRuntimeEvent(event);

    const worker = Effect.forever(
      Queue.take(runtimeEventQueue).pipe(Effect.flatMap(processRuntimeEvent)),
    );
    yield* Effect.forkScoped(worker);

    yield* Effect.forEach(adapters, (adapter) =>
      Stream.runForEach(adapter.streamEvents, (event) =>
        Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid),
      ).pipe(Effect.forkScoped),
    ).pipe(Effect.asVoid);

    const recoverSessionForThread = (input: {
      readonly binding: ProviderRuntimeBinding;
      readonly operation: string;
    }): Effect.Effect<
      {
        readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
        readonly session: ProviderSession;
      },
      ProviderServiceError
    > =>
      Effect.gen(function* () {
        const adapter = yield* registry.getByProvider(input.binding.provider);
        const hasResumeCursor =
          input.binding.resumeCursor !== null && input.binding.resumeCursor !== undefined;
        const hasActiveSession = yield* adapter.hasSession(input.binding.threadId);
        if (hasActiveSession) {
          const activeSessions = yield* adapter.listSessions();
          const existing = activeSessions.find(
            (session) => session.threadId === input.binding.threadId,
          );
          if (existing) {
            const providerThreadId = readProviderThreadIdFromResumeCursor(existing.resumeCursor);
            const reconnectSummary = providerThreadId
              ? `Reconnected to remote provider thread ${providerThreadId}.`
              : "Reconnected to an existing provider session.";
            yield* upsertSessionBinding(existing, input.binding.threadId, {
              runtimePayload: buildRemoteSessionRuntimeMetadataPatch({
                session: existing,
                reconnectState: "adopt-existing",
                reconnectSummary,
                resumeAvailable:
                  existing.resumeCursor !== undefined ||
                  (input.binding.resumeCursor !== null && input.binding.resumeCursor !== undefined),
              }),
            });
            yield* analytics.record("provider.session.recovered", {
              provider: existing.provider,
              strategy: "adopt-existing",
              hasResumeCursor: existing.resumeCursor !== undefined,
            });
            return { adapter, session: existing } as const;
          }
        }

        if (!hasResumeCursor) {
          const reconnectSummary =
            "Cannot reconnect automatically because no persisted remote provider thread is available.";
          yield* directory.upsert({
            threadId: input.binding.threadId,
            provider: input.binding.provider,
            ...(input.binding.runtimeMode !== undefined
              ? { runtimeMode: input.binding.runtimeMode }
              : {}),
            status: "error",
            runtimePayload: buildRemoteSessionRuntimeMetadataPatch({
              reconnectState: "resume-unavailable",
              reconnectSummary,
              resumeAvailable: false,
            }),
          });
          return yield* toValidationError(
            input.operation,
            `Cannot recover thread '${input.binding.threadId}' because no provider resume state is persisted.`,
          );
        }

        const persistedCwd = readPersistedCwd(input.binding.runtimePayload);
        const persistedModelSelection = readPersistedModelSelection(input.binding.runtimePayload);
        const persistedProviderOptions = readPersistedProviderOptions(input.binding.runtimePayload);
        const startSessionInput = {
          threadId: input.binding.threadId,
          provider: input.binding.provider,
          ...(persistedCwd ? { cwd: persistedCwd } : {}),
          ...(persistedModelSelection ? { modelSelection: persistedModelSelection } : {}),
          ...(persistedProviderOptions ? { providerOptions: persistedProviderOptions } : {}),
          runtimeMode: input.binding.runtimeMode ?? "full-access",
        } satisfies ProviderSessionStartInput;

        const startFreshAfterResumeUnavailable = () =>
          adapter.startSession(startSessionInput).pipe(
            Effect.map((session) => ({
              session,
              strategy: "resume-fallback-fresh-start" as const,
              reconnectState: "fresh-start" as const,
              reconnectSummary: RESUME_FALLBACK_RECONNECT_SUMMARY,
            })),
          );

        const resumed = yield* adapter
          .startSession({
            ...startSessionInput,
            ...(hasResumeCursor ? { resumeCursor: input.binding.resumeCursor } : {}),
          })
          .pipe(
            Effect.map((session) => {
              if (
                hasResumeCursor &&
                didResumeCursorFallback({
                  requestedResumeCursor: input.binding.resumeCursor,
                  resumedResumeCursor: session.resumeCursor,
                })
              ) {
                return {
                  session,
                  strategy: "resume-fallback-fresh-start" as const,
                  reconnectState: "fresh-start" as const,
                  reconnectSummary: RESUME_FALLBACK_RECONNECT_SUMMARY,
                };
              }
              const resumedProviderThreadId = readProviderThreadIdFromResumeCursor(
                session.resumeCursor,
              );
              return {
                session,
                strategy: "resume-thread" as const,
                reconnectState: "resume-thread" as const,
                reconnectSummary: resumedProviderThreadId
                  ? `Reconnected to remote provider thread ${resumedProviderThreadId}.`
                  : "Resumed the persisted remote provider session.",
              };
            }),
            Effect.catchTags({
              ProviderAdapterSessionNotFoundError: (error) =>
                input.binding.provider === "kiro"
                  ? startFreshAfterResumeUnavailable()
                  : Effect.fail(error),
              ProviderAdapterSessionClosedError: (error) =>
                input.binding.provider === "kiro"
                  ? startFreshAfterResumeUnavailable()
                  : Effect.fail(error),
            }),
            Effect.tapError(() =>
              directory
                .upsert({
                  threadId: input.binding.threadId,
                  provider: input.binding.provider,
                  ...(input.binding.runtimeMode !== undefined
                    ? { runtimeMode: input.binding.runtimeMode }
                    : {}),
                  status: "error",
                  runtimePayload: buildRemoteSessionRuntimeMetadataPatch({
                    reconnectState: "resume-failed",
                    reconnectSummary:
                      "Automatic reconnect to the persisted remote provider session failed.",
                    resumeAvailable: true,
                  }),
                })
                .pipe(Effect.catch(() => Effect.void)),
            ),
          );
        if (resumed.session.provider !== adapter.provider) {
          return yield* toValidationError(
            input.operation,
            `Adapter/provider mismatch while recovering thread '${input.binding.threadId}'. Expected '${adapter.provider}', received '${resumed.session.provider}'.`,
          );
        }

        yield* upsertSessionBinding(resumed.session, input.binding.threadId, {
          runtimePayload: buildRemoteSessionRuntimeMetadataPatch({
            session: resumed.session,
            reconnectState: resumed.reconnectState,
            reconnectSummary: resumed.reconnectSummary,
            resumeAvailable: resumed.session.resumeCursor !== undefined,
          }),
        });
        yield* analytics.record("provider.session.recovered", {
          provider: resumed.session.provider,
          strategy: resumed.strategy,
          hasResumeCursor: resumed.session.resumeCursor !== undefined,
        });
        return { adapter, session: resumed.session } as const;
      });

    const resolveRoutableSession = (input: {
      readonly threadId: ThreadId;
      readonly operation: string;
      readonly allowRecovery: boolean;
    }): Effect.Effect<
      {
        readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
        readonly threadId: ThreadId;
        readonly isActive: boolean;
        readonly recovered: boolean;
      },
      ProviderServiceError
    > =>
      Effect.gen(function* () {
        const bindingOption = yield* directory.getBinding(input.threadId);
        const binding = Option.getOrUndefined(bindingOption);
        if (!binding) {
          return yield* toValidationError(
            input.operation,
            `Cannot route thread '${input.threadId}' because no persisted provider binding exists.`,
          );
        }
        const adapter = yield* registry.getByProvider(binding.provider);

        const hasRequestedSession = yield* adapter.hasSession(input.threadId);
        if (hasRequestedSession) {
          return {
            adapter,
            threadId: input.threadId,
            isActive: true,
            recovered: false,
          } as const;
        }

        if (!input.allowRecovery) {
          return {
            adapter,
            threadId: input.threadId,
            isActive: false,
            recovered: false,
          } as const;
        }

        const recovered = yield* recoverSessionForThread({ binding, operation: input.operation });
        return {
          adapter: recovered.adapter,
          threadId: input.threadId,
          isActive: true,
          recovered: true,
        } as const;
      });

    const startSession: ProviderServiceShape["startSession"] = (threadId, rawInput) =>
      Effect.gen(function* () {
        const parsed = yield* decodeInputOrValidationError({
          operation: "ProviderService.startSession",
          schema: ProviderSessionStartInput,
          payload: rawInput,
        });

        const input = {
          ...parsed,
          threadId,
          provider: parsed.provider ?? "codex",
        };
        const persistedBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        const effectiveResumeCursor =
          input.resumeCursor ??
          (persistedBinding?.provider === input.provider
            ? persistedBinding.resumeCursor
            : undefined);
        const adapter = yield* registry.getByProvider(input.provider);
        const session = yield* adapter.startSession({
          ...input,
          ...(effectiveResumeCursor !== undefined ? { resumeCursor: effectiveResumeCursor } : {}),
        });

        if (session.provider !== adapter.provider) {
          return yield* toValidationError(
            "ProviderService.startSession",
            `Adapter/provider mismatch: requested '${adapter.provider}', received '${session.provider}'.`,
          );
        }

        yield* upsertSessionBinding(session, threadId, {
          modelSelection: input.modelSelection,
          providerOptions: input.providerOptions,
          runtimePayload: buildRemoteSessionRuntimeMetadataPatch({
            session,
            reconnectState: "fresh-start",
            reconnectSummary: "Started a new provider session.",
            resumeAvailable: session.resumeCursor !== undefined,
          }),
        });
        yield* analytics.record("provider.session.started", {
          provider: session.provider,
          runtimeMode: input.runtimeMode,
          hasResumeCursor: session.resumeCursor !== undefined,
          hasCwd: typeof input.cwd === "string" && input.cwd.trim().length > 0,
          hasModel:
            typeof input.modelSelection?.model === "string" &&
            input.modelSelection.model.trim().length > 0,
        });

        return session;
      });

    const sendTurn: ProviderServiceShape["sendTurn"] = (rawInput) =>
      Effect.gen(function* () {
        const parsed = yield* decodeInputOrValidationError({
          operation: "ProviderService.sendTurn",
          schema: ProviderSendTurnInput,
          payload: rawInput,
        });

        const input = {
          ...parsed,
          attachments: parsed.attachments ?? [],
        };
        if (!input.input && input.attachments.length === 0) {
          return yield* toValidationError(
            "ProviderService.sendTurn",
            "Either input text or at least one attachment is required",
          );
        }
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.sendTurn",
          allowRecovery: true,
        });
        const turn = yield* routed.adapter.sendTurn(input);
        yield* directory.upsert({
          threadId: input.threadId,
          provider: routed.adapter.provider,
          status: "running",
          ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
          runtimePayload: {
            ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
            activeTurnId: turn.turnId,
            lastRuntimeEvent: "provider.sendTurn",
            lastRuntimeEventAt: new Date().toISOString(),
          },
        });
        yield* analytics.record("provider.turn.sent", {
          provider: routed.adapter.provider,
          model: input.modelSelection?.model,
          interactionMode: input.interactionMode,
          attachmentCount: input.attachments.length,
          hasInput: typeof input.input === "string" && input.input.trim().length > 0,
        });
        return turn;
      });

    const interruptTurn: ProviderServiceShape["interruptTurn"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.interruptTurn",
          schema: ProviderInterruptTurnInput,
          payload: rawInput,
        });
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.interruptTurn",
          allowRecovery: true,
        });
        yield* routed.adapter.interruptTurn(routed.threadId, input.turnId);
        yield* analytics.record("provider.turn.interrupted", {
          provider: routed.adapter.provider,
        });
      });

    const respondToRequest: ProviderServiceShape["respondToRequest"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.respondToRequest",
          schema: ProviderRespondToRequestInput,
          payload: rawInput,
        });
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.respondToRequest",
          allowRecovery: true,
        });
        yield* routed.adapter.respondToRequest(routed.threadId, input.requestId, input.decision);
        yield* analytics.record("provider.request.responded", {
          provider: routed.adapter.provider,
          decision: input.decision,
        });
      });

    const respondToUserInput: ProviderServiceShape["respondToUserInput"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.respondToUserInput",
          schema: ProviderRespondToUserInputInput,
          payload: rawInput,
        });
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.respondToUserInput",
          allowRecovery: true,
        });
        yield* routed.adapter.respondToUserInput(routed.threadId, input.requestId, input.answers);
      });

    const stopSession: ProviderServiceShape["stopSession"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.stopSession",
          schema: ProviderStopSessionInput,
          payload: rawInput,
        });
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.stopSession",
          allowRecovery: false,
        });
        if (routed.isActive) {
          yield* routed.adapter.stopSession(routed.threadId);
        }
        yield* directory.remove(input.threadId);
        yield* analytics.record("provider.session.stopped", {
          provider: routed.adapter.provider,
        });
      });

    const listSessions: ProviderServiceShape["listSessions"] = () =>
      Effect.gen(function* () {
        const sessionsByProvider = yield* Effect.forEach(adapters, (adapter) =>
          adapter.listSessions(),
        );
        const activeSessions = sessionsByProvider.flatMap((sessions) => sessions);
        const persistedBindings = yield* directory.listThreadIds().pipe(
          Effect.flatMap((threadIds) =>
            Effect.forEach(
              threadIds,
              (threadId) =>
                directory
                  .getBinding(threadId)
                  .pipe(Effect.orElseSucceed(() => Option.none<ProviderRuntimeBinding>())),
              { concurrency: "unbounded" },
            ),
          ),
          Effect.orElseSucceed(() => [] as Array<Option.Option<ProviderRuntimeBinding>>),
        );
        const bindingsByThreadId = new Map<ThreadId, ProviderRuntimeBinding>();
        for (const bindingOption of persistedBindings) {
          const binding = Option.getOrUndefined(bindingOption);
          if (binding) {
            bindingsByThreadId.set(binding.threadId, binding);
          }
        }

        return activeSessions.map((session) => {
          const binding = bindingsByThreadId.get(session.threadId);
          if (!binding) {
            return session;
          }

          const overrides: {
            resumeCursor?: ProviderSession["resumeCursor"];
            runtimeMode?: ProviderSession["runtimeMode"];
          } = {};
          if (session.resumeCursor === undefined && binding.resumeCursor !== undefined) {
            overrides.resumeCursor = binding.resumeCursor;
          }
          if (binding.runtimeMode !== undefined) {
            overrides.runtimeMode = binding.runtimeMode;
          }
          return Object.assign({}, session, overrides);
        });
      });

    const inspectRecoverableThread: ProviderServiceShape["inspectRecoverableThread"] = (input) =>
      Effect.gen(function* () {
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.inspectRecoverableThread",
          allowRecovery: true,
        });
        const activeSessions = yield* listSessions();
        const session = activeSessions.find((entry) => entry.threadId === input.threadId);
        if (!session) {
          return yield* toValidationError(
            "ProviderService.inspectRecoverableThread",
            `Recovered thread '${input.threadId}' has no active provider session.`,
          );
        }
        const threadSnapshot = yield* routed.adapter.readThread(input.threadId);
        return {
          session,
          threadSnapshot,
          recovered: routed.recovered,
        } as const;
      });

    const getCapabilities: ProviderServiceShape["getCapabilities"] = (provider) =>
      registry.getByProvider(provider).pipe(Effect.map((adapter) => adapter.capabilities));

    const rollbackConversation: ProviderServiceShape["rollbackConversation"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.rollbackConversation",
          schema: ProviderRollbackConversationInput,
          payload: rawInput,
        });
        if (input.numTurns === 0) {
          return;
        }
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.rollbackConversation",
          allowRecovery: true,
        });
        yield* routed.adapter.rollbackThread(routed.threadId, input.numTurns);
        yield* analytics.record("provider.conversation.rolled_back", {
          provider: routed.adapter.provider,
          turns: input.numTurns,
        });
      });

    const runStopAll = () =>
      Effect.gen(function* () {
        const threadIds = yield* directory.listThreadIds();
        const stoppedAt = new Date().toISOString();
        yield* Effect.forEach(adapters, (adapter) => adapter.stopAll()).pipe(Effect.asVoid);
        yield* Effect.forEach(threadIds, (threadId) =>
          directory.getBinding(threadId).pipe(
            Effect.flatMap((binding) =>
              Option.match(binding, {
                onNone: () => Effect.void,
                onSome: (value) =>
                  directory.upsert({
                    threadId,
                    provider: value.provider,
                    ...(value.runtimeMode !== undefined ? { runtimeMode: value.runtimeMode } : {}),
                    ...(value.resumeCursor !== undefined
                      ? { resumeCursor: value.resumeCursor }
                      : {}),
                    ...(!hasPersistedRemoteTarget(value.runtimePayload)
                      ? { status: "stopped" as const }
                      : {}),
                    runtimePayload: {
                      ...(!hasPersistedRemoteTarget(value.runtimePayload)
                        ? { activeTurnId: null }
                        : {}),
                      lastError: null,
                      lastRuntimeEvent: "provider.stopAll",
                      lastRuntimeEventAt: stoppedAt,
                      reconnectState: null,
                      reconnectSummary: null,
                      reconnectUpdatedAt: null,
                    },
                  }),
              }),
            ),
          ),
        ).pipe(Effect.asVoid);
        yield* analytics.record("provider.sessions.stopped_all", {
          sessionCount: threadIds.length,
        });
        yield* analytics.flush;
      });

    yield* Effect.addFinalizer(() =>
      Effect.catch(runStopAll(), (cause) =>
        Effect.logWarning("failed to stop provider service", { cause }),
      ),
    );

    return {
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      inspectRecoverableThread,
      getCapabilities,
      rollbackConversation,
      // Each access creates a fresh PubSub subscription so that multiple
      // consumers (ProviderRuntimeIngestion, CheckpointReactor, etc.) each
      // independently receive all runtime events.
      get streamEvents(): ProviderServiceShape["streamEvents"] {
        return Stream.fromPubSub(runtimeEventPubSub);
      },
    } satisfies ProviderServiceShape;
  });

export const ProviderServiceLive = Layer.effect(ProviderService, makeProviderService());

export function makeProviderServiceLive(options?: ProviderServiceLiveOptions) {
  return Layer.effect(ProviderService, makeProviderService(options));
}

import { randomUUID } from "node:crypto";

import {
  CommandId,
  type OrchestrationSession,
  type OrchestrationThread,
  type ProviderSession,
  ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  StartupThreadReconciler,
  type StartupThreadReconcilerShape,
} from "../Services/StartupThreadReconciler.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { readProviderThreadIdFromResumeCursor } from "../../provider/remoteSessionMetadata.ts";

const RECONCILE_TIMEOUT_MS = 15_000;
const RECONCILE_CONCURRENCY = 4;

function readRequestId(activity: OrchestrationThread["activities"][number]): string | null {
  const payload = activity.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const requestId = (payload as { requestId?: unknown }).requestId;
  return typeof requestId === "string" ? requestId : null;
}

function hasPendingApproval(thread: OrchestrationThread): boolean {
  const open = new Set<string>();
  for (const activity of thread.activities) {
    const requestId = readRequestId(activity);
    if (!requestId) {
      continue;
    }
    if (activity.kind === "approval.requested") {
      open.add(requestId);
      continue;
    }
    if (activity.kind === "approval.resolved") {
      open.delete(requestId);
      continue;
    }
    if (
      activity.kind === "provider.approval.respond.failed" &&
      typeof activity.payload === "object" &&
      activity.payload !== null &&
      "detail" in activity.payload &&
      typeof (activity.payload as { detail?: unknown }).detail === "string" &&
      (activity.payload as { detail: string }).detail.includes("Unknown pending permission request")
    ) {
      open.delete(requestId);
    }
  }
  return open.size > 0;
}

function hasPendingUserInput(thread: OrchestrationThread): boolean {
  const open = new Set<string>();
  for (const activity of thread.activities) {
    const requestId = readRequestId(activity);
    if (!requestId) {
      continue;
    }
    if (activity.kind === "user-input.requested") {
      open.add(requestId);
      continue;
    }
    if (activity.kind === "user-input.resolved") {
      open.delete(requestId);
    }
  }
  return open.size > 0;
}

function toSessionFromThread(input: {
  readonly thread: OrchestrationThread;
  readonly status: OrchestrationSession["status"];
  readonly now: string;
}): OrchestrationSession | null {
  const existing = input.thread.session;
  if (!existing) {
    return null;
  }
  return {
    ...existing,
    status: input.status,
    updatedAt: input.now,
  };
}

function toSessionFromProvider(input: {
  readonly thread: OrchestrationThread;
  readonly providerSession: ProviderSession;
  readonly status: OrchestrationSession["status"];
  readonly activeTurnId: TurnId | null;
  readonly now: string;
}): OrchestrationSession | null {
  const existing = input.thread.session;
  if (!existing) {
    return null;
  }
  return {
    threadId: input.thread.id,
    status: input.status,
    providerName: input.providerSession.provider,
    runtimeMode: input.providerSession.runtimeMode,
    activeTurnId: input.activeTurnId,
    lastError: input.providerSession.lastError ?? null,
    ...(readProviderThreadIdFromResumeCursor(input.providerSession.resumeCursor)
      ? {
          providerThreadId: readProviderThreadIdFromResumeCursor(
            input.providerSession.resumeCursor,
          ),
        }
      : existing.providerThreadId
        ? { providerThreadId: existing.providerThreadId }
        : {}),
    ...(input.providerSession.resumeCursor !== undefined
      ? { resumeAvailable: true }
      : existing.resumeAvailable !== undefined
        ? { resumeAvailable: existing.resumeAvailable }
        : {}),
    ...(existing.reconnectState !== undefined ? { reconnectState: existing.reconnectState } : {}),
    ...(existing.reconnectSummary !== undefined
      ? { reconnectSummary: existing.reconnectSummary }
      : {}),
    ...(existing.reconnectUpdatedAt !== undefined
      ? { reconnectUpdatedAt: existing.reconnectUpdatedAt }
      : {}),
    updatedAt: input.now,
  };
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;

  const setThreadSession = (thread: OrchestrationThread, status: OrchestrationSession["status"]) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const session = toSessionFromThread({ thread, status, now });
      if (!session) {
        return;
      }
      yield* orchestrationEngine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe(randomUUID()),
        threadId: thread.id,
        session,
        createdAt: now,
      });
    });

  const stopRecoveredSession = (threadId: ThreadId) =>
    providerService.stopSession({ threadId }).pipe(Effect.ignore);

  const reconcileThread = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const thread = readModel.threads.find((entry) => entry.id === threadId);
      if (!thread || thread.deletedAt !== null) {
        return;
      }
      if (thread.session?.status !== "disconnected") {
        return;
      }
      if (thread.latestTurn?.completedAt !== null) {
        return;
      }

      yield* setThreadSession(thread, "starting");

      const inspectedExit = yield* Effect.exit(
        providerService
          .inspectRecoverableThread({ threadId })
          .pipe(Effect.timeoutOption(RECONCILE_TIMEOUT_MS)),
      );
      if (inspectedExit._tag === "Failure") {
        yield* setThreadSession(thread, "disconnected");
        yield* stopRecoveredSession(thread.id);
        return;
      }
      const inspected = Option.getOrUndefined(inspectedExit.value);

      if (!inspected) {
        yield* setThreadSession(thread, "disconnected");
        yield* stopRecoveredSession(thread.id);
        return;
      }

      const refreshedReadModel = yield* orchestrationEngine.getReadModel();
      const refreshedThread = refreshedReadModel.threads.find((entry) => entry.id === threadId);
      if (!refreshedThread || refreshedThread.deletedAt !== null) {
        yield* stopRecoveredSession(thread.id);
        return;
      }

      const now = new Date().toISOString();
      if (hasPendingApproval(refreshedThread) || hasPendingUserInput(refreshedThread)) {
        const session = toSessionFromProvider({
          thread: refreshedThread,
          providerSession: inspected.session,
          status: "ready",
          activeTurnId: null,
          now,
        });
        if (session) {
          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.makeUnsafe(randomUUID()),
            threadId,
            session,
            createdAt: now,
          });
        }
        return;
      }

      if (inspected.session.activeTurnId) {
        const session = toSessionFromProvider({
          thread: refreshedThread,
          providerSession: inspected.session,
          status: "running",
          activeTurnId: inspected.session.activeTurnId,
          now,
        });
        if (session) {
          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.makeUnsafe(randomUUID()),
            threadId,
            session,
            createdAt: now,
          });
        }
        return;
      }

      if (refreshedThread.latestTurn?.turnId) {
        yield* orchestrationEngine.dispatch({
          type: "thread.turn.complete",
          commandId: CommandId.makeUnsafe(randomUUID()),
          threadId,
          turnId: refreshedThread.latestTurn.turnId,
          state: "completed",
          completedAt: now,
          ...(refreshedThread.latestTurn.assistantMessageId
            ? { assistantMessageId: refreshedThread.latestTurn.assistantMessageId }
            : {}),
          createdAt: now,
        });
      }

      yield* stopRecoveredSession(thread.id);
      yield* setThreadSession(refreshedThread, "stopped");
    });

  const runInitialReconciliation = Effect.gen(function* () {
    const readModel = yield* orchestrationEngine.getReadModel();
    const candidateIds = readModel.threads
      .filter((thread) => thread.deletedAt === null)
      .filter((thread) => thread.session?.status === "running")
      .filter((thread) => thread.latestTurn?.completedAt === null)
      .filter((thread) => !hasPendingApproval(thread))
      .filter((thread) => !hasPendingUserInput(thread))
      .map((thread) => thread.id);

    yield* Effect.forEach(
      candidateIds,
      (threadId) => {
        const currentThread = readModel.threads.find((entry) => entry.id === threadId);
        if (!currentThread) {
          return Effect.void;
        }
        return setThreadSession(currentThread, "disconnected");
      },
      { concurrency: 1 },
    );

    yield* Effect.forEach(candidateIds, reconcileThread, {
      concurrency: RECONCILE_CONCURRENCY,
    });
  });

  const start: StartupThreadReconcilerShape["start"] = Effect.forkScoped(
    runInitialReconciliation.pipe(Effect.ignore),
  ).pipe(Effect.asVoid);

  return {
    start,
  } satisfies StartupThreadReconcilerShape;
});

export const StartupThreadReconcilerLive = Layer.effect(StartupThreadReconciler, make);

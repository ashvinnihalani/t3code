import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
  TurnId,
  type ProviderSession,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { StartupThreadReconcilerLive } from "./StartupThreadReconciler.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { StartupThreadReconciler } from "../Services/StartupThreadReconciler.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

async function waitFor<T>(
  load: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<T> => {
    const value = await load();
    if (predicate(value)) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    return poll();
  };
  return poll();
}

function makeProviderSession(input: {
  threadId: ThreadId;
  status?: ProviderSession["status"];
  activeTurnId?: TurnId | null;
}): ProviderSession {
  const now = "2026-03-19T00:00:00.000Z";
  return {
    provider: "codex",
    status: input.status ?? "running",
    runtimeMode: "full-access",
    threadId: input.threadId,
    ...(input.activeTurnId ? { activeTurnId: input.activeTurnId } : {}),
    resumeCursor: { opaque: `provider-thread:${input.threadId}` },
    createdAt: now,
    updatedAt: now,
  };
}

function createProviderServiceStub(input: {
  inspectRecoverableThread: ProviderServiceShape["inspectRecoverableThread"];
  stopSession?: ProviderServiceShape["stopSession"];
}): ProviderServiceShape {
  const unsupported = () => Effect.die(new Error("Unsupported provider call in test")) as never;
  return {
    startSession: () => unsupported(),
    sendTurn: () => unsupported(),
    interruptTurn: () => unsupported(),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: input.stopSession ?? (() => Effect.void),
    listSessions: () => Effect.succeed([]),
    getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
    rollbackConversation: () => unsupported(),
    inspectRecoverableThread: input.inspectRecoverableThread,
    streamEvents: Stream.empty,
  };
}

describe("StartupThreadReconciler", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | StartupThreadReconciler,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  async function createHarness(input: {
    inspectRecoverableThread: ProviderServiceShape["inspectRecoverableThread"];
    stopSession?: ProviderServiceShape["stopSession"];
  }) {
    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
    );
    const providerLayer = Layer.succeed(
      ProviderService,
      createProviderServiceStub({
        inspectRecoverableThread: input.inspectRecoverableThread,
        ...(input.stopSession ? { stopSession: input.stopSession } : {}),
      }),
    );
    const orchestrationRuntimeLayer = orchestrationLayer.pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(NodeServices.layer),
    );
    const startupLayer = StartupThreadReconcilerLive.pipe(
      Layer.provideMerge(orchestrationRuntimeLayer),
      Layer.provideMerge(providerLayer),
    );
    runtime = ManagedRuntime.make(
      Layer.mergeAll(orchestrationRuntimeLayer, providerLayer, startupLayer),
    );

    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const reconciler = await runtime.runPromise(Effect.service(StartupThreadReconciler));
    scope = await Effect.runPromise(Scope.make("sequential"));

    const createdAt = "2026-03-19T00:00:00.000Z";
    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-create"),
        projectId: asProjectId("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        threadId: asThreadId("thread-1"),
        projectId: asProjectId("project-1"),
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        projectPath: "/tmp/project",
        branch: [null],
        worktreePath: [null],
        createdAt,
      }),
    );

    return {
      engine,
      reconciler,
    };
  }

  it("marks stale running threads disconnected before probing, then returns them to working", async () => {
    const inspectRecoverableThread = vi.fn<ProviderServiceShape["inspectRecoverableThread"]>(
      ({ threadId }) =>
        Effect.sleep("100 millis").pipe(
          Effect.as({
            session: makeProviderSession({
              threadId,
              activeTurnId: asTurnId("turn-1"),
            }),
            threadSnapshot: {
              threadId,
              turns: [],
            },
            recovered: true,
          }),
        ),
    );
    const { engine, reconciler } = await createHarness({ inspectRecoverableThread });
    const startedAt = "2026-03-19T00:00:05.000Z";

    await Effect.runPromise(
      engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-running"),
        threadId: asThreadId("thread-1"),
        session: {
          threadId: asThreadId("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: asTurnId("turn-1"),
          lastError: null,
          updatedAt: startedAt,
        },
        createdAt: startedAt,
      }),
    );

    await Effect.runPromise(reconciler.start.pipe(Scope.provide(scope!)));

    const disconnectedThread = await waitFor(
      async () => {
        const readModel = await Effect.runPromise(engine.getReadModel());
        return readModel.threads.find((entry) => entry.id === asThreadId("thread-1")) ?? null;
      },
      (thread) => thread?.session?.status === "disconnected",
    );
    expect(disconnectedThread?.session?.status).toBe("disconnected");

    const runningThread = await waitFor(
      async () => {
        const readModel = await Effect.runPromise(engine.getReadModel());
        return readModel.threads.find((entry) => entry.id === asThreadId("thread-1")) ?? null;
      },
      (thread) => thread?.session?.status === "running",
    );
    expect(runningThread?.session?.activeTurnId).toBe(asTurnId("turn-1"));
    expect(inspectRecoverableThread).toHaveBeenCalledTimes(1);
  });

  it("synthesizes completion for stale running threads that finished while t3 was away", async () => {
    const stopSession = vi.fn<ProviderServiceShape["stopSession"]>(() => Effect.void);
    const { engine, reconciler } = await createHarness({
      inspectRecoverableThread: ({ threadId }) =>
        Effect.succeed({
          session: makeProviderSession({
            threadId,
            status: "ready",
            activeTurnId: null,
          }),
          threadSnapshot: {
            threadId,
            turns: [],
          },
          recovered: true,
        }),
      stopSession,
    });
    const startedAt = "2026-03-19T00:00:05.000Z";

    await Effect.runPromise(
      engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-running"),
        threadId: asThreadId("thread-1"),
        session: {
          threadId: asThreadId("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: asTurnId("turn-1"),
          lastError: null,
          updatedAt: startedAt,
        },
        createdAt: startedAt,
      }),
    );

    await Effect.runPromise(reconciler.start.pipe(Scope.provide(scope!)));

    const completedThread = await waitFor(
      async () => {
        const readModel = await Effect.runPromise(engine.getReadModel());
        return readModel.threads.find((entry) => entry.id === asThreadId("thread-1")) ?? null;
      },
      (thread) => {
        if (thread?.latestTurn?.turnId !== asTurnId("turn-1")) {
          return false;
        }
        return thread.latestTurn.completedAt !== null && thread.session?.status === "stopped";
      },
    );

    expect(completedThread?.latestTurn?.state).toBe("completed");
    expect(completedThread?.session?.status).toBe("stopped");
    expect(stopSession).toHaveBeenCalledWith({ threadId: asThreadId("thread-1") });
  });

  it("does not downgrade already-completed threads into disconnected recovery", async () => {
    const inspectRecoverableThread = vi.fn<ProviderServiceShape["inspectRecoverableThread"]>(
      () =>
        Effect.die(
          new Error("inspectRecoverableThread should not run for already completed threads"),
        ) as never,
    );
    const { engine, reconciler } = await createHarness({ inspectRecoverableThread });
    const completedAt = "2026-03-19T00:00:10.000Z";

    await Effect.runPromise(
      engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-ready"),
        threadId: asThreadId("thread-1"),
        session: {
          threadId: asThreadId("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: completedAt,
        },
        createdAt: completedAt,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.turn.complete",
        commandId: CommandId.makeUnsafe("cmd-turn-complete"),
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        state: "completed",
        completedAt,
        createdAt: completedAt,
      }),
    );

    await Effect.runPromise(reconciler.start.pipe(Scope.provide(scope!)));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const readModel = await Effect.runPromise(engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === asThreadId("thread-1"));
    expect(thread?.session?.status).toBe("ready");
    expect(thread?.latestTurn?.completedAt).toBe(completedAt);
    expect(inspectRecoverableThread).not.toHaveBeenCalled();
  });
});

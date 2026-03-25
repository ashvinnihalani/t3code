import {
  CheckpointRef,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { checkpointRefForThreadTurn } from "../Utils.ts";
import { CheckpointDiffQueryLive } from "./CheckpointDiffQuery.ts";
import { CheckpointStore, type CheckpointStoreShape } from "../Services/CheckpointStore.ts";
import { CheckpointDiffQuery } from "../Services/CheckpointDiffQuery.ts";

function makeSnapshot(input: {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly checkpointTurnCount: number;
  readonly checkpointRef: CheckpointRef;
  readonly checkpointStatus?: "ready" | "missing" | "error";
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    projects: [
      {
        id: input.projectId,
        title: "Project",
        workspaceRoot: input.workspaceRoot,
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: input.threadId,
        projectId: input.projectId,
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: input.worktreePath,
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:00.000Z",
          assistantMessageId: null,
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
        messages: [],
        activities: [],
        proposedPlans: [],
        checkpoints: [
          {
            turnId: TurnId.makeUnsafe("turn-1"),
            checkpointTurnCount: input.checkpointTurnCount,
            checkpointRef: input.checkpointRef,
            status: input.checkpointStatus ?? "ready",
            files: [],
            assistantMessageId: null,
            completedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        session: null,
      },
    ],
  };
}

describe("CheckpointDiffQueryLive", () => {
  it("computes diffs using canonical turn-0 checkpoint refs", async () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const threadId = ThreadId.makeUnsafe("thread-1");
    const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
    const hasCheckpointRefCalls: Array<CheckpointRef> = [];
    const diffCheckpointsCalls: Array<{
      readonly fromCheckpointRef: CheckpointRef;
      readonly toCheckpointRef: CheckpointRef;
      readonly cwd: string;
    }> = [];

    const snapshot = makeSnapshot({
      projectId,
      threadId,
      workspaceRoot: "/tmp/workspace",
      worktreePath: null,
      checkpointTurnCount: 1,
      checkpointRef: toCheckpointRef,
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: ({ checkpointRef }) =>
        Effect.sync(() => {
          hasCheckpointRefCalls.push(checkpointRef);
          return true;
        }),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd }) =>
        Effect.sync(() => {
          diffCheckpointsCalls.push({ fromCheckpointRef, toCheckpointRef, cwd });
          return "diff patch";
        }),
      deleteCheckpointRefs: () => Effect.void,
    };

    const projectionTurnRepository = {
      upsertByTurnId: () => Effect.void,
      replacePendingTurnStart: () => Effect.void,
      getPendingTurnStartByThreadId: () => Effect.succeed(Option.none()),
      deletePendingTurnStartByThreadId: () => Effect.void,
      listByThreadId: () => Effect.succeed([]),
      getByTurnId: () => Effect.succeed(Option.none()),
      clearCheckpointTurnConflict: () => Effect.void,
      deleteByThreadId: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(Layer.succeed(ProjectionTurnRepository, projectionTurnRepository)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getSnapshot: () => Effect.succeed(snapshot),
        }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer)),
    );

    const expectedFromRef = checkpointRefForThreadTurn(threadId, 0);
    expect(hasCheckpointRefCalls).toEqual([expectedFromRef, toCheckpointRef]);
    expect(diffCheckpointsCalls).toEqual([
      {
        cwd: "/tmp/workspace",
        fromCheckpointRef: expectedFromRef,
        toCheckpointRef,
      },
    ]);
    expect(result).toEqual({
      threadId,
      fromTurnCount: 0,
      toTurnCount: 1,
      diff: "diff patch",
    });
  });

  it("fails when the thread is missing from the snapshot", async () => {
    const threadId = ThreadId.makeUnsafe("thread-missing");

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(true),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.succeed(""),
      deleteCheckpointRefs: () => Effect.void,
    };

    const projectionTurnRepository = {
      upsertByTurnId: () => Effect.void,
      replacePendingTurnStart: () => Effect.void,
      getPendingTurnStartByThreadId: () => Effect.succeed(Option.none()),
      deletePendingTurnStartByThreadId: () => Effect.void,
      listByThreadId: () => Effect.succeed([]),
      getByTurnId: () => Effect.succeed(Option.none()),
      clearCheckpointTurnConflict: () => Effect.void,
      deleteByThreadId: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(Layer.succeed(ProjectionTurnRepository, projectionTurnRepository)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getSnapshot: () =>
            Effect.succeed({
              snapshotSequence: 0,
              projects: [],
              threads: [],
              updatedAt: "2026-01-01T00:00:00.000Z",
            } satisfies OrchestrationReadModel),
        }),
      ),
    );

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const query = yield* CheckpointDiffQuery;
          return yield* query.getTurnDiff({
            threadId,
            fromTurnCount: 0,
            toTurnCount: 1,
          });
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow("Thread 'thread-missing' not found.");
  });

  it("returns stored provider diffs without consulting the checkpoint store", async () => {
    const projectId = ProjectId.makeUnsafe("project-remote");
    const threadId = ThreadId.makeUnsafe("thread-remote");
    const providerDiffRef = CheckpointRef.makeUnsafe("provider-diff:evt-remote-1");

    const snapshot = makeSnapshot({
      projectId,
      threadId,
      workspaceRoot: "/home/remote-user/project",
      worktreePath: null,
      checkpointTurnCount: 1,
      checkpointRef: providerDiffRef,
      checkpointStatus: "missing",
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.die("checkpoint store should not be used"),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.die("checkpoint store should not be used"),
      deleteCheckpointRefs: () => Effect.void,
    };

    const projectionTurnRepository = {
      upsertByTurnId: () => Effect.void,
      replacePendingTurnStart: () => Effect.void,
      getPendingTurnStartByThreadId: () => Effect.succeed(Option.none()),
      deletePendingTurnStartByThreadId: () => Effect.void,
      listByThreadId: () => Effect.succeed([]),
      getByTurnId: () =>
        Effect.succeed(
          Option.some({
            threadId,
            turnId: TurnId.makeUnsafe("turn-1"),
            pendingMessageId: null,
            sourceProposedPlanThreadId: null,
            sourceProposedPlanId: null,
            assistantMessageId: null,
            state: "completed" as const,
            requestedAt: "2026-01-01T00:00:00.000Z",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:00.000Z",
            checkpointTurnCount: 1,
            checkpointRef: providerDiffRef,
            checkpointStatus: "missing" as const,
            checkpointFiles: [],
            checkpointDiff: [
              "diff --git a/src/app.ts b/src/app.ts",
              "--- a/src/app.ts",
              "+++ b/src/app.ts",
              "@@ -1 +1,2 @@",
              " console.log('hello');",
              "+console.log('remote');",
              "",
            ].join("\n"),
          }),
        ),
      clearCheckpointTurnConflict: () => Effect.void,
      deleteByThreadId: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(Layer.succeed(ProjectionTurnRepository, projectionTurnRepository)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getSnapshot: () => Effect.succeed(snapshot),
        }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.diff).toContain("console.log('remote');");
  });

  it("rejects whole-thread diff requests for provider-only checkpoints", async () => {
    const projectId = ProjectId.makeUnsafe("project-remote");
    const threadId = ThreadId.makeUnsafe("thread-remote");

    const snapshot: OrchestrationReadModel = {
      snapshotSequence: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
      projects: [
        {
          id: projectId,
          title: "Project",
          workspaceRoot: "/home/remote-user/project",
          defaultModel: null,
          scripts: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          deletedAt: null,
        },
      ],
      threads: [
        {
          id: threadId,
          projectId,
          title: "Thread",
          model: "gpt-5-codex",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-2"),
            state: "completed",
            requestedAt: "2026-01-01T00:00:00.000Z",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:00.000Z",
            assistantMessageId: null,
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          deletedAt: null,
          messages: [],
          activities: [],
          proposedPlans: [],
          checkpoints: [
            {
              turnId: TurnId.makeUnsafe("turn-1"),
              checkpointTurnCount: 1,
              checkpointRef: CheckpointRef.makeUnsafe("provider-diff:evt-remote-1"),
              status: "missing",
              files: [],
              assistantMessageId: null,
              completedAt: "2026-01-01T00:00:00.000Z",
            },
            {
              turnId: TurnId.makeUnsafe("turn-2"),
              checkpointTurnCount: 2,
              checkpointRef: CheckpointRef.makeUnsafe("provider-diff:evt-remote-2"),
              status: "missing",
              files: [],
              assistantMessageId: null,
              completedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          session: null,
        },
      ],
    };

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.die("checkpoint store should not be used"),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.die("checkpoint store should not be used"),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.die("checkpoint store should not be used"),
      deleteCheckpointRefs: () => Effect.void,
    };

    const projectionTurnRepository = {
      upsertByTurnId: () => Effect.void,
      replacePendingTurnStart: () => Effect.void,
      getPendingTurnStartByThreadId: () => Effect.succeed(Option.none()),
      deletePendingTurnStartByThreadId: () => Effect.void,
      listByThreadId: () => Effect.succeed([]),
      getByTurnId: () => Effect.succeed(Option.none()),
      clearCheckpointTurnConflict: () => Effect.void,
      deleteByThreadId: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(Layer.succeed(ProjectionTurnRepository, projectionTurnRepository)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getSnapshot: () => Effect.succeed(snapshot),
        }),
      ),
    );

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const query = yield* CheckpointDiffQuery;
          return yield* query.getFullThreadDiff({
            threadId,
            toTurnCount: 2,
          });
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow("Only the per-turn diff for turn 2 is available");
  });

  it("returns a checkpoint error when the workspace path is unavailable", async () => {
    const projectId = ProjectId.makeUnsafe("project-missing");
    const threadId = ThreadId.makeUnsafe("thread-missing-workspace");
    const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

    const snapshot = makeSnapshot({
      projectId,
      threadId,
      workspaceRoot: "/missing/workspace",
      worktreePath: null,
      checkpointTurnCount: 1,
      checkpointRef: toCheckpointRef,
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(false),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.die("checkpoint refs should not be resolved"),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.die("checkpoint diffs should not be resolved"),
      deleteCheckpointRefs: () => Effect.void,
    };

    const projectionTurnRepository = {
      upsertByTurnId: () => Effect.void,
      replacePendingTurnStart: () => Effect.void,
      getPendingTurnStartByThreadId: () => Effect.succeed(Option.none()),
      deletePendingTurnStartByThreadId: () => Effect.void,
      listByThreadId: () => Effect.succeed([]),
      getByTurnId: () => Effect.succeed(Option.none()),
      clearCheckpointTurnConflict: () => Effect.void,
      deleteByThreadId: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(Layer.succeed(ProjectionTurnRepository, projectionTurnRepository)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getSnapshot: () => Effect.succeed(snapshot),
        }),
      ),
    );

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const query = yield* CheckpointDiffQuery;
          return yield* query.getTurnDiff({
            threadId,
            fromTurnCount: 0,
            toTurnCount: 1,
          });
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow("workspace '/missing/workspace' is missing or is not a git repository");
  });
});

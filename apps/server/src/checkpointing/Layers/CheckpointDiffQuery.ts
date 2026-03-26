import {
  OrchestrationGetTurnDiffResult,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationGetTurnDiffResult as OrchestrationGetTurnDiffResultType,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema } from "effect";

import { parseTurnDiffFilesFromUnifiedDiff } from "../Diffs.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { CheckpointInvariantError, CheckpointUnavailableError } from "../Errors.ts";
import {
  checkpointRefForThreadTurn,
  prefixRepoRelativePath,
  resolveThreadGitRepoTargets,
  resolveThreadWorkspaceCwd,
} from "../Utils.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import {
  CheckpointDiffQuery,
  type CheckpointDiffQueryShape,
} from "../Services/CheckpointDiffQuery.ts";

const isTurnDiffResult = Schema.is(OrchestrationGetTurnDiffResult);
const isProviderDiffCheckpointRef = (checkpointRef: string) =>
  checkpointRef.startsWith("provider-diff:");

const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const checkpointStore = yield* CheckpointStore;

  const getTurnDiff: CheckpointDiffQueryShape["getTurnDiff"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointDiffQuery.getTurnDiff";

      if (input.fromTurnCount === input.toTurnCount) {
        const emptyDiff: OrchestrationGetTurnDiffResultType = {
          threadId: input.threadId,
          fromTurnCount: input.fromTurnCount,
          toTurnCount: input.toTurnCount,
          diff: "",
        };
        if (!isTurnDiffResult(emptyDiff)) {
          return yield* new CheckpointInvariantError({
            operation,
            detail: "Computed turn diff result does not satisfy contract schema.",
          });
        }
        return emptyDiff;
      }

      const snapshot = yield* projectionSnapshotQuery.getSnapshot();
      const thread = snapshot.threads.find((entry) => entry.id === input.threadId);
      if (!thread) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Thread '${input.threadId}' not found.`,
        });
      }

      const maxTurnCount = thread.checkpoints.reduce(
        (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
        0,
      );
      if (input.toTurnCount > maxTurnCount) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Turn diff range exceeds current turn count: requested ${input.toTurnCount}, current ${maxTurnCount}.`,
        });
      }

      const workspaceCwd = resolveThreadWorkspaceCwd({
        thread,
        projects: snapshot.projects,
      });
      if (!workspaceCwd) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Workspace path missing for thread '${input.threadId}' when computing turn diff.`,
        });
      }

      const fromCheckpointRef =
        input.fromTurnCount === 0
          ? checkpointRefForThreadTurn(input.threadId, 0)
          : thread.checkpoints.find(
              (checkpoint) => checkpoint.checkpointTurnCount === input.fromTurnCount,
            )?.checkpointRef;
      if (!fromCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.fromTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.fromTurnCount}.`,
        });
      }

      const toCheckpoint = thread.checkpoints.find(
        (checkpoint) => checkpoint.checkpointTurnCount === input.toTurnCount,
      );
      const toCheckpointRef = toCheckpoint?.checkpointRef;
      if (!toCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.toTurnCount}.`,
        });
      }

      if (toCheckpoint && isProviderDiffCheckpointRef(toCheckpoint.checkpointRef)) {
        const supportedFromTurnCount = Math.max(0, input.toTurnCount - 1);
        if (input.fromTurnCount !== supportedFromTurnCount) {
          return yield* new CheckpointUnavailableError({
            threadId: input.threadId,
            turnCount: input.toTurnCount,
            detail: `Only the per-turn diff for turn ${input.toTurnCount} is available for this checkpoint source. Select that turn instead of viewing all turns.`,
          });
        }
      }

      if (
        toCheckpoint &&
        isProviderDiffCheckpointRef(toCheckpoint.checkpointRef) &&
        input.fromTurnCount === Math.max(0, input.toTurnCount - 1)
      ) {
        const turnRowOption = yield* projectionTurnRepository.getByTurnId({
          threadId: input.threadId,
          turnId: toCheckpoint.turnId,
        });
        if (
          Option.isSome(turnRowOption) &&
          typeof turnRowOption.value.checkpointDiff === "string"
        ) {
          const turnDiff: OrchestrationGetTurnDiffResultType = {
            threadId: input.threadId,
            fromTurnCount: input.fromTurnCount,
            toTurnCount: input.toTurnCount,
            diff: turnRowOption.value.checkpointDiff,
          };
          if (!isTurnDiffResult(turnDiff)) {
            return yield* new CheckpointInvariantError({
              operation,
              detail: "Computed provider turn diff result does not satisfy contract schema.",
            });
          }
          return turnDiff;
        }

        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Provider diff is unavailable for turn ${input.toTurnCount}.`,
        });
      }

      const isGitRepository = yield* checkpointStore.isGitRepository(workspaceCwd);
      if (!isGitRepository) {
        const repoTargets = resolveThreadGitRepoTargets({
          thread,
          projects: snapshot.projects,
        });
        if (repoTargets.length === 0) {
          return yield* new CheckpointUnavailableError({
            threadId: input.threadId,
            turnCount: input.toTurnCount,
            detail: `Turn diffs are unavailable because workspace '${workspaceCwd}' is missing or is not a git repository.`,
          });
        }

        const repoDiffs = yield* Effect.forEach(
          repoTargets,
          (repo) =>
            Effect.gen(function* () {
              const isRepo = yield* checkpointStore
                .isGitRepository(repo.cwd)
                .pipe(Effect.catch(() => Effect.succeed(false)));
              if (!isRepo) {
                return {
                  repoId: repo.repoId,
                  relativePath: repo.relativePath,
                  displayName: repo.displayName,
                  diff: "",
                  error: `Repo '${repo.displayName}' is unavailable or is not a git repository.`,
                };
              }

              const [fromExists, toExists] = yield* Effect.all(
                [
                  checkpointStore.hasCheckpointRef({
                    cwd: repo.cwd,
                    checkpointRef: fromCheckpointRef,
                  }),
                  checkpointStore.hasCheckpointRef({
                    cwd: repo.cwd,
                    checkpointRef: toCheckpointRef,
                  }),
                ],
                { concurrency: "unbounded" },
              );
              if (!fromExists || !toExists) {
                return {
                  repoId: repo.repoId,
                  relativePath: repo.relativePath,
                  displayName: repo.displayName,
                  diff: "",
                  error: `Filesystem checkpoint is unavailable for '${repo.displayName}'.`,
                };
              }

              const diff = yield* checkpointStore.diffCheckpoints({
                cwd: repo.cwd,
                fromCheckpointRef,
                toCheckpointRef,
                fallbackFromToHead: false,
              });
              return {
                repoId: repo.repoId,
                relativePath: repo.relativePath,
                displayName: repo.displayName,
                diff,
                files: parseTurnDiffFilesFromUnifiedDiff(diff).map((file) => ({
                  path: prefixRepoRelativePath(repo.relativePath, file.path),
                  kind: "modified" as const,
                  additions: file.additions,
                  deletions: file.deletions,
                })),
              };
            }).pipe(
              Effect.catch((error) =>
                Effect.succeed({
                  repoId: repo.repoId,
                  relativePath: repo.relativePath,
                  displayName: repo.displayName,
                  diff: "",
                  error: error.message,
                }),
              ),
            ),
          { concurrency: 1 },
        );

        const turnDiff: OrchestrationGetTurnDiffResultType = {
          threadId: input.threadId,
          fromTurnCount: input.fromTurnCount,
          toTurnCount: input.toTurnCount,
          diff: repoDiffs
            .map((repoDiff) => repoDiff.diff)
            .filter((diff) => diff.trim().length > 0)
            .join("\n"),
          repoDiffs,
        };
        if (!isTurnDiffResult(turnDiff)) {
          return yield* new CheckpointInvariantError({
            operation,
            detail: "Computed turn diff result does not satisfy contract schema.",
          });
        }
        return turnDiff;
      }

      const [fromExists, toExists] = yield* Effect.all(
        [
          checkpointStore.hasCheckpointRef({
            cwd: workspaceCwd,
            checkpointRef: fromCheckpointRef,
          }),
          checkpointStore.hasCheckpointRef({
            cwd: workspaceCwd,
            checkpointRef: toCheckpointRef,
          }),
        ],
        { concurrency: "unbounded" },
      );

      if (!fromExists) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.fromTurnCount,
          detail: `Filesystem checkpoint is unavailable for turn ${input.fromTurnCount}.`,
        });
      }

      if (!toExists) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Filesystem checkpoint is unavailable for turn ${input.toTurnCount}.`,
        });
      }

      const diff = yield* checkpointStore.diffCheckpoints({
        cwd: workspaceCwd,
        fromCheckpointRef,
        toCheckpointRef,
        fallbackFromToHead: false,
      });

      const turnDiff: OrchestrationGetTurnDiffResultType = {
        threadId: input.threadId,
        fromTurnCount: input.fromTurnCount,
        toTurnCount: input.toTurnCount,
        diff,
      };
      if (!isTurnDiffResult(turnDiff)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: "Computed turn diff result does not satisfy contract schema.",
        });
      }

      return turnDiff;
    });

  const getFullThreadDiff: CheckpointDiffQueryShape["getFullThreadDiff"] = (
    input: OrchestrationGetFullThreadDiffInput,
  ) =>
    getTurnDiff({
      threadId: input.threadId,
      fromTurnCount: 0,
      toTurnCount: input.toTurnCount,
    }).pipe(Effect.map((result): OrchestrationGetFullThreadDiffResult => result));

  return {
    getTurnDiff,
    getFullThreadDiff,
  } satisfies CheckpointDiffQueryShape;
});

export const CheckpointDiffQueryLive = Layer.effect(CheckpointDiffQuery, make);

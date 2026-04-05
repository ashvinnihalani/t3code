import { DEFAULT_RUNTIME_MODE, type ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { newThreadId } from "../lib/utils";
import { useStore } from "../store";
import { resolvePersistedThreadEnvMode } from "../threadEnvMode";

export function useHandleNewThread() {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const navigate = useNavigate();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const activeDraftThread = useComposerDraftStore((store) =>
    routeThreadId ? (store.draftThreadsByThreadId[routeThreadId] ?? null) : null,
  );

  const activeThread = routeThreadId
    ? threads.find((thread) => thread.id === routeThreadId)
    : undefined;

  const handleNewThread = useCallback(
    (
      projectId: ProjectId,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
      },
    ): Promise<void> => {
      const project = projects.find((entry) => entry.id === projectId);
      const {
        clearProjectDraftThreadId,
        getDraftThread,
        getDraftThreadByProjectId,
        applyStickyState,
        setDraftThreadContext,
        setProjectDraftThreadId,
      } = useComposerDraftStore.getState();
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const storedDraftThread = getDraftThreadByProjectId(projectId);
      const latestActiveDraftThread: DraftThreadState | null = routeThreadId
        ? getDraftThread(routeThreadId)
        : null;

      const resolveEnvMode = (
        currentWorktreePath: string | null,
        fallbackEnvMode?: DraftThreadEnvMode,
      ) =>
        resolvePersistedThreadEnvMode({
          projectHost: project?.host ?? null,
          requestedEnvMode: options?.envMode,
          fallbackEnvMode,
          worktreePath: hasWorktreePathOption
            ? (options?.worktreePath ?? null)
            : currentWorktreePath,
        });

      if (storedDraftThread) {
        return (async () => {
          const resolvedEnvMode = resolveEnvMode(
            storedDraftThread.worktreePath[0] ?? null,
            storedDraftThread.envMode,
          );
          const shouldNormalizeStoredEnvMode = resolvedEnvMode !== storedDraftThread.envMode;
          if (
            hasBranchOption ||
            hasWorktreePathOption ||
            hasEnvModeOption ||
            shouldNormalizeStoredEnvMode
          ) {
            setDraftThreadContext(storedDraftThread.threadId, {
              ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
              ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
              ...(project?.cwd
                ? { projectPath: storedDraftThread.projectPath || project.cwd }
                : {}),
              ...(hasEnvModeOption || shouldNormalizeStoredEnvMode
                ? { envMode: resolvedEnvMode }
                : {}),
            });
          }
          setProjectDraftThreadId(projectId, storedDraftThread.threadId);
          if (routeThreadId === storedDraftThread.threadId) {
            return;
          }
          await navigate({
            to: "/$threadId",
            params: { threadId: storedDraftThread.threadId },
          });
        })();
      }

      clearProjectDraftThreadId(projectId);

      if (
        latestActiveDraftThread &&
        routeThreadId &&
        latestActiveDraftThread.projectId === projectId
      ) {
        const resolvedEnvMode = resolveEnvMode(
          latestActiveDraftThread.worktreePath[0] ?? null,
          latestActiveDraftThread.envMode,
        );
        const shouldNormalizeActiveEnvMode = resolvedEnvMode !== latestActiveDraftThread.envMode;
        if (
          hasBranchOption ||
          hasWorktreePathOption ||
          hasEnvModeOption ||
          shouldNormalizeActiveEnvMode
        ) {
          setDraftThreadContext(routeThreadId, {
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(project?.cwd
              ? { projectPath: latestActiveDraftThread.projectPath || project.cwd }
              : {}),
            ...(hasEnvModeOption || shouldNormalizeActiveEnvMode
              ? { envMode: resolvedEnvMode }
              : {}),
          });
        }
        setProjectDraftThreadId(projectId, routeThreadId);
        return Promise.resolve();
      }

      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      return (async () => {
        const resolvedEnvMode = resolveEnvMode(options?.worktreePath ?? null);
        setProjectDraftThreadId(projectId, threadId, {
          createdAt,
          ...(project?.cwd ? { projectPath: project.cwd } : {}),
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          envMode: resolvedEnvMode,
          runtimeMode: DEFAULT_RUNTIME_MODE,
        });
        applyStickyState(threadId);

        await navigate({
          to: "/$threadId",
          params: { threadId },
        });
      })();
    },
    [navigate, projects, routeThreadId],
  );

  return {
    activeDraftThread,
    activeThread,
    handleNewThread,
    projects,
    routeThreadId,
  };
}

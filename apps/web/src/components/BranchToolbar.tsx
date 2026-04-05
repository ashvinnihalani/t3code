import type { ProjectExecutionTarget, ThreadId } from "@t3tools/contracts";
import { getSingleRepoBranch, getSingleRepoWorktreePath } from "@t3tools/shared/threadGit";
import { FolderIcon, GitForkIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStore } from "../store";
import { supportsDraftWorktreeEnv } from "../threadEnvMode";
import {
  EnvMode,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
} from "./BranchToolbar.logic";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

const envModeItems = [
  { value: "local", label: "Local" },
  { value: "worktree", label: "New worktree" },
] as const;

function deriveMultiRepoProjectPathFromChildWorktreePath(
  childWorktreePath: string,
  repoPath: string | null,
): string {
  if (!repoPath) {
    return childWorktreePath;
  }
  const repoSegments = repoPath.split("/").filter((segment) => segment.length > 0);
  if (repoSegments.length === 0) {
    return childWorktreePath;
  }
  let parentPath = childWorktreePath;
  for (let index = 0; index < repoSegments.length; index += 1) {
    const separatorIndex = Math.max(parentPath.lastIndexOf("/"), parentPath.lastIndexOf("\\"));
    if (separatorIndex < 0) {
      return childWorktreePath;
    }
    parentPath = parentPath.slice(0, separatorIndex);
  }
  return parentPath;
}

interface BranchToolbarProps {
  threadId: ThreadId;
  onEnvModeChange: (mode: EnvMode) => void;
  envLocked: boolean;
  projectHost: ProjectExecutionTarget | null;
  selectedRepoPath: string | null;
  onSelectedRepoPathChange: (repoPath: string | null) => void;
  providerThreadId?: string | null;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
}

export default function BranchToolbar({
  threadId,
  onEnvModeChange,
  envLocked,
  projectHost,
  selectedRepoPath,
  onSelectedRepoPathChange,
  providerThreadId,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: BranchToolbarProps) {
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const setThreadBranchAction = useStore((store) => store.setThreadBranch);
  const draftThread = useComposerDraftStore((store) => store.getDraftThread(threadId));
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);

  const serverThread = threads.find((thread) => thread.id === threadId);
  const activeProjectId = serverThread?.projectId ?? draftThread?.projectId ?? null;
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const activeProjectRoot = activeProject?.cwd ?? "";
  const activeThreadId = serverThread?.id ?? (draftThread ? threadId : undefined);
  const isMultiRepo = activeProject?.gitMode === "multi";
  const gitRepos = useMemo(() => activeProject?.gitRepos ?? [], [activeProject?.gitRepos]);
  const selectedRepoIndex = useMemo(
    () =>
      selectedRepoPath ? gitRepos.findIndex((repo) => repo.repoPath === selectedRepoPath) : -1,
    [gitRepos, selectedRepoPath],
  );
  const resolvedSelectedRepoIndex = selectedRepoIndex >= 0 ? selectedRepoIndex : 0;
  const activeThreadBranch = isMultiRepo
    ? (serverThread?.branch[resolvedSelectedRepoIndex] ??
      draftThread?.branch[resolvedSelectedRepoIndex] ??
      null)
    : serverThread
      ? getSingleRepoBranch(serverThread)
      : (draftThread?.branch[0] ?? null);
  const activeWorktreePath = isMultiRepo
    ? (serverThread?.worktreePath[resolvedSelectedRepoIndex] ??
      draftThread?.worktreePath[resolvedSelectedRepoIndex] ??
      null)
    : serverThread
      ? getSingleRepoWorktreePath(serverThread)
      : (draftThread?.worktreePath[0] ?? null);
  const branchCwd =
    activeProject === undefined
      ? null
      : isMultiRepo
        ? (activeWorktreePath ??
          (selectedRepoPath ? `${activeProject.cwd}/${selectedRepoPath}` : activeProject.cwd))
        : (activeWorktreePath ?? activeProject.cwd);
  const hasServerThread = serverThread !== undefined;
  const effectiveEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    draftThreadEnvMode: draftThread?.envMode,
    projectHost,
  });
  const supportsWorktreeEnv = supportsDraftWorktreeEnv({ projectHost });

  const setThreadBranch = useCallback(
    (branch: string | null, worktreePath: string | null) => {
      if (!activeThreadId) return;
      const api = readNativeApi();
      // If the effective cwd is about to change, stop the running session so the
      // next message creates a new one with the correct cwd.
      if (serverThread?.session && worktreePath !== activeWorktreePath && api) {
        void api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId: activeThreadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
      if (api && hasServerThread) {
        const nextBranch = [...(serverThread?.branch ?? [null])];
        const nextWorktreePath = [...(serverThread?.worktreePath ?? [null])];
        nextBranch[resolvedSelectedRepoIndex] = branch;
        nextWorktreePath[resolvedSelectedRepoIndex] = worktreePath;
        const nextProjectPath = isMultiRepo
          ? nextWorktreePath.some((value) => value !== null)
            ? serverThread?.projectPath !== activeProjectRoot
              ? serverThread?.projectPath
              : worktreePath
                ? deriveMultiRepoProjectPathFromChildWorktreePath(
                    worktreePath,
                    selectedRepoPath ?? gitRepos[0]?.repoPath ?? null,
                  )
                : activeProjectRoot
            : activeProjectRoot
          : (worktreePath ?? activeProjectRoot);
        void api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: activeThreadId,
          projectPath: nextProjectPath,
          branch: nextBranch,
          worktreePath: nextWorktreePath,
        });
      }
      if (hasServerThread) {
        const nextBranch = [...(serverThread?.branch ?? [null])];
        const nextWorktreePath = [...(serverThread?.worktreePath ?? [null])];
        nextBranch[resolvedSelectedRepoIndex] = branch;
        nextWorktreePath[resolvedSelectedRepoIndex] = worktreePath;
        const nextProjectPath = isMultiRepo
          ? nextWorktreePath.some((value) => value !== null)
            ? serverThread?.projectPath !== activeProjectRoot
              ? serverThread?.projectPath
              : worktreePath
                ? deriveMultiRepoProjectPathFromChildWorktreePath(
                    worktreePath,
                    selectedRepoPath ?? gitRepos[0]?.repoPath ?? null,
                  )
                : activeProjectRoot
            : activeProjectRoot
          : (worktreePath ?? activeProjectRoot);
        setThreadBranchAction(
          activeThreadId,
          branch,
          worktreePath,
          resolvedSelectedRepoIndex,
          nextProjectPath,
        );
        return;
      }
      const nextDraftWorktreePath = [...(draftThread?.worktreePath ?? [null])];
      nextDraftWorktreePath[resolvedSelectedRepoIndex] = worktreePath;
      const nextDraftProjectPath = isMultiRepo
        ? nextDraftWorktreePath.some((value) => value !== null)
          ? draftThread?.projectPath && draftThread.projectPath !== activeProjectRoot
            ? draftThread.projectPath
            : worktreePath
              ? deriveMultiRepoProjectPathFromChildWorktreePath(
                  worktreePath,
                  selectedRepoPath ?? gitRepos[0]?.repoPath ?? null,
                )
              : activeProjectRoot
          : activeProjectRoot
        : (worktreePath ?? activeProjectRoot);
      const nextDraftEnvMode = resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: worktreePath,
        currentWorktreePath: activeWorktreePath,
        effectiveEnvMode,
      });
      setDraftThreadContext(threadId, {
        branch,
        worktreePath,
        branchIndex: resolvedSelectedRepoIndex,
        projectPath: nextDraftProjectPath,
        envMode: nextDraftEnvMode,
      });
    },
    [
      activeThreadId,
      serverThread?.session,
      activeWorktreePath,
      hasServerThread,
      setThreadBranchAction,
      setDraftThreadContext,
      threadId,
      effectiveEnvMode,
      resolvedSelectedRepoIndex,
      serverThread?.branch,
      serverThread?.projectPath,
      serverThread?.worktreePath,
      activeProjectRoot,
      draftThread?.projectPath,
      draftThread?.worktreePath,
      gitRepos,
      isMultiRepo,
      selectedRepoPath,
    ],
  );

  if (!activeThreadId || !activeProject) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl items-start justify-between px-5 pb-3 pt-1">
      <div className="flex min-w-0 items-center gap-2">
        {envLocked || activeWorktreePath || !supportsWorktreeEnv ? (
          <span className="inline-flex items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs">
            {activeWorktreePath ? (
              <>
                <GitForkIcon className="size-3" />
                Worktree
              </>
            ) : (
              <>
                <FolderIcon className="size-3" />
                Local
              </>
            )}
          </span>
        ) : (
          <Select
            value={effectiveEnvMode}
            onValueChange={(value) => onEnvModeChange(value as EnvMode)}
            items={envModeItems}
          >
            <SelectTrigger variant="ghost" size="xs" className="font-medium">
              {effectiveEnvMode === "worktree" ? (
                <GitForkIcon className="size-3" />
              ) : (
                <FolderIcon className="size-3" />
              )}
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="local">
                <span className="inline-flex items-center gap-1.5">
                  <FolderIcon className="size-3" />
                  Local
                </span>
              </SelectItem>
              <SelectItem value="worktree">
                <span className="inline-flex items-center gap-1.5">
                  <GitForkIcon className="size-3" />
                  New worktree
                </span>
              </SelectItem>
            </SelectPopup>
          </Select>
        )}
        {providerThreadId ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-sm font-medium text-muted-foreground/70 sm:text-xs">
            <span className="shrink-0">Thread ID</span>
            <span>{providerThreadId}</span>
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-2">
        {isMultiRepo && gitRepos.length > 0 ? (
          <Select
            value={selectedRepoPath ?? gitRepos[0]?.repoPath}
            onValueChange={onSelectedRepoPathChange}
            items={gitRepos.map((repo) => ({ value: repo.repoPath, label: repo.displayName }))}
          >
            <SelectTrigger variant="ghost" size="xs" className="font-medium">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {gitRepos.map((repo) => (
                <SelectItem key={repo.repoPath} value={repo.repoPath}>
                  {repo.displayName}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}

        <BranchToolbarBranchSelector
          activeProjectId={activeProject.id}
          activeProjectCwd={activeProject.cwd}
          activeThreadBranch={activeThreadBranch}
          activeWorktreePath={activeWorktreePath}
          branchCwd={branchCwd}
          effectiveEnvMode={effectiveEnvMode}
          envLocked={envLocked}
          onSetThreadBranch={setThreadBranch}
          {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
          {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
        />
      </div>
    </div>
  );
}

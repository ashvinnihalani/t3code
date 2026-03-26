import type { ProjectRemoteTarget, ThreadId } from "@t3tools/contracts";
import { FolderIcon, GitForkIcon } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";

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

interface BranchToolbarProps {
  threadId: ThreadId;
  onEnvModeChange: (mode: EnvMode) => void;
  envLocked: boolean;
  projectRemote: ProjectRemoteTarget | null;
  providerThreadId?: string | null;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
}

export default function BranchToolbar({
  threadId,
  onEnvModeChange,
  envLocked,
  projectRemote,
  providerThreadId,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: BranchToolbarProps) {
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const setThreadBranchAction = useStore((store) => store.setThreadBranch);
  const setThreadRepoBranchAction = useStore((store) => store.setThreadRepoBranch);
  const setThreadSelectedRepoAction = useStore((store) => store.setThreadSelectedRepo);
  const draftThread = useComposerDraftStore((store) => store.getDraftThread(threadId));
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);

  const serverThread = threads.find((thread) => thread.id === threadId);
  const activeProjectId = serverThread?.projectId ?? draftThread?.projectId ?? null;
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const activeThreadId = serverThread?.id ?? (draftThread ? threadId : undefined);
  const activeThreadBranch = serverThread?.branch ?? draftThread?.branch ?? null;
  const activeWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const branchCwd = activeWorktreePath ?? activeProject?.cwd ?? null;
  const hasServerThread = serverThread !== undefined;
  const effectiveEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    draftThreadEnvMode: draftThread?.envMode,
    projectRemote,
  });
  const supportsWorktreeEnv = supportsDraftWorktreeEnv({ projectRemote });
  const gitRepos = activeProject?.gitRepos;
  const isMultiRepoProject = (gitRepos?.length ?? 0) > 1;
  const repoSelectItems = useMemo(
    () =>
      (gitRepos ?? []).map((repo) => ({
        value: repo.id,
        label: repo.displayName,
      })),
    [gitRepos],
  );
  const selectedRepoId = serverThread?.selectedRepoId ?? draftThread?.selectedRepoId ?? null;

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
        void api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: activeThreadId,
          branch,
          worktreePath,
        });
      }
      if (hasServerThread) {
        setThreadBranchAction(activeThreadId, branch, worktreePath);
        return;
      }
      const nextDraftEnvMode = resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: worktreePath,
        currentWorktreePath: activeWorktreePath,
        effectiveEnvMode,
      });
      setDraftThreadContext(threadId, {
        branch,
        worktreePath,
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
    ],
  );

  const setRepoThreadBranch = useCallback(
    (repoId: string, branch: string | null, worktreePath: string | null) => {
      if (!activeThreadId) return;
      if (!serverThread) {
        const existingRepoBranches = draftThread?.repoBranches ?? [];
        const nextRepoBranches = existingRepoBranches.some((entry) => entry.repoId === repoId)
          ? existingRepoBranches.map((entry) =>
              entry.repoId === repoId ? { ...entry, branch } : entry,
            )
          : [...existingRepoBranches, { repoId, branch }];
        setDraftThreadContext(threadId, {
          selectedRepoId: repoId,
          repoBranches: nextRepoBranches,
          branch,
          worktreePath,
          envMode: resolveDraftEnvModeAfterBranchChange({
            nextWorktreePath: worktreePath,
            currentWorktreePath: activeWorktreePath,
            effectiveEnvMode,
          }),
        });
        return;
      }
      const existingRepoBranches = serverThread.repoBranches ?? [];
      const nextRepoBranches = existingRepoBranches.some((entry) => entry.repoId === repoId)
        ? existingRepoBranches.map((entry) =>
            entry.repoId === repoId ? { ...entry, branch } : entry,
          )
        : [...existingRepoBranches, { repoId, branch }];
      const nextMultiRepoWorktree = serverThread.multiRepoWorktree
        ? {
            ...serverThread.multiRepoWorktree,
            repos: serverThread.multiRepoWorktree.repos.map((repo) =>
              repo.repoId === repoId && worktreePath ? { ...repo, worktreePath } : repo,
            ),
          }
        : serverThread.multiRepoWorktree;
      const api = readNativeApi();
      if (api) {
        void api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: activeThreadId,
          repoBranches: nextRepoBranches,
          ...(nextMultiRepoWorktree ? { multiRepoWorktree: nextMultiRepoWorktree } : {}),
        });
      }
      setThreadRepoBranchAction(activeThreadId, repoId, branch, worktreePath);
    },
    [
      activeThreadId,
      activeWorktreePath,
      draftThread?.repoBranches,
      effectiveEnvMode,
      serverThread,
      setDraftThreadContext,
      setThreadRepoBranchAction,
      threadId,
    ],
  );

  useEffect(() => {
    if ((gitRepos?.length ?? 0) === 0) {
      return;
    }
    if (selectedRepoId && gitRepos?.some((repo) => repo.id === selectedRepoId)) {
      return;
    }
    const nextRepoId = gitRepos?.[0]?.id ?? null;
    if (serverThread && activeThreadId) {
      setThreadSelectedRepoAction(activeThreadId, nextRepoId);
      return;
    }
    setDraftThreadContext(threadId, { selectedRepoId: nextRepoId });
  }, [
    activeThreadId,
    gitRepos,
    selectedRepoId,
    serverThread,
    setDraftThreadContext,
    setThreadSelectedRepoAction,
    threadId,
  ]);

  if (!activeThreadId || !activeProject) return null;

  const selectedRepo =
    (selectedRepoId ? gitRepos?.find((repo) => repo.id === selectedRepoId) : undefined) ??
    gitRepos?.[0];
  const selectedRepoBranch = selectedRepo
    ? (serverThread?.repoBranches?.find((entry) => entry.repoId === selectedRepo.id)?.branch ??
      draftThread?.repoBranches?.find((entry) => entry.repoId === selectedRepo.id)?.branch ??
      (draftThread?.selectedRepoId === selectedRepo.id ? (draftThread.branch ?? null) : null))
    : null;
  const selectedRepoWorktreePath = selectedRepo
    ? (serverThread?.multiRepoWorktree?.repos.find((entry) => entry.repoId === selectedRepo.id)
        ?.worktreePath ??
      (draftThread?.selectedRepoId === selectedRepo.id ? (draftThread.worktreePath ?? null) : null))
    : null;

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

      {isMultiRepoProject ? (
        <div className="flex min-w-0 items-center gap-2">
          <Select
            value={selectedRepo?.id ?? ""}
            onValueChange={(value) => {
              if (serverThread && activeThreadId) {
                setThreadSelectedRepoAction(activeThreadId, value);
                return;
              }
              setDraftThreadContext(threadId, { selectedRepoId: value });
            }}
            items={repoSelectItems}
          >
            <SelectTrigger variant="ghost" size="xs" className="max-w-40 font-medium">
              <SelectValue placeholder="Select repo" />
            </SelectTrigger>
            <SelectPopup>
              {(gitRepos ?? []).map((repo) => (
                <SelectItem key={repo.id} value={repo.id}>
                  <span className="inline-flex min-w-0 max-w-56 items-center gap-1.5">
                    <span className="truncate">{repo.displayName}</span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {repo.relativePath}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          {selectedRepo ? (
            <BranchToolbarBranchSelector
              activeProjectId={activeProject.id}
              activeProjectCwd={selectedRepo.rootPath}
              activeThreadBranch={selectedRepoBranch}
              activeWorktreePath={selectedRepoWorktreePath}
              branchCwd={selectedRepoWorktreePath ?? selectedRepo.rootPath}
              effectiveEnvMode={effectiveEnvMode}
              envLocked={envLocked}
              onSetThreadBranch={(branch, worktreePath) =>
                setRepoThreadBranch(selectedRepo.id, branch, worktreePath)
              }
              {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
              {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
            />
          ) : null}
        </div>
      ) : (
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
      )}
    </div>
  );
}

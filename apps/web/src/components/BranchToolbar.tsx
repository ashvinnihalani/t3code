import type { EnvironmentDefinition, ProjectRemoteTarget, ThreadId } from "@t3tools/contracts";
import { FolderIcon, GitForkIcon } from "lucide-react";
import { useCallback } from "react";

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
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

const envModeItems = [
  { value: "local", label: "Local" },
  { value: "worktree", label: "New worktree" },
] as const;

interface BranchToolbarProps {
  threadId: ThreadId;
  onEnvModeChange: (mode: EnvMode) => void;
  onSelectedEnvironmentChange?: (environmentId: string | null) => void;
  envLocked: boolean;
  environments?: ReadonlyArray<EnvironmentDefinition>;
  projectRemote: ProjectRemoteTarget | null;
  selectedEnvironmentId?: string | null;
  providerThreadId?: string | null;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
}

export default function BranchToolbar({
  threadId,
  onEnvModeChange,
  onSelectedEnvironmentChange,
  envLocked,
  environments = [],
  projectRemote,
  selectedEnvironmentId = null,
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
  const selectedEnvironment =
    environments.find((environment) => environment.id === selectedEnvironmentId) ?? null;

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

  if (!activeThreadId || !activeProject) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 pb-3 pt-1">
      <div className="flex min-w-0 items-center gap-2">
        {envLocked || activeWorktreePath || !supportsWorktreeEnv ? (
          <span className="inline-flex items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs">
            {selectedEnvironment ? (
              <>
                <GitForkIcon className="size-3" />
                {selectedEnvironment.name}
              </>
            ) : activeWorktreePath ? (
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
        ) : environments.length > 0 && onSelectedEnvironmentChange ? (
          <Select
            value={selectedEnvironmentId ?? "__none__"}
            onValueChange={(value) =>
              onSelectedEnvironmentChange(value === "__none__" ? null : value)
            }
          >
            <SelectTrigger variant="ghost" size="xs" className="font-medium">
              <GitForkIcon className="size-3" />
              <SelectValue>
                {selectedEnvironment ? selectedEnvironment.name : "Environment"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                <SelectGroupLabel>Local</SelectGroupLabel>
                <SelectItem value="__none__">
                  <span className="inline-flex items-center gap-1.5">
                    <FolderIcon className="size-3" />
                    None
                  </span>
                </SelectItem>
                {environments.map((environment) => (
                  <SelectItem key={environment.id} value={environment.id}>
                    <span className="inline-flex items-center gap-1.5">
                      <GitForkIcon className="size-3" />
                      {environment.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectGroupLabel>Remote</SelectGroupLabel>
                <SelectItem value="__remote__" disabled>
                  Remote environments are not supported yet
                </SelectItem>
              </SelectGroup>
            </SelectPopup>
          </Select>
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
  );
}

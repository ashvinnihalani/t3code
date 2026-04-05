import type {
  GitActionProgressEvent,
  GitStackedAction,
  GitStatusResult,
  ProjectRemoteTarget,
  ThreadId,
} from "@t3tools/contracts";
import {
  useIsMutating,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, CloudUploadIcon, GitCommitIcon, InfoIcon } from "lucide-react";
import { buildGitRequestSettings, useAppSettings } from "../appSettings";
import { resolveAppModelSelectionState } from "../modelSelection";
import { GitHubIcon } from "./Icons";
import {
  buildGitActionProgressStages,
  buildMenuItems,
  type GitActionIconName,
  type GitActionMenuItem,
  type GitQuickAction,
  type DefaultBranchConfirmableAction,
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
  resolveQuickAction,
  summarizeGitResult,
} from "./GitActionsControl.logic";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Group, GroupSeparator } from "~/components/ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { toastManager } from "~/components/ui/toast";
import { openResolvedEditorTargetInPreferredEditor } from "~/editorPreferences";
import {
  type GitQueryTarget,
  gitBranchesQueryOptions,
  gitInitMutationOptions,
  gitMutationKeys,
  gitPullMutationOptions,
  gitRunStackedActionMutationOptions,
  gitStatusQueryOptions,
  invalidateGitQueries,
} from "~/lib/gitReactQuery";
import { randomUUID } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { resolveProjectEditorTargetFromRawPath } from "~/projectEditorTargets";

interface GitActionsControlProps {
  gitTarget: GitQueryTarget;
  activeThreadId: ThreadId | null;
  projectRemote: ProjectRemoteTarget | null;
  disableGitActions?: boolean;
  multiRepoTargets?: ReadonlyArray<MultiRepoGitActionTarget> | undefined;
}

export interface MultiRepoGitActionTarget {
  displayPath: string;
  repoPath: string;
}

interface PendingDefaultBranchAction {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  commitMessage?: string;
  forcePushOnlyProgress: boolean;
  onConfirmed?: () => void;
  filePaths?: string[];
}

interface MultiRepoExecutionState {
  status: "idle" | "running" | "success" | "error";
  errorMessage: string | null;
}

interface MultiRepoSection {
  displayPath: string;
  repoPath: string;
  status: GitStatusResult | null;
  statusErrorMessage: string | null;
  isDefaultBranch: boolean;
}

type GitActionToastId = ReturnType<typeof toastManager.add>;

interface ActiveGitActionProgress {
  toastId: GitActionToastId;
  actionId: string;
  title: string;
  phaseStartedAtMs: number | null;
  hookStartedAtMs: number | null;
  hookName: string | null;
  lastOutputLine: string | null;
  currentPhaseLabel: string | null;
}

interface RunGitActionWithToastInput {
  action: GitStackedAction;
  commitMessage?: string;
  forcePushOnlyProgress?: boolean;
  onConfirmed?: () => void;
  skipDefaultBranchPrompt?: boolean;
  statusOverride?: GitStatusResult | null;
  featureBranch?: boolean;
  isDefaultBranchOverride?: boolean;
  progressToastId?: GitActionToastId;
  filePaths?: string[];
}

function formatElapsedDescription(startedAtMs: number | null): string | undefined {
  if (startedAtMs === null) {
    return undefined;
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `Running for ${elapsedSeconds}s`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `Running for ${minutes}m ${seconds}s`;
}

function resolveProgressDescription(progress: ActiveGitActionProgress): string | undefined {
  if (progress.lastOutputLine) {
    return progress.lastOutputLine;
  }
  return formatElapsedDescription(progress.hookStartedAtMs ?? progress.phaseStartedAtMs);
}

function getMenuActionDisabledReason({
  item,
  gitStatus,
  isBusy,
  hasOriginRemote,
}: {
  item: GitActionMenuItem;
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
  hasOriginRemote: boolean;
}): string | null {
  if (!item.disabled) return null;
  if (isBusy) return "Git action in progress.";
  if (!gitStatus) return "Git status is unavailable.";

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;

  if (item.id === "commit") {
    if (!hasChanges) {
      return "Worktree is clean. Make changes before committing.";
    }
    return "Commit is currently unavailable.";
  }

  if (item.id === "push") {
    if (!hasBranch) {
      return "Detached HEAD: checkout a branch before pushing.";
    }
    if (hasChanges) {
      return "Commit or stash local changes before pushing.";
    }
    if (isBehind) {
      return "Branch is behind upstream. Pull/rebase before pushing.";
    }
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return 'Add an "origin" remote before pushing.';
    }
    if (!isAhead) {
      return "No local commits to push.";
    }
    return "Push is currently unavailable.";
  }

  if (hasOpenPr) {
    return "View PR is currently unavailable.";
  }
  if (!hasBranch) {
    return "Detached HEAD: checkout a branch before creating a PR.";
  }
  if (hasChanges) {
    return "Commit local changes before creating a PR.";
  }
  if (!gitStatus.hasUpstream && !hasOriginRemote) {
    return 'Add an "origin" remote before creating a PR.';
  }
  if (!isAhead) {
    return "No local commits to include in a PR.";
  }
  if (isBehind) {
    return "Branch is behind upstream. Pull/rebase before creating a PR.";
  }
  return "Create PR is currently unavailable.";
}

const COMMIT_DIALOG_TITLE = "Commit changes";
const COMMIT_DIALOG_DESCRIPTION =
  "Review and confirm your commit. Leave the message blank to auto-generate one.";
const MULTI_REPO_COMMIT_DIALOG_DESCRIPTION =
  "Review and confirm your commits. Messages will be auto-generated.";

function GitActionItemIcon({ icon }: { icon: GitActionIconName }) {
  if (icon === "commit") return <GitCommitIcon />;
  if (icon === "push") return <CloudUploadIcon />;
  return <GitHubIcon />;
}

function GitQuickActionIcon({ quickAction }: { quickAction: GitQuickAction }) {
  const iconClassName = "size-3.5";
  if (quickAction.kind === "open_pr") return <GitHubIcon className={iconClassName} />;
  if (quickAction.kind === "run_pull") return <InfoIcon className={iconClassName} />;
  if (quickAction.kind === "run_action") {
    if (quickAction.action === "commit") return <GitCommitIcon className={iconClassName} />;
    if (quickAction.action === "commit_push") return <CloudUploadIcon className={iconClassName} />;
    return <GitHubIcon className={iconClassName} />;
  }
  if (quickAction.label === "Commit") return <GitCommitIcon className={iconClassName} />;
  return <InfoIcon className={iconClassName} />;
}

export default function GitActionsControl({
  gitTarget,
  activeThreadId,
  projectRemote,
  disableGitActions = false,
  multiRepoTargets,
}: GitActionsControlProps) {
  const { settings } = useAppSettings();
  const gitRepoPath = gitTarget.repoPath;
  const isMultiRepoDialog = (multiRepoTargets?.length ?? 0) > 1;
  const threadToastData = useMemo(
    () => (activeThreadId ? { threadId: activeThreadId } : undefined),
    [activeThreadId],
  );
  const queryClient = useQueryClient();
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [dialogCommitMessage, setDialogCommitMessage] = useState("");
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(new Set());
  const [excludedFilesByRepo, setExcludedFilesByRepo] = useState<Record<string, string[]>>({});
  const [isEditingFiles, setIsEditingFiles] = useState(false);
  const [editingRepos, setEditingRepos] = useState<Record<string, boolean>>({});
  const [multiRepoExecutionState, setMultiRepoExecutionState] = useState<
    Record<string, MultiRepoExecutionState>
  >({});
  const [pendingDefaultBranchAction, setPendingDefaultBranchAction] =
    useState<PendingDefaultBranchAction | null>(null);
  const gitRequestSettings = useMemo(() => buildGitRequestSettings(settings), [settings]);
  const gitActionModelSelection = useMemo(
    () =>
      gitRequestSettings.textGenerationModelSelection ?? resolveAppModelSelectionState(settings),
    [gitRequestSettings.textGenerationModelSelection, settings],
  );
  const activeGitActionProgressRef = useRef<ActiveGitActionProgress | null>(null);

  const updateActiveProgressToast = useCallback(() => {
    const progress = activeGitActionProgressRef.current;
    if (!progress) {
      return;
    }
    toastManager.update(progress.toastId, {
      type: "loading",
      title: progress.title,
      description: resolveProgressDescription(progress),
      timeout: 0,
      data: threadToastData,
    });
  }, [threadToastData]);

  const { data: gitStatus = null, error: gitStatusError } = useQuery(
    gitStatusQueryOptions(gitTarget, gitRequestSettings),
  );

  const { data: branchList = null } = useQuery(gitBranchesQueryOptions(gitTarget));
  const multiRepoStatuses = useQueries({
    queries: (multiRepoTargets ?? []).map((target) =>
      gitStatusQueryOptions(
        { repoPath: target.repoPath, projectId: gitTarget.projectId },
        gitRequestSettings,
      ),
    ),
  });
  const multiRepoBranchLists = useQueries({
    queries: (multiRepoTargets ?? []).map((target) =>
      gitBranchesQueryOptions({ repoPath: target.repoPath, projectId: gitTarget.projectId }),
    ),
  });
  // Default to true while loading so we don't flash init controls.
  const isRepo = branchList?.isRepo ?? true;
  const hasOriginRemote = branchList?.hasOriginRemote ?? false;
  const currentBranch = branchList?.branches.find((branch) => branch.current)?.name ?? null;
  const isGitStatusOutOfSync =
    !!gitStatus?.branch && !!currentBranch && gitStatus.branch !== currentBranch;

  useEffect(() => {
    if (!isGitStatusOutOfSync) return;
    void invalidateGitQueries(queryClient);
  }, [isGitStatusOutOfSync, queryClient]);

  const gitStatusForActions = isGitStatusOutOfSync ? null : gitStatus;

  const allFiles = gitStatusForActions?.workingTree.files ?? [];
  const selectedFiles = allFiles.filter((f) => !excludedFiles.has(f.path));
  const allSelected = excludedFiles.size === 0;
  const noneSelected = selectedFiles.length === 0;
  const multiRepoSections = useMemo<MultiRepoSection[]>(() => {
    if (!isMultiRepoDialog || !multiRepoTargets) {
      return [];
    }
    return multiRepoTargets.map((target, index) => {
      const statusResult = multiRepoStatuses[index];
      const branchListResult = multiRepoBranchLists[index];
      const status =
        statusResult && statusResult.status === "success" ? (statusResult.data ?? null) : null;
      const branchName = status?.branch ?? null;
      const matchingBranch = branchListResult?.data?.branches.find(
        (branch) => branch.name === branchName,
      );
      const isDefault =
        branchName === null
          ? false
          : (matchingBranch?.isDefault ?? false) ||
            branchName === "main" ||
            branchName === "master";
      return {
        displayPath: target.displayPath,
        repoPath: target.repoPath,
        status,
        statusErrorMessage:
          statusResult && statusResult.status === "error"
            ? statusResult.error instanceof Error
              ? statusResult.error.message
              : "Failed to load git status."
            : null,
        isDefaultBranch: isDefault,
      };
    });
  }, [isMultiRepoDialog, multiRepoBranchLists, multiRepoStatuses, multiRepoTargets]);
  const multiRepoSelectionSummary = useMemo(() => {
    return multiRepoSections.map((section) => {
      const files = section.status?.workingTree.files ?? [];
      const excluded = new Set(excludedFilesByRepo[section.repoPath] ?? []);
      const selected = files.filter((file) => !excluded.has(file.path));
      return {
        ...section,
        files,
        excluded,
        selected,
        allSelected: excluded.size === 0,
        noneSelected: selected.length === 0,
      };
    });
  }, [excludedFilesByRepo, multiRepoSections]);
  const multiRepoHasAnySelectedFiles = multiRepoSelectionSummary.some(
    (section) => section.selected.length > 0,
  );
  const multiRepoHasFailures = multiRepoSelectionSummary.some(
    (section) => multiRepoExecutionState[section.repoPath]?.status === "error",
  );
  const multiRepoHasRunningRepo = multiRepoSelectionSummary.some(
    (section) => multiRepoExecutionState[section.repoPath]?.status === "running",
  );
  const multiRepoRetryLabel = multiRepoHasFailures ? "Retry commit" : "Commit";
  const multiRepoRetryNewBranchLabel = multiRepoHasFailures
    ? "Retry on new branch"
    : "Commit on new branch";

  const initMutation = useMutation(gitInitMutationOptions({ target: gitTarget, queryClient }));

  const runImmediateGitActionMutation = useMutation(
    gitRunStackedActionMutationOptions({
      target: gitTarget,
      queryClient,
      ...(gitRequestSettings ? { settings: gitRequestSettings } : {}),
      modelSelection: gitActionModelSelection,
    }),
  );
  const pullMutation = useMutation(gitPullMutationOptions({ target: gitTarget, queryClient }));

  const isRunStackedActionRunning =
    useIsMutating({ mutationKey: gitMutationKeys.runStackedAction(gitTarget) }) > 0;
  const isPullRunning = useIsMutating({ mutationKey: gitMutationKeys.pull(gitTarget) }) > 0;
  const isGitActionRunning = isRunStackedActionRunning || isPullRunning;
  const isDefaultBranch = useMemo(() => {
    const branchName = gitStatusForActions?.branch;
    if (!branchName) return false;
    const current = branchList?.branches.find((branch) => branch.name === branchName);
    return current?.isDefault ?? (branchName === "main" || branchName === "master");
  }, [branchList?.branches, gitStatusForActions?.branch]);

  const gitActionMenuItems = useMemo(
    () =>
      buildMenuItems(
        gitStatusForActions,
        disableGitActions ? true : isGitActionRunning,
        hasOriginRemote,
      ),
    [disableGitActions, gitStatusForActions, hasOriginRemote, isGitActionRunning],
  );
  const quickAction = useMemo(
    () =>
      disableGitActions
        ? {
            label: "Commit",
            disabled: true,
            kind: "show_hint" as const,
            hint: "Git actions are disabled for multi-repo projects right now.",
          }
        : resolveQuickAction(
            gitStatusForActions,
            isGitActionRunning,
            isDefaultBranch,
            hasOriginRemote,
            settings.gitDefaultAction,
          ),
    [
      disableGitActions,
      gitStatusForActions,
      hasOriginRemote,
      isDefaultBranch,
      isGitActionRunning,
      settings.gitDefaultAction,
    ],
  );
  const quickActionDisabledReason = quickAction.disabled
    ? (quickAction.hint ?? "This action is currently unavailable.")
    : null;
  const pendingDefaultBranchActionCopy = pendingDefaultBranchAction
    ? resolveDefaultBranchActionDialogCopy({
        action: pendingDefaultBranchAction.action,
        branchName: pendingDefaultBranchAction.branchName,
        includesCommit: pendingDefaultBranchAction.includesCommit,
      })
    : null;
  const resetCommitDialogState = useCallback(() => {
    setDialogCommitMessage("");
    setExcludedFiles(new Set());
    setExcludedFilesByRepo({});
    setIsEditingFiles(false);
    setEditingRepos({});
    setMultiRepoExecutionState({});
  }, []);

  useEffect(() => {
    const api = readNativeApi();
    if (!api) {
      return;
    }

    const applyProgressEvent = (event: GitActionProgressEvent) => {
      const progress = activeGitActionProgressRef.current;
      if (!progress) {
        return;
      }
      if (gitRepoPath && event.cwd !== gitRepoPath) {
        return;
      }
      if (progress.actionId !== event.actionId) {
        return;
      }

      const now = Date.now();
      switch (event.kind) {
        case "action_started":
          progress.phaseStartedAtMs = now;
          progress.hookStartedAtMs = null;
          progress.hookName = null;
          progress.lastOutputLine = null;
          break;
        case "phase_started":
          progress.title = event.label;
          progress.currentPhaseLabel = event.label;
          progress.phaseStartedAtMs = now;
          progress.hookStartedAtMs = null;
          progress.hookName = null;
          progress.lastOutputLine = null;
          break;
        case "hook_started":
          progress.title = `Running ${event.hookName}...`;
          progress.hookName = event.hookName;
          progress.hookStartedAtMs = now;
          progress.lastOutputLine = null;
          break;
        case "hook_output":
          progress.lastOutputLine = event.text;
          break;
        case "hook_finished":
          progress.title = progress.currentPhaseLabel ?? "Committing...";
          progress.hookName = null;
          progress.hookStartedAtMs = null;
          progress.lastOutputLine = null;
          break;
        case "action_finished":
          // Don't clear timestamps here — the HTTP response handler (line 496)
          // sets activeGitActionProgressRef to null and shows the success toast.
          // Clearing timestamps early causes the "Running for Xs" description
          // to disappear before the success state renders, leaving a bare
          // "Pushing..." toast in the gap between the WS event and HTTP response.
          return;
        case "action_failed":
          // Same reasoning as action_finished — let the HTTP error handler
          // manage the final toast state to avoid a flash of bare title.
          return;
      }

      updateActiveProgressToast();
    };

    return api.git.onActionProgress(applyProgressEvent);
  }, [gitRepoPath, updateActiveProgressToast]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!activeGitActionProgressRef.current) {
        return;
      }
      updateActiveProgressToast();
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [updateActiveProgressToast]);

  const openExistingPr = useCallback(async () => {
    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
        data: threadToastData,
      });
      return;
    }
    const prUrl = gitStatusForActions?.pr?.state === "open" ? gitStatusForActions.pr.url : null;
    if (!prUrl) {
      toastManager.add({
        type: "error",
        title: "No open PR found.",
        data: threadToastData,
      });
      return;
    }
    void api.shell.openExternal(prUrl).catch((err) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: err instanceof Error ? err.message : "An error occurred.",
        data: threadToastData,
      });
    });
  }, [gitStatusForActions, threadToastData]);

  const runGitActionWithToast = useEffectEvent(
    async ({
      action,
      commitMessage,
      forcePushOnlyProgress = false,
      onConfirmed,
      skipDefaultBranchPrompt = false,
      statusOverride,
      featureBranch = false,
      isDefaultBranchOverride,
      progressToastId,
      filePaths,
    }: RunGitActionWithToastInput) => {
      if (disableGitActions) {
        toastManager.add({
          type: "error",
          title: "Git actions are disabled for multi-repo projects right now.",
          data: threadToastData,
        });
        return;
      }
      const actionStatus = statusOverride ?? gitStatusForActions;
      const actionBranch = actionStatus?.branch ?? null;
      const actionIsDefaultBranch =
        isDefaultBranchOverride ?? (featureBranch ? false : isDefaultBranch);
      const includesCommit =
        !forcePushOnlyProgress && (action === "commit" || !!actionStatus?.hasWorkingTreeChanges);
      if (
        !skipDefaultBranchPrompt &&
        requiresDefaultBranchConfirmation(action, actionIsDefaultBranch) &&
        actionBranch
      ) {
        if (action !== "commit_push" && action !== "commit_push_pr") {
          return;
        }
        setPendingDefaultBranchAction({
          action,
          branchName: actionBranch,
          includesCommit,
          ...(commitMessage ? { commitMessage } : {}),
          forcePushOnlyProgress,
          ...(onConfirmed ? { onConfirmed } : {}),
          ...(filePaths ? { filePaths } : {}),
        });
        return;
      }
      onConfirmed?.();

      const progressStages = buildGitActionProgressStages({
        action,
        hasCustomCommitMessage: !!commitMessage?.trim(),
        hasWorkingTreeChanges: !!actionStatus?.hasWorkingTreeChanges,
        forcePushOnly: forcePushOnlyProgress,
        featureBranch,
      });
      const actionId = randomUUID();
      const resolvedProgressToastId =
        progressToastId ??
        toastManager.add({
          type: "loading",
          title: progressStages[0] ?? "Running git action...",
          description: "Waiting for Git...",
          timeout: 0,
          data: threadToastData,
        });

      activeGitActionProgressRef.current = {
        toastId: resolvedProgressToastId,
        actionId,
        title: progressStages[0] ?? "Running git action...",
        phaseStartedAtMs: null,
        hookStartedAtMs: null,
        hookName: null,
        lastOutputLine: null,
        currentPhaseLabel: progressStages[0] ?? "Running git action...",
      };

      if (progressToastId) {
        toastManager.update(progressToastId, {
          type: "loading",
          title: progressStages[0] ?? "Running git action...",
          description: "Waiting for Git...",
          timeout: 0,
          data: threadToastData,
        });
      }

      const promise = runImmediateGitActionMutation.mutateAsync({
        actionId,
        action,
        ...(commitMessage ? { commitMessage } : {}),
        ...(featureBranch ? { featureBranch } : {}),
        ...(filePaths ? { filePaths } : {}),
      });

      try {
        const result = await promise;
        activeGitActionProgressRef.current = null;
        const resultToast = summarizeGitResult(result);

        const existingOpenPrUrl =
          actionStatus?.pr?.state === "open" ? actionStatus.pr.url : undefined;
        const prUrl = result.pr.url ?? existingOpenPrUrl;
        const shouldOfferPushCta = action === "commit" && result.commit.status === "created";
        const shouldOfferOpenPrCta =
          (action === "commit_push" || action === "commit_push_pr") &&
          !!prUrl &&
          (!actionIsDefaultBranch ||
            result.pr.status === "created" ||
            result.pr.status === "opened_existing");
        const shouldOfferCreatePrCta =
          action === "commit_push" &&
          !prUrl &&
          result.push.status === "pushed" &&
          !actionIsDefaultBranch;
        const closeResultToast = () => {
          toastManager.close(resolvedProgressToastId);
        };

        toastManager.update(resolvedProgressToastId, {
          type: "success",
          title: resultToast.title,
          description: resultToast.description,
          timeout: 0,
          data: {
            ...threadToastData,
            dismissAfterVisibleMs: 10_000,
          },
          ...(shouldOfferPushCta
            ? {
                actionProps: {
                  children: "Push",
                  onClick: () => {
                    void runGitActionWithToast({
                      action: "commit_push",
                      forcePushOnlyProgress: true,
                      onConfirmed: closeResultToast,
                      statusOverride: actionStatus,
                      isDefaultBranchOverride: actionIsDefaultBranch,
                    });
                  },
                },
              }
            : shouldOfferOpenPrCta
              ? {
                  actionProps: {
                    children: "View PR",
                    onClick: () => {
                      const api = readNativeApi();
                      if (!api) return;
                      closeResultToast();
                      void api.shell.openExternal(prUrl);
                    },
                  },
                }
              : shouldOfferCreatePrCta
                ? {
                    actionProps: {
                      children: "Create PR",
                      onClick: () => {
                        closeResultToast();
                        void runGitActionWithToast({
                          action: "commit_push_pr",
                          forcePushOnlyProgress: true,
                          statusOverride: actionStatus,
                          isDefaultBranchOverride: actionIsDefaultBranch,
                        });
                      },
                    },
                  }
                : {}),
        });
      } catch (err) {
        activeGitActionProgressRef.current = null;
        toastManager.update(resolvedProgressToastId, {
          type: "error",
          title: "Action failed",
          description: err instanceof Error ? err.message : "An error occurred.",
          data: threadToastData,
        });
      }
    },
  );

  const continuePendingDefaultBranchAction = useCallback(() => {
    if (!pendingDefaultBranchAction) return;
    const { action, commitMessage, forcePushOnlyProgress, onConfirmed, filePaths } =
      pendingDefaultBranchAction;
    setPendingDefaultBranchAction(null);
    void runGitActionWithToast({
      action,
      ...(commitMessage ? { commitMessage } : {}),
      forcePushOnlyProgress,
      ...(onConfirmed ? { onConfirmed } : {}),
      ...(filePaths ? { filePaths } : {}),
      skipDefaultBranchPrompt: true,
    });
  }, [pendingDefaultBranchAction]);

  const checkoutFeatureBranchAndContinuePendingAction = useCallback(() => {
    if (!pendingDefaultBranchAction) return;
    const { action, commitMessage, forcePushOnlyProgress, onConfirmed, filePaths } =
      pendingDefaultBranchAction;
    setPendingDefaultBranchAction(null);
    void runGitActionWithToast({
      action,
      ...(commitMessage ? { commitMessage } : {}),
      forcePushOnlyProgress,
      ...(onConfirmed ? { onConfirmed } : {}),
      ...(filePaths ? { filePaths } : {}),
      featureBranch: true,
      skipDefaultBranchPrompt: true,
    });
  }, [pendingDefaultBranchAction]);

  const runMultiRepoDialogAction = useCallback(
    async (featureBranch: boolean) => {
      if (!isCommitDialogOpen || !isMultiRepoDialog) return;
      const api = readNativeApi();
      if (!api) {
        toastManager.add({
          type: "error",
          title: "Git actions are unavailable.",
          data: threadToastData,
        });
        return;
      }

      const reposToRun = multiRepoSelectionSummary.filter((section) => {
        if (section.selected.length === 0) {
          return false;
        }
        const previousState = multiRepoExecutionState[section.repoPath];
        return previousState?.status !== "success";
      });
      if (reposToRun.length === 0) {
        return;
      }

      const progressToastId = toastManager.add({
        type: "loading",
        title: featureBranch ? "Committing on new branches..." : "Committing...",
        description: `Running ${reposToRun[0]?.displayPath ?? "git"}...`,
        timeout: 0,
        data: threadToastData,
      });

      try {
        for (const section of reposToRun) {
          toastManager.update(progressToastId, {
            type: "loading",
            title: featureBranch ? "Committing on new branches..." : "Committing...",
            description: `Running ${section.displayPath}...`,
            timeout: 0,
            data: threadToastData,
          });
          setMultiRepoExecutionState((prev) => ({
            ...prev,
            [section.repoPath]: {
              status: "running",
              errorMessage: null,
            },
          }));
          try {
            await api.git.runStackedAction({
              repoPath: section.repoPath,
              ...(gitTarget.projectId ? { projectId: gitTarget.projectId } : {}),
              actionId: randomUUID(),
              modelSelection: gitActionModelSelection,
              action: "commit",
              ...(featureBranch ? { featureBranch: true } : {}),
              ...(!section.allSelected
                ? { filePaths: section.selected.map((file) => file.path) }
                : {}),
              ...(gitRequestSettings ? { settings: gitRequestSettings } : {}),
            });
            setMultiRepoExecutionState((prev) => ({
              ...prev,
              [section.repoPath]: {
                status: "success",
                errorMessage: null,
              },
            }));
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Failed to commit this repo.";
            setMultiRepoExecutionState((prev) => ({
              ...prev,
              [section.repoPath]: {
                status: "error",
                errorMessage,
              },
            }));
            toastManager.update(progressToastId, {
              type: "error",
              title: "Commit failed",
              description: `${section.displayPath}: ${errorMessage}`,
              data: threadToastData,
            });
            await invalidateGitQueries(queryClient).catch(() => undefined);
            return;
          }
        }

        toastManager.update(progressToastId, {
          type: "success",
          title: featureBranch ? "Committed on new branches" : "Committed",
          description: `Updated ${reposToRun.length} ${reposToRun.length === 1 ? "repo" : "repos"}.`,
          data: {
            ...threadToastData,
            dismissAfterVisibleMs: 10_000,
          },
        });
        await invalidateGitQueries(queryClient).catch(() => undefined);
        setIsCommitDialogOpen(false);
        resetCommitDialogState();
      } finally {
        await invalidateGitQueries(queryClient).catch(() => undefined);
      }
    },
    [
      gitActionModelSelection,
      gitRequestSettings,
      gitTarget.projectId,
      isCommitDialogOpen,
      isMultiRepoDialog,
      multiRepoExecutionState,
      multiRepoSelectionSummary,
      queryClient,
      resetCommitDialogState,
      threadToastData,
    ],
  );

  const runDialogActionOnNewBranch = useCallback(() => {
    if (!isCommitDialogOpen) return;
    if (isMultiRepoDialog) {
      void runMultiRepoDialogAction(true);
      return;
    }
    const commitMessage = dialogCommitMessage.trim();

    setIsCommitDialogOpen(false);
    resetCommitDialogState();

    void runGitActionWithToast({
      action: "commit",
      ...(commitMessage ? { commitMessage } : {}),
      ...(!allSelected ? { filePaths: selectedFiles.map((f) => f.path) } : {}),
      featureBranch: true,
      skipDefaultBranchPrompt: true,
    });
  }, [
    allSelected,
    dialogCommitMessage,
    isCommitDialogOpen,
    isMultiRepoDialog,
    resetCommitDialogState,
    runMultiRepoDialogAction,
    selectedFiles,
  ]);

  const runQuickAction = useCallback(() => {
    if (quickAction.kind === "open_pr") {
      void openExistingPr();
      return;
    }
    if (quickAction.kind === "run_pull") {
      const promise = pullMutation.mutateAsync();
      toastManager.promise(promise, {
        loading: { title: "Pulling...", data: threadToastData },
        success: (result) => ({
          title: result.status === "pulled" ? "Pulled" : "Already up to date",
          description:
            result.status === "pulled"
              ? `Updated ${result.branch} from ${result.upstreamBranch ?? "upstream"}`
              : `${result.branch} is already synchronized.`,
          data: threadToastData,
        }),
        error: (err) => ({
          title: "Pull failed",
          description: err instanceof Error ? err.message : "An error occurred.",
          data: threadToastData,
        }),
      });
      void promise.catch(() => undefined);
      return;
    }
    if (quickAction.kind === "show_hint") {
      toastManager.add({
        type: "info",
        title: quickAction.label,
        description: quickAction.hint,
        data: threadToastData,
      });
      return;
    }
    if (quickAction.action) {
      void runGitActionWithToast({ action: quickAction.action });
    }
  }, [openExistingPr, pullMutation, quickAction, threadToastData]);

  const openDialogForMenuItem = useCallback(
    (item: GitActionMenuItem) => {
      if (item.disabled) return;
      if (item.kind === "open_pr") {
        void openExistingPr();
        return;
      }
      if (item.dialogAction === "push") {
        void runGitActionWithToast({ action: "commit_push", forcePushOnlyProgress: true });
        return;
      }
      if (item.dialogAction === "create_pr") {
        void runGitActionWithToast({ action: "commit_push_pr" });
        return;
      }
      resetCommitDialogState();
      setIsCommitDialogOpen(true);
    },
    [openExistingPr, resetCommitDialogState, setIsCommitDialogOpen],
  );

  const runDialogAction = useCallback(() => {
    if (!isCommitDialogOpen) return;
    if (isMultiRepoDialog) {
      void runMultiRepoDialogAction(false);
      return;
    }
    const commitMessage = dialogCommitMessage.trim();
    setIsCommitDialogOpen(false);
    resetCommitDialogState();
    void runGitActionWithToast({
      action: "commit",
      ...(commitMessage ? { commitMessage } : {}),
      ...(!allSelected ? { filePaths: selectedFiles.map((f) => f.path) } : {}),
    });
  }, [
    allSelected,
    dialogCommitMessage,
    isCommitDialogOpen,
    isMultiRepoDialog,
    resetCommitDialogState,
    runMultiRepoDialogAction,
    selectedFiles,
  ]);

  const openChangedFileInEditor = useCallback(
    (filePath: string, referenceRoot: string) => {
      const api = readNativeApi();
      if (!api) {
        toastManager.add({
          type: "error",
          title: "Editor opening is unavailable.",
          data: threadToastData,
        });
        return;
      }
      const target = resolveProjectEditorTargetFromRawPath(filePath, {
        projectId: gitTarget.projectId ?? undefined,
        threadId: activeThreadId ?? undefined,
        referenceRoot,
        remote: projectRemote,
      });
      if (!target) {
        toastManager.add({
          type: "info",
          title: "Open in editor is unavailable for this file.",
          data: threadToastData,
        });
        return;
      }
      void openResolvedEditorTargetInPreferredEditor(api, target).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Unable to open file",
          description: error instanceof Error ? error.message : "An error occurred.",
          data: threadToastData,
        });
      });
    },
    [activeThreadId, gitTarget.projectId, projectRemote, threadToastData],
  );

  if (!gitTarget.repoPath) return null;

  return (
    <>
      {!isRepo ? (
        <Button
          variant="outline"
          size="xs"
          disabled={initMutation.isPending}
          onClick={() => initMutation.mutate()}
        >
          {initMutation.isPending ? "Initializing..." : "Initialize Git"}
        </Button>
      ) : (
        <Group aria-label="Git actions" className="shrink-0">
          {quickActionDisabledReason ? (
            <Popover>
              <PopoverTrigger
                openOnHover
                render={
                  <Button
                    aria-disabled="true"
                    className="cursor-not-allowed rounded-e-none border-e-0 opacity-64 before:rounded-e-none"
                    size="xs"
                    variant="outline"
                  />
                }
              >
                <GitQuickActionIcon quickAction={quickAction} />
                <span className="sr-only @sm/header-actions:not-sr-only @sm/header-actions:ml-0.5">
                  {quickAction.label}
                </span>
              </PopoverTrigger>
              <PopoverPopup tooltipStyle side="bottom" align="start">
                {quickActionDisabledReason}
              </PopoverPopup>
            </Popover>
          ) : (
            <Button
              variant="outline"
              size="xs"
              disabled={isGitActionRunning || quickAction.disabled}
              onClick={runQuickAction}
            >
              <GitQuickActionIcon quickAction={quickAction} />
              <span className="sr-only @sm/header-actions:not-sr-only @sm/header-actions:ml-0.5">
                {quickAction.label}
              </span>
            </Button>
          )}
          <GroupSeparator className="hidden @sm/header-actions:block" />
          <Menu
            onOpenChange={(open) => {
              if (open) void invalidateGitQueries(queryClient);
            }}
          >
            <MenuTrigger
              render={<Button aria-label="Git action options" size="icon-xs" variant="outline" />}
              disabled={isGitActionRunning}
            >
              <ChevronDownIcon aria-hidden="true" className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end" className="w-full">
              {gitActionMenuItems.map((item) => {
                const disabledReason = getMenuActionDisabledReason({
                  item,
                  gitStatus: gitStatusForActions,
                  isBusy: isGitActionRunning,
                  hasOriginRemote,
                });
                if (item.disabled && disabledReason) {
                  return (
                    <Popover key={`${item.id}-${item.label}`}>
                      <PopoverTrigger
                        openOnHover
                        nativeButton={false}
                        render={<span className="block w-max cursor-not-allowed" />}
                      >
                        <MenuItem className="w-full" disabled>
                          <GitActionItemIcon icon={item.icon} />
                          {item.label}
                        </MenuItem>
                      </PopoverTrigger>
                      <PopoverPopup tooltipStyle side="left" align="center">
                        {disabledReason}
                      </PopoverPopup>
                    </Popover>
                  );
                }

                return (
                  <MenuItem
                    key={`${item.id}-${item.label}`}
                    disabled={item.disabled}
                    onClick={() => {
                      openDialogForMenuItem(item);
                    }}
                  >
                    <GitActionItemIcon icon={item.icon} />
                    {item.label}
                  </MenuItem>
                );
              })}
              {gitStatusForActions?.branch === null && (
                <p className="px-2 py-1.5 text-xs text-warning">
                  Detached HEAD: create and checkout a branch to enable push and PR actions.
                </p>
              )}
              {gitStatusForActions &&
                gitStatusForActions.branch !== null &&
                !gitStatusForActions.hasWorkingTreeChanges &&
                gitStatusForActions.behindCount > 0 &&
                gitStatusForActions.aheadCount === 0 && (
                  <p className="px-2 py-1.5 text-xs text-warning">
                    Behind upstream. Pull/rebase first.
                  </p>
                )}
              {isGitStatusOutOfSync && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  Refreshing git status...
                </p>
              )}
              {gitStatusError && (
                <p className="px-2 py-1.5 text-xs text-destructive">{gitStatusError.message}</p>
              )}
            </MenuPopup>
          </Menu>
        </Group>
      )}

      <Dialog
        open={isCommitDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsCommitDialogOpen(false);
            resetCommitDialogState();
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{COMMIT_DIALOG_TITLE}</DialogTitle>
            <DialogDescription>
              {isMultiRepoDialog ? MULTI_REPO_COMMIT_DIALOG_DESCRIPTION : COMMIT_DIALOG_DESCRIPTION}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            {isMultiRepoDialog ? (
              <div className="space-y-3">
                {multiRepoSelectionSummary.map((section) => {
                  const executionState = multiRepoExecutionState[section.repoPath];
                  const isEditingRepo = editingRepos[section.repoPath] ?? false;
                  return (
                    <div
                      key={section.repoPath}
                      className="space-y-3 rounded-lg border border-input bg-muted/40 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-sm">{section.displayPath}</p>
                        {executionState?.status === "running" ? (
                          <span className="text-muted-foreground">Committing...</span>
                        ) : executionState?.status === "success" ? (
                          <span className="text-success">Committed</span>
                        ) : executionState?.status === "error" ? (
                          <span className="text-destructive">Retry required</span>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
                        <span className="text-muted-foreground">Branch</span>
                        <span className="font-medium">
                          {section.status?.branch ?? "(detached HEAD)"}
                        </span>
                      </div>
                      {section.isDefaultBranch && (
                        <Alert variant="warning">
                          <InfoIcon />
                          <AlertTitle>Default branch</AlertTitle>
                          <AlertDescription>
                            Commit on new branch to avoid committing directly to the default branch.
                          </AlertDescription>
                        </Alert>
                      )}
                      {section.statusErrorMessage && (
                        <Alert variant="error">
                          <InfoIcon />
                          <AlertTitle>Git status unavailable</AlertTitle>
                          <AlertDescription>{section.statusErrorMessage}</AlertDescription>
                        </Alert>
                      )}
                      {executionState?.status === "error" && executionState.errorMessage && (
                        <Alert variant="error">
                          <InfoIcon />
                          <AlertTitle>Commit failed</AlertTitle>
                          <AlertDescription>{executionState.errorMessage}</AlertDescription>
                        </Alert>
                      )}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isEditingRepo && section.files.length > 0 && (
                              <Checkbox
                                checked={section.allSelected}
                                indeterminate={!section.allSelected && !section.noneSelected}
                                onCheckedChange={() => {
                                  setExcludedFilesByRepo((prev) => ({
                                    ...prev,
                                    [section.repoPath]: section.allSelected
                                      ? section.files.map((file) => file.path)
                                      : [],
                                  }));
                                }}
                              />
                            )}
                            <span className="text-muted-foreground">Files</span>
                            {!section.allSelected && !isEditingRepo && (
                              <span className="text-muted-foreground">
                                ({section.selected.length} of {section.files.length})
                              </span>
                            )}
                          </div>
                          {section.files.length > 0 && (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() =>
                                setEditingRepos((prev) => ({
                                  ...prev,
                                  [section.repoPath]: !isEditingRepo,
                                }))
                              }
                            >
                              {isEditingRepo ? "Done" : "Edit"}
                            </Button>
                          )}
                        </div>
                        {section.files.length === 0 ? (
                          <p className="font-medium">none</p>
                        ) : (
                          <div className="space-y-2">
                            <ScrollArea className="h-44 rounded-md border border-input bg-background">
                              <div className="space-y-1 p-1">
                                {section.files.map((file) => {
                                  const isExcluded = section.excluded.has(file.path);
                                  return (
                                    <div
                                      key={`${section.repoPath}:${file.path}`}
                                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors hover:bg-accent/50"
                                    >
                                      {isEditingRepo && (
                                        <Checkbox
                                          checked={!isExcluded}
                                          onCheckedChange={() => {
                                            setExcludedFilesByRepo((prev) => {
                                              const current = new Set(prev[section.repoPath] ?? []);
                                              if (current.has(file.path)) {
                                                current.delete(file.path);
                                              } else {
                                                current.add(file.path);
                                              }
                                              return {
                                                ...prev,
                                                [section.repoPath]: [...current],
                                              };
                                            });
                                          }}
                                        />
                                      )}
                                      <button
                                        type="button"
                                        className="flex flex-1 items-center justify-between gap-3 text-left truncate"
                                        onClick={() =>
                                          openChangedFileInEditor(file.path, section.repoPath)
                                        }
                                      >
                                        <span
                                          className={`truncate${isExcluded ? " text-muted-foreground" : ""}`}
                                        >
                                          {file.path}
                                        </span>
                                        <span className="shrink-0">
                                          {isExcluded ? (
                                            <span className="text-muted-foreground">Excluded</span>
                                          ) : (
                                            <>
                                              <span className="text-success">
                                                +{file.insertions}
                                              </span>
                                              <span className="text-muted-foreground"> / </span>
                                              <span className="text-destructive">
                                                -{file.deletions}
                                              </span>
                                            </>
                                          )}
                                        </span>
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </ScrollArea>
                            <div className="flex justify-end font-mono">
                              <span className="text-success">
                                +{section.selected.reduce((sum, file) => sum + file.insertions, 0)}
                              </span>
                              <span className="text-muted-foreground"> / </span>
                              <span className="text-destructive">
                                -{section.selected.reduce((sum, file) => sum + file.deletions, 0)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="space-y-3 rounded-lg border border-input bg-muted/40 p-3 text-xs">
                  <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
                    <span className="text-muted-foreground">Branch</span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {gitStatusForActions?.branch ?? "(detached HEAD)"}
                      </span>
                      {isDefaultBranch && (
                        <span className="text-right text-warning text-xs">
                          Warning: default branch
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isEditingFiles && allFiles.length > 0 && (
                          <Checkbox
                            checked={allSelected}
                            indeterminate={!allSelected && !noneSelected}
                            onCheckedChange={() => {
                              setExcludedFiles(
                                allSelected ? new Set(allFiles.map((f) => f.path)) : new Set(),
                              );
                            }}
                          />
                        )}
                        <span className="text-muted-foreground">Files</span>
                        {!allSelected && !isEditingFiles && (
                          <span className="text-muted-foreground">
                            ({selectedFiles.length} of {allFiles.length})
                          </span>
                        )}
                      </div>
                      {allFiles.length > 0 && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setIsEditingFiles((prev) => !prev)}
                        >
                          {isEditingFiles ? "Done" : "Edit"}
                        </Button>
                      )}
                    </div>
                    {!gitStatusForActions || allFiles.length === 0 ? (
                      <p className="font-medium">none</p>
                    ) : (
                      <div className="space-y-2">
                        <ScrollArea className="h-44 rounded-md border border-input bg-background">
                          <div className="space-y-1 p-1">
                            {allFiles.map((file) => {
                              const isExcluded = excludedFiles.has(file.path);
                              return (
                                <div
                                  key={file.path}
                                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors hover:bg-accent/50"
                                >
                                  {isEditingFiles && (
                                    <Checkbox
                                      checked={!excludedFiles.has(file.path)}
                                      onCheckedChange={() => {
                                        setExcludedFiles((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(file.path)) {
                                            next.delete(file.path);
                                          } else {
                                            next.add(file.path);
                                          }
                                          return next;
                                        });
                                      }}
                                    />
                                  )}
                                  <button
                                    type="button"
                                    className="flex flex-1 items-center justify-between gap-3 text-left truncate"
                                    onClick={() =>
                                      openChangedFileInEditor(file.path, gitTarget.repoPath!)
                                    }
                                  >
                                    <span
                                      className={`truncate${isExcluded ? " text-muted-foreground" : ""}`}
                                    >
                                      {file.path}
                                    </span>
                                    <span className="shrink-0">
                                      {isExcluded ? (
                                        <span className="text-muted-foreground">Excluded</span>
                                      ) : (
                                        <>
                                          <span className="text-success">+{file.insertions}</span>
                                          <span className="text-muted-foreground"> / </span>
                                          <span className="text-destructive">
                                            -{file.deletions}
                                          </span>
                                        </>
                                      )}
                                    </span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </ScrollArea>
                        <div className="flex justify-end font-mono">
                          <span className="text-success">
                            +{selectedFiles.reduce((sum, f) => sum + f.insertions, 0)}
                          </span>
                          <span className="text-muted-foreground"> / </span>
                          <span className="text-destructive">
                            -{selectedFiles.reduce((sum, f) => sum + f.deletions, 0)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium">Commit message (optional)</p>
                  <Textarea
                    value={dialogCommitMessage}
                    onChange={(event) => setDialogCommitMessage(event.target.value)}
                    placeholder="Leave empty to auto-generate"
                    size="sm"
                  />
                </div>
              </>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={multiRepoHasRunningRepo}
              onClick={() => {
                setIsCommitDialogOpen(false);
                resetCommitDialogState();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={
                isMultiRepoDialog
                  ? !multiRepoHasAnySelectedFiles || multiRepoHasRunningRepo
                  : noneSelected
              }
              onClick={runDialogActionOnNewBranch}
            >
              {isMultiRepoDialog ? multiRepoRetryNewBranchLabel : "Commit on new branch"}
            </Button>
            <Button
              size="sm"
              disabled={
                isMultiRepoDialog
                  ? !multiRepoHasAnySelectedFiles || multiRepoHasRunningRepo
                  : noneSelected
              }
              onClick={runDialogAction}
            >
              {isMultiRepoDialog ? multiRepoRetryLabel : "Commit"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={pendingDefaultBranchAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDefaultBranchAction(null);
          }
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {pendingDefaultBranchActionCopy?.title ?? "Run action on default branch?"}
            </DialogTitle>
            <DialogDescription>{pendingDefaultBranchActionCopy?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingDefaultBranchAction(null)}>
              Abort
            </Button>
            <Button variant="outline" size="sm" onClick={continuePendingDefaultBranchAction}>
              {pendingDefaultBranchActionCopy?.continueLabel ?? "Continue"}
            </Button>
            <Button size="sm" onClick={checkoutFeatureBranchAndContinuePendingAction}>
              Checkout feature branch & continue
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

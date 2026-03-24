import type { GitRequestSettings, GitStackedAction, ProjectId } from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";

const GIT_STATUS_STALE_TIME_MS = 5_000;
const GIT_STATUS_REFETCH_INTERVAL_MS = 15_000;
const GIT_BRANCHES_STALE_TIME_MS = 15_000;
const GIT_BRANCHES_REFETCH_INTERVAL_MS = 60_000;

export interface GitQueryTarget {
  cwd: string | null;
  projectId: ProjectId | null;
}

function toGitApiTarget(target: GitQueryTarget): { cwd: string; projectId?: ProjectId } {
  if (!target.cwd) {
    throw new Error("Git is unavailable.");
  }
  return {
    cwd: target.cwd,
    ...(target.projectId ? { projectId: target.projectId } : {}),
  };
}

export const gitQueryKeys = {
  all: ["git"] as const,
  status: (target: GitQueryTarget, settings?: GitRequestSettings) =>
    ["git", "status", target.projectId, target.cwd, settings?.githubBinaryPath ?? null] as const,
  branches: (target: GitQueryTarget) => ["git", "branches", target.projectId, target.cwd] as const,
};

export const gitMutationKeys = {
  init: (target: GitQueryTarget) =>
    ["git", "mutation", "init", target.projectId, target.cwd] as const,
  checkout: (target: GitQueryTarget) =>
    ["git", "mutation", "checkout", target.projectId, target.cwd] as const,
  runStackedAction: (target: GitQueryTarget) =>
    ["git", "mutation", "run-stacked-action", target.projectId, target.cwd] as const,
  pull: (target: GitQueryTarget) =>
    ["git", "mutation", "pull", target.projectId, target.cwd] as const,
  preparePullRequestThread: (target: GitQueryTarget) =>
    ["git", "mutation", "prepare-pull-request-thread", target.projectId, target.cwd] as const,
};

export function invalidateGitQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: gitQueryKeys.all });
}

export function gitStatusQueryOptions(target: GitQueryTarget, settings?: GitRequestSettings) {
  return queryOptions({
    queryKey: gitQueryKeys.status(target, settings),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.git.status({
        ...toGitApiTarget(target),
        ...(settings ? { settings } : {}),
      });
    },
    enabled: target.cwd !== null,
    staleTime: GIT_STATUS_STALE_TIME_MS,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
  });
}

export function gitBranchesQueryOptions(target: GitQueryTarget) {
  return queryOptions({
    queryKey: gitQueryKeys.branches(target),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.git.listBranches(toGitApiTarget(target));
    },
    enabled: target.cwd !== null,
    staleTime: GIT_BRANCHES_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_BRANCHES_REFETCH_INTERVAL_MS,
  });
}

export function gitResolvePullRequestQueryOptions(input: {
  target: GitQueryTarget;
  reference: string | null;
  settings?: GitRequestSettings;
}) {
  return queryOptions({
    queryKey: [
      "git",
      "pull-request",
      input.target.projectId,
      input.target.cwd,
      input.reference,
      input.settings?.githubBinaryPath ?? null,
    ] as const,
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.target.cwd || !input.reference) {
        throw new Error("Pull request lookup is unavailable.");
      }
      return api.git.resolvePullRequest({
        ...toGitApiTarget(input.target),
        reference: input.reference,
        ...(input.settings ? { settings: input.settings } : {}),
      });
    },
    enabled: input.target.cwd !== null && input.reference !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function gitInitMutationOptions(input: {
  target: GitQueryTarget;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitMutationKeys.init(input.target),
    mutationFn: async () => {
      const api = ensureNativeApi();
      return api.git.init(toGitApiTarget(input.target));
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitCheckoutMutationOptions(input: {
  target: GitQueryTarget;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitMutationKeys.checkout(input.target),
    mutationFn: async (branch: string) => {
      const api = ensureNativeApi();
      return api.git.checkout({ ...toGitApiTarget(input.target), branch });
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitRunStackedActionMutationOptions(input: {
  target: GitQueryTarget;
  queryClient: QueryClient;
  settings?: GitRequestSettings;
}) {
  return mutationOptions({
    mutationKey: gitMutationKeys.runStackedAction(input.target),
    mutationFn: async ({
      actionId,
      action,
      commitMessage,
      featureBranch,
      filePaths,
    }: {
      actionId: string;
      action: GitStackedAction;
      commitMessage?: string;
      featureBranch?: boolean;
      filePaths?: string[];
    }) => {
      const api = ensureNativeApi();
      return api.git.runStackedAction({
        ...toGitApiTarget(input.target),
        actionId,
        action,
        ...(commitMessage ? { commitMessage } : {}),
        ...(featureBranch ? { featureBranch } : {}),
        ...(filePaths ? { filePaths } : {}),
        ...(input.settings ? { settings: input.settings } : {}),
        ...(input.settings ? { settings: input.settings } : {}),
      });
    },
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitPullMutationOptions(input: {
  target: GitQueryTarget;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitMutationKeys.pull(input.target),
    mutationFn: async () => {
      const api = ensureNativeApi();
      return api.git.pull(toGitApiTarget(input.target));
    },
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitCreateWorktreeMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async ({
      cwd,
      projectId,
      branch,
      newBranch,
      path,
    }: {
      cwd: string;
      projectId?: ProjectId | null;
      branch: string;
      newBranch: string;
      path?: string | null;
    }) => {
      const api = ensureNativeApi();
      return api.git.createWorktree({
        cwd,
        ...(projectId ? { projectId } : {}),
        branch,
        newBranch,
        path: path ?? null,
      });
    },
    mutationKey: ["git", "mutation", "create-worktree"] as const,
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitRemoveWorktreeMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async ({
      cwd,
      projectId,
      path,
      force,
    }: {
      cwd: string;
      projectId?: ProjectId | null;
      path: string;
      force?: boolean;
    }) => {
      const api = ensureNativeApi();
      return api.git.removeWorktree({
        cwd,
        ...(projectId ? { projectId } : {}),
        path,
        force,
      });
    },
    mutationKey: ["git", "mutation", "remove-worktree"] as const,
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitPreparePullRequestThreadMutationOptions(input: {
  target: GitQueryTarget;
  queryClient: QueryClient;
  settings?: GitRequestSettings;
}) {
  return mutationOptions({
    mutationFn: async ({ reference, mode }: { reference: string; mode: "local" | "worktree" }) => {
      const api = ensureNativeApi();
      return api.git.preparePullRequestThread({
        ...toGitApiTarget(input.target),
        reference,
        mode,
        ...(input.settings ? { settings: input.settings } : {}),
      });
    },
    mutationKey: gitMutationKeys.preparePullRequestThread(input.target),
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("../nativeApi", () => ({
  ensureNativeApi: vi.fn(),
}));

vi.mock("../wsRpcClient", () => ({
  getWsRpcClient: vi.fn(),
}));

import {
  gitBranchesQueryOptions,
  gitMutationKeys,
  gitQueryKeys,
  gitPreparePullRequestThreadMutationOptions,
  gitPullMutationOptions,
  type GitQueryTarget,
  gitRunStackedActionMutationOptions,
  invalidateGitStatusQuery,
  gitStatusQueryOptions,
  invalidateGitQueries,
} from "./gitReactQuery";

describe("gitMutationKeys", () => {
  const repoATarget: GitQueryTarget = { repoPath: "/repo/a", projectId: null };
  const repoBTarget: GitQueryTarget = { repoPath: "/repo/b", projectId: null };

  it("scopes stacked action keys by repoPath", () => {
    expect(gitMutationKeys.runStackedAction(repoATarget)).not.toEqual(
      gitMutationKeys.runStackedAction(repoBTarget),
    );
  });

  it("scopes pull keys by repoPath", () => {
    expect(gitMutationKeys.pull(repoATarget)).not.toEqual(gitMutationKeys.pull(repoBTarget));
  });

  it("scopes pull request thread preparation keys by repoPath", () => {
    expect(gitMutationKeys.preparePullRequestThread(repoATarget)).not.toEqual(
      gitMutationKeys.preparePullRequestThread(repoBTarget),
    );
  });
});

describe("git mutation options", () => {
  const queryClient = new QueryClient();
  const target: GitQueryTarget = { repoPath: "/repo/a", projectId: null };

  it("attaches repoPath-scoped mutation key for runStackedAction", () => {
    const options = gitRunStackedActionMutationOptions({
      target,
      queryClient,
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
    });
    expect(options.mutationKey).toEqual(gitMutationKeys.runStackedAction(target));
  });

  it("attaches repoPath-scoped mutation key for pull", () => {
    const options = gitPullMutationOptions({ target, queryClient });
    expect(options.mutationKey).toEqual(gitMutationKeys.pull(target));
  });

  it("attaches repoPath-scoped mutation key for preparePullRequestThread", () => {
    const options = gitPreparePullRequestThreadMutationOptions({
      target,
      queryClient,
    });
    expect(options.mutationKey).toEqual(gitMutationKeys.preparePullRequestThread(target));
  });
});

describe("invalidateGitQueries", () => {
  it("can invalidate a single cwd without blasting other git query scopes", async () => {
    const queryClient = new QueryClient();
    const repoATarget: GitQueryTarget = { repoPath: "/repo/a", projectId: null };
    const repoBTarget: GitQueryTarget = { repoPath: "/repo/b", projectId: null };

    queryClient.setQueryData(gitQueryKeys.status(repoATarget), { ok: "a" });
    queryClient.setQueryData(gitQueryKeys.branches(repoATarget), { ok: "a-branches" });
    queryClient.setQueryData(gitQueryKeys.status(repoBTarget), { ok: "b" });
    queryClient.setQueryData(gitQueryKeys.branches(repoBTarget), { ok: "b-branches" });

    await invalidateGitQueries(queryClient, { target: repoATarget });

    expect(
      queryClient.getQueryState(gitStatusQueryOptions(repoATarget).queryKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(gitBranchesQueryOptions(repoATarget).queryKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(gitStatusQueryOptions(repoBTarget).queryKey)?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(gitBranchesQueryOptions(repoBTarget).queryKey)?.isInvalidated,
    ).toBe(false);
  });
});

describe("invalidateGitStatusQuery", () => {
  it("invalidates only status for the selected cwd", async () => {
    const queryClient = new QueryClient();
    const repoATarget: GitQueryTarget = { repoPath: "/repo/a", projectId: null };
    const repoBTarget: GitQueryTarget = { repoPath: "/repo/b", projectId: null };

    queryClient.setQueryData(gitQueryKeys.status(repoATarget), { ok: "a" });
    queryClient.setQueryData(gitQueryKeys.branches(repoATarget), { ok: "a-branches" });
    queryClient.setQueryData(gitQueryKeys.status(repoBTarget), { ok: "b" });

    await invalidateGitStatusQuery(queryClient, repoATarget);

    expect(
      queryClient.getQueryState(gitStatusQueryOptions(repoATarget).queryKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(gitBranchesQueryOptions(repoATarget).queryKey)?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(gitStatusQueryOptions(repoBTarget).queryKey)?.isInvalidated,
    ).toBe(false);
  });
});

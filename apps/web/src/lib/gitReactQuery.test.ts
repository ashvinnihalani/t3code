import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  gitMutationKeys,
  gitPreparePullRequestThreadMutationOptions,
  gitPullMutationOptions,
  type GitQueryTarget,
  gitRunStackedActionMutationOptions,
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

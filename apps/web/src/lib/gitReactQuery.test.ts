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
  const repoATarget: GitQueryTarget = { cwd: "/repo/a", projectId: null };
  const repoBTarget: GitQueryTarget = { cwd: "/repo/b", projectId: null };

  it("scopes stacked action keys by cwd", () => {
    expect(gitMutationKeys.runStackedAction(repoATarget)).not.toEqual(
      gitMutationKeys.runStackedAction(repoBTarget),
    );
  });

  it("scopes pull keys by cwd", () => {
    expect(gitMutationKeys.pull(repoATarget)).not.toEqual(gitMutationKeys.pull(repoBTarget));
  });

  it("scopes pull request thread preparation keys by cwd", () => {
    expect(gitMutationKeys.preparePullRequestThread(repoATarget)).not.toEqual(
      gitMutationKeys.preparePullRequestThread(repoBTarget),
    );
  });
});

describe("git mutation options", () => {
  const queryClient = new QueryClient();
  const target: GitQueryTarget = { cwd: "/repo/a", projectId: null };

  it("attaches cwd-scoped mutation key for runStackedAction", () => {
    const options = gitRunStackedActionMutationOptions({ target, queryClient });
    expect(options.mutationKey).toEqual(gitMutationKeys.runStackedAction(target));
  });

  it("attaches cwd-scoped mutation key for pull", () => {
    const options = gitPullMutationOptions({ target, queryClient });
    expect(options.mutationKey).toEqual(gitMutationKeys.pull(target));
  });

  it("attaches cwd-scoped mutation key for preparePullRequestThread", () => {
    const options = gitPreparePullRequestThreadMutationOptions({
      target,
      queryClient,
    });
    expect(options.mutationKey).toEqual(gitMutationKeys.preparePullRequestThread(target));
  });
});

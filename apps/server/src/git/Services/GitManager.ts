/**
 * GitManager - Effect service contract for stacked Git workflows.
 *
 * Orchestrates status inspection and commit/push/PR flows by composing
 * lower-level Git and external tool services.
 *
 * @module GitManager
 */
import {
  GitActionProgressEvent,
  GitProjectCheckoutInput,
  GitProjectCheckoutResult,
  GitProjectCreateBranchInput,
  GitProjectCreateBranchResult,
  GitProjectCreateWorktreeInput,
  GitProjectCreateWorktreeResult,
  GitProjectListBranchesInput,
  GitProjectListBranchesResult,
  GitProjectPullInput,
  GitProjectPullResult,
  GitProjectRunStackedActionInput,
  GitProjectRunStackedActionResult,
  GitProjectStatusInput,
  GitProjectStatusResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitStatusInput,
  GitStatusResult,
  ProjectGitRepo,
  ProjectRemoteTarget,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { GitManagerServiceError } from "../Errors.ts";

export interface GitStatusExecutionInput extends GitStatusInput {
  remote?: ProjectRemoteTarget | null;
}

export interface GitPullRequestRefExecutionInput extends GitPullRequestRefInput {
  remote?: ProjectRemoteTarget | null;
}

export interface GitActionProgressReporter {
  readonly publish: (event: GitActionProgressEvent) => Effect.Effect<void, never>;
}

export interface GitPreparePullRequestThreadExecutionInput extends GitPreparePullRequestThreadInput {
  remote?: ProjectRemoteTarget | null;
}

export interface GitRunStackedActionExecutionInput extends GitRunStackedActionInput {
  remote?: ProjectRemoteTarget | null;
}

interface GitProjectExecutionContext {
  workspaceRoot: string;
  gitRepos: ReadonlyArray<ProjectGitRepo>;
  remote?: ProjectRemoteTarget | null;
}

export interface GitProjectStatusExecutionInput
  extends GitProjectStatusInput, GitProjectExecutionContext {}

export interface GitProjectListBranchesExecutionInput
  extends GitProjectListBranchesInput, GitProjectExecutionContext {}

export interface GitProjectCreateBranchExecutionInput
  extends GitProjectCreateBranchInput, GitProjectExecutionContext {}

export interface GitProjectCheckoutExecutionInput
  extends GitProjectCheckoutInput, GitProjectExecutionContext {}

export interface GitProjectCreateWorktreeExecutionInput
  extends GitProjectCreateWorktreeInput, GitProjectExecutionContext {}

export interface GitProjectPullExecutionInput
  extends GitProjectPullInput, GitProjectExecutionContext {}

export interface GitProjectRunStackedActionExecutionInput
  extends GitProjectRunStackedActionInput, GitProjectExecutionContext {}

export interface GitRunStackedActionOptions {
  readonly actionId?: string;
  readonly progressReporter?: GitActionProgressReporter;
}

/**
 * GitManagerShape - Service API for high-level Git workflow actions.
 */
export interface GitManagerShape {
  /**
   * Read current repository Git status plus open PR metadata when available.
   */
  readonly status: (
    input: GitStatusExecutionInput,
  ) => Effect.Effect<GitStatusResult, GitManagerServiceError>;

  readonly projectStatus: (
    input: GitProjectStatusExecutionInput,
  ) => Effect.Effect<GitProjectStatusResult, GitManagerServiceError>;

  /**
   * Resolve a pull request by URL/number against the current repository.
   */
  readonly resolvePullRequest: (
    input: GitPullRequestRefExecutionInput,
  ) => Effect.Effect<GitResolvePullRequestResult, GitManagerServiceError>;

  /**
   * Prepare a new thread workspace from a pull request in local or worktree mode.
   */
  readonly preparePullRequestThread: (
    input: GitPreparePullRequestThreadExecutionInput,
  ) => Effect.Effect<GitPreparePullRequestThreadResult, GitManagerServiceError>;

  readonly projectListBranches: (
    input: GitProjectListBranchesExecutionInput,
  ) => Effect.Effect<GitProjectListBranchesResult, GitManagerServiceError>;

  readonly projectCreateBranch: (
    input: GitProjectCreateBranchExecutionInput,
  ) => Effect.Effect<GitProjectCreateBranchResult, GitManagerServiceError>;

  readonly projectCheckout: (
    input: GitProjectCheckoutExecutionInput,
  ) => Effect.Effect<GitProjectCheckoutResult, GitManagerServiceError>;

  readonly projectCreateWorktree: (
    input: GitProjectCreateWorktreeExecutionInput,
  ) => Effect.Effect<GitProjectCreateWorktreeResult, GitManagerServiceError>;

  readonly projectPull: (
    input: GitProjectPullExecutionInput,
  ) => Effect.Effect<GitProjectPullResult, GitManagerServiceError>;

  /**
   * Run a stacked Git action (`commit`, `commit_push`, `commit_push_pr`).
   * When `featureBranch` is set, creates and checks out a feature branch first.
   */
  readonly runStackedAction: (
    input: GitRunStackedActionExecutionInput,
    options?: GitRunStackedActionOptions,
  ) => Effect.Effect<GitRunStackedActionResult, GitManagerServiceError>;

  readonly projectRunStackedAction: (
    input: GitProjectRunStackedActionExecutionInput,
    options?: GitRunStackedActionOptions,
  ) => Effect.Effect<GitProjectRunStackedActionResult, GitManagerServiceError>;
}

/**
 * GitManager - Service tag for stacked Git workflow orchestration.
 */
export class GitManager extends ServiceMap.Service<GitManager, GitManagerShape>()(
  "t3/git/Services/GitManager",
) {}
